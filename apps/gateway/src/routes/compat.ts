import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { TranscriptResponse, VoiceDescriptor } from '@local-ai-voice/shared';
import { builtInVoices, providerSupportsReferenceAudio, sttCatalog, ttsCatalog } from '../catalog.js';
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
import type { TtsProviderRegistry } from '../tts-providers.js';
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
  ttsProviders: TtsProviderRegistry;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function queryProvider(query: unknown): string | undefined {
  return stringField((query as { provider?: unknown } | undefined)?.provider);
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

async function voicesForProvider(
  config: AppConfig,
  ttsProviders: TtsProviderRegistry,
  provider: string,
  activeReferenceId?: string | null
): Promise<VoiceDescriptor[]> {
  const normalized = ttsProviders.resolveProvider(provider, undefined, provider);
  const builtIns = builtInVoices(normalized);
  const workerVoices = await ttsProviders
    .client(normalized)
    .voices()
    .then((response) => response.voices)
    .catch(() => [] as VoiceDescriptor[]);
  const byId = new Map<string, VoiceDescriptor>();
  for (const voice of [...builtIns, ...workerVoices]) {
    if (voice.provider !== normalized) continue;
    byId.set(voice.id, { ...voice, provider: normalized });
  }
  if (providerSupportsReferenceAudio(normalized)) {
    const uploaded = await listReferenceAudio(config, normalized);
    for (const reference of uploaded) {
      byId.set(reference.referenceId, {
        ...reference,
        label: reference.filename,
        referenceAudio: true,
        active: reference.referenceId === activeReferenceId,
        ...referenceDeleteLinks(reference.referenceId)
      } as VoiceDescriptor);
    }
  }
  return [...byId.values()];
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
  const { config, configStore, sttClient, ttsProviders } = deps;

  app.get('/health', async () => {
    const mutable = await configStore.read();
    const provider = ttsProviders.resolveProvider(undefined, mutable.tts.defaultModel, mutable.tts.provider);
    const [stt, tts] = await Promise.all([sttClient.health(), ttsProviders.health(provider)]);
    return {
      status: stt.ok || tts.ok ? 'ok' : 'degraded',
      gateway: 'local-ai-voice-node-gateway',
      stt,
      tts,
      ttsProviders: await ttsProviders.providerStates()
    };
  });

  app.get('/gpu', async () => await getGpuStatus());

  app.get('/models', async () => {
    const mutable = await configStore.read();
    const ttsProvider = ttsProviders.resolveProvider(undefined, mutable.tts.defaultModel, mutable.tts.provider);
    return {
      default_model: mutable.stt.defaultModel,
      active_model: (await sttClient.modelStatus().catch(() => undefined))?.loadedModel ?? null,
      stt: sttCatalog(config),
      tts: ttsCatalog(config),
      tts_provider: ttsProvider,
      tts_status: await ttsProviders.modelStatus(ttsProvider).catch(() => null),
      tts_providers: ttsProviders.descriptors()
    };
  });

  app.get('/voices', async (request) => {
    const mutable = await configStore.read();
    const provider = ttsProviders.resolveProvider(queryProvider(request.query), undefined, mutable.tts.provider);
    const active = provider === mutable.tts.provider ? publicActiveReference(mutable) : null;
    return {
      provider,
      voices: await voicesForProvider(config, ttsProviders, provider, active?.referenceId),
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
    const provider = ttsProviders.resolveProvider(undefined, mutable.tts.defaultModel, mutable.tts.provider);
    return {
      default_voice: active?.referenceId ?? ttsProviders.defaultVoice(provider) ?? 'reference-upload',
      provider,
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
      const mutable = await configStore.read();
      const provider = ttsProviders.resolveProvider(speakRequest.provider, speakRequest.model, mutable.tts.provider);
      const requestedReferenceId = referenceIdFromSpeakRequest(speakRequest);
      if (referenceAudio && !providerSupportsReferenceAudio(provider)) {
        throw new HttpError(400, `${provider} does not support reference audio uploads.`);
      }
      if (requestedReferenceId && !providerSupportsReferenceAudio(provider)) {
        throw new HttpError(400, `${provider} does not support reference audio ids.`);
      }
      speakRequest = {
        ...speakRequest,
        provider,
        model: speakRequest.model ?? (provider === mutable.tts.provider ? mutable.tts.defaultModel : ttsProviders.defaultModel(provider)),
        language: speakRequest.language ?? (provider === mutable.tts.provider ? mutable.tts.language : config.defaultTtsLanguage),
        voice: speakRequest.voice ?? ttsProviders.defaultVoice(provider)
      };
      if (!referenceAudio && providerSupportsReferenceAudio(provider)) {
        const resolvedReferenceId = await resolveRequestedOrActiveReferenceId(config, mutable, requestedReferenceId, provider);
        if (resolvedReferenceId) {
          speakRequest = { ...speakRequest, referenceId: resolvedReferenceId, referenceAudioId: resolvedReferenceId };
        }
      }
      const response = await ttsProviders.client(provider).speak(speakRequest, referenceAudio);
      const body = Buffer.from(await response.arrayBuffer());
      reply
        .header('content-type', response.headers.get('content-type') ?? 'audio/wav')
        .header('content-disposition', response.headers.get('content-disposition') ?? 'attachment; filename="speech.wav"')
        .header('x-sample-rate', response.headers.get('x-sample-rate') ?? '24000')
        .header('x-engine', response.headers.get('x-engine') ?? `${provider}-tts`)
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
