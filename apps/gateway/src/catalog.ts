import type { ModelDescriptor, VoiceDescriptor } from '@local-ai-voice/shared';
import type { AppConfig } from './config.js';

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
  const models: ModelDescriptor[] = [
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
      id: 'kokoro-placeholder',
      provider: 'kokoro-placeholder',
      role: 'tts',
      label: 'Kokoro placeholder',
      description: 'Reserved provider slot for a future high-speed TTS implementation.',
      languages: ['en'],
      recommendedFor10Gb: true,
      supportsReferenceAudio: false,
      supportsVoiceCloning: false,
      notes: ['Scaffold only; no worker implementation is shipped yet.']
    }
  ];
  return models.filter((model) => model.provider !== 'kokoro-placeholder' || config.nodeEnv !== 'production');
}

export function builtInVoices(): VoiceDescriptor[] {
  return [
    {
      id: 'reference-upload',
      provider: 'chatterbox',
      label: 'Uploaded reference WAV',
      referenceAudio: true
    }
  ];
}
