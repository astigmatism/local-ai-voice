import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ConfigView, TtsReferenceAudio } from '@local-ai-voice/shared';
import type { AppConfig } from './config.js';
import { defaultTtsLanguageForProvider, defaultTtsModelForProvider, defaultTtsVoiceForProvider, toConfigView } from './config.js';
import { normalizeTtsProvider, type TtsProviderId } from './tts-providers.js';

export interface MutableTtsProviderConfig {
  enabled: boolean;
  defaultModel: string;
  defaultVoice?: string;
  language: string;
  autoLoad: boolean;
  activeReferenceId?: string | null;
  activeReference?: TtsReferenceAudio | null;
}

export interface MutableApplianceConfig {
  stt: {
    provider: string;
    defaultModel: string;
    computeType: string;
  };
  tts: {
    /** Default TTS provider. It is only a fallback for requests that omit provider. */
    provider: string;
    defaultModel: string;
    language: string;
    activeReferenceId?: string | null;
    activeReference?: TtsReferenceAudio | null;
    providers: Record<TtsProviderId, MutableTtsProviderConfig>;
  };
  updatedAt: string;
}

export type TtsPatch = Partial<Omit<MutableApplianceConfig['tts'], 'providers'>> & {
  providers?: Partial<Record<TtsProviderId, Partial<MutableTtsProviderConfig>>>;
};

export class ConfigStore {
  private readonly filePath: string;
  private cache: MutableApplianceConfig | undefined;

  constructor(private readonly config: AppConfig) {
    this.filePath = path.join(config.configDir, 'appliance.json');
  }

  private providerDefault(provider: TtsProviderId): MutableTtsProviderConfig {
    return {
      enabled: provider === 'kokoro' ? this.config.ttsKokoroEnabled : this.config.ttsChatterboxEnabled,
      defaultModel: defaultTtsModelForProvider(this.config, provider),
      defaultVoice: defaultTtsVoiceForProvider(this.config, provider),
      language: defaultTtsLanguageForProvider(this.config, provider),
      autoLoad: provider === 'kokoro' ? this.config.ttsKokoroAutoload : this.config.ttsChatterboxAutoload,
      activeReferenceId: null,
      activeReference: null
    };
  }

  defaults(): MutableApplianceConfig {
    const provider = normalizeTtsProvider(this.config.defaultTtsProvider, 'chatterbox');
    const providers: Record<TtsProviderId, MutableTtsProviderConfig> = {
      chatterbox: this.providerDefault('chatterbox'),
      kokoro: this.providerDefault('kokoro')
    };
    return {
      stt: {
        provider: this.config.defaultSttProvider,
        defaultModel: this.config.defaultSttModel,
        computeType: this.config.defaultSttComputeType
      },
      tts: {
        provider,
        defaultModel: providers[provider].defaultModel,
        language: providers[provider].language,
        activeReferenceId: providers[provider].activeReferenceId,
        activeReference: providers[provider].activeReference,
        providers
      },
      updatedAt: new Date(0).toISOString()
    };
  }

  private normalize(raw: Partial<MutableApplianceConfig>): MutableApplianceConfig {
    const defaults = this.defaults();
    const rawTts: Partial<MutableApplianceConfig['tts']> = raw.tts ?? {};
    const provider = normalizeTtsProvider(rawTts.provider, defaults.tts.provider);
    const rawProviders: Partial<Record<TtsProviderId, Partial<MutableTtsProviderConfig>>> = rawTts.providers ?? {};
    const providers: Record<TtsProviderId, MutableTtsProviderConfig> = {
      chatterbox: {
        ...defaults.tts.providers.chatterbox,
        ...(rawProviders.chatterbox ?? {})
      },
      kokoro: {
        ...defaults.tts.providers.kokoro,
        ...(rawProviders.kokoro ?? {})
      }
    };

    // Backfill older single-provider config files into the selected provider bucket.
    if (rawTts.defaultModel !== undefined && rawProviders[provider]?.defaultModel === undefined) {
      providers[provider].defaultModel = rawTts.defaultModel;
    }
    if (rawTts.language !== undefined && rawProviders[provider]?.language === undefined) {
      providers[provider].language = rawTts.language;
    }
    if (rawTts.activeReferenceId !== undefined && rawProviders[provider]?.activeReferenceId === undefined) {
      providers[provider].activeReferenceId = rawTts.activeReferenceId;
    }
    if (rawTts.activeReference !== undefined && rawProviders[provider]?.activeReference === undefined) {
      providers[provider].activeReference = rawTts.activeReference;
    }

    return {
      ...defaults,
      ...raw,
      stt: { ...defaults.stt, ...(raw.stt ?? {}) },
      tts: {
        ...defaults.tts,
        ...rawTts,
        provider,
        providers,
        defaultModel: providers[provider].defaultModel,
        language: providers[provider].language,
        activeReferenceId: providers[provider].activeReferenceId,
        activeReference: providers[provider].activeReference
      },
      updatedAt: raw.updatedAt ?? defaults.updatedAt
    };
  }

  async read(): Promise<MutableApplianceConfig> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = this.normalize(JSON.parse(raw) as Partial<MutableApplianceConfig>);
      return this.cache;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.cache = this.defaults();
      return this.cache;
    }
  }

  async write(next: MutableApplianceConfig): Promise<MutableApplianceConfig> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const normalized = this.normalize({ ...next, updatedAt: new Date().toISOString() });
    await fs.writeFile(this.filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    this.cache = normalized;
    return normalized;
  }

  async patchStt(patch: Partial<MutableApplianceConfig['stt']>): Promise<MutableApplianceConfig> {
    const current = await this.read();
    return await this.write({ ...current, stt: { ...current.stt, ...patch } });
  }

  async patchTts(patch: TtsPatch): Promise<MutableApplianceConfig> {
    const current = await this.read();
    const provider = normalizeTtsProvider(patch.provider, current.tts.provider);
    const providers: Record<TtsProviderId, MutableTtsProviderConfig> = {
      chatterbox: { ...current.tts.providers.chatterbox, ...(patch.providers?.chatterbox ?? {}) },
      kokoro: { ...current.tts.providers.kokoro, ...(patch.providers?.kokoro ?? {}) }
    };

    if (patch.defaultModel !== undefined) providers[provider].defaultModel = patch.defaultModel;
    if (patch.language !== undefined) providers[provider].language = patch.language;
    if (patch.activeReferenceId !== undefined) providers[provider].activeReferenceId = patch.activeReferenceId;
    if (patch.activeReference !== undefined) providers[provider].activeReference = patch.activeReference;

    const nextTts: MutableApplianceConfig['tts'] = {
      ...current.tts,
      ...patch,
      provider,
      providers,
      defaultModel: providers[provider].defaultModel,
      language: providers[provider].language,
      activeReferenceId: providers[provider].activeReferenceId,
      activeReference: providers[provider].activeReference
    };
    return await this.write({ ...current, tts: nextTts });
  }

  async view(): Promise<ConfigView & { mutable: MutableApplianceConfig }> {
    const view = toConfigView(this.config);
    const mutable = await this.read();
    return { ...view, mutable };
  }
}
