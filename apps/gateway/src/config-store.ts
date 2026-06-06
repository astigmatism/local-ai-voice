import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ConfigView, TtsReferenceAudio } from '@local-ai-voice/shared';
import type { AppConfig } from './config.js';
import { toConfigView } from './config.js';

export interface MutableApplianceConfig {
  stt: {
    provider: string;
    defaultModel: string;
    computeType: string;
  };
  tts: {
    provider: string;
    defaultModel: string;
    language: string;
    activeReferenceId?: string | null;
    activeReference?: TtsReferenceAudio | null;
  };
  updatedAt: string;
}

export class ConfigStore {
  private readonly filePath: string;
  private cache: MutableApplianceConfig | undefined;

  constructor(private readonly config: AppConfig) {
    this.filePath = path.join(config.configDir, 'appliance.json');
  }

  defaults(): MutableApplianceConfig {
    return {
      stt: {
        provider: this.config.defaultSttProvider,
        defaultModel: this.config.defaultSttModel,
        computeType: this.config.defaultSttComputeType
      },
      tts: {
        provider: this.config.defaultTtsProvider,
        defaultModel:
          this.config.defaultTtsProvider === 'kokoro'
            ? this.config.kokoroDefaultTtsModel
            : this.config.defaultTtsModel,
        language: this.config.defaultTtsLanguage,
        activeReferenceId: null,
        activeReference: null
      },
      updatedAt: new Date(0).toISOString()
    };
  }

  private normalize(raw: Partial<MutableApplianceConfig>): MutableApplianceConfig {
    const defaults = this.defaults();
    return {
      ...defaults,
      ...raw,
      stt: { ...defaults.stt, ...(raw.stt ?? {}) },
      tts: { ...defaults.tts, ...(raw.tts ?? {}) },
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

  async patchTts(patch: Partial<MutableApplianceConfig['tts']>): Promise<MutableApplianceConfig> {
    const current = await this.read();
    return await this.write({ ...current, tts: { ...current.tts, ...patch } });
  }

  async view(): Promise<ConfigView & { mutable: MutableApplianceConfig }> {
    const view = toConfigView(this.config);
    const mutable = await this.read();
    return { ...view, mutable };
  }
}
