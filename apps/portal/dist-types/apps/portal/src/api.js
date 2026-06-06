async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`${url} failed: ${response.status}`);
    return (await response.json());
}
async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok)
        throw new Error(`${url} failed: ${response.status} ${await response.text()}`);
    return (await response.json());
}
async function patchJson(url, body) {
    const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok)
        throw new Error(`${url} failed: ${response.status} ${await response.text()}`);
    return (await response.json());
}
async function postAudio(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok)
        throw new Error(`${url} failed: ${response.status} ${await response.text()}`);
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
    health: () => getJson('/api/health'),
    gpu: () => getJson('/api/gpu'),
    system: () => getJson('/api/system'),
    models: () => getJson('/api/models'),
    config: () => getJson('/api/config'),
    ttsServices: () => getJson('/api/services/tts'),
    logs: () => getJson('/api/logs?limit=120'),
    voices: (provider) => getJson(`/api/voices?provider=${encodeURIComponent(provider)}`),
    speak: (payload) => postAudio('/api/tts/speak', payload),
    loadStt: (model) => postJson('/api/models/stt/load', { model }),
    unloadStt: (strategy) => postJson('/api/models/stt/unload', { strategy, clearCache: true }),
    loadTts: (provider, model, language) => postJson('/api/models/tts/load', { provider, model, language }),
    unloadTts: (provider, strategy) => postJson('/api/models/tts/unload', { provider, strategy, clearCache: true }),
    reloadTts: (provider, model, language) => postJson('/api/models/tts/reload', { provider, model, language }),
    patchSttDefault: (defaultModel) => patchJson('/api/config/stt', { defaultModel }),
    patchTtsDefault: (provider, defaultModel, language) => patchJson('/api/config/tts', { provider, defaultModel, language }),
    uploadReference: async (file, setDefault = true, provider = 'chatterbox') => {
        const form = new FormData();
        form.append('file', file, file.name || 'reference.wav');
        form.append('provider', provider);
        form.append('setDefault', String(setDefault));
        const response = await fetch('/api/tts/reference-audio', { method: 'POST', body: form });
        if (!response.ok)
            throw new Error(`/api/tts/reference-audio failed: ${response.status} ${await response.text()}`);
        return (await response.json());
    }
};
//# sourceMappingURL=api.js.map