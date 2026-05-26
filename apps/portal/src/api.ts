import type { ConfigView, GpuStatus, ModelDescriptor, WorkerHealth } from '@local-ai-voice/shared';

export interface HealthResponse {
  ok: boolean;
  checkedAt: string;
  gpu: GpuStatus;
  services: {
    stt: WorkerHealth;
    tts: WorkerHealth;
  };
}

export interface ModelsResponse {
  stt: ModelDescriptor[];
  tts: ModelDescriptor[];
}

export interface LogsResponse {
  entries: Array<{ file: string; line: string }>;
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
  config: () => getJson<ConfigView & { mutable: Record<string, unknown> }>('/api/config'),
  logs: () => getJson<LogsResponse>('/api/logs?limit=120'),
  loadStt: (model: string) => postJson('/api/models/stt/load', { model }),
  unloadStt: (strategy: 'soft' | 'hard') => postJson('/api/models/stt/unload', { strategy, clearCache: true }),
  loadTts: (model: string, language: string) => postJson('/api/models/tts/load', { model, language }),
  unloadTts: (strategy: 'soft' | 'hard') => postJson('/api/models/tts/unload', { strategy, clearCache: true }),
  patchSttDefault: (defaultModel: string) => patchJson('/api/config/stt', { defaultModel }),
  patchTtsDefault: (defaultModel: string, language: string) => patchJson('/api/config/tts', { defaultModel, language }),
  uploadReference: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/tts/reference-audio', { method: 'POST', body: form });
    if (!response.ok) throw new Error(`/api/tts/reference-audio failed: ${response.status}`);
    return response.json();
  }
};
