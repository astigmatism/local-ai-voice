import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GpuDeviceInfo, ModelDescriptor, WorkerHealth } from '@local-ai-voice/shared';
import { api, type HealthResponse, type LogsResponse, type ModelsResponse } from './api.js';

type LoadStrategy = 'soft' | 'hard';

function bytes(kib: number | undefined): string {
  if (!kib) return 'unknown';
  const gib = kib / 1024 / 1024;
  return `${gib.toFixed(1)} GiB`;
}

function mib(value: number | undefined): string {
  return value === undefined ? 'unknown' : `${value.toLocaleString()} MiB`;
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

function ModelPicker({
  role,
  models,
  onLoad,
  onUnload,
  onSetDefault
}: {
  role: 'STT' | 'TTS';
  models: ModelDescriptor[];
  onLoad: (model: string, language: string) => Promise<void>;
  onUnload: (strategy: LoadStrategy) => Promise<void>;
  onSetDefault: (model: string, language: string) => Promise<void>;
}) {
  const defaultModel = models[0]?.id ?? '';
  const [model, setModel] = useState(defaultModel);
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!model && defaultModel) setModel(defaultModel);
  }, [defaultModel, model]);

  const selected = models.find((candidate) => candidate.id === model);

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
        <select value={model} onChange={(event) => setModel(event.target.value)}>
          {models.map((candidate) => (
            <option key={`${candidate.provider}:${candidate.id}`} value={candidate.id}>
              {candidate.label} ({candidate.provider})
            </option>
          ))}
        </select>
      </label>
      {role === 'TTS' && (
        <label>
          Language
          <input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="en" />
        </label>
      )}
      <div className="actions">
        <button disabled={busy || !model} onClick={() => void run(() => onLoad(model, language))}>
          Load
        </button>
        <button disabled={busy} onClick={() => void run(() => onUnload('soft'))}>
          Soft unload
        </button>
        <button disabled={busy} onClick={() => void run(() => onUnload('hard'))}>
          Hard restart
        </button>
        <button disabled={busy || !model} onClick={() => void run(() => onSetDefault(model, language))}>
          Set default
        </button>
      </div>
      {selected && (
        <p className="hint">
          {selected.description} Approx VRAM: {selected.approximateVramMiB ? `${selected.approximateVramMiB} MiB` : 'unknown'}.
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

function ReferenceUpload({ onUploaded }: { onUploaded: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  return (
    <section className="card">
      <h2>Chatterbox reference WAV</h2>
      <p className="hint">Upload short reference WAV clips for voice cloning or conditioning. Keep files consented and local.</p>
      <input type="file" accept="audio/wav,audio/x-wav" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <button
        disabled={!file}
        onClick={() =>
          void (async () => {
            if (!file) return;
            const result = await api.uploadReference(file);
            setMessage(`Uploaded ${result.id ?? file.name}`);
            await onUploaded();
          })()
        }
      >
        Upload reference
      </button>
      {message && <p className="hint">{message}</p>}
    </section>
  );
}

export function App() {
  const [health, setHealth] = useState<HealthResponse>();
  const [models, setModels] = useState<ModelsResponse>({ stt: [], tts: [] });
  const [system, setSystem] = useState<Record<string, unknown>>();
  const [logs, setLogs] = useState<LogsResponse>();
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string>('never');

  const refresh = useCallback(async () => {
    try {
      setError('');
      const [nextHealth, nextModels, nextSystem, nextLogs] = await Promise.all([
        api.health(),
        api.models(),
        api.system(),
        api.logs()
      ]);
      setHealth(nextHealth);
      setModels(nextModels);
      setSystem(nextSystem);
      setLogs(nextLogs);
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
        <ModelPicker
          role="STT"
          models={models.stt}
          onLoad={(model) => withRefresh(api.loadStt(model))}
          onUnload={(strategy) => withRefresh(api.unloadStt(strategy))}
          onSetDefault={(model) => withRefresh(api.patchSttDefault(model))}
        />
        <ModelPicker
          role="TTS"
          models={models.tts}
          onLoad={(model, language) => withRefresh(api.loadTts(model, language))}
          onUnload={(strategy) => withRefresh(api.unloadTts(strategy))}
          onSetDefault={(model, language) => withRefresh(api.patchTtsDefault(model, language))}
        />
        <ReferenceUpload onUploaded={refresh} />
        <StorageCard system={system} />
        <LogsCard logs={logs} />
      </div>
    </main>
  );
}
