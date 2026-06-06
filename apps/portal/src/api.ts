import type {
  ConfigView,
  GpuStatus,
  ModelDescriptor,
  TtsReferenceAudio,
  VoiceDescriptor,
  WorkerHealth
} from '@local-ai-voice/shared';

export interface TtsProviderView {
  id: string;
  role: 'tts';
  label: string;
  name?: string;
  displayName?: string;
  workerUrl: string;
  systemdService: string;
  defaultModel: string;
  defaultVoice?: string;
  supportsReferenceAudio: boolean;
  supportsVoiceCloning: boolean;
  supportsLanguageSelection: boolean;
  enabled?: boolean;
  active?: boolean;
  reachable?: boolean;
  state?: string;
  model?: string | null;
  loadedModel?: string | null;
  voice?: string | null;
  language?: string;
  workerPort?: number;
  capabilities?: Record<string, boolean>;
  activeReferenceAudio?: TtsReferenceAudio | null;
  models: string[];
  voices: VoiceDescriptor[];
  health?: WorkerHealth;
  status?: Record<string, unknown>;
}

export interface HealthResponse {
  ok: boolean;
  checkedAt: string;
  gpu: GpuStatus;
  services: {
    stt: WorkerHealth;
    tts: WorkerHealth & { activeReferenceAudio?: TtsReferenceAudio | null };
  };
  ttsProviders?: TtsProviderView[];
}

export interface ModelsResponse {
  stt: ModelDescriptor[];
  tts: ModelDescriptor[];
  ttsProviders?: TtsProviderView[];
}

export interface ServicesTtsResponse {
  ok: boolean;
  defaultProvider: string;
  selectedProvider: string;
  provider: string;
  providers: TtsProviderView[];
}

export interface VoicesResponse {
  provider: string;
  voices: VoiceDescriptor[];
  activeReferenceAudio?: TtsReferenceAudio | null;
}

export interface LogsResponse {
  entries: Array<{ file: string; line: string }>;
}

export type ConfigResponse = ConfigView & {
  mutable: {
    stt?: {
      provider?: string;
      defaultModel?: string;
      computeType?: string;
    };
    tts?: {
      provider?: string;
      defaultModel?: string;
      language?: string;
      activeReferenceId?: string | null;
      activeReference?: TtsReferenceAudio | null;
      providers?: Record<
        string,
        {
          enabled?: boolean;
          defaultModel?: string;
          defaultVoice?: string;
          language?: string;
          autoLoad?: boolean;
          activeReferenceId?: string | null;
          activeReference?: TtsReferenceAudio | null;
        }
      >;
    };
    [key: string]: unknown;
  };
};

export interface ReferenceUploadResponse extends TtsReferenceAudio {
  ok: true;
}

export interface SpeakPayload {
  text: string;
  provider?: string;
  model?: string;
  voice?: string;
  language?: string;
  speed?: number;
  options?: Record<string, unknown>;
}

export interface SpeakResponse {
  blob: Blob;
  contentType: string;
  engine: string | null;
  sampleRate: string | null;
  model: string | null;
  voice: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

async function postAudio(url: string, body: unknown): Promise<SpeakResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${await response.text()}`);
  return {
    blob: await response.blob(),
    contentType: response.headers.get('content-type') ?? 'audio/wav',
    engine: response.headers.get('x-local-ai-voice-engine') ?? response.headers.get('x-engine'),
    sampleRate: response.headers.get('x-sample-rate'),
    model: response.headers.get('x-local-ai-voice-model'),
    voice: response.headers.get('x-local-ai-voice-voice')
  };
}

export const api = {
  health: () => getJson<HealthResponse>('/api/health'),
  gpu: () => getJson<GpuStatus>('/api/gpu'),
  system: () => getJson<Record<string, unknown>>('/api/system'),
  models: () => getJson<ModelsResponse>('/api/models'),
  config: () => getJson<ConfigResponse>('/api/config'),
  ttsServices: () => getJson<ServicesTtsResponse>('/api/services/tts'),
  logs: () => getJson<LogsResponse>('/api/logs?limit=120'),
  voices: (provider: string) => getJson<VoicesResponse>(`/api/voices?provider=${encodeURIComponent(provider)}`),
  speak: (payload: SpeakPayload) => postAudio('/api/tts/speak', payload),
  loadStt: (model: string) => postJson('/api/models/stt/load', { model }),
  unloadStt: (strategy: 'soft' | 'hard') => postJson('/api/models/stt/unload', { strategy, clearCache: true }),
  loadTts: (provider: string, model: string, language: string) =>
    postJson('/api/models/tts/load', { provider, model, language }),
  unloadTts: (provider: string, strategy: 'soft' | 'hard') =>
    postJson('/api/models/tts/unload', { provider, strategy, clearCache: true }),
  reloadTts: (provider: string, model: string, language: string) =>
    postJson('/api/models/tts/reload', { provider, model, language }),
  patchSttDefault: (defaultModel: string) => patchJson('/api/config/stt', { defaultModel }),
  patchTtsDefault: (provider: string, defaultModel: string, language: string) =>
    patchJson('/api/config/tts', { provider, defaultModel, language }),
  uploadReference: async (file: File, setDefault = true, provider = 'chatterbox'): Promise<ReferenceUploadResponse> => {
    const form = new FormData();
    form.append('file', file, file.name || 'reference.wav');
    form.append('provider', provider);
    form.append('setDefault', String(setDefault));
    const response = await fetch('/api/tts/reference-audio', { method: 'POST', body: form });
    if (!response.ok) throw new Error(`/api/tts/reference-audio failed: ${response.status} ${await response.text()}`);
    return (await response.json()) as ReferenceUploadResponse;
  }
};
