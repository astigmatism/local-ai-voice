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
function ModelPicker({ role, models, onLoad, onUnload, onSetDefault }) {
    const defaultModel = models[0]?.id ?? '';
    const [model, setModel] = useState(defaultModel);
    const [language, setLanguage] = useState('en');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!model && defaultModel)
            setModel(defaultModel);
    }, [defaultModel, model]);
    const selected = models.find((candidate) => candidate.id === model);
    async function run(action) {
        setBusy(true);
        try {
            await action();
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("section", { className: "card", children: [_jsxs("h2", { children: [role, " model control"] }), _jsxs("label", { children: ["Model", _jsx("select", { value: model, onChange: (event) => setModel(event.target.value), children: models.map((candidate) => (_jsxs("option", { value: candidate.id, children: [candidate.label, " (", candidate.provider, ")"] }, `${candidate.provider}:${candidate.id}`))) })] }), role === 'TTS' && (_jsxs("label", { children: ["Language", _jsx("input", { value: language, onChange: (event) => setLanguage(event.target.value), placeholder: "en" })] })), _jsxs("div", { className: "actions", children: [_jsx("button", { disabled: busy || !model, onClick: () => void run(() => onLoad(model, language)), children: "Load" }), _jsx("button", { disabled: busy, onClick: () => void run(() => onUnload('soft')), children: "Soft unload" }), _jsx("button", { disabled: busy, onClick: () => void run(() => onUnload('hard')), children: "Hard restart" }), _jsx("button", { disabled: busy || !model, onClick: () => void run(() => onSetDefault(model, language)), children: "Set default" })] }), selected && (_jsxs("p", { className: "hint", children: [selected.description, " Approx VRAM: ", selected.approximateVramMiB ? `${selected.approximateVramMiB} MiB` : 'unknown', "."] }))] }));
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
    const selectedFileLooksValid = !file ||
        file.name.toLowerCase().endsWith('.wav') ||
        ['audio/wav', 'audio/x-wav', 'audio/wave'].includes(file.type);
    async function upload() {
        if (!file || !selectedFileLooksValid)
            return;
        setBusy(true);
        setMessage('');
        setUploadError('');
        try {
            const result = await api.uploadReference(file, true);
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
    return (_jsxs("section", { className: "card", children: [_jsx("h2", { children: "Chatterbox reference WAV" }), _jsx("p", { className: "hint", children: "Upload short reference WAV clips for voice cloning or conditioning. Keep files consented and local." }), _jsxs("div", { className: "kv compact", children: [_jsx("span", { children: "Active reference" }), _jsx("strong", { children: activeReference ? `${activeReference.filename} (${activeReference.referenceId})` : 'none configured' })] }), _jsx("input", { type: "file", accept: ".wav,audio/wav,audio/x-wav,audio/wave", onChange: (event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setMessage('');
                    setUploadError('');
                } }), file && !selectedFileLooksValid && _jsx("p", { className: "error", children: "Choose a WAV file with a .wav extension." }), _jsx("button", { disabled: busy || !file || !selectedFileLooksValid, onClick: () => void upload(), children: busy ? 'Uploading...' : 'Upload and activate reference' }), message && _jsx("p", { className: "hint", children: message }), uploadError && _jsx("p", { className: "error", children: uploadError })] }));
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
    return (_jsxs("main", { children: [_jsxs("header", { className: "hero", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Local AI Voice Appliance" }), _jsx("h1", { children: "GPU-first STT/TTS manager" }), _jsx("p", { children: "Gateway, portal, and localhost Python workers for swappable speech-to-text and text-to-speech models." })] }), _jsxs("div", { className: "hero-actions", children: [_jsx(StatusPill, { ok: applianceOk, label: applianceOk ? 'healthy' : 'degraded' }), _jsx("button", { onClick: () => void refresh(), children: "Refresh" }), _jsx("a", { href: "/api/docs", children: "API docs" })] })] }), error && _jsx("section", { className: "banner error", children: error }), _jsxs("p", { className: "updated", children: ["Last updated: ", lastUpdated] }), _jsxs("div", { className: "grid", children: [_jsx(GpuCard, { gpu: health?.gpu }), _jsx(ServiceCard, { title: "Speech to text", health: health?.services.stt }), _jsx(ServiceCard, { title: "Text to speech", health: health?.services.tts }), _jsx(ModelPicker, { role: "STT", models: models.stt, onLoad: (model) => withRefresh(api.loadStt(model)), onUnload: (strategy) => withRefresh(api.unloadStt(strategy)), onSetDefault: (model) => withRefresh(api.patchSttDefault(model)) }), _jsx(ModelPicker, { role: "TTS", models: models.tts, onLoad: (model, language) => withRefresh(api.loadTts(model, language)), onUnload: (strategy) => withRefresh(api.unloadTts(strategy)), onSetDefault: (model, language) => withRefresh(api.patchTtsDefault(model, language)) }), _jsx(ReferenceUpload, { activeReference: activeReference, onUploaded: refresh }), _jsx(StorageCard, { system: system }), _jsx(LogsCard, { logs: logs })] })] }));
}
//# sourceMappingURL=App.js.map