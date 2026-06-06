import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GpuDeviceInfo, ModelDescriptor, TtsReferenceAudio, VoiceDescriptor, WorkerHealth } from '@local-ai-voice/shared';
import {
  api,
  type ConfigResponse,
  type HealthResponse,
  type LogsResponse,
  type ModelsResponse,
  type SpeakResponse,
  type TtsProviderView,
  type VoicesResponse
} from './api.js';

type LoadStrategy = 'soft' | 'hard';

function bytes(kib: number | undefined): string {
  if (!kib) return 'unknown';
  const gib = kib / 1024 / 1024;
  return `${gib.toFixed(1)} GiB`;
}

function mib(value: number | undefined): string {
  return value === undefined ? 'unknown' : `${value.toLocaleString()} MiB`;
}

function modelKey(model: ModelDescriptor): string {
  return `${model.provider}:${model.id}`;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? 'pill ok' : 'pill warn'}>{label}</span>;
}

function GpuCard({ gpu }: { gpu?: HealthResponse['gpu'] }) {
  if (!gpu) return <section className="card">Loading GPU state...</section>;
  return (
    <section className="card">
      <div className="card-title">
        <h2>GPU</h2>
        <StatusPill ok={gpu.available} label={gpu.available ? 'available' : 'unavailable'} />
      </div>
      {gpu.error && <p className="error">{gpu.error}</p>}
      {gpu.devices.map((device: GpuDeviceInfo) => (
        <div key={device.index} className="metrics">
          <div>
            <span>Name</span>
            <strong>{device.name}</strong>
          </div>
          <div>
            <span>Driver</span>
            <strong>{device.driverVersion ?? 'unknown'}</strong>
          </div>
          <div>
            <span>VRAM</span>
            <strong>
              {mib(device.memoryUsedMiB)} / {mib(device.memoryTotalMiB)}
            </strong>
          </div>
          <div>
            <span>Free</span>
            <strong>{mib(device.memoryFreeMiB)}</strong>
          </div>
          <div>
            <span>Utilization</span>
            <strong>{device.utilizationGpuPercent ?? 'unknown'}%</strong>
          </div>
          <div>
            <span>Temp</span>
            <strong>{device.temperatureC ?? 'unknown'} C</strong>
          </div>
        </div>
      ))}
    </section>
  );
}

function ServiceCard({ title, health }: { title: string; health?: WorkerHealth }) {
  return (
    <section className="card">
      <div className="card-title">
        <h2>{title}</h2>
        {health ? <StatusPill ok={health.ok} label={health.state} /> : <StatusPill ok={false} label="unknown" />}
      </div>
      {health ? (
        <div className="kv">
          <span>Provider</span>
          <strong>{health.provider}</strong>
          <span>Loaded model</span>
          <strong>{health.loadedModel ?? 'none'}</strong>
          <span>GPU only</span>
          <strong>{String(health.gpuOnly)}</strong>
          <span>GPU visible to worker</span>
          <strong>{String(health.gpuAvailable)}</strong>
          {health.error && (
            <>
              <span>Error</span>
              <strong className="error">{health.error}</strong>
            </>
          )}
        </div>
      ) : (
        <p>Loading...</p>
      )}
    </section>
  );
}

function ProviderCapabilityList({ provider }: { provider: TtsProviderView }) {
  const capabilities = provider.capabilities ?? { referenceAudio: provider.supportsReferenceAudio };
  return (
    <span className="hint">
      {capabilities.referenceAudio ? 'reference WAV' : 'built-in voices'};
      {capabilities['languageSelection'] ? ' language selection' : ' fixed language'}; speed control
    </span>
  );
}

