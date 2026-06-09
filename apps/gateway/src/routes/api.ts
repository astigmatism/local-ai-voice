import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { LoadModelRequest, ModelStatus, ServiceRole, UnloadModelRequest, VoiceDescriptor } from '@local-ai-voice/shared';
import { builtInVoices, providerSupportsReferenceAudio, sttCatalog, ttsCatalog } from '../catalog.js';
import type { AppConfig } from '../config.js';
import type { ConfigStore, MutableApplianceConfig } from '../config-store.js';
import { getGpuStatus } from '../gpu.js';
import { recentLogs } from '../logs.js';
import { fieldBoolean, saveUpload } from '../storage.js';
import { systemOverview } from '../system.js';
import {
  deleteReferenceAudio,
  listReferenceAudio,
  publicActiveReference,
  resolveReferenceAudioId,
  resolveRequestedOrActiveReferenceId,
  saveReferenceAudio,
  validateReferenceWavUpload,
  ReferenceAudioError
} from '../reference-audio.js';
import { normalizeTtsProvider } from '../tts-providers.js';
import type { TtsProviderId, TtsProviderRegistry, TtsProviderRuntimeStatus } from '../tts-providers.js';
import type { WorkerClient } from '../worker-client.js';
import {
  getFirstFile,
  getRequiredField,
  HttpError,
  normalizeSpeakRequest,
  normalizeTranscribeFields,
  readMultipartPayload,
  sendError,
  transcribeFileFieldNames
} from './helpers.js';

const execFileAsync = promisify(execFile);

export interface ApiRouteDependencies {
  config: AppConfig;
  configStore: ConfigStore;
  sttClient: WorkerClient;
  ttsProviders: TtsProviderRegistry;
}

async function maybeRestartService(config: AppConfig, service: string): Promise<Record<string, unknown>> {
  if (!config.allowSystemdRestart) {
    return {
      attempted: false,
      reason: 'Hard restart disabled. Set ALLOW_SYSTEMD_RESTART=true after configuring systemd privileges.',
      service
    };
  }
  await execFileAsync('systemctl', ['restart', service], { timeout: 30_000 });
  return { attempted: true, service };
}

async function maybeRestartWorker(config: AppConfig, role: ServiceRole): Promise<Record<string, unknown>> {
  const service = role === 'stt' ? config.sttSystemdService : config.ttsSystemdService;
  return await maybeRestartService(config, service);
}

