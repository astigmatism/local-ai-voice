import { renderToString } from 'react-dom/server';
import type { WorkerHealth } from '@local-ai-voice/shared';
import { describe, expect, it } from 'vitest';
import { App, TtsProviderStatus } from './App.js';
import type { HealthResponse } from './api.js';

const checkedAt = '2026-06-06T00:00:00.000Z';

function workerHealth(provider: string, loadedModel: string): WorkerHealth {
  return {
    ok: true,
    reachable: true,
    role: 'tts',
    provider,
    state: 'loaded',
    loadedModel,
    gpuOnly: true,
    gpuAvailable: true
  };
}

describe('App', () => {
  it('renders the appliance title', () => {
    const html = renderToString(<App />);
    expect(html).toContain('GPU-first STT/TTS manager');
  });

  it('can render Chatterbox and Kokoro provider state simultaneously', () => {
    const chatterboxHealth = workerHealth('chatterbox', 'chatterbox-turbo');
    const kokoroHealth = workerHealth('kokoro', 'kokoro-82m');

    const health: HealthResponse = {
      ok: true,
      checkedAt,
      gpu: {
        available: true,
        checkedAt,
        devices: []
      },
      services: {
        stt: {
          ok: true,
          reachable: true,
          role: 'stt',
          provider: 'fast-whisper',
          state: 'loaded',
          loadedModel: 'base.en',
          gpuOnly: true,
          gpuAvailable: true
        },
        tts: chatterboxHealth
      },
      ttsProviders: [
        {
          id: 'chatterbox',
          role: 'tts',
          label: 'Chatterbox TTS',
          displayName: 'Chatterbox TTS',
          workerUrl: 'http://127.0.0.1:8001',
          systemdService: 'local-ai-voice-tts-chatterbox.service',
          defaultModel: 'chatterbox-turbo',
          defaultVoice: 'reference-upload',
          supportsReferenceAudio: true,
          supportsVoiceCloning: true,
          supportsLanguageSelection: false,
          enabled: true,
          reachable: true,
          state: 'loaded',
          model: 'chatterbox-turbo',
          loadedModel: 'chatterbox-turbo',
          workerPort: 8001,
          models: ['chatterbox-turbo'],
          voices: [],
          health: chatterboxHealth
        },
        {
          id: 'kokoro',
          role: 'tts',
          label: 'Kokoro TTS',
          displayName: 'Kokoro TTS',
          workerUrl: 'http://127.0.0.1:8003',
          systemdService: 'local-ai-voice-tts-kokoro.service',
          defaultModel: 'kokoro-82m',
          defaultVoice: 'af_heart',
          supportsReferenceAudio: false,
          supportsVoiceCloning: false,
          supportsLanguageSelection: true,
          enabled: true,
          reachable: true,
          state: 'loaded',
          model: 'kokoro-82m',
          loadedModel: 'kokoro-82m',
          workerPort: 8003,
          models: ['kokoro-82m'],
          voices: [],
          health: kokoroHealth
        }
      ]
    };

    const html = renderToString(<TtsProviderStatus health={health} />);

    expect(html).toContain('Chatterbox TTS');
    expect(html).toContain('Kokoro TTS');
    expect(html).toContain('http://127.0.0.1:8001');
    expect(html).toContain('http://127.0.0.1:8003');
  });
});
