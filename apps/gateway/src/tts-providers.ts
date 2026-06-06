import type { ModelStatus, VoiceDescriptor, WorkerHealth } from '@local-ai-voice/shared';
import { builtInVoices, providerSupportsReferenceAudio, ttsCatalog } from './catalog.js';
import type { AppConfig } from './config.js';
import { WorkerClient } from './worker-client.js';

export interface TtsProviderDescriptor {
  id: string;
  role: 'tts';
  label: string;
  workerUrl: string;
  systemdService: string;
  defaultModel: string;
  defaultVoice?: string;
  supportsReferenceAudio: boolean;
  supportsVoiceCloning: boolean;
  supportsLanguageSelection: boolean;
  models: string[];
  voices: VoiceDescriptor[];
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

  client(provider: string | undefined): WorkerClient {
    return this.clients[normalizeTtsProvider(provider, this.config.defaultTtsProvider)];
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
    const normalized = normalizeTtsProvider(provider, this.config.defaultTtsProvider);
    if (normalized === 'kokoro') return this.config.kokoroDefaultTtsModel;
    return this.config.defaultTtsProvider === 'chatterbox' ? this.config.defaultTtsModel : 'chatterbox-turbo';
  }

  defaultVoice(provider: string | undefined): string | undefined {
    return normalizeTtsProvider(provider, this.config.defaultTtsProvider) === 'kokoro'
      ? this.config.kokoroDefaultTtsVoice
      : undefined;
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
      return {
        id: provider,
        role: 'tts',
        label: labelForProvider(provider),
        workerUrl: this.workerUrl(provider),
        systemdService: this.systemdService(provider),
        defaultModel: this.defaultModel(provider),
        defaultVoice: this.defaultVoice(provider),
        supportsReferenceAudio: providerSupportsReferenceAudio(provider),
        supportsVoiceCloning: providerModels.some((model) => model.supportsVoiceCloning),
        supportsLanguageSelection: providerModels.some((model) => model.supportsLanguageSelection),
        models: providerModels.map((model) => model.id),
        voices: builtInVoices(provider)
      };
    });
  }

  async health(provider: string | undefined): Promise<WorkerHealth> {
    const normalized = normalizeTtsProvider(provider, this.config.defaultTtsProvider);
    const health = await this.clients[normalized].health();
    return { ...health, provider: normalized };
  }

  async modelStatus(provider: string | undefined): Promise<ModelStatus> {
    const normalized = normalizeTtsProvider(provider, this.config.defaultTtsProvider);
    const status = await this.clients[normalized].modelStatus();
    return { ...status, provider: normalized };
  }

  async providerStates(): Promise<Array<TtsProviderDescriptor & { health: WorkerHealth; status?: ModelStatus }>> {
    return await Promise.all(
      this.descriptors().map(async (descriptor) => {
        const health = await this.health(descriptor.id);
        const status = await this.modelStatus(descriptor.id).catch(() => undefined);
        return { ...descriptor, health, status };
      })
    );
  }
}
