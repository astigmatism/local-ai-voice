export type ServiceRole = 'stt' | 'tts';
export type LoadState = 'unloaded' | 'loading' | 'loaded' | 'unloading' | 'failed';
export type UnloadStrategy = 'soft' | 'hard';

export interface GpuDeviceInfo {
  index: number;
  name: string;
  driverVersion?: string;
  cudaVersion?: string;
  memoryTotalMiB?: number;
  memoryUsedMiB?: number;
  memoryFreeMiB?: number;
  utilizationGpuPercent?: number;
  temperatureC?: number;
  processes?: Array<{
    pid: number;
    name?: string;
    usedMemoryMiB?: number;
  }>;
}

export interface GpuStatus {
  available: boolean;
  checkedAt: string;
  error?: string;
  devices: GpuDeviceInfo[];
}

export interface WorkerHealth {
  ok: boolean;
  role: ServiceRole;
  provider: string;
  state: LoadState;
  loadedModel?: string | null;
  gpuOnly: boolean;
  gpuAvailable: boolean;
  version?: string;
  uptimeSeconds?: number;
  error?: string | null;
}

export interface ModelDescriptor {
  id: string;
  provider: string;
  role: ServiceRole;
  label: string;
  description?: string;
  languages?: string[];
  approximateVramMiB?: number;
  recommendedFor10Gb?: boolean;
  defaultComputeType?: string;
  supportsReferenceAudio?: boolean;
  supportsVoiceCloning?: boolean;
  supportsLanguageSelection?: boolean;
  notes?: string[];
}

export interface VoiceDescriptor {
  id: string;
  provider: string;
  label: string;
  path?: string;
  language?: string;
  referenceAudio?: boolean;
  createdAt?: string;
}

export interface LoadModelRequest {
  provider?: string;
  model: string;
  computeType?: string;
  language?: string;
  options?: Record<string, unknown>;
}

export interface UnloadModelRequest {
  strategy?: UnloadStrategy;
  clearCache?: boolean;
}

export interface ModelStatus {
  role: ServiceRole;
  provider: string;
  state: LoadState;
  loadedModel?: string | null;
  defaultModel?: string;
  computeType?: string | null;
  device?: string | null;
  lastChangedAt?: string;
  error?: string | null;
}

export interface TranscriptSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
  avgLogprob?: number | null;
  noSpeechProb?: number | null;
  compressionRatio?: number | null;
  words?: Array<{
    start: number;
    end: number;
    word: string;
    probability?: number;
  }>;
}

export interface TranscriptResponse {
  filename?: string;
  provider: string;
  model: string;
  defaultModel?: string;
  activeModel?: string;
  language?: string | null;
  languageProbability?: number | null;
  vadFilter?: boolean;
  minSilenceDurationMs?: number;
  transcript: string;
  segments: TranscriptSegment[];
  durationSeconds?: number | null;
}

export interface SpeakRequest {
  text: string;
  voice?: string;
  referenceAudioId?: string;
  language?: string;
  speed?: number;
  exaggeration?: number;
  cfgWeight?: number;
  temperature?: number;
  model?: string;
  options?: Record<string, unknown>;
}

export interface ConfigView {
  public: {
    host: string;
    port: number;
  };
  defaults: {
    sttProvider: string;
    sttModel: string;
    ttsProvider: string;
    ttsModel: string;
  };
  paths: {
    baseDir: string;
    configDir: string;
    modelDir: string;
    cacheDir: string;
    voiceDir: string;
    uploadDir: string;
    outputDir: string;
    logDir: string;
  };
  gpuOnly: boolean;
  maxUploadBytes: number;
  generatedRetentionHours: number;
  authEnabled: boolean;
}

export const loadStateOrder: LoadState[] = ['unloaded', 'loading', 'loaded', 'unloading', 'failed'];
