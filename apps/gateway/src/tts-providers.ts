import type { ModelStatus, VoiceDescriptor, WorkerHealth } from '@local-ai-voice/shared';
import { builtInVoices, providerSupportsReferenceAudio, ttsCatalog } from './catalog.js';
import type { AppConfig } from './config.js';
import { defaultTtsLanguageForProvider, defaultTtsModelForProvider, defaultTtsVoiceForProvider } from './config.js';
import { WorkerClient } from './worker-client.js';

export interface TtsProviderCapabilities {
  referenceAudio: boolean;
  voiceSelection: boolean;
  languageSelection: boolean;
  speedControl: boolean;
  voiceCloning: boolean;
}

export interface TtsProviderDescriptor {
  id: TtsProviderId;
  role: 'tts';
  label: string;
  name: string;
  displayName: string;
  workerUrl: string;
  workerPort?: number;
  systemdService: string;
  enabled: boolean;
  active: boolean;
  defaultModel: string;
  defaultVoice?: string;
  defaultLanguage: string;
  autoLoad: boolean;
  supportsReferenceAudio: boolean;
  supportsVoiceCloning: boolean;
  supportsLanguageSelection: boolean;
  capabilities: TtsProviderCapabilities;
  models: string[];
  voices: VoiceDescriptor[];
}

export interface TtsProviderRuntimeStatus extends TtsProviderDescriptor {
  reachable: boolean;
  state: ModelStatus['state'];
  model?: string | null;
  voice?: string | null;
  health: WorkerHealth;
  status?: ModelStatus;
}

export class TtsProviderError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export const ttsProviderIds = ['chatterbox', 'kokoro'] as const;
export type TtsProviderId = (typeof ttsProviderIds)[number];

type TtsClientMap = Partial<Record<TtsProviderId, WorkerClient>>;

function isTtsProviderId(value: string): value is TtsProviderId {
  return (ttsProviderIds as readonly string[]).includes(value);
}

export function normalizeTtsProvider(provider: string | undefined, fallback?: string): TtsProviderId {
  const normalized = (provider ?? fallback ?? '').trim().toLowerCase();
  if (isTtsProviderId(normalized)) return normalized;
  throw new TtsProviderError(400, `Unsupported TTS provider: ${normalized || 'empty'}`);
}

function labelForProvider(provider: TtsProviderId): string {
  return provider === 'kokoro' ? 'Kokoro TTS' : 'Chatterbox TTS';
}

