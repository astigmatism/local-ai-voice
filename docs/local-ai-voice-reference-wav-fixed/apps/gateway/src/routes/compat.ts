import type { FastifyInstance } from 'fastify';
import { builtInVoices, sttCatalog, ttsCatalog } from '../catalog.js';
import type { AppConfig } from '../config.js';
import type { ConfigStore } from '../config-store.js';
import { getGpuStatus } from '../gpu.js';
import { saveUpload } from '../storage.js';
import {
  listReferenceAudio,
  publicActiveReference,
  resolveRequestedOrActiveReferenceId,
  validateReferenceWavUpload
} from '../reference-audio.js';
import type { WorkerClient } from '../worker-client.js';
import { getFirstFile, normalizeSpeakRequest, readMultipartPayload, sendError } from './helpers.js';

export interface CompatRouteDependencies {
  config: AppConfig;
  configStore: ConfigStore;
  sttClient: WorkerClient;
  ttsClient: WorkerClient;
}

function referenceIdFromSpeakRequest(request: { referenceId?: string; referenceAudioId?: string; voice?: string }): string | undefined {
  return request.referenceId ?? request.referenceAudioId ?? (request.voice?.endsWith('.wav') ? request.voice : undefined);
}

export async function registerCompatRoutes(app: FastifyInstance, deps: CompatRouteDependencies): Promise<void> {
  const { config, configStore, sttClient, ttsClient } = deps;

  app.get('/health', async () => {
    const [stt, tts] = await Promise.all([sttClient.health(), ttsClient.health()]);
    return {
      status: stt.ok || tts.ok ? 'ok' : 'degraded',
      gateway: 'local-ai-voice-node-gateway',
      stt,
      tts
    };
  });

  app.get('/gpu', async () => await getGpuStatus());

  app.get('/models', async () => {
    const mutable = await configStore.read();
    return {
      default_model: mutable.stt.defaultModel,
      active_model: (await sttClient.modelStatus().catch(() => undefined))?.loadedModel ?? null,
      stt: sttCatalog(config),
      tts: ttsCatalog(config)
    };
  });

  app.get('/voices', async () => {
    const mutable = await configStore.read();
    const active = publicActiveReference(mutable);
    const uploaded = await listReferenceAudio(config, mutable.tts.provider);
    return {
      voices: [
        ...builtInVoices(),
        ...uploaded.map((reference) => ({
          ...reference,
          label: reference.filename,
          referenceAudio: true,
          active: reference.referenceId === active?.referenceId
        }))
      ],
      activeReferenceAudio: active
    };
  });

  app.get('/model/default', async () => {
    const mutable = await configStore.read();
    return { default_model: mutable.stt.defaultModel, provider: mutable.stt.provider };
  });

  app.get('/voice/default', async () => {
    const mutable = await configStore.read();
    const active = publicActiveReference(mutable);
    return {
      default_voice: active?.referenceId ?? 'reference-upload',
      provider: mutable.tts.provider,
      model: mutable.tts.defaultModel,
      activeReferenceAudio: active
    };
  });

  app.post('/speak', async (request, reply) => {
    try {
      let speakRequest;
      let referenceAudio;
      if (request.isMultipart()) {
        const payload = await readMultipartPayload(request, config);
        speakRequest = normalizeSpeakRequest(undefined, payload.fields);
        referenceAudio = payload.files.find((file) => ['reference_audio', 'reference', 'voice'].includes(file.fieldname));
        if (referenceAudio) validateReferenceWavUpload(referenceAudio, config.maxUploadBytes);
      } else {
        speakRequest = normalizeSpeakRequest(request.body);
      }
      if (!referenceAudio) {
        const mutable = await configStore.read();
        const resolvedReferenceId = await resolveRequestedOrActiveReferenceId(
          config,
          mutable,
          referenceIdFromSpeakRequest(speakRequest)
        );
        if (resolvedReferenceId) {
          speakRequest = { ...speakRequest, referenceId: resolvedReferenceId, referenceAudioId: resolvedReferenceId };
        }
      }
      const response = await ttsClient.speak(speakRequest, referenceAudio);
      const body = Buffer.from(await response.arrayBuffer());
      reply
        .header('content-type', response.headers.get('content-type') ?? 'audio/wav')
        .header('content-disposition', response.headers.get('content-disposition') ?? 'attachment; filename="speech.wav"')
        .header('x-sample-rate', response.headers.get('x-sample-rate') ?? '24000')
        .header('x-engine', response.headers.get('x-engine') ?? 'chatterbox-tts')
        .send(body);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/transcribe', async (request, reply) => {
    try {
      const payload = await readMultipartPayload(request, config);
      const audio = getFirstFile(payload, ['file', 'audio']);
      await saveUpload(config.uploadDir, audio, 'stt');
      const result = await sttClient.transcribe(audio, payload.fields);
      return {
        filename: result.filename ?? audio.filename,
        model: result.model,
        default_model: result.defaultModel ?? config.defaultSttModel,
        active_model: result.activeModel ?? result.model,
        language: result.language,
        language_probability: result.languageProbability,
        vad_filter: result.vadFilter,
        min_silence_duration_ms: result.minSilenceDurationMs,
        transcript: result.transcript,
        segments: result.segments
      };
    } catch (error) {
      sendError(reply, error);
    }
  });
}
