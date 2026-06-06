import path from 'node:path';
import type { ConfigView } from '@local-ai-voice/shared';

export interface AppConfig {
  publicHost: string;
  publicPort: number;
  nodeEnv: string;
  logLevel: string;
  corsOrigin: string;
  portalEnabled: boolean;
  portalDistDir: string;
  apiDocsEnabled: boolean;
  sttWorkerUrl: string;
  ttsWorkerUrl: string;
  kokoroTtsWorkerUrl: string;
  workerTimeoutMs: number;
  allowSystemdRestart: boolean;
  sttSystemdService: string;
  ttsSystemdService: string;
  kokoroTtsSystemdService: string;
  baseDir: string;
  configDir: string;
  modelDir: string;
  cacheDir: string;
  voiceDir: string;
  uploadDir: string;
  outputDir: string;
  logDir: string;
  gpuOnly: boolean;
  defaultSttProvider: string;
  defaultSttModel: string;
  defaultSttComputeType: string;
  defaultSttDevice: string;
  defaultTtsProvider: string;
  defaultTtsModel: string;
  defaultTtsLanguage: string;
  kokoroDefaultTtsModel: string;
  kokoroDefaultTtsVoice: string;
  maxUploadBytes: number;
  generatedRetentionHours: number;
  authEnabled: boolean;
  basicAuthUsername: string;
  basicAuthPassword: string;
}

const numberFromEnv = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const serviceNamePattern = /^[a-zA-Z0-9_.@-]+\.service$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const baseDir = env.BASE_DIR ?? '/opt/local-ai-voice';
  const portalDistDir = env.PORTAL_DIST_DIR ?? path.resolve(process.cwd(), '../portal/dist');
  const sttService = env.STT_SYSTEMD_SERVICE ?? 'local-ai-voice-stt-worker.service';
  const ttsService = env.TTS_SYSTEMD_SERVICE ?? 'local-ai-voice-tts-chatterbox.service';
  const kokoroTtsService = env.KOKORO_TTS_SYSTEMD_SERVICE ?? env.TTS_KOKORO_SYSTEMD_SERVICE ?? 'local-ai-voice-tts-kokoro.service';

  if (
    !serviceNamePattern.test(sttService) ||
    !serviceNamePattern.test(ttsService) ||
    !serviceNamePattern.test(kokoroTtsService)
  ) {
    throw new Error('Systemd service names must end in .service and contain only safe characters.');
  }

  return {
    publicHost: env.PUBLIC_HOST ?? '0.0.0.0',
    publicPort: numberFromEnv(env.PUBLIC_PORT, 8000),
    nodeEnv: env.NODE_ENV ?? 'development',
    logLevel: env.LOG_LEVEL ?? 'info',
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:8000',
    portalEnabled: boolFromEnv(env.PORTAL_ENABLED, true),
    portalDistDir,
    apiDocsEnabled: boolFromEnv(env.API_DOCS_ENABLED, true),
    sttWorkerUrl: env.STT_WORKER_URL ?? 'http://127.0.0.1:8002',
    ttsWorkerUrl: env.TTS_WORKER_URL ?? 'http://127.0.0.1:8001',
    kokoroTtsWorkerUrl: env.KOKORO_TTS_WORKER_URL ?? env.TTS_KOKORO_WORKER_URL ?? 'http://127.0.0.1:8003',
    workerTimeoutMs: numberFromEnv(env.WORKER_TIMEOUT_MS, 120_000),
    allowSystemdRestart: boolFromEnv(env.ALLOW_SYSTEMD_RESTART, false),
    sttSystemdService: sttService,
    ttsSystemdService: ttsService,
    kokoroTtsSystemdService: kokoroTtsService,
    baseDir,
    configDir: env.CONFIG_DIR ?? path.join(baseDir, 'config'),
    modelDir: env.MODEL_DIR ?? path.join(baseDir, 'models'),
    cacheDir: env.CACHE_DIR ?? path.join(baseDir, 'cache'),
    voiceDir: env.VOICE_DIR ?? path.join(baseDir, 'voices'),
    uploadDir: env.UPLOAD_DIR ?? path.join(baseDir, 'uploads'),
    outputDir: env.OUTPUT_DIR ?? path.join(baseDir, 'output'),
    logDir: env.LOG_DIR ?? path.join(baseDir, 'logs'),
    gpuOnly: boolFromEnv(env.GPU_ONLY, true),
    defaultSttProvider: env.DEFAULT_STT_PROVIDER ?? 'fast-whisper',
    defaultSttModel: env.DEFAULT_STT_MODEL ?? 'large-v3-turbo',
    defaultSttComputeType: env.DEFAULT_STT_COMPUTE_TYPE ?? 'int8_float16',
    defaultSttDevice: env.DEFAULT_STT_DEVICE ?? 'cuda',
    defaultTtsProvider: env.DEFAULT_TTS_PROVIDER ?? 'chatterbox',
    defaultTtsModel: env.DEFAULT_TTS_MODEL ?? 'chatterbox-turbo',
    defaultTtsLanguage: env.DEFAULT_TTS_LANGUAGE ?? 'en',
    kokoroDefaultTtsModel: env.KOKORO_TTS_MODEL ?? env.KOKORO_DEFAULT_TTS_MODEL ?? 'kokoro-82m',
    kokoroDefaultTtsVoice: env.KOKORO_TTS_VOICE ?? env.KOKORO_DEFAULT_TTS_VOICE ?? 'af_heart',
    maxUploadBytes: numberFromEnv(env.MAX_UPLOAD_BYTES, 104_857_600),
    generatedRetentionHours: numberFromEnv(env.GENERATED_RETENTION_HOURS, 24),
    authEnabled: boolFromEnv(env.AUTH_ENABLED, false),
    basicAuthUsername: env.BASIC_AUTH_USERNAME ?? 'admin',
    basicAuthPassword: env.BASIC_AUTH_PASSWORD ?? ''
  };
}

export function toConfigView(config: AppConfig): ConfigView {
  return {
    public: { host: config.publicHost, port: config.publicPort },
    defaults: {
      sttProvider: config.defaultSttProvider,
      sttModel: config.defaultSttModel,
      ttsProvider: config.defaultTtsProvider,
      ttsModel: config.defaultTtsProvider === 'kokoro' ? config.kokoroDefaultTtsModel : config.defaultTtsModel
    },
    paths: {
      baseDir: config.baseDir,
      configDir: config.configDir,
      modelDir: config.modelDir,
      cacheDir: config.cacheDir,
      voiceDir: config.voiceDir,
      uploadDir: config.uploadDir,
      outputDir: config.outputDir,
      logDir: config.logDir
    },
    gpuOnly: config.gpuOnly,
    maxUploadBytes: config.maxUploadBytes,
    generatedRetentionHours: config.generatedRetentionHours,
    authEnabled: config.authEnabled
  };
}
