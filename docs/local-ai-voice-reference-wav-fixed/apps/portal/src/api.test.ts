import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('portal api helpers', () => {
  it('uploads Chatterbox reference WAV as active multipart state', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(init?.method).toBe('POST');
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('provider')).toBe('chatterbox');
      expect(form.get('setDefault')).toBe('true');
      expect(form.get('file')).toBeInstanceOf(File);
      return new Response(
        JSON.stringify({
          ok: true,
          provider: 'chatterbox',
          referenceId: 'reference-test.wav',
          id: 'reference-test.wav',
          filename: 'reference.wav',
          contentType: 'audio/wav',
          sizeBytes: 44,
          active: true,
          createdAt: '2026-05-27T00:00:00.000Z'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69])], 'reference.wav', {
      type: 'audio/wav'
    });
    const result = await api.uploadReference(file);

    expect(fetchMock).toHaveBeenCalledWith('/api/tts/reference-audio', expect.objectContaining({ method: 'POST' }));
    expect(result).toMatchObject({ ok: true, referenceId: 'reference-test.wav', active: true });
  });
});
