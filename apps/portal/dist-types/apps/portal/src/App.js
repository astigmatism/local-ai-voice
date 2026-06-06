import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
function bytes(kib) {
    if (!kib)
        return 'unknown';
    const gib = kib / 1024 / 1024;
    return `${gib.toFixed(1)} GiB`;
}
function mib(value) {
    return value === undefined ? 'unknown' : `${value.toLocaleString()} MiB`;
}
function modelKey(model) {
    return `${model.provider}:${model.id}`;
}
function StatusPill({ ok, label }) {
    return _jsx("span", { className: ok ? 'pill ok' : 'pill warn', children: label });
}
function GpuCard({ gpu }) {
    if (!gpu)
        return _jsx("section", { className: "card", children: "Loading GPU state..." });
    return (_jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-title", children: [_jsx("h2", { children: "GPU" }), _jsx(StatusPill, { ok: gpu.available, label: gpu.available ? 'available' : 'unavailable' })] }), gpu.error && _jsx("p", { className: "error", children: gpu.error }), gpu.devices.map((device) => (_jsxs("div", { className: "metrics", children: [_jsxs("div", { children: [_jsx("span", { children: "Name" }), _jsx("strong", { children: device.name })] }), _jsxs("div", { children: [_jsx("span", { children: "Driver" }), _jsx("strong", { children: device.driverVersion ?? 'unknown' })] }), _jsxs("div", { children: [_jsx("span", { children: "VRAM" }), _jsxs("strong", { children: [mib(device.memoryUsedMiB), " / ", mib(device.memoryTotalMiB)] })] }), _jsxs("div", { children: [_jsx("span", { children: "Free" }), _jsx("strong", { children: mib(device.memoryFreeMiB) })] }), _jsxs("div", { children: [_jsx("span", { children: "Utilization" }), _jsxs("strong", { children: [device.utilizationGpuPercent ?? 'unknown', "%"] })] }), _jsxs("div", { children: [_jsx("span", { children: "Temp" }), _jsxs("strong", { children: [device.temperatureC ?? 'unknown', " C"] })] })] }, device.index)))] }));
}
function ServiceCard({ title, health }) {
    return (_jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-title", children: [_jsx("h2", { children: title }), health ? _jsx(StatusPill, { ok: health.ok, label: health.state }) : _jsx(StatusPill, { ok: false, label: "unknown" })] }), health ? (_jsxs("div", { className: "kv", children: [_jsx("span", { children: "Provider" }), _jsx("strong", { children: health.provider }), _jsx("span", { children: "Loaded model" }), _jsx("strong", { children: health.loadedModel ?? 'none' }), _jsx("span", { children: "GPU only" }), _jsx("strong", { children: String(health.gpuOnly) }), _jsx("span", { children: "GPU visible to worker" }), _jsx("strong", { children: String(health.gpuAvailable) }), health.error && (_jsxs(_Fragment, { children: [_jsx("span", { children: "Error" }), _jsx("strong", { className: "error", children: health.error })] }))] })) : (_jsx("p", { children: "Loading..." }))] }));
}
function TtsProviderStatus({ health }) {
    const providers = health?.ttsProviders ?? [];
    return (_jsxs("section", { className: "card", children: [_jsx("h2", { children: "TTS providers" }), providers.length === 0 ? (_jsx("p", { className: "hint", children: "Provider status will appear after the gateway refreshes." })) : (_jsx("div", { className: "provider-list", children: providers.map((provider) => (_jsxs("div", { className: "provider-row", children: [_jsxs("div", { children: [_jsx("strong", { children: provider.label }), _jsx("span", { children: provider.id })] }), _jsx(StatusPill, { ok: Boolean(provider.health?.ok), label: provider.health?.state ?? 'unknown' })] }, provider.id))) }))] }));
}
function ModelPicker({ role, models, onLoad, onUnload, onSetDefault }) {
    const defaultKey = models[0] ? modelKey(models[0]) : '';
    const [selectedKey, setSelectedKey] = useState(defaultKey);
    const [language, setLanguage] = useState('en');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!selectedKey && defaultKey)
            setSelectedKey(defaultKey);
    }, [defaultKey, selectedKey]);
    const selected = models.find((candidate) => modelKey(candidate) === selectedKey) ?? models[0];
    async function run(action) {
        setBusy(true);
        try {
            await action();
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("section", { className: "card", children: [_jsxs("h2", { children: [role, " model control"] }), _jsxs("label", { children: ["Model", _jsx("select", { value: selected ? modelKey(selected) : '', onChange: (event) => setSelectedKey(event.target.value), children: models.map((candidate) => (_jsxs("option", { value: modelKey(candidate), children: [candidate.label, " (", candidate.provider, ")"] }, modelKey(candidate)))) })] }), role === 'TTS' && (_jsxs("label", { children: ["Language", _jsx("input", { value: language, onChange: (event) => setLanguage(event.target.value), placeholder: "en or a" })] })), _jsxs("div", { className: "actions", children: [_jsx("button", { disabled: busy || !selected, onClick: () => selected && void run(() => onLoad(selected.provider, selected.id, language)), children: "Load" }), _jsx("button", { disabled: busy || !selected, onClick: () => selected && void run(() => onUnload(selected.provider, 'soft')), children: "Soft unload" }), _jsx("button", { disabled: busy || !selected, onClick: () => selected && void run(() => onUnload(selected.provider, 'hard')), children: "Hard restart" }), _jsx("button", { disabled: busy || !selected, onClick: () => selected && void run(() => onSetDefault(selected.provider, selected.id, language)), children: "Set default" })] }), selected && (_jsxs("p", { className: "hint", children: [selected.description, " Approx VRAM: ", selected.approximateVramMiB ? `${selected.approximateVramMiB} MiB` : 'unknown', ".", selected.supportsReferenceAudio ? ' Supports reference WAV.' : ' Uses built-in voices.'] }))] }));
}
function StorageCard({ system }) {
    const disks = Array.isArray(system?.disks) ? system.disks : [];
    return (_jsxs("section", { className: "card wide", children: [_jsx("h2", { children: "Storage and paths" }), _jsx("div", { className: "table-wrap", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Path" }), _jsx("th", { children: "Used" }), _jsx("th", { children: "Total" }), _jsx("th", { children: "%" })] }) }), _jsx("tbody", { children: disks.map((disk) => (_jsxs("tr", { children: [_jsx("td", { children: String(disk.path) }), _jsx("td", { children: bytes(Number(disk.usedKiB)) }), _jsx("td", { children: bytes(Number(disk.totalKiB)) }), _jsx("td", { children: String(disk.percentUsed ?? 'unknown') })] }, String(disk.path)))) })] }) })] }));
}
function LogsCard({ logs }) {
    return (_jsxs("section", { className: "card wide", children: [_jsx("h2", { children: "Recent logs" }), _jsx("pre", { className: "logs", children: logs?.entries.length ? logs.entries.map((entry) => `[${entry.file}] ${entry.line}`).join('\n') : 'No log files found yet.' })] }));
}
function ReferenceUpload({ activeReference, onUploaded }) {
    const [file, setFile] = useState(null);
    const [message, setMessage] = useState('');
    const [uploadError, setUploadError] = useState('');
    const [busy, setBusy] = useState(false);
    const selectedFileLooksValid = !file || file.name.toLowerCase().endsWith('.wav') || ['audio/wav', 'audio/x-wav', 'audio/wave'].includes(file.type);
    async function upload() {
        if (!file || !selectedFileLooksValid)
            return;
        setBusy(true);
        setMessage('');
        setUploadError('');
        try {
            const result = await api.uploadReference(file, true, 'chatterbox');
            setMessage(`Uploaded and activated ${result.filename || result.referenceId}`);
            await onUploaded();
        }
        catch (err) {
            setUploadError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("section", { className: "card", children: [_jsx("h2", { children: "Chatterbox reference WAV" }), _jsx("p", { className: "hint", children: "Upload short reference WAV clips for Chatterbox voice cloning or conditioning. Keep files consented and local." }), _jsxs("div", { className: "kv compact", children: [_jsx("span", { children: "Active reference" }), _jsx("strong", { children: activeReference ? `${activeReference.filename} (${activeReference.referenceId})` : 'none configured' })] }), _jsx("input", { type: "file", accept: ".wav,audio/wav,audio/x-wav,audio/wave", onChange: (event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setMessage('');
                    setUploadError('');
                } }), file && !selectedFileLooksValid && _jsx("p", { className: "error", children: "Choose a WAV file with a .wav extension." }), _jsx("button", { disabled: busy || !file || !selectedFileLooksValid, onClick: () => void upload(), children: busy ? 'Uploading...' : 'Upload and activate reference' }), message && _jsx("p", { className: "hint", children: message }), uploadError && _jsx("p", { className: "error", children: uploadError })] }));
}
function preferredVoice(provider, voices, activeReference) {
    if (provider === 'chatterbox')
        return activeReference?.referenceId ?? 'reference-upload';
    if (provider === 'kokoro' && voices.some((voice) => voice.id === 'af_heart'))
        return 'af_heart';
    return voices[0]?.id ?? '';
}
function TtsSpeakCard({ models, configView }) {
    const configuredProvider = configView?.mutable.tts?.provider ?? 'chatterbox';
    const configuredModel = configView?.mutable.tts?.defaultModel;
    const configuredLanguage = configView?.mutable.tts?.language ?? 'en';
    const providers = useMemo(() => [...new Set(models.map((model) => model.provider))], [models]);
    const [provider, setProvider] = useState(configuredProvider);
    const providerModels = models.filter((model) => model.provider === provider);
    const [model, setModel] = useState(configuredModel ?? providerModels[0]?.id ?? '');
    const [language, setLanguage] = useState(configuredLanguage);
    const [voice, setVoice] = useState('');
    const [text, setText] = useState('Hello from the local AI voice appliance.');
    const [speed, setSpeed] = useState('1');
    const [voices, setVoices] = useState();
    const [audioUrl, setAudioUrl] = useState('');
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!providers.includes(provider) && providers[0])
            setProvider(providers[0]);
    }, [provider, providers]);
    useEffect(() => {
        const modelsForProvider = models.filter((candidate) => candidate.provider === provider);
        if (!modelsForProvider.some((candidate) => candidate.id === model)) {
            const configured = provider === configuredProvider ? configuredModel : undefined;
            setModel(configured ?? modelsForProvider[0]?.id ?? '');
        }
    }, [configuredModel, configuredProvider, model, models, provider]);
    useEffect(() => {
        setLanguage(provider === configuredProvider ? configuredLanguage : provider === 'kokoro' ? 'a' : 'en');
    }, [configuredLanguage, configuredProvider, provider]);
    useEffect(() => {
        let active = true;
        api
            .voices(provider)
            .then((nextVoices) => {
            if (!active)
                return;
            setVoices(nextVoices);
            setVoice((current) => nextVoices.voices.some((candidate) => candidate.id === current)
                ? current
                : preferredVoice(provider, nextVoices.voices, nextVoices.activeReferenceAudio));
        })
            .catch((err) => {
            if (active)
                setError(err instanceof Error ? err.message : String(err));
        });
        return () => {
            active = false;
        };
    }, [provider]);
    useEffect(() => {
        return () => {
            if (audioUrl)
                URL.revokeObjectURL(audioUrl);
        };
    }, [audioUrl]);
    async function synthesize() {
        setBusy(true);
        setError('');
        try {
            const nextResult = await api.speak({
                text,
                provider,
                model,
                language,
                voice: voice && voice !== 'reference-upload' ? voice : undefined,
                speed: Number.isFinite(Number(speed)) ? Number(speed) : undefined
            });
            if (audioUrl)
                URL.revokeObjectURL(audioUrl);
            setResult(nextResult);
            setAudioUrl(URL.createObjectURL(nextResult.blob));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("section", { className: "card wide", children: [_jsx("h2", { children: "Generate speech" }), _jsx("p", { className: "hint", children: "Choose Chatterbox for reference-WAV cloning or Kokoro for built-in multilingual voices." }), _jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Provider", _jsx("select", { value: provider, onChange: (event) => setProvider(event.target.value), children: providers.map((candidate) => (_jsx("option", { value: candidate, children: candidate }, candidate))) })] }), _jsxs("label", { children: ["Model", _jsx("select", { value: model, onChange: (event) => setModel(event.target.value), children: providerModels.map((candidate) => (_jsx("option", { value: candidate.id, children: candidate.label }, candidate.id))) })] }), _jsxs("label", { children: ["Voice", _jsx("select", { value: voice, onChange: (event) => setVoice(event.target.value), children: (voices?.voices ?? []).map((candidate) => (_jsx("option", { value: candidate.id, children: candidate.label ?? candidate.id }, candidate.id))) })] }), _jsxs("label", { children: ["Language", _jsx("input", { value: language, onChange: (event) => setLanguage(event.target.value), placeholder: "en, a, fr, ja..." })] }), _jsxs("label", { children: ["Speed", _jsx("input", { value: speed, onChange: (event) => setSpeed(event.target.value), inputMode: "decimal" })] })] }), _jsxs("label", { children: ["Text", _jsx("textarea", { value: text, onChange: (event) => setText(event.target.value), rows: 5 })] }), _jsx("div", { className: "actions", children: _jsx("button", { disabled: busy || !text.trim() || !model, onClick: () => void synthesize(), children: busy ? 'Generating...' : 'Generate speech' }) }), audioUrl && (_jsxs("div", { className: "audio-result", children: [_jsx("audio", { controls: true, src: audioUrl }), _jsx("a", { href: audioUrl, download: "speech.wav", children: "Download WAV" }), _jsxs("span", { className: "hint", children: [result?.engine ?? provider, " ", result?.voice ? `voice ${result.voice}` : ''] })] })), error && _jsx("p", { className: "error", children: error })] }));
}
export function App() {
    const [health, setHealth] = useState();
    const [models, setModels] = useState({ stt: [], tts: [] });
    const [system, setSystem] = useState();
    const [logs, setLogs] = useState();
    const [configView, setConfigView] = useState();
    const [error, setError] = useState('');
    const [lastUpdated, setLastUpdated] = useState('never');
    const refresh = useCallback(async () => {
        try {
            setError('');
            const [nextHealth, nextModels, nextSystem, nextLogs, nextConfig] = await Promise.all([
                api.health(),
                api.models(),
                api.system(),
                api.logs(),
                api.config()
            ]);
            setHealth(nextHealth);
            setModels(nextModels);
            setSystem(nextSystem);
            setLogs(nextLogs);
            setConfigView(nextConfig);
            setLastUpdated(new Date().toLocaleTimeString());
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);
    useEffect(() => {
        void refresh();
        const interval = window.setInterval(() => void refresh(), 15_000);
        return () => window.clearInterval(interval);
    }, [refresh]);
    const applianceOk = useMemo(() => Boolean(health?.ok), [health]);
    const activeReference = configView?.mutable.tts?.activeReference ?? health?.services.tts.activeReferenceAudio ?? null;
    async function withRefresh(action) {
        await action;
        await refresh();
    }
    return (_jsxs("main", { children: [_jsxs("header", { className: "hero", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Local AI Voice Appliance" }), _jsx("h1", { children: "GPU-first STT/TTS manager" }), _jsx("p", { children: "Gateway, portal, and localhost Python workers for swappable speech-to-text and text-to-speech models." })] }), _jsxs("div", { className: "hero-actions", children: [_jsx(StatusPill, { ok: applianceOk, label: applianceOk ? 'healthy' : 'degraded' }), _jsx("button", { onClick: () => void refresh(), children: "Refresh" }), _jsx("a", { href: "/api/docs", children: "API docs" })] })] }), error && _jsx("section", { className: "banner error", children: error }), _jsxs("p", { className: "updated", children: ["Last updated: ", lastUpdated] }), _jsxs("div", { className: "grid", children: [_jsx(GpuCard, { gpu: health?.gpu }), _jsx(ServiceCard, { title: "Speech to text", health: health?.services.stt }), _jsx(ServiceCard, { title: "Text to speech", health: health?.services.tts }), _jsx(TtsProviderStatus, { health: health }), _jsx(ModelPicker, { role: "STT", models: models.stt, onLoad: (_provider, model) => withRefresh(api.loadStt(model)), onUnload: (_provider, strategy) => withRefresh(api.unloadStt(strategy)), onSetDefault: (_provider, model) => withRefresh(api.patchSttDefault(model)) }), _jsx(ModelPicker, { role: "TTS", models: models.tts, onLoad: (provider, model, language) => withRefresh(api.loadTts(provider, model, language)), onUnload: (provider, strategy) => withRefresh(api.unloadTts(provider, strategy)), onSetDefault: (provider, model, language) => withRefresh(api.patchTtsDefault(provider, model, language)) }), _jsx(TtsSpeakCard, { models: models.tts, configView: configView }), _jsx(ReferenceUpload, { activeReference: activeReference, onUploaded: refresh }), _jsx(StorageCard, { system: system }), _jsx(LogsCard, { logs: logs })] })] }));
}
//# sourceMappingURL=App.js.map