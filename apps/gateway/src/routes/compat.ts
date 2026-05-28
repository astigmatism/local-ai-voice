import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { TranscriptResponse } from '@local-ai-voice/shared';
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
import {
  getFirstFile,
  HttpError,
  normalizeSpeakRequest,
  normalizeTranscribeFields,
  readMultipartPayload,
  sendError,
  transcribeFileFieldNames
} from './helpers.js';

export interface CompatRouteDependencies {
  config: AppConfig;
  configStore: ConfigStore;
  sttClient: WorkerClient;
  ttsClient: WorkerClient;
}

function referenceIdFromSpeakRequest(request: {
  referenceId?: string;
  referenceAudioId?: string;
  voice?: string;
}): string | undefined {
  return request.referenceId ?? request.referenceAudioId ?? (request.voice?.endsWith('.wav') ? request.voice : undefined);
}

function referenceDeletePath(referenceId: string): string {
  return `/api/tts/reference-audio/${encodeURIComponent(referenceId)}`;
}

function referenceDeleteLinks(
  referenceId: string
): { canDelete: true; deleteUrl: string; _links: { delete: { href: string; method: 'DELETE' } } } {
  const deleteUrl = referenceDeletePath(referenceId);
  return {
    canDelete: true,
    deleteUrl,
    _links: { delete: { href: deleteUrl, method: 'DELETE' } }
  };
}

function timestamp(seconds: number, decimalSeparator: ',' | '.'): string {
  const whole = Math.max(0, Math.floor(seconds));
  const milliseconds = Math.max(0, Math.floor((seconds - whole) * 1000));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${decimalSeparator}${pad(milliseconds, 3)}`;
}

function segmentsToSrt(result: TranscriptResponse): string {
  return `${result.segments
    .map(
      (segment, index) =>
        `${index + 1}\n${timestamp(segment.start, ',')} --> ${timestamp(segment.end, ',')}\n${segment.text}`
    )
    .join('\n\n')}\n`;
}

function segmentsToVtt(result: TranscriptResponse): string {
  return `WEBVTT\n\n${result.segments
    .map((segment) => `${timestamp(segment.start, '.')} --> ${timestamp(segment.end, '.')}\n${segment.text}`)
    .join('\n\n')}\n`;
}

function openAiJsonResponse(result: TranscriptResponse, responseFormat: string): Record<string, unknown> {
  if (responseFormat !== 'verbose_json') return { text: result.transcript };
  return {
    task: 'transcribe',
    language: result.language,
    duration: result.durationSeconds,
    text: result.transcript,
    segments: result.segments
  };
}

async function handleOpenAiTranscription(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: Pick<CompatRouteDependencies, 'config' | 'configStore' | 'sttClient'>
): Promise<Record<string, unknown> | void> {
  const { config, configStore, sttClient } = deps;
  try {
    const payload = await readMultipartPayload(request, config);
    const audio = getFirstFile(payload, transcribeFileFieldNames);
    const mutable = await configStore.read();
    const fields = normalizeTranscribeFields(payload.fields, {
      defaultModel: mutable.stt.defaultModel,
      mapOpenAiModelAlias: true
    });
    await saveUpload(config.uploadDir, audio, 'stt');
    const result = await sttClient.transcribe(audio, fields);
    const responseFormat = (fields.response_format ?? 'json').toLowerCase();
    if (!['json', 'verbose_json', 'text', 'srt', 'vtt'].includes(responseFormat)) {
      throw new HttpError(400, `Unsupported response_format: ${responseFormat}`);
    }
    if (responseFormat === 'text') {
      reply.type('text/plain').send(result.transcript);
      return;
    }
    if (responseFormat === 'srt') {
      reply.type('application/x-subrip').send(segmentsToSrt(result));
      return;
    }
    if (responseFormat === 'vtt') {
      reply.type('text/vtt').send(segmentsToVtt(result));
      return;
    }
    return openAiJsonResponse(result, responseFormat);
  } catch (error) {
    sendError(reply, error);
  }
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
          active: reference.referenceId === active?.referenceId,
          ...referenceDeleteLinks(reference.referenceId)
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
      const audio = getFirstFile(payload, transcribeFileFieldNames);
      const mutable = await configStore.read();
      const fields = normalizeTranscribeFields(payload.fields, { defaultModel: mutable.stt.defaultModel });
      await saveUpload(config.uploadDir, audio, 'stt');
      const result = await sttClient.transcribe(audio, fields);
      return {
        filename: result.filename ?? audio.filename,
        model: result.model,
        default_model: result.defaultModel ?? mutable.stt.defaultModel,
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

  app.post('/v1/audio/transcriptions', async (request, reply) =>
    await handleOpenAiTranscription(request, reply, { config, configStore, sttClient })
  );
  app.post('/audio/transcriptions', async (request, reply) =>
    await handleOpenAiTranscription(request, reply, { config, configStore, sttClient })
  );
}
