import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SpeakRequest } from '@local-ai-voice/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { UploadedAudio } from '../src/storage.js';
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
    API_DOCS_ENABLED: 'false',
    PUBLIC_PORT: '0',
    AUTH_ENABLED: 'false'
  } as NodeJS.ProcessEnv);
}

function wavBuffer(): Buffer {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
    0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00,
    0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00
  ]);
}

function responseBodyFromBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

function multipartPayload(options: {
  fields?: Record<string, string>;
  fileField?: string;
  filename?: string;
  contentType?: string;
  file?: Buffer;
}) {
  const boundary = `----local-ai-voice-test-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  const append = (value: string | Buffer) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  for (const [name, value] of Object.entries(options.fields ?? {})) {
    append(`--${boundary}\r\n`);
    append(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    append(`${value}\r\n`);
  }
  append(`--${boundary}\r\n`);
  append(
    `Content-Disposition: form-data; name="${options.fileField ?? 'file'}"; filename="${options.filename ?? 'reference.wav'}"\r\n`
  );
  append(`Content-Type: ${options.contentType ?? 'audio/wav'}\r\n\r\n`);
  append(options.file ?? wavBuffer());
  append(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }
  };
}

interface CapturedSpeak {
  payload: SpeakRequest;
  referenceAudio?: UploadedAudio;
}

interface CapturedTranscribe {
  upload: UploadedAudio;
  fields: Record<string, string>;
}

function worker(role: 'stt' | 'tts', speaks: CapturedSpeak[] = [], transcribes: CapturedTranscribe[] = []): WorkerClient {
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
    transcribe: async (upload: UploadedAudio, fields: Record<string, string>) => {
      transcribes.push({ upload, fields });
      return {
        filename: upload.filename,
        provider: 'fast-whisper',
        model: fields.model ?? 'large-v3-turbo',
        defaultModel: fields.model ?? 'large-v3-turbo',
        activeModel: fields.model ?? 'large-v3-turbo',
        language: 'en',
        languageProbability: 0.99,
        durationSeconds: 1,
        transcript: 'hello world',
        segments: [{ start: 0, end: 1, text: 'hello world' }],
        vadFilter: fields.vad_filter !== 'false',
        minSilenceDurationMs: Number(fields.min_silence_duration_ms ?? 1000)
      };
    },
    speak: async (payload: SpeakRequest, referenceAudio?: UploadedAudio) => {
      speaks.push({ payload, referenceAudio });
      return new Response(responseBodyFromBuffer(wavBuffer()), { headers: { 'content-type': 'audio/wav' } });
    },
    config: async () => ({})
  } as unknown as WorkerClient;
}

async function uploadReference(app: Awaited<ReturnType<typeof buildApp>>, fields: Record<string, string> = {}) {
  const multipart = multipartPayload({ fields: { provider: 'chatterbox', ...fields } });
  const response = await app.inject({
    method: 'POST',
    url: '/api/tts/reference-audio',
    headers: multipart.headers,
    payload: multipart.payload
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { referenceId: string; filename: string; active: boolean };
}

afterEach(() => {
  for (const tmpRoot of tmpRoots.splice(0)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('gateway routes', () => {
  it('exposes health and service state', async () => {
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt'), ttsClient: worker('tts') });
    const response = await app.inject({ method: 'GET', url: '/api/services' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ stt: { ok: true }, tts: { ok: true, activeReferenceAudio: null } });
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


  it('normalizes modern STT transcribe fields and uses the mutable STT default model', async () => {
    const transcribes: CapturedTranscribe[] = [];
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt', [], transcribes), ttsClient: worker('tts') });
    await app.inject({
      method: 'PATCH',
      url: '/api/config/stt',
      payload: { defaultModel: 'medium' }
    });
    const multipart = multipartPayload({
      fileField: 'audio',
      filename: 'sample.wav',
      fields: {
        vadFilter: 'false',
        minSilenceDurationMs: '250',
        beamSize: '1',
        wordTimestamps: 'true'
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/stt/transcribe',
      headers: multipart.headers,
      payload: multipart.payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ model: 'medium', transcript: 'hello world', vadFilter: false });
    expect(transcribes.at(-1)?.upload.fieldname).toBe('audio');
    expect(transcribes.at(-1)?.fields).toMatchObject({
      model: 'medium',
      vad_filter: 'false',
      min_silence_duration_ms: '250',
      beam_size: '1',
      word_timestamps: 'true'
    });
    expect(transcribes.at(-1)?.fields.vadFilter).toBeUndefined();
    expect(transcribes.at(-1)?.fields.minSilenceDurationMs).toBeUndefined();
    await app.close();
  });

  it('keeps legacy transcribe shape while using the mutable STT default model', async () => {
    const transcribes: CapturedTranscribe[] = [];
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt', [], transcribes), ttsClient: worker('tts') });
    await app.inject({
      method: 'PATCH',
      url: '/api/config/stt',
      payload: { defaultModel: 'small' }
    });
    const multipart = multipartPayload({ fields: { vad_filter: 'true', min_silence_duration_ms: '750' } });

    const response = await app.inject({
      method: 'POST',
      url: '/transcribe',
      headers: multipart.headers,
      payload: multipart.payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      model: 'small',
      default_model: 'small',
      active_model: 'small',
      transcript: 'hello world',
      vad_filter: true,
      min_silence_duration_ms: 750
    });
    expect(transcribes.at(-1)?.fields.model).toBe('small');
    await app.close();
  });

  it('accepts OpenAI-compatible transcription requests and maps whisper-1 to the local STT default', async () => {
    const transcribes: CapturedTranscribe[] = [];
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt', [], transcribes), ttsClient: worker('tts') });
    const multipart = multipartPayload({
      fields: { model: 'whisper-1', response_format: 'verbose_json' },
      filename: 'openai.wav'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audio/transcriptions',
      headers: multipart.headers,
      payload: multipart.payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ task: 'transcribe', text: 'hello world', language: 'en' });
    expect(transcribes.at(-1)?.fields.model).toBe('large-v3-turbo');
    expect(transcribes.at(-1)?.fields.response_format).toBe('verbose_json');
    await app.close();
  });

  it('uploads a valid Chatterbox WAV reference, stores it under the provider voice dir, and marks it active', async () => {
    const config = tempConfig();
    const app = await buildApp({ config, sttClient: worker('stt'), ttsClient: worker('tts') });
    const result = await uploadReference(app, { setDefault: 'true' });

    expect(result.referenceId).toMatch(/^reference-.*\.wav$/);
    expect(result.active).toBe(true);
    expect(existsSync(path.join(config.voiceDir, 'chatterbox', result.referenceId))).toBe(true);

    const services = await app.inject({ method: 'GET', url: '/api/services/tts' });
    expect(services.json()).toMatchObject({ activeReferenceAudio: { referenceId: result.referenceId, active: true } });
    await app.close();
  });

  it('rejects non-WAV reference uploads with a clear 4xx response', async () => {
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt'), ttsClient: worker('tts') });
    const multipart = multipartPayload({
      filename: 'not-a-wav.txt',
      contentType: 'text/plain',
      file: Buffer.from('not wav')
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/tts/reference-audio',
      headers: multipart.headers,
      payload: multipart.payload
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.json().error).toMatch(/audio|WAV|content type/i);
    await app.close();
  });

  it('sanitizes traversal-style upload filenames and never uses them as storage paths', async () => {
    const config = tempConfig();
    const app = await buildApp({ config, sttClient: worker('stt'), ttsClient: worker('tts') });
    const multipart = multipartPayload({
      fields: { provider: 'chatterbox', setDefault: 'false' },
      filename: '../evil.wav'
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/tts/reference-audio',
      headers: multipart.headers,
      payload: multipart.payload
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.filename).not.toContain('..');
    expect(body.filename).not.toContain('/');
    expect(body).not.toHaveProperty('path');
    expect(existsSync(path.join(config.voiceDir, 'chatterbox', body.referenceId))).toBe(true);
    await app.close();
  });

  it('forwards the active/default reference id to Chatterbox on modern speak requests', async () => {
    const speaks: CapturedSpeak[] = [];
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt'), ttsClient: worker('tts', speaks) });
    const reference = await uploadReference(app, { setDefault: 'true' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/tts/speak',
      payload: { text: 'This should use the active reference.' }
    });

    expect(response.statusCode).toBe(200);
    expect(speaks.at(-1)?.payload.referenceAudioId).toBe(reference.referenceId);
    await app.close();
  });

  it('lets explicit referenceId override the active/default reference id', async () => {
    const speaks: CapturedSpeak[] = [];
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt'), ttsClient: worker('tts', speaks) });
    const first = await uploadReference(app, { setDefault: 'true' });
    const second = await uploadReference(app, { setDefault: 'false' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/tts/speak',
      payload: { text: 'Use explicit reference.', referenceId: second.referenceId }
    });

    expect(response.statusCode).toBe(200);
    expect(first.referenceId).not.toBe(second.referenceId);
    expect(speaks.at(-1)?.payload.referenceAudioId).toBe(second.referenceId);
    await app.close();
  });

  it('keeps compatibility POST /speak working and applies the active/default reference id', async () => {
    const speaks: CapturedSpeak[] = [];
    const app = await buildApp({ config: tempConfig(), sttClient: worker('stt'), ttsClient: worker('tts', speaks) });
    const reference = await uploadReference(app, { setDefault: 'true' });

    const response = await app.inject({
      method: 'POST',
      url: '/speak',
      payload: { text: 'Compatibility speak should use the reference.' }
    });

    expect(response.statusCode).toBe(200);
    expect(speaks.at(-1)?.payload.referenceAudioId).toBe(reference.referenceId);
    await app.close();
  });
});