function referenceIdFromSpeakRequest(request: { referenceId?: string; referenceAudioId?: string; voice?: string }): string | undefined {
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

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function queryProvider(query: unknown): string | undefined {
  return stringField((query as { provider?: unknown } | undefined)?.provider);
}

function referenceIdFromDeleteRequest(params: unknown, body: unknown): string {
  const routeReferenceId = stringField((params as { referenceId?: unknown } | undefined)?.referenceId);
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const referenceId =
    routeReferenceId ??
    stringField(payload.referenceId) ??
    stringField(payload.referenceAudioId) ??
    stringField(payload.reference_id) ??
    stringField(payload.reference_audio_id) ??
    stringField(payload.id) ??
    stringField(payload.voice) ??
    stringField(payload.storedFilename) ??
    stringField(payload.stored_filename) ??
    stringField(payload.filename);
  if (!referenceId) {
    throw new ReferenceAudioError(400, 'Missing referenceId for reference audio deletion.');
  }
  return referenceId;
}

function providerFromDeleteRequest(query: unknown, body: unknown, fallback: string): string {
  const queryValue = queryProvider(query);
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return queryValue ?? stringField(payload.provider) ?? fallback;
}

function failedModelStatus(provider: TtsProviderId, error: unknown): ModelStatus {
  return {
    role: 'tts',
    provider,
    state: 'failed',
    loadedModel: null,
    error: error instanceof Error ? error.message : String(error)
  };
}

async function ttsStatusMap(ttsProviders: TtsProviderRegistry): Promise<Record<TtsProviderId, ModelStatus>> {
  const entries = await Promise.all(
    ttsProviders.ids().map(async (provider) => {
      const status = await ttsProviders.modelStatus(provider).catch((error: unknown) => failedModelStatus(provider, error));
      return [provider, status] as const;
    })
  );
  return Object.fromEntries(entries) as Record<TtsProviderId, ModelStatus>;
}

async function voicesForProvider(
  config: AppConfig,
  ttsProviders: TtsProviderRegistry,
  provider: TtsProviderId,
  activeReferenceId?: string | null
): Promise<VoiceDescriptor[]> {
  const builtIns = builtInVoices(provider);
  const workerVoices = await ttsProviders
    .client(provider)
    .voices()
    .then((response) => response.voices)
    .catch(() => [] as VoiceDescriptor[]);
  const byId = new Map<string, VoiceDescriptor>();
  for (const voice of [...builtIns, ...workerVoices]) {
    if (voice.provider !== provider) continue;
    byId.set(voice.id, { ...voice, provider });
  }
  if (providerSupportsReferenceAudio(provider)) {
    const uploaded = await listReferenceAudio(config, provider);
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

function providerConfig(mutable: MutableApplianceConfig, provider: TtsProviderId) {
  return mutable.tts.providers?.[provider];
}

function defaultModelForSpeak(ttsProviders: TtsProviderRegistry, provider: TtsProviderId, mutable: MutableApplianceConfig): string {
  return providerConfig(mutable, provider)?.defaultModel ?? (provider === mutable.tts.provider ? mutable.tts.defaultModel : ttsProviders.defaultModel(provider));
}

function defaultLanguageForSpeak(ttsProviders: TtsProviderRegistry, provider: TtsProviderId, mutable: MutableApplianceConfig): string {
  return providerConfig(mutable, provider)?.language ?? (provider === mutable.tts.provider ? mutable.tts.language : ttsProviders.defaultLanguage(provider));
}

function defaultVoiceForSpeak(ttsProviders: TtsProviderRegistry, provider: TtsProviderId, mutable: MutableApplianceConfig): string | undefined {
  return providerConfig(mutable, provider)?.defaultVoice ?? ttsProviders.defaultVoice(provider);
}

function publicProviderState(provider: TtsProviderRuntimeStatus, mutable: MutableApplianceConfig) {
  const providerDefaults = providerConfig(mutable, provider.id);
  const activeReferenceAudio = providerSupportsReferenceAudio(provider.id) ? publicActiveReference(mutable, provider.id) : null;
  return {
    id: provider.id,
    name: provider.name,
    label: provider.label,
    displayName: provider.displayName,
    workerUrl: provider.workerUrl,
    workerPort: provider.workerPort,
    systemdService: provider.systemdService,
    enabled: provider.enabled,
    active: provider.active,
    autoLoad: providerDefaults?.autoLoad ?? provider.autoLoad,
    reachable: provider.reachable,
    state: provider.state,
    model: provider.model ?? providerDefaults?.defaultModel ?? provider.defaultModel,
    loadedModel: provider.status?.loadedModel ?? provider.health.loadedModel ?? null,
    defaultModel: providerDefaults?.defaultModel ?? provider.defaultModel,
    voice: providerDefaults?.defaultVoice ?? provider.voice ?? provider.defaultVoice ?? null,
    language: providerDefaults?.language ?? provider.defaultLanguage,
    capabilities: provider.capabilities,
    health: { ...provider.health },
    status: provider.status ? { ...provider.status } : undefined,
    activeReferenceAudio
  };
}

export async function registerApiRoutes(app: FastifyInstance, deps: ApiRouteDependencies): Promise<void> {
  const { config, configStore, sttClient, ttsProviders } = deps;

  app.get('/api/health', async () => {
    const [gpu, stt, mutable] = await Promise.all([getGpuStatus(), sttClient.health(), configStore.read()]);
    const ttsProvider = ttsProviders.resolveProvider(undefined, mutable.tts.defaultModel, mutable.tts.provider);
    const [tts, providerStates] = await Promise.all([ttsProviders.health(ttsProvider), ttsProviders.providerStates()]);
    return {
      ok: gpu.available && stt.ok && tts.ok,
      checkedAt: new Date().toISOString(),
      gpu,
      services: { stt, tts: { ...tts, activeReferenceAudio: publicActiveReference(mutable, ttsProvider) } },
      ttsProviders: providerStates.map((provider) => publicProviderState(provider, mutable))
    };
  });

  app.get('/api/system', async () => await systemOverview(config));
  app.get('/api/gpu', async () => await getGpuStatus());

  app.get('/api/services', async () => {
    const [stt, mutable] = await Promise.all([sttClient.health(), configStore.read()]);
    const ttsProvider = ttsProviders.resolveProvider(undefined, mutable.tts.defaultModel, mutable.tts.provider);
    const [tts, providerStates] = await Promise.all([ttsProviders.health(ttsProvider), ttsProviders.providerStates()]);
    return { stt, tts: { ...tts, activeReferenceAudio: publicActiveReference(mutable, ttsProvider) }, ttsProviders: providerStates.map((provider) => publicProviderState(provider, mutable)) };
  });

  app.get('/api/services/stt', async () => await sttClient.health());
  app.get('/api/services/tts', async (request) => {
    const mutable = await configStore.read();
    const selectedProvider = ttsProviders.resolveProvider(queryProvider(request.query), undefined, mutable.tts.provider);
    const providerStates = await ttsProviders.providerStates();
    const providers = providerStates.map((provider) => publicProviderState(provider, mutable));
    const selected = providers.find((provider) => provider.id === selectedProvider) ?? providers[0];
    return {
      ...(selected?.health ?? {}),
      ok: providers.some((provider) => provider.enabled && provider.reachable),
      defaultProvider: mutable.tts.provider,
      selectedProvider,
      provider: selectedProvider,
      providers,
      statuses: Object.fromEntries(providers.map((provider) => [provider.id, provider.status])),
      status: selected?.status,
      activeReferenceAudio: selected?.activeReferenceAudio ?? null
    };
  });

  app.get('/api/tts/providers', async () => {
    const mutable = await configStore.read();
    const providerStates = await ttsProviders.providerStates();
    return { defaultProvider: mutable.tts.provider, providers: providerStates.map((provider) => publicProviderState(provider, mutable)) };
  });

  app.get('/api/models', async () => ({
    stt: sttCatalog(config),
    tts: ttsCatalog(config),
    ttsProviders: ttsProviders.descriptors()
  }));
  app.get('/api/models/stt', async () => ({ models: sttCatalog(config), status: await sttClient.modelStatus() }));
  app.get('/api/models/tts', async (request) => {
    const mutable = await configStore.read();
    const provider = queryProvider(request.query)
      ? ttsProviders.resolveProvider(queryProvider(request.query), undefined, mutable.tts.provider)
      : undefined;
    const currentProvider = provider ?? ttsProviders.resolveProvider(undefined, mutable.tts.defaultModel, mutable.tts.provider);
    const models = provider ? ttsCatalog(config).filter((model) => model.provider === provider) : ttsCatalog(config);
    return {
      models,
      providers: ttsProviders.descriptors(),
      status: await ttsProviders.modelStatus(currentProvider).catch((error: unknown) => failedModelStatus(currentProvider, error)),
      statuses: await ttsStatusMap(ttsProviders)
    };
  });

  app.post('/api/models/stt/load', async (request, reply) => {
    try {
      const body = request.body as Partial<LoadModelRequest> | undefined;
      const mutable = await configStore.read();
      const payload: LoadModelRequest = {
        provider: body?.provider ?? mutable.stt.provider,
        model: body?.model ?? mutable.stt.defaultModel,
        computeType: body?.computeType ?? mutable.stt.computeType,
        options: body?.options
      };
      return await sttClient.loadModel(payload);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/api/models/tts/load', async (request, reply) => {
    try {
      const body = request.body as Partial<LoadModelRequest> | undefined;
      const mutable = await configStore.read();
      const provider = ttsProviders.resolveProvider(body?.provider, body?.model, mutable.tts.provider);
      const payload: LoadModelRequest = {
        provider,
        model: body?.model ?? defaultModelForSpeak(ttsProviders, provider, mutable),
        language: body?.language ?? defaultLanguageForSpeak(ttsProviders, provider, mutable),
        options: body?.options
      };
      return await ttsProviders.client(provider).loadModel(payload);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/api/models/tts/reload', async (request, reply) => {
    try {
      const body = request.body as Partial<LoadModelRequest> | undefined;
      const mutable = await configStore.read();
      const provider = ttsProviders.resolveProvider(body?.provider, body?.model, mutable.tts.provider);
      const payload: LoadModelRequest = {
        provider,
        model: body?.model ?? defaultModelForSpeak(ttsProviders, provider, mutable),
        language: body?.language ?? defaultLanguageForSpeak(ttsProviders, provider, mutable),
        options: body?.options
      };
      return await ttsProviders.client(provider).reloadModel(payload);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/api/models/stt/unload', async (request, reply) => {
    try {
      const payload = ((request.body as UnloadModelRequest | undefined) ?? { strategy: 'soft' }) as UnloadModelRequest;
      if (payload.strategy === 'hard') {
        const status = await sttClient.unloadModel({ ...payload, strategy: 'soft' }).catch(() => null);
        const restart = await maybeRestartWorker(config, 'stt');
        return { status, restart };
      }
      return await sttClient.unloadModel(payload);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/api/models/tts/unload', async (request, reply) => {
    try {
      const payload = ((request.body as UnloadModelRequest | undefined) ?? { strategy: 'soft' }) as UnloadModelRequest;
      const mutable = await configStore.read();
      const provider = ttsProviders.resolveProvider(payload.provider, undefined, mutable.tts.provider);
      if (payload.strategy === 'hard') {
        const status = await ttsProviders.client(provider).unloadModel({ ...payload, provider, strategy: 'soft' }).catch(() => null);
        const restart = await maybeRestartService(config, ttsProviders.systemdService(provider));
        return { status, restart, provider };
      }
      return await ttsProviders.client(provider).unloadModel({ ...payload, provider });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/api/stt/transcribe', async (request, reply) => {
    try {
      const payload = await readMultipartPayload(request, config);
      const audio = getFirstFile(payload, transcribeFileFieldNames);
      const mutable = await configStore.read();
      const fields = normalizeTranscribeFields(payload.fields, { defaultModel: mutable.stt.defaultModel });
      await saveUpload(config.uploadDir, audio, 'stt');
      return await sttClient.transcribe(audio, fields);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/api/tts/speak', async (request, reply) => {
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
        model: speakRequest.model ?? defaultModelForSpeak(ttsProviders, provider, mutable),
        language: speakRequest.language ?? defaultLanguageForSpeak(ttsProviders, provider, mutable),
        voice: speakRequest.voice ?? defaultVoiceForSpeak(ttsProviders, provider, mutable)
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
        .header('x-local-ai-voice-engine', response.headers.get('x-local-ai-voice-engine') ?? `${provider}-tts-worker`)
        .send(body);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post('/api/tts/reference-audio', async (request, reply) => {
    try {
      const payload = await readMultipartPayload(request, config);
      const file = getFirstFile(payload, ['file', 'reference_audio', 'reference']);
      const provider = payload.fields.provider ?? 'chatterbox';
      const saved = await saveReferenceAudio(config, file, provider);
      const setDefault = fieldBoolean(payload.fields, 'setDefault') ?? fieldBoolean(payload.fields, 'set_default') ?? true;
      if (setDefault) {
        await configStore.patchTts({
          provider: saved.provider,
          activeReferenceId: saved.referenceId,
          activeReference: { ...saved, active: true }
        });
      }
      return {
        ok: true,
        provider: saved.provider,
        referenceId: saved.referenceId,
        id: saved.referenceId,
        filename: saved.filename,
        contentType: saved.contentType,
        sizeBytes: saved.sizeBytes,
        active: setDefault,
        ...referenceDeleteLinks(saved.referenceId)
      };
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.delete('/api/tts/reference-audio/:referenceId', async (request, reply) => {
    try {
      const mutable = await configStore.read();
      const provider = providerFromDeleteRequest(request.query, request.body, mutable.tts.provider);
      const referenceId = referenceIdFromDeleteRequest(request.params, request.body);
      const deleted = await deleteReferenceAudio(config, provider, referenceId);
      const deletedProvider = normalizeTtsProvider(deleted.provider, mutable.tts.provider);
      const activeReferenceCleared = providerConfig(mutable, deletedProvider)?.activeReferenceId === deleted.referenceId;
      if (activeReferenceCleared) {
        await configStore.patchTts({ provider: deletedProvider, activeReferenceId: null, activeReference: null });
      }
      return {
        ok: true,
        deleted: true,
        provider: deleted.provider,
        referenceId: deleted.referenceId,
        id: deleted.referenceId,
        filename: deleted.filename,
        contentType: deleted.contentType,
        sizeBytes: deleted.sizeBytes,
        activeReferenceCleared
      };
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.delete('/api/tts/reference-audio', async (request, reply) => {
    try {
      const mutable = await configStore.read();
      const provider = providerFromDeleteRequest(request.query, request.body, mutable.tts.provider);
      const referenceId = referenceIdFromDeleteRequest(request.params, request.body);
      const deleted = await deleteReferenceAudio(config, provider, referenceId);
      const deletedProvider = normalizeTtsProvider(deleted.provider, mutable.tts.provider);
      const activeReferenceCleared = providerConfig(mutable, deletedProvider)?.activeReferenceId === deleted.referenceId;
      if (activeReferenceCleared) {
        await configStore.patchTts({ provider: deletedProvider, activeReferenceId: null, activeReference: null });
      }
      return {
        ok: true,
        deleted: true,
        provider: deleted.provider,
        referenceId: deleted.referenceId,
        id: deleted.referenceId,
        filename: deleted.filename,
        contentType: deleted.contentType,
        sizeBytes: deleted.sizeBytes,
        activeReferenceCleared
      };
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get('/api/config', async () => await configStore.view());

  app.patch('/api/config/stt', async (request, reply) => {
    try {
      const body = request.body as { provider?: string; defaultModel?: string; computeType?: string } | undefined;
      const patch: { provider?: string; defaultModel?: string; computeType?: string } = {};
      if (body?.provider !== undefined) patch.provider = body.provider;
      if (body?.defaultModel !== undefined) patch.defaultModel = body.defaultModel;
      if (body?.computeType !== undefined) patch.computeType = body.computeType;
      return await configStore.patchStt(patch);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.patch('/api/config/tts', async (request, reply) => {
    try {
      const body = request.body as
        | {
            provider?: string;
            defaultProvider?: string;
            defaultModel?: string;
            defaultVoice?: string;
            language?: string;
            activeReferenceId?: string | null;
            providers?: Record<string, { defaultModel?: string; defaultVoice?: string; language?: string; enabled?: boolean; autoLoad?: boolean }>;
          }
        | undefined;
      const mutable = await configStore.read();
      const requestedProvider = body?.provider ?? body?.defaultProvider;
      const nextProvider = requestedProvider !== undefined
        ? ttsProviders.resolveProvider(requestedProvider, body?.defaultModel, mutable.tts.provider)
        : body?.defaultModel !== undefined
          ? ttsProviders.resolveProvider(undefined, body.defaultModel, mutable.tts.provider)
          : normalizeTtsProvider(mutable.tts.provider, config.defaultTtsProvider);
      const patch: Parameters<ConfigStore['patchTts']>[0] = { provider: nextProvider };

      if (body?.defaultModel !== undefined) patch.defaultModel = body.defaultModel;
      else if (requestedProvider !== undefined && !providerConfig(mutable, nextProvider)?.defaultModel) {
        patch.defaultModel = ttsProviders.defaultModel(nextProvider);
      }
      if (body?.language !== undefined) patch.language = body.language;
      if (body?.defaultVoice !== undefined) {
        patch.providers = {
          ...(patch.providers ?? {}),
          [nextProvider]: { ...((patch.providers ?? {})[nextProvider] ?? {}), defaultVoice: body.defaultVoice }
        };
      }
      if (body?.providers) {
        for (const [providerId, providerPatch] of Object.entries(body.providers)) {
          const normalized = normalizeTtsProvider(providerId, nextProvider);
          patch.providers = {
            ...(patch.providers ?? {}),
            [normalized]: { ...((patch.providers ?? {})[normalized] ?? {}), ...providerPatch }
          };
        }
      }

      if (body?.activeReferenceId !== undefined) {
        if (body.activeReferenceId === null) {
          return await configStore.patchTts({ ...patch, activeReferenceId: null, activeReference: null });
        }
        if (!providerSupportsReferenceAudio(nextProvider)) {
          throw new HttpError(400, `${nextProvider} does not support active reference audio.`);
        }
        const referenceId = await resolveReferenceAudioId(config, nextProvider, body.activeReferenceId);
        const reference = (await listReferenceAudio(config, nextProvider)).find((candidate) => candidate.referenceId === referenceId);
        return await configStore.patchTts({
          ...patch,
          activeReferenceId: referenceId,
          activeReference: reference ? { ...reference, active: true } : null
        });
      }
      return await configStore.patchTts(patch);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get('/api/logs', async (request) => {
    const query = request.query as { limit?: string };
    const limit = Number(query.limit ?? 200);
    return { entries: await recentLogs(config, Number.isFinite(limit) ? limit : 200) };
  });

  app.get('/api/voices', async (request) => {
    const mutable = await configStore.read();
    const provider = ttsProviders.resolveProvider(queryProvider(request.query), undefined, mutable.tts.provider);
    const active = publicActiveReference(mutable, provider);
    return {
      provider,
      voices: await voicesForProvider(config, ttsProviders, provider, active?.referenceId),
      activeReferenceAudio: active
    };
  });

  app.post('/api/tts/speak/validate', async (request) => {
    const payload = request.body as { text?: string };
    return { ok: Boolean(payload.text?.trim()), textLength: payload.text?.length ?? 0 };
  });

  app.get('/api/defaults', async () => {
    const mutable = await configStore.read();
    return {
      stt: { provider: mutable.stt.provider, model: mutable.stt.defaultModel },
      tts: {
        provider: mutable.tts.provider,
        model: mutable.tts.defaultModel,
        language: mutable.tts.language,
        defaultVoice: defaultVoiceForSpeak(ttsProviders, normalizeTtsProvider(mutable.tts.provider, config.defaultTtsProvider), mutable)
      },
      requiredTranscribeFileField: getRequiredField({ file: 'file' }, 'file')
    };
  });
}
