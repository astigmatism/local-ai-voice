import type { ConfigView, GpuStatus, ModelDescriptor, TtsReferenceAudio, WorkerHealth } from '@local-ai-voice/shared';

export interface HealthResponse {
  ok: boolean;
  checkedAt: string;
  gpu: GpuStatus;
  services: {
    stt: WorkerHealth;
    tts: WorkerHealth & { activeReferenceAudio?: TtsReferenceAudio | null };
  };
}

export interface ModelsResponse {
  stt: ModelDescriptor[];
  tts: ModelDescriptor[];
}

export interface LogsResponse {
  entries: Array<{ file: string; line: string }>;
}

export type ConfigResponse = ConfigView & {
  mutable: {
    tts?: {
      activeReferenceId?: string | null;
      activeReference?: TtsReferenceAudio | null;
    };
    [key: string]: unknown;
  };
};

export interface ReferenceUploadResponse extends TtsReferenceAudio {
  ok: true;
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

export const api = {
  health: () => getJson<HealthResponse>('/api/health'),
  gpu: () => getJson<GpuStatus>('/api/gpu'),
  system: () => getJson<Record<string, unknown>>('/api/system'),
  models: () => getJson<ModelsResponse>('/api/models'),
  config: () => getJson<ConfigResponse>('/api/config'),
  logs: () => getJson<LogsResponse>('/api/logs?limit=120'),
  loadStt: (model: string) => postJson('/api/models/stt/load', { model }),
  unloadStt: (strategy: 'soft' | 'hard') => postJson('/api/models/stt/unload', { strategy, clearCache: true }),
  loadTts: (model: string, language: string) => postJson('/api/models/tts/load', { model, language }),
  unloadTts: (strategy: 'soft' | 'hard') => postJson('/api/models/tts/unload', { strategy, clearCache: true }),
  patchSttDefault: (defaultModel: string) => patchJson('/api/config/stt', { defaultModel }),
  patchTtsDefault: (defaultModel: string, language: string) => patchJson('/api/config/tts', { defaultModel, language }),
  uploadReference: async (file: File, setDefault = true): Promise<ReferenceUploadResponse> => {
    const form = new FormData();
    form.append('file', file, file.name || 'reference.wav');
    form.append('provider', 'chatterbox');
    form.append('setDefault', String(setDefault));
    const response = await fetch('/api/tts/reference-audio', { method: 'POST', body: form });
    if (!response.ok) throw new Error(`/api/tts/reference-audio failed: ${response.status} ${await response.text()}`);
    return (await response.json()) as ReferenceUploadResponse;
  }
};
