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
export const api = {
    health: () => getJson('/api/health'),
    gpu: () => getJson('/api/gpu'),
    system: () => getJson('/api/system'),
    models: () => getJson('/api/models'),
    config: () => getJson('/api/config'),
    logs: () => getJson('/api/logs?limit=120'),
    loadStt: (model) => postJson('/api/models/stt/load', { model }),
    unloadStt: (strategy) => postJson('/api/models/stt/unload', { strategy, clearCache: true }),
    loadTts: (model, language) => postJson('/api/models/tts/load', { model, language }),
    unloadTts: (strategy) => postJson('/api/models/tts/unload', { strategy, clearCache: true }),
    patchSttDefault: (defaultModel) => patchJson('/api/config/stt', { defaultModel }),
    patchTtsDefault: (defaultModel, language) => patchJson('/api/config/tts', { defaultModel, language }),
    uploadReference: async (file, setDefault = true) => {
        const form = new FormData();
        form.append('file', file, file.name || 'reference.wav');
        form.append('provider', 'chatterbox');
        form.append('setDefault', String(setDefault));
        const response = await fetch('/api/tts/reference-audio', { method: 'POST', body: form });
        if (!response.ok)
            throw new Error(`/api/tts/reference-audio failed: ${response.status} ${await response.text()}`);
        return (await response.json());
    }
};
//# sourceMappingURL=api.js.map