import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { WorkerClient } from '../src/worker-client.js';

const tmpRoots: string[] = [];

function tempConfig() {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'lav-gateway-'));
  tmpRoots.push(baseDir);
  return loadConfig({
    BASE_DIR: baseDir,
    CONFIG_DIR: path.join(baseDir, 'config'),
    MODEL_DIR: path.join(baseDir, 'models'),
    CACHE_DIR: path.join(baseDir, 'cache'),
    VOICE_DIR: path.join(baseDir, 'voices'),
    UPLOAD_DIR: path.join(baseDir, 'uploads'),
    OUTPUT_DIR: path.join(baseDir, 'output'),
    LOG_DIR: path.join(baseDir, 'logs'),
    PORTAL_ENABLED: 'false',
    PUBLIC_PORT: '0',
    AUTH_ENABLED: 'false'
  } as NodeJS.ProcessEnv);
}

function worker(role: 'stt' | 'tts'): WorkerClient {
  const model = role === 'stt' ? 'large-v3-turbo' : 'chatterbox-turbo';
  return {
    health: async () => ({
      ok: true,
      role,
      provider: role === 'stt' ? 'fast-whisper' : 'chatterbox',
      state: 'loaded',
      loadedModel: model,
      gpuOnly: true,
      gpuAvailable: true
    }),
    modelStatus: async () => ({
      role,
      provider: role === 'stt' ? 'fast-whisper' : 'chatterbox',
      state: 'loaded',
      loadedModel: model,
      defaultModel: model,
      device: 'cuda'
    }),
    loadModel: async (payload: { model: string }) => ({
      role,
      provider: role === 'stt' ? 'fast-whisper' : 'chatterbox',
      state: 'loaded',
      loadedModel: payload.model
    }),
    unloadModel: async () => ({
      role,
      provider: role === 'stt' ? 'fast-whisper' : 'chatterbox',
      state: 'unloaded',
      loadedModel: null
    }),
    transcribe: async () => ({
      provider: 'fast-whisper',
      model: 'large-v3-turbo',
      transcript: 'hello world',
      segments: [{ start: 0, end: 1, text: 'hello world' }],
      vadFilter: true,
      minSilenceDurationMs: 1000
    }),
    speak: async () => new Response(Buffer.from('RIFF'), { headers: { 'content-type': 'audio/wav' } }),
    config: async () => ({})
  } as unknown as WorkerClient;
}

afterEach(() => {
  for (const tmpRoot of tmpRoots.splice(0)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('gateway routes', () => {
  it('exposes health and service state', async () => {
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt'), ttsClient: worker('tts') });
    const response = await app.inject({ method: 'GET', url: '/api/services' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ stt: { ok: true }, tts: { ok: true } });
    await app.close();
  });

  it('preserves compatibility model default route', async () => {
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt'), ttsClient: worker('tts') });
    const response = await app.inject({ method: 'GET', url: '/model/default' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ default_model: 'large-v3-turbo' });
    await app.close();
  });

  it('loads STT model through abstraction', async () => {
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt'), ttsClient: worker('tts') });
    const response = await app.inject({
      method: 'POST',
      url: '/api/models/stt/load',
      payload: { model: 'small', computeType: 'int8_float16' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: 'loaded', loadedModel: 'small' });
    await app.close();
  });
});
