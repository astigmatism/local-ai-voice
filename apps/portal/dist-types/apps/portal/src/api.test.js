import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
afterEach(() => {
    vi.restoreAllMocks();
});
describe('portal api helpers', () => {
    it('uploads Chatterbox reference WAV as active multipart state', async () => {
        const fetchMock = vi.fn(async (_url, init) => {
            const form = init?.body;
            expect(init?.method).toBe('POST');
            expect(form).toBeInstanceOf(FormData);
            expect(form.get('provider')).toBe('chatterbox');
            expect(form.get('setDefault')).toBe('true');
            const uploaded = form.get('file');
            expect(uploaded).toBeInstanceOf(Blob);
            expect(uploaded.type).toBe('audio/wav');
            return new Response(JSON.stringify({
                ok: true,
                provider: 'chatterbox',
                referenceId: 'reference-test.wav',
                id: 'reference-test.wav',
                filename: 'reference.wav',
                contentType: 'audio/wav',
                sizeBytes: 44,
                active: true,
                createdAt: '2026-05-27T00:00:00.000Z'
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        vi.stubGlobal('fetch', fetchMock);
        const file = new Blob([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69])], {
            type: 'audio/wav'
        });
        Object.defineProperty(file, 'name', { value: 'reference.wav' });
        const result = await api.uploadReference(file);
        expect(fetchMock).toHaveBeenCalledWith('/api/tts/reference-audio', expect.objectContaining({ method: 'POST' }));
        expect(result).toMatchObject({ ok: true, referenceId: 'reference-test.wav', active: true });
    });
    it('posts Kokoro speak requests and returns audio metadata', async () => {
        const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
        const fetchMock = vi.fn(async (_url, init) => {
            expect(_url).toBe('/api/tts/speak');
            expect(init?.method).toBe('POST');
            expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
            expect(JSON.parse(String(init?.body))).toMatchObject({ provider: 'kokoro', voice: 'af_heart' });
            return new Response(audio, {
                status: 200,
                headers: {
                    'content-type': 'audio/wav',
                    'x-local-ai-voice-engine': 'kokoro-tts',
                    'x-local-ai-voice-model': 'kokoro-82m',
                    'x-local-ai-voice-voice': 'af_heart'
                }
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await api.speak({ text: 'hello', provider: 'kokoro', voice: 'af_heart' });
        expect(result.contentType).toBe('audio/wav');
        expect(result.engine).toBe('kokoro-tts');
        expect(result.model).toBe('kokoro-82m');
        expect(result.voice).toBe('af_heart');
    });
});
//# sourceMappingURL=api.test.js.map