import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { LoadModelRequest, ServiceRole, UnloadModelRequest } from '@local-ai-voice/shared';
import { builtInVoices, sttCatalog, ttsCatalog } from '../catalog.js';
import type { AppConfig } from '../config.js';
import { ConfigStore } from '../config-store.js';
import { getGpuStatus } from '../gpu.js';
import { recentLogs } from '../logs.js';
import { saveUpload } from '../storage.js';
import { systemOverview } from '../system.js';
import type { WorkerClient } from '../worker-client.js';
import {
  getFirstFile,
  getRequiredField,
  normalizeSpeakRequest,
  readMultipartPayload,
  sendError
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

export async function registerApiRoutes(app: FastifyInstance, deps: ApiRouteDependencies): Promise<void> {
  const { config, configStore, sttClient, ttsClient } = deps;

  app.get('/api/health', async () => {
    const [gpu, stt, tts] = await Promise.all([getGpuStatus(), sttClient.health(), ttsClient.health()]);
    return {
      ok: gpu.available && stt.ok && tts.ok,
      checkedAt: new Date().toISOString(),
      gpu,
      services: { stt, tts }
    };
  });

  app.get('/api/system', async () => await systemOverview(config));
  app.get('/api/gpu', async () => await getGpuStatus());

  app.get('/api/services', async () => {
    const [stt, tts] = await Promise.all([sttClient.health(), ttsClient.health()]);
    return { stt, tts };
  });

  app.get('/api/services/stt', async () => await sttClient.health());
  app.get('/api/services/tts', async () => await ttsClient.health());

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
      const audio = getFirstFile(payload, ['file', 'audio']);
      await saveUpload(config.uploadDir, audio, 'stt');
      return await sttClient.transcribe(audio, payload.fields);
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
      } else {
        speakRequest = normalizeSpeakRequest(request.body);
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
      const savedPath = await saveUpload(config.voiceDir, file, 'voice');
      return {
        ok: true,
        id: savedPath.split('/').pop(),
        filename: file.filename,
        path: savedPath,
        provider: payload.fields.provider ?? 'chatterbox'
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
      const body = request.body as { provider?: string; defaultModel?: string; language?: string } | undefined;
      const patch: { provider?: string; defaultModel?: string; language?: string } = {};
      if (body?.provider !== undefined) patch.provider = body.provider;
      if (body?.defaultModel !== undefined) patch.defaultModel = body.defaultModel;
      if (body?.language !== undefined) patch.language = body.language;
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

  app.get('/api/voices', async () => ({ voices: builtInVoices() }));

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