export function TtsProviderStatus({ health }: { health?: HealthResponse }) {
  const providers = health?.ttsProviders ?? [];
  return (
    <section className="card wide">
      <h2>Concurrent TTS providers</h2>
      {providers.length === 0 ? (
        <p className="hint">Provider status will appear after the gateway refreshes.</p>
      ) : (
        <div className="provider-grid">
          {providers.map((provider) => (
            <div key={provider.id} className="provider-panel">
              <div className="provider-row">
                <div>
                  <strong>{provider.displayName ?? provider.label}</strong>
                  <span>{provider.workerUrl}</span>
                </div>
                <StatusPill
                  ok={Boolean(provider.reachable ?? provider.health?.reachable ?? provider.health?.ok)}
                  label={provider.state ?? provider.health?.state ?? 'unknown'}
                />
              </div>
              <div className="kv compact">
                <span>Enabled</span>
                <strong>{String(provider.enabled ?? provider.active ?? true)}</strong>
                <span>Loaded model</span>
                <strong>{provider.loadedModel ?? provider.model ?? provider.health?.loadedModel ?? 'none'}</strong>
                <span>Default model</span>
                <strong>{provider.defaultModel}</strong>
                <span>Default voice</span>
                <strong>{provider.voice ?? provider.defaultVoice ?? 'none'}</strong>
                <span>Worker port</span>
                <strong>{provider.workerPort ?? 'unknown'}</strong>
              </div>
              <ProviderCapabilityList provider={provider} />
              {provider.health?.error && <p className="error">{provider.health.error}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ModelPicker({
  role,
  models,
  onLoad,
  onUnload,
  onReload,
  onSetDefault
}: {
  role: 'STT' | 'TTS';
  models: ModelDescriptor[];
  onLoad: (provider: string, model: string, language: string) => Promise<void>;
  onUnload: (provider: string, strategy: LoadStrategy) => Promise<void>;
  onReload?: (provider: string, model: string, language: string) => Promise<void>;
  onSetDefault: (provider: string, model: string, language: string) => Promise<void>;
}) {
  const defaultKey = models[0] ? modelKey(models[0]) : '';
  const [selectedKey, setSelectedKey] = useState(defaultKey);
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedKey && defaultKey) setSelectedKey(defaultKey);
  }, [defaultKey, selectedKey]);

  const selected = models.find((candidate) => modelKey(candidate) === selectedKey) ?? models[0];

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{role} model control</h2>
      <label>
        Model
        <select value={selected ? modelKey(selected) : ''} onChange={(event) => setSelectedKey(event.target.value)}>
          {models.map((candidate) => (
            <option key={modelKey(candidate)} value={modelKey(candidate)}>
              {candidate.label} ({candidate.provider})
            </option>
          ))}
        </select>
      </label>
      {role === 'TTS' && (
        <label>
          Language
          <input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="en or a" />
        </label>
      )}
      <div className="actions">
        <button disabled={busy || !selected} onClick={() => selected && void run(() => onLoad(selected.provider, selected.id, language))}>
          Load
        </button>
        <button disabled={busy || !selected} onClick={() => selected && void run(() => onUnload(selected.provider, 'soft'))}>
          Soft unload
        </button>
        {role === 'TTS' && (
          <button disabled={busy || !selected || !onReload} onClick={() => selected && onReload && void run(() => onReload(selected.provider, selected.id, language))}>
            Reload
          </button>
        )}
        <button disabled={busy || !selected} onClick={() => selected && void run(() => onUnload(selected.provider, 'hard'))}>
          Hard restart
        </button>
        <button disabled={busy || !selected} onClick={() => selected && void run(() => onSetDefault(selected.provider, selected.id, language))}>
          Set default
        </button>
      </div>
      {selected && (
        <p className="hint">
          {selected.description} Approx VRAM: {selected.approximateVramMiB ? `${selected.approximateVramMiB} MiB` : 'unknown'}.
          {selected.supportsReferenceAudio ? ' Supports reference WAV.' : ' Uses built-in voices.'}
        </p>
      )}
    </section>
  );
}

function StorageCard({ system }: { system?: Record<string, unknown> }) {
  const disks = Array.isArray(system?.disks) ? (system.disks as Array<Record<string, unknown>>) : [];
  return (
    <section className="card wide">
      <h2>Storage and paths</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th>Used</th>
              <th>Total</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {disks.map((disk) => (
              <tr key={String(disk.path)}>
                <td>{String(disk.path)}</td>
                <td>{bytes(Number(disk.usedKiB))}</td>
                <td>{bytes(Number(disk.totalKiB))}</td>
                <td>{String(disk.percentUsed ?? 'unknown')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LogsCard({ logs }: { logs?: LogsResponse }) {
  return (
    <section className="card wide">
      <h2>Recent logs</h2>
      <pre className="logs">
        {logs?.entries.length ? logs.entries.map((entry) => `[${entry.file}] ${entry.line}`).join('\n') : 'No log files found yet.'}
      </pre>
    </section>
  );
}

function ReferenceUpload({
  activeReference,
  onUploaded
}: {
  activeReference?: TtsReferenceAudio | null;
  onUploaded: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedFileLooksValid =
    !file || file.name.toLowerCase().endsWith('.wav') || ['audio/wav', 'audio/x-wav', 'audio/wave'].includes(file.type);

  async function upload() {
    if (!file || !selectedFileLooksValid) return;
    setBusy(true);
    setMessage('');
    setUploadError('');
    try {
      const result = await api.uploadReference(file, true, 'chatterbox');
      setMessage(`Uploaded and activated ${result.filename || result.referenceId}`);
      await onUploaded();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Chatterbox reference WAV</h2>
      <p className="hint">Upload short reference WAV clips for Chatterbox voice cloning or conditioning. Keep files consented and local.</p>
      <div className="kv compact">
        <span>Active reference</span>
        <strong>{activeReference ? `${activeReference.filename} (${activeReference.referenceId})` : 'none configured'}</strong>
      </div>
      <input
        type="file"
        accept=".wav,audio/wav,audio/x-wav,audio/wave"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setMessage('');
          setUploadError('');
        }}
      />
      {file && !selectedFileLooksValid && <p className="error">Choose a WAV file with a .wav extension.</p>}
      <button disabled={busy || !file || !selectedFileLooksValid} onClick={() => void upload()}>
        {busy ? 'Uploading...' : 'Upload and activate reference'}
      </button>
      {message && <p className="hint">{message}</p>}
      {uploadError && <p className="error">{uploadError}</p>}
    </section>
  );
}

function preferredVoice(provider: string, voices: VoiceDescriptor[], activeReference?: TtsReferenceAudio | null): string {
  if (provider === 'chatterbox') return activeReference?.referenceId ?? 'reference-upload';
  if (provider === 'kokoro' && voices.some((voice) => voice.id === 'af_heart')) return 'af_heart';
  return voices[0]?.id ?? '';
}

function TtsSpeakCard({ models, configView }: { models: ModelDescriptor[]; configView?: ConfigResponse }) {
  const configuredProvider = configView?.mutable.tts?.provider ?? 'chatterbox';
  const providerDefaults: NonNullable<NonNullable<ConfigResponse['mutable']['tts']>['providers']> =
    configView?.mutable.tts?.providers ?? {};
  const configuredModel = providerDefaults[configuredProvider]?.defaultModel ?? configView?.mutable.tts?.defaultModel;
  const configuredLanguage = providerDefaults[configuredProvider]?.language ?? configView?.mutable.tts?.language ?? 'en';
  const providers = useMemo(() => [...new Set(models.map((model) => model.provider))], [models]);
  const [provider, setProvider] = useState(configuredProvider);
  const providerModels = models.filter((model) => model.provider === provider);
  const [model, setModel] = useState(configuredModel ?? providerModels[0]?.id ?? '');
  const [language, setLanguage] = useState(configuredLanguage);
  const [voice, setVoice] = useState('');
  const [text, setText] = useState('Hello from the local AI voice appliance.');
  const [speed, setSpeed] = useState('1');
  const [voices, setVoices] = useState<VoicesResponse>();
  const [audioUrl, setAudioUrl] = useState('');
  const [result, setResult] = useState<SpeakResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!providers.includes(provider) && providers[0]) setProvider(providers[0]);
  }, [provider, providers]);

  useEffect(() => {
    const modelsForProvider = models.filter((candidate) => candidate.provider === provider);
    if (!modelsForProvider.some((candidate) => candidate.id === model)) {
      const configured = providerDefaults[provider]?.defaultModel ?? (provider === configuredProvider ? configuredModel : undefined);
      setModel(configured ?? modelsForProvider[0]?.id ?? '');
    }
  }, [configuredModel, configuredProvider, model, models, provider, providerDefaults]);

  useEffect(() => {
    setLanguage(providerDefaults[provider]?.language ?? (provider === configuredProvider ? configuredLanguage : provider === 'kokoro' ? 'a' : 'en'));
  }, [configuredLanguage, configuredProvider, provider, providerDefaults]);

  useEffect(() => {
    let active = true;
    api
      .voices(provider)
      .then((nextVoices) => {
        if (!active) return;
        setVoices(nextVoices);
        setVoice((current) =>
          nextVoices.voices.some((candidate) => candidate.id === current)
            ? current
            : preferredVoice(provider, nextVoices.voices, nextVoices.activeReferenceAudio)
        );
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [provider]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
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
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setResult(nextResult);
      setAudioUrl(URL.createObjectURL(nextResult.blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card wide">
      <h2>Generate speech</h2>
      <p className="hint">Choose Chatterbox for reference-WAV cloning or Kokoro for built-in multilingual voices.</p>
      <div className="form-grid">
        <label>
          Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            {providers.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <select value={model} onChange={(event) => setModel(event.target.value)}>
            {providerModels.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Voice
          <select value={voice} onChange={(event) => setVoice(event.target.value)}>
            {(voices?.voices ?? []).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label ?? candidate.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Language
          <input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="en, a, fr, ja..." />
        </label>
        <label>
          Speed
          <input value={speed} onChange={(event) => setSpeed(event.target.value)} inputMode="decimal" />
        </label>
      </div>
      <label>
        Text
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} />
      </label>
      <div className="actions">
        <button disabled={busy || !text.trim() || !model} onClick={() => void synthesize()}>
          {busy ? 'Generating...' : 'Generate speech'}
        </button>
      </div>
      {audioUrl && (
        <div className="audio-result">
          <audio controls src={audioUrl} />
          <a href={audioUrl} download="speech.wav">
            Download WAV
          </a>
          <span className="hint">
            {result?.engine ?? provider} {result?.voice ? `voice ${result.voice}` : ''}
          </span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

export function App() {
  const [health, setHealth] = useState<HealthResponse>();
  const [models, setModels] = useState<ModelsResponse>({ stt: [], tts: [] });
  const [system, setSystem] = useState<Record<string, unknown>>();
  const [logs, setLogs] = useState<LogsResponse>();
  const [configView, setConfigView] = useState<ConfigResponse>();
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string>('never');

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const applianceOk = useMemo(() => Boolean(health?.ok), [health]);
  const activeReference =
    configView?.mutable.tts?.providers?.chatterbox?.activeReference ??
    configView?.mutable.tts?.activeReference ??
    health?.ttsProviders?.find((provider) => provider.id === 'chatterbox')?.activeReferenceAudio ??
    health?.services.tts.activeReferenceAudio ??
    null;

  async function withRefresh(action: Promise<unknown>) {
    await action;
    await refresh();
  }

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">Local AI Voice Appliance</p>
          <h1>GPU-first STT/TTS manager</h1>
          <p>Gateway, portal, and localhost Python workers for swappable speech-to-text and text-to-speech models.</p>
        </div>
        <div className="hero-actions">
          <StatusPill ok={applianceOk} label={applianceOk ? 'healthy' : 'degraded'} />
          <button onClick={() => void refresh()}>Refresh</button>
          <a href="/api/docs">API docs</a>
        </div>
      </header>

      {error && <section className="banner error">{error}</section>}
      <p className="updated">Last updated: {lastUpdated}</p>

      <div className="grid">
        <GpuCard gpu={health?.gpu} />
        <ServiceCard title="Speech to text" health={health?.services.stt} />
        <ServiceCard title="Text to speech" health={health?.services.tts} />
        <TtsProviderStatus health={health} />
        <ModelPicker
          role="STT"
          models={models.stt}
          onLoad={(_provider, model) => withRefresh(api.loadStt(model))}
          onUnload={(_provider, strategy) => withRefresh(api.unloadStt(strategy))}
          onSetDefault={(_provider, model) => withRefresh(api.patchSttDefault(model))}
        />
        <ModelPicker
          role="TTS"
          models={models.tts}
          onLoad={(provider, model, language) => withRefresh(api.loadTts(provider, model, language))}
          onUnload={(provider, strategy) => withRefresh(api.unloadTts(provider, strategy))}
          onReload={(provider, model, language) => withRefresh(api.reloadTts(provider, model, language))}
          onSetDefault={(provider, model, language) => withRefresh(api.patchTtsDefault(provider, model, language))}
        />
        <TtsSpeakCard models={models.tts} configView={configView} />
        <ReferenceUpload activeReference={activeReference} onUploaded={refresh} />
        <StorageCard system={system} />
        <LogsCard logs={logs} />
      </div>
    </main>
  );
}