function workerPort(workerUrl: string): number | undefined {
  try {
    const parsed = new URL(workerUrl);
    const explicit = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    return Number.isFinite(explicit) ? explicit : undefined;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failedStatus(provider: TtsProviderId, error: unknown): ModelStatus {
  return {
    role: 'tts',
    provider,
    state: 'failed',
    loadedModel: null,
    error: errorMessage(error)
  };
}

function failedHealth(provider: TtsProviderId, error: unknown, config: AppConfig): WorkerHealth {
  return {
    ok: false,
    reachable: false,
    role: 'tts',
    provider,
    state: 'failed',
    loadedModel: null,
    gpuOnly: config.gpuOnly,
    gpuAvailable: false,
    error: errorMessage(error)
  };
}

function assertTtsStatusBelongsToProvider(provider: TtsProviderId, status: ModelStatus): ModelStatus {
  if (status.role !== 'tts') {
    throw new TtsProviderError(502, `TTS worker ${provider} returned non-TTS status role: ${status.role}.`);
  }
  if (status.provider && status.provider !== provider) {
    throw new TtsProviderError(502, `TTS worker ${provider} returned status for provider ${status.provider}.`);
  }
  return { ...status, provider };
}

function healthBelongsToProvider(provider: TtsProviderId, health: WorkerHealth): boolean {
  return health.role === 'tts' && (!health.provider || health.provider === provider);
}

export class TtsProviderRegistry {
  private readonly clients: Record<TtsProviderId, WorkerClient>;

  constructor(
    private readonly config: AppConfig,
    clients: TtsClientMap = {}
  ) {
    this.clients = {
      chatterbox:
        clients.chatterbox ??
        new WorkerClient({
          role: 'tts',
          provider: 'chatterbox',
          baseUrl: config.ttsWorkerUrl,
          timeoutMs: config.workerTimeoutMs
        }),
      kokoro:
        clients.kokoro ??
        new WorkerClient({
          role: 'tts',
          provider: 'kokoro',
          baseUrl: config.kokoroTtsWorkerUrl,
          timeoutMs: config.workerTimeoutMs
        })
    };
  }

  ids(): TtsProviderId[] {
    return [...ttsProviderIds];
  }

  enabled(provider: string | undefined): boolean {
    const normalized = normalizeTtsProvider(provider, this.config.defaultTtsProvider);
    return normalized === 'kokoro' ? this.config.ttsKokoroEnabled : this.config.ttsChatterboxEnabled;
  }

  ensureEnabled(provider: TtsProviderId): void {
    if (!this.enabled(provider)) throw new TtsProviderError(400, `TTS provider ${provider} is disabled.`);
  }

  client(provider: string | undefined): WorkerClient {
    const normalized = normalizeTtsProvider(provider, this.config.defaultTtsProvider);
    this.ensureEnabled(normalized);
    return this.clients[normalized];
  }

  workerUrl(provider: string | undefined): string {
    const normalized = normalizeTtsProvider(provider, this.config.defaultTtsProvider);
    return normalized === 'kokoro' ? this.config.kokoroTtsWorkerUrl : this.config.ttsWorkerUrl;
  }

  systemdService(provider: string | undefined): string {
    const normalized = normalizeTtsProvider(provider, this.config.defaultTtsProvider);
    return normalized === 'kokoro' ? this.config.kokoroTtsSystemdService : this.config.ttsSystemdService;
  }

  defaultModel(provider: string | undefined): string {
    return defaultTtsModelForProvider(this.config, normalizeTtsProvider(provider, this.config.defaultTtsProvider));
  }

  defaultVoice(provider: string | undefined): string | undefined {
    return defaultTtsVoiceForProvider(this.config, normalizeTtsProvider(provider, this.config.defaultTtsProvider));
  }

  defaultLanguage(provider: string | undefined): string {
    return defaultTtsLanguageForProvider(this.config, normalizeTtsProvider(provider, this.config.defaultTtsProvider));
  }

  providerForModel(model: string | undefined): TtsProviderId | undefined {
    if (!model) return undefined;
    const descriptor = ttsCatalog(this.config).find((candidate) => candidate.id === model);
    return descriptor ? normalizeTtsProvider(descriptor.provider) : undefined;
  }

  resolveProvider(provider: string | undefined, model: string | undefined, fallbackProvider: string | undefined): TtsProviderId {
    if (provider) return normalizeTtsProvider(provider);
    return this.providerForModel(model) ?? normalizeTtsProvider(fallbackProvider, this.config.defaultTtsProvider);
  }

  descriptors(): TtsProviderDescriptor[] {
    const models = ttsCatalog(this.config);
    return this.ids().map((provider) => {
      const providerModels = models.filter((model) => model.provider === provider);
      const supportsReferenceAudio = providerSupportsReferenceAudio(provider);
      const supportsVoiceCloning = providerModels.some((model) => model.supportsVoiceCloning);
      const supportsLanguageSelection = providerModels.some((model) => model.supportsLanguageSelection);
      const descriptor: TtsProviderDescriptor = {
        id: provider,
        role: 'tts',
        label: labelForProvider(provider),
        name: labelForProvider(provider),
        displayName: labelForProvider(provider),
        workerUrl: this.workerUrl(provider),
        workerPort: workerPort(this.workerUrl(provider)),
        systemdService: this.systemdService(provider),
        enabled: this.enabled(provider),
        active: this.enabled(provider),
        defaultModel: this.defaultModel(provider),
        defaultVoice: this.defaultVoice(provider),
        defaultLanguage: this.defaultLanguage(provider),
        autoLoad: provider === 'kokoro' ? this.config.ttsKokoroAutoload : this.config.ttsChatterboxAutoload,
        supportsReferenceAudio,
        supportsVoiceCloning,
        supportsLanguageSelection,
        capabilities: {
          referenceAudio: supportsReferenceAudio,
          voiceSelection: true,
          languageSelection: supportsLanguageSelection || provider === 'kokoro',
          speedControl: true,
          voiceCloning: supportsVoiceCloning
        },
        models: providerModels.map((model) => model.id),
        voices: builtInVoices(provider)
      };
      return descriptor;
    });
  }

  async health(provider: string | undefined): Promise<WorkerHealth> {
    const normalized = normalizeTtsProvider(provider, this.config.defaultTtsProvider);
    if (!this.enabled(normalized)) {
      return {
        ok: false,
        reachable: false,
        role: 'tts',
        provider: normalized,
        state: 'unloaded',
        loadedModel: null,
        gpuOnly: this.config.gpuOnly,
        gpuAvailable: false,
        error: `TTS provider ${normalized} is disabled.`
      };
    }
    const health = await this.clients[normalized].health();
    if (!healthBelongsToProvider(normalized, health)) {
      return failedHealth(normalized, `TTS worker ${normalized} returned health for provider ${health.provider}.`, this.config);
    }
    return { ...health, provider: normalized };
  }

  async modelStatus(provider: string | undefined): Promise<ModelStatus> {
    const normalized = normalizeTtsProvider(provider, this.config.defaultTtsProvider);
    if (!this.enabled(normalized)) {
      return {
        role: 'tts',
        provider: normalized,
        state: 'unloaded',
        loadedModel: null,
        defaultModel: this.defaultModel(normalized),
        error: `TTS provider ${normalized} is disabled.`
      };
    }
    const status = await this.clients[normalized].modelStatus();
    return assertTtsStatusBelongsToProvider(normalized, status);
  }

  async providerStates(): Promise<TtsProviderRuntimeStatus[]> {
    return await Promise.all(
      this.descriptors().map(async (descriptor) => {
        const health = await this.health(descriptor.id);
        const status = await this.modelStatus(descriptor.id).catch((error: unknown) => failedStatus(descriptor.id, error));
        return {
          ...descriptor,
          reachable: Boolean(health.reachable ?? health.ok),
          state: status.state ?? health.state,
          model: status.loadedModel ?? health.loadedModel ?? null,
          voice: descriptor.defaultVoice ?? null,
          health: { ...health },
          status: { ...status }
        };
      })
    );
  }
}
