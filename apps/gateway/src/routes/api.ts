import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { LoadModelRequest, ServiceRole, UnloadModelRequest } from '@local-ai-voice/shared';
import { builtInVoices, sttCatalog, ttsCatalog } from '../catalog.js';
import type { AppConfig } from '../config.js';
import type { ConfigStore } from '../config-store.js';
import { getGpuStatus } from '../gpu.js';
import { recentLogs } from '../logs.js';
import { fieldBoolean, saveUpload } from '../storage.js';
import { systemOverview } from '../system.js';
import {
  listReferenceAudio,
  publicActiveReference,
  resolveReferenceAudioId,
  resolveRequestedOrActiveReferenceId,
  saveReferenceAudio,
  validateReferenceWavUpload
} from '../reference-audio.js';
import type { WorkerClient } from '../worker-client.js';
import {
  getFirstFile,
  getRequiredField,
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
  ttsClient: WorkerClient;
}

async function maybeRestartWorker(config: AppConfig, role: ServiceRole): Promise<Record<string, unknown>> {
  if (!config.allowSystemdRestart) {
    return {
      attempted: false,
      reason: 'Hard restart disabled. Set ALLOW_SYSTEMD_RESTART=true after configuring systemd privileges.'
    };
  }
  const service = role === 'stt' ? config.sttSystemdService : config.ttsSystemdService;
  await execFileAsync('systemctl', ['restart', service], { timeout: 30_000 });
  return { attempted: true, service };
}

function referenceIdFromSpeakRequest(request: { referenceId?: string; referenceAudioId?: string; voice?: string }): string | undefined {
  return request.referenceId ?? request.referenceAudioId ?? (request.voice?.endsWith('.wav') ? request.voice : undefined);
}

export async function registerApiRoutes(app: FastifyInstance, deps: ApiRouteDependencies): Promise<void> {
  const { config, configStore, sttClient, ttsClient } = deps;

  app.get('/api/health', async () => {
    const [gpu, stt, tts, mutable] = await Promise.all([
      getGpuStatus(),
      sttClient.health(),
      ttsClient.health(),
      configStore.read()
    ]);
    return {
      ok: gpu.available && stt.ok && tts.ok,
      checkedAt: new Date().toISOString(),
      gpu,
      services: { stt, tts: { ...tts, activeReferenceAudio: publicActiveReference(mutable) } }
    };
  });

  app.get('/api/system', async () => await systemOverview(config));
  app.get('/api/gpu', async () => await getGpuStatus());

  app.get('/api/services', async () => {
    const [stt, tts, mutable] = await Promise.all([sttClient.health(), ttsClient.health(), configStore.read()]);
    return { stt, tts: { ...tts, activeReferenceAudio: publicActiveReference(mutable) } };
  });

  app.get('/api/services/stt', async () => await sttClient.health());
  app.get('/api/services/tts', async () => {
    const [tts, mutable] = await Promise.all([ttsClient.health(), configStore.read()]);
    return { ...tts, activeReferenceAudio: publicActiveReference(mutable) };
  });

  app.get('/api/models', async () => ({ stt: sttCatalog(config), tts: ttsCatalog(config) }));
  app.get('/api/models/stt', async () => ({ models: sttCatalog(config), status: await sttClient.modelStatus() }));
  app.get('/api/models/tts', async () => ({ models: ttsCatalog(config), status: await ttsClient.modelStatus() }));

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
      const payload: LoadModelRequest = {
        provider: body?.provider ?? mutable.tts.provider,
        model: body?.model ?? mutable.tts.defaultModel,
        language: body?.language ?? mutable.tts.language,
        options: body?.options
      };
      return await ttsClient.loadModel(payload);
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
      if (payload.strategy === 'hard') {
        const status = await ttsClient.unloadModel({ ...payload, strategy: 'soft' }).catch(() => null);
        const restart = await maybeRestartWorker(config, 'tts');
        return { status, restart };
      }
      return await ttsClient.unloadModel(payload);
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
        .header('x-local-ai-voice-engine', response.headers.get('x-local-ai-voice-engine') ?? 'tts-worker')
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
        active: setDefault
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
      const body =
        request.body as
          | { provider?: string; defaultModel?: string; language?: string; activeReferenceId?: string | null }
          | undefined;
      const patch: { provider?: string; defaultModel?: string; language?: string; activeReferenceId?: string | null } = {};
      if (body?.provider !== undefined) patch.provider = body.provider;
      if (body?.defaultModel !== undefined) patch.defaultModel = body.defaultModel;
      if (body?.language !== undefined) patch.language = body.language;
      if (body?.activeReferenceId !== undefined) {
        if (body.activeReferenceId === null) {
          return await configStore.patchTts({ ...patch, activeReferenceId: null, activeReference: null });
        }
        const mutable = await configStore.read();
        const provider = body.provider ?? mutable.tts.provider;
        const referenceId = await resolveReferenceAudioId(config, provider, body.activeReferenceId);
        const reference = (await listReferenceAudio(config, provider)).find((candidate) => candidate.referenceId === referenceId);
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

  app.get('/api/voices', async () => {
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

  app.post('/api/tts/speak/validate', async (request) => {
    const payload = request.body as { text?: string };
    return { ok: Boolean(payload.text?.trim()), textLength: payload.text?.length ?? 0 };
  });

  app.get('/api/defaults', async () => {
    const mutable = await configStore.read();
    return {
      stt: { provider: mutable.stt.provider, model: mutable.stt.defaultModel },
      tts: { provider: mutable.tts.provider, model: mutable.tts.defaultModel, language: mutable.tts.language },
      requiredTranscribeFileField: getRequiredField({ file: 'file' }, 'file')
    };
  });
}
