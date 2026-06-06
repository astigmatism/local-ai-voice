import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import type { TtsReferenceAudio } from '@local-ai-voice/shared';
import type { AppConfig } from './config.js';
import type { MutableApplianceConfig } from './config-store.js';
import { safeJoin, type UploadedAudio } from './storage.js';

const referenceMimeTypes = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream']);

export class ReferenceAudioError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

const referenceIdPattern = /^[a-zA-Z0-9._-]+\.wav$/;

export type StoredReferenceAudio = TtsReferenceAudio;

export function normalizeReferenceProvider(provider: string | undefined): string {
  const normalized = (provider ?? 'chatterbox').trim().toLowerCase();
  if (normalized !== 'chatterbox') {
    throw new ReferenceAudioError(400, `Reference audio is only supported for the chatterbox TTS provider, not ${normalized || 'empty'}.`);
  }
  return normalized;
}

export function providerVoiceDir(config: AppConfig, provider: string): string {
  return path.join(config.voiceDir, normalizeReferenceProvider(provider));
}

export function sanitizedDisplayFilename(filename: string | undefined): string {
  const basename = path.basename(filename || 'reference.wav');
  const cleaned = basename
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'reference.wav';
}

export function looksLikeWav(buffer: Buffer): boolean {
  if (buffer.byteLength < 12) return false;
  const riff = buffer.subarray(0, 4).toString('ascii');
  const wave = buffer.subarray(8, 12).toString('ascii');
  return (riff === 'RIFF' || riff === 'RF64') && wave === 'WAVE';
}

export function validateReferenceWavUpload(upload: UploadedAudio, maxUploadBytes: number): void {
  if (!referenceMimeTypes.has(upload.mimetype)) {
    throw new ReferenceAudioError(415, `Reference audio must be a WAV file; received content type ${upload.mimetype}.`);
  }
  if (upload.buffer.byteLength <= 0) {
    throw new ReferenceAudioError(400, 'Reference audio file is empty.');
  }
  if (upload.buffer.byteLength > maxUploadBytes) {
    throw new ReferenceAudioError(413, `Reference audio exceeds max size of ${maxUploadBytes} bytes.`);
  }
  const extension = path.extname(upload.filename || '').toLowerCase();
  if (extension !== '.wav' && extension !== '.wave') {
    throw new ReferenceAudioError(400, 'Reference audio filename must end in .wav.');
  }
  if (!looksLikeWav(upload.buffer)) {
    throw new ReferenceAudioError(400, 'Reference audio is not a valid RIFF/WAVE file.');
  }
}

export function normalizeReferenceAudioId(referenceId: string | undefined): string {
  const trimmed = referenceId?.trim();
  if (!trimmed || !referenceIdPattern.test(trimmed) || path.basename(trimmed) !== trimmed) {
    throw new ReferenceAudioError(400, 'Invalid referenceId. Use the safe identifier returned by /api/tts/reference-audio.');
  }
  return trimmed;
}

function referenceDescriptorFromStat(provider: string, referenceId: string, stat: Stats): StoredReferenceAudio {
  return {
    provider,
    referenceId,
    id: referenceId,
    filename: referenceId,
    contentType: 'audio/wav',
    sizeBytes: stat.size,
    active: false,
    createdAt: stat.birthtime.toISOString()
  };
}

async function storedReferenceAudio(
  config: AppConfig,
  provider: string,
  referenceId: string
): Promise<{ filePath: string; reference: StoredReferenceAudio }> {
  const normalizedProvider = normalizeReferenceProvider(provider);
  const normalizedReferenceId = normalizeReferenceAudioId(referenceId);
  const dir = providerVoiceDir(config, normalizedProvider);
  const filePath = safeJoin(dir, normalizedReferenceId);
  const stat = await fs.stat(filePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ReferenceAudioError(404, `Reference audio not found: ${normalizedReferenceId}`);
    }
    throw error;
  });
  if (!stat.isFile()) {
    throw new ReferenceAudioError(400, `Reference audio is not a regular file: ${normalizedReferenceId}`);
  }
  return { filePath, reference: referenceDescriptorFromStat(normalizedProvider, normalizedReferenceId, stat) };
}

export async function saveReferenceAudio(
  config: AppConfig,
  upload: UploadedAudio,
  provider: string
): Promise<StoredReferenceAudio> {
  const normalizedProvider = normalizeReferenceProvider(provider);
  validateReferenceWavUpload(upload, config.maxUploadBytes);
  const dir = providerVoiceDir(config, normalizedProvider);
  await fs.mkdir(dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const referenceId = `reference-${createdAt.replace(/[:.]/g, '-')}-${randomUUID()}.wav`;
  const target = safeJoin(dir, referenceId);
  await fs.writeFile(target, upload.buffer, { flag: 'wx' });
  upload.savedPath = target;
  return {
    provider: normalizedProvider,
    referenceId,
    id: referenceId,
    filename: sanitizedDisplayFilename(upload.filename),
    contentType: 'audio/wav',
    sizeBytes: upload.buffer.byteLength,
    active: false,
    createdAt
  };
}

export async function deleteReferenceAudio(
  config: AppConfig,
  provider: string,
  referenceId: string
): Promise<StoredReferenceAudio> {
  const { filePath, reference } = await storedReferenceAudio(config, provider, referenceId);
  await fs.unlink(filePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ReferenceAudioError(404, `Reference audio not found: ${reference.referenceId}`);
    }
    throw error;
  });
  return reference;
}

export function publicActiveReference(
  mutable: MutableApplianceConfig
): TtsReferenceAudio | null {
  const active = mutable.tts.activeReference;
  if (!active || active.referenceId !== mutable.tts.activeReferenceId) return null;
  if (active.provider !== mutable.tts.provider) return null;
  return { ...active, active: true };
}

export async function listReferenceAudio(config: AppConfig, provider = 'chatterbox'): Promise<TtsReferenceAudio[]> {
  const normalizedProvider = normalizeReferenceProvider(provider);
  const dir = providerVoiceDir(config, normalizedProvider);
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const voices: TtsReferenceAudio[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !referenceIdPattern.test(entry.name)) continue;
    const filePath = safeJoin(dir, entry.name);
    const stat = await fs.stat(filePath);
    voices.push(referenceDescriptorFromStat(normalizedProvider, entry.name, stat));
  }
  return voices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function resolveReferenceAudioId(
  config: AppConfig,
  provider: string,
  referenceId: string | undefined
): Promise<string | undefined> {
  if (!referenceId) return undefined;
  const trimmed = normalizeReferenceAudioId(referenceId);
  const { filePath } = await storedReferenceAudio(config, provider, trimmed);
  await fs.access(filePath, fsConstants.R_OK);
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(12);
    await handle.read(header, 0, header.byteLength, 0);
    if (!looksLikeWav(header)) {
      throw new ReferenceAudioError(400, `Reference audio is not a valid RIFF/WAVE file: ${trimmed}`);
    }
  } finally {
    await handle.close();
  }
  return trimmed;
}

export async function resolveRequestedOrActiveReferenceId(
  config: AppConfig,
  mutable: MutableApplianceConfig,
  requestedReferenceId?: string,
  providerOverride?: string
): Promise<string | undefined> {
  const provider = providerOverride || mutable.tts.provider || config.defaultTtsProvider;
  const activeReferenceId = mutable.tts.activeReference?.provider === provider ? mutable.tts.activeReferenceId : undefined;
  const selected = requestedReferenceId || activeReferenceId || undefined;
  return await resolveReferenceAudioId(config, provider, selected);
}
