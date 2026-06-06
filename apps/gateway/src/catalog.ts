import type { ModelDescriptor, VoiceDescriptor } from '@local-ai-voice/shared';
import type { AppConfig } from './config.js';

const kokoroLanguages = ['en-us', 'en-gb', 'es', 'fr-fr', 'hi', 'it', 'ja', 'pt-br', 'zh'];

const kokoroVoiceLanguages: Record<string, string> = {
  af: 'en-us',
  am: 'en-us',
  bf: 'en-gb',
  bm: 'en-gb',
  ef: 'es',
  em: 'es',
  ff: 'fr-fr',
  hf: 'hi',
  hm: 'hi',
  if: 'it',
  im: 'it',
  jf: 'ja',
  jm: 'ja',
  pf: 'pt-br',
  pm: 'pt-br',
  zf: 'zh',
  zm: 'zh'
};

export const kokoroVoiceIds = [
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_heart',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_fenrir',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_alice',
  'bf_emma',
  'bf_isabella',
  'bf_lily',
  'bm_daniel',
  'bm_fable',
  'bm_george',
  'bm_lewis',
  'ef_dora',
  'em_alex',
  'em_santa',
  'ff_siwis',
  'hf_alpha',
  'hf_beta',
  'hm_omega',
  'hm_psi',
  'if_sara',
  'im_nicola',
  'jf_alpha',
  'jf_gongitsune',
  'jf_nezumi',
  'jf_tebukuro',
  'jm_kumo',
  'pf_dora',
  'pm_alex',
  'pm_santa',
  'zf_xiaobei',
  'zf_xiaoni',
  'zf_xiaoxiao',
  'zf_xiaoyi',
  'zm_yunjian',
  'zm_yunxi',
  'zm_yunxia',
  'zm_yunyang'
] as const;

function labelFromKokoroVoice(id: string): string {
  const separator = id.indexOf('_');
  const prefix = separator > 0 ? id.slice(0, separator) : id.slice(0, 2);
  const language = kokoroVoiceLanguages[prefix] ?? 'unknown';
  const rawName = separator >= 0 ? id.slice(separator + 1) : id;
  const name = rawName.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return `${name || id} (${language})`;
}

export function sttCatalog(config: AppConfig): ModelDescriptor[] {
  return [
    {
      id: 'large-v3-turbo',
      provider: 'fast-whisper',
      role: 'stt',
      label: 'Whisper large-v3 turbo',
      description: 'Default local STT model. Good quality/latency balance on roughly 10 GB VRAM with int8_float16.',
      languages: ['auto', 'multilingual'],
      approximateVramMiB: 6500,
      recommendedFor10Gb: true,
      defaultComputeType: config.defaultSttComputeType,
      notes: ['GPU device=cuda is enforced when GPU_ONLY=true.', 'Use smaller models if other workers must stay loaded.']
    },
    {
      id: 'distil-large-v3',
      provider: 'fast-whisper',
      role: 'stt',
      label: 'Distil Whisper large-v3',
      description: 'Fast English-centric distillation option supported by faster-whisper.',
      languages: ['en'],
      approximateVramMiB: 5500,
      recommendedFor10Gb: true,
      defaultComputeType: 'float16'
    },
    {
      id: 'medium',
      provider: 'fast-whisper',
      role: 'stt',
      label: 'Whisper medium',
      description: 'Lower VRAM fallback when TTS must share the GPU.',
      languages: ['auto', 'multilingual'],
      approximateVramMiB: 3500,
      recommendedFor10Gb: true,
      defaultComputeType: 'int8_float16'
    },
    {
      id: 'small',
      provider: 'fast-whisper',
      role: 'stt',
      label: 'Whisper small',
      description: 'Fast test model for smoke checks and small GPUs.',
      languages: ['auto', 'multilingual'],
      approximateVramMiB: 1800,
      recommendedFor10Gb: true,
      defaultComputeType: 'int8_float16'
    },
    {
      id: 'large-v3',
      provider: 'fast-whisper',
      role: 'stt',
      label: 'Whisper large-v3',
      description: 'Higher quality baseline. May crowd a 10 GB GPU when TTS is loaded.',
      languages: ['auto', 'multilingual'],
      approximateVramMiB: 8500,
      recommendedFor10Gb: false,
      defaultComputeType: 'int8_float16',
      notes: ['Load STT and TTS independently; unload TTS first if VRAM is tight.']
    }
  ];
}

