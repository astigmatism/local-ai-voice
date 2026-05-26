import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SpeakRequest } from '@local-ai-voice/shared';
import type { AppConfig } from '../config.js';
import { allowedAudioTypes, fieldNumber, type MultipartPayload } from '../storage.js';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export async function readMultipartPayload(
  request: FastifyRequest,
  config: AppConfig
): Promise<MultipartPayload> {
  if (!request.isMultipart()) {
    throw new HttpError(415, 'Expected multipart/form-data.');
  }
  const fields: Record<string, string> = {};
  const files: MultipartPayload['files'] = [];

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (!allowedAudioTypes.has(part.mimetype)) {
        throw new HttpError(415, `Unsupported audio content type: ${part.mimetype}`);
      }
      const buffer = await part.toBuffer();
      if (buffer.byteLength > config.maxUploadBytes) {
        throw new HttpError(413, `Upload exceeds max size of ${config.maxUploadBytes} bytes.`);
      }
      files.push({
        fieldname: part.fieldname,
        filename: part.filename || `${part.fieldname}.wav`,
        mimetype: part.mimetype,
        buffer
      });
    } else {
      fields[part.fieldname] = String(part.value ?? '');
    }
  }

  return { fields, files };
}

export function getRequiredField(fields: Record<string, string>, name: string): string {
  const value = fields[name];
  if (!value) throw new HttpError(400, `Missing required field: ${name}`);
  return value;
}

export function getFirstFile(payload: MultipartPayload, fieldNames: string[]): MultipartPayload['files'][number] {
  const file = payload.files.find((candidate) => fieldNames.includes(candidate.fieldname));
  if (!file) throw new HttpError(400, `Missing required file field: ${fieldNames.join(' or ')}`);
  return file;
}

export function normalizeSpeakRequest(
  body: unknown,
  fields: Record<string, string> = {}
): SpeakRequest {
  const objectBody = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const text = String(fields.text ?? objectBody.text ?? '');
  if (!text.trim()) throw new HttpError(400, 'Missing required text field.');

  return {
    text,
    voice: fields.voice ?? (typeof objectBody.voice === 'string' ? objectBody.voice : undefined),
    referenceAudioId:
      fields.referenceAudioId ??
      fields.reference_audio_id ??
      (typeof objectBody.referenceAudioId === 'string' ? objectBody.referenceAudioId : undefined),
    language: fields.language ?? (typeof objectBody.language === 'string' ? objectBody.language : undefined),
    model: fields.model ?? (typeof objectBody.model === 'string' ? objectBody.model : undefined),
    speed: fieldNumber(fields, 'speed') ?? (typeof objectBody.speed === 'number' ? objectBody.speed : undefined),
    exaggeration:
      fieldNumber(fields, 'exaggeration') ??
      (typeof objectBody.exaggeration === 'number' ? objectBody.exaggeration : undefined),
    cfgWeight:
      fieldNumber(fields, 'cfg_weight') ??
      fieldNumber(fields, 'cfgWeight') ??
      (typeof objectBody.cfgWeight === 'number' ? objectBody.cfgWeight : undefined),
    temperature:
      fieldNumber(fields, 'temperature') ??
      (typeof objectBody.temperature === 'number' ? objectBody.temperature : undefined)
  };
}

export function sendError(reply: FastifyReply, error: unknown): void {
  if (error instanceof HttpError) {
    reply.code(error.statusCode).send({ ok: false, error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  reply.code(500).send({ ok: false, error: message });
}
