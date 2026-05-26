import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';

export interface UploadedAudio {
  fieldname: string;
  filename: string;
  mimetype: string;
  buffer: Buffer;
  savedPath?: string;
}

export interface MultipartPayload {
  fields: Record<string, string>;
  files: UploadedAudio[];
}

export const allowedAudioTypes = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/flac',
  'audio/x-flac',
  'audio/ogg',
  'audio/mp4',
  'application/octet-stream'
]);

export async function ensureRuntimeDirectories(config: AppConfig): Promise<void> {
  await Promise.all(
    [
      config.baseDir,
      config.configDir,
      config.modelDir,
      config.cacheDir,
      config.voiceDir,
      config.uploadDir,
      config.outputDir,
      config.logDir
    ].map((dir) => fs.mkdir(dir, { recursive: true }))
  );
}

export function safeJoin(base: string, unsafeName: string): string {
  const fileName = path.basename(unsafeName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const candidate = path.resolve(base, fileName);
  const resolvedBase = path.resolve(base);
  if (!candidate.startsWith(resolvedBase + path.sep) && candidate !== resolvedBase) {
    throw new Error('Path traversal attempt rejected.');
  }
  return candidate;
}

function extensionForMime(mimetype: string, filename: string): string {
  const current = path.extname(filename);
  if (current) return current;
  if (mimetype.includes('wav')) return '.wav';
  if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return '.mp3';
  if (mimetype.includes('flac')) return '.flac';
  if (mimetype.includes('ogg')) return '.ogg';
  return '.bin';
}

export async function saveUpload(dir: string, upload: UploadedAudio, prefix: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const ext = extensionForMime(upload.mimetype, upload.filename);
  const target = safeJoin(dir, `${prefix}-${Date.now()}-${randomUUID()}${ext}`);
  await fs.writeFile(target, upload.buffer, { flag: 'wx' });
  upload.savedPath = target;
  return target;
}

export function fieldNumber(fields: Record<string, string>, name: string): number | undefined {
  const raw = fields[name];
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function fieldBoolean(fields: Record<string, string>, name: string): boolean | undefined {
  const raw = fields[name];
  if (raw === undefined || raw === '') return undefined;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}