export function ttsCatalog(config: AppConfig): ModelDescriptor[] {
  return [
    {
      id: 'chatterbox-turbo',
      provider: 'chatterbox',
      role: 'tts',
      label: 'Chatterbox Turbo',
      description: 'Default low-latency Chatterbox variant for English voice-agent use.',
      languages: ['en'],
      approximateVramMiB: 3500,
      recommendedFor10Gb: true,
      supportsReferenceAudio: true,
      supportsVoiceCloning: true,
      supportsLanguageSelection: false,
      notes: ['Requires a reference WAV for voice cloning in the upstream Turbo examples.']
    },
    {
      id: 'chatterbox',
      provider: 'chatterbox',
      role: 'tts',
      label: 'Chatterbox English',
      description: 'Original English Chatterbox model with exaggeration and CFG controls.',
      languages: ['en'],
      approximateVramMiB: 5000,
      recommendedFor10Gb: true,
      supportsReferenceAudio: true,
      supportsVoiceCloning: true
    },
    {
      id: 'chatterbox-multilingual',
      provider: 'chatterbox',
      role: 'tts',
      label: 'Chatterbox Multilingual',
      description: 'Multilingual Chatterbox model. Confirm upstream checkpoint/version before production use.',
      languages: ['ar', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ru', 'sv', 'sw', 'tr', 'zh'],
      approximateVramMiB: 5500,
      recommendedFor10Gb: true,
      supportsReferenceAudio: true,
      supportsVoiceCloning: true,
      supportsLanguageSelection: true,
      notes: ['The worker supports an option t3_model=v3 for opt-in multilingual v3 if the installed package exposes it.']
    },
    {
      id: 'kokoro-82m',
      provider: 'kokoro',
      role: 'tts',
      label: 'Kokoro 82M',
      description: 'Fast Kokoro-82M TTS using built-in voice packs and language-aware KPipeline synthesis.',
      languages: kokoroLanguages,
      approximateVramMiB: 1500,
      recommendedFor10Gb: true,
      supportsReferenceAudio: false,
      supportsVoiceCloning: false,
      supportsLanguageSelection: true,
      notes: [
        'Select Kokoro voices with IDs such as af_heart, bf_emma, ff_siwis, jf_alpha, or zf_xiaoxiao.',
        'Japanese and Mandarin voices require the worker dependencies with misaki ja/zh extras.',
        `Configured Kokoro default voice: ${config.kokoroDefaultTtsVoice}.`
      ]
    }
  ];
}

export function kokoroVoices(): VoiceDescriptor[] {
  return kokoroVoiceIds.map((id) => ({
    id,
    provider: 'kokoro',
    label: labelFromKokoroVoice(id),
    language: kokoroVoiceLanguages[id.slice(0, 2)] ?? 'unknown',
    referenceAudio: false
  }));
}

export function builtInVoices(provider?: string): VoiceDescriptor[] {
  const chatterboxVoices: VoiceDescriptor[] = [
    {
      id: 'reference-upload',
      provider: 'chatterbox',
      label: 'Uploaded reference WAV',
      referenceAudio: true
    }
  ];
  const voices = [...chatterboxVoices, ...kokoroVoices()];
  return provider ? voices.filter((voice) => voice.provider === provider) : voices;
}

export function providerSupportsReferenceAudio(provider: string): boolean {
  return provider === 'chatterbox';
}
