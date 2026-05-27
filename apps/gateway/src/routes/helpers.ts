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
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (code === 'FST_REQ_FILE_TOO_LARGE' || String(error).toLowerCase().includes('file size')) {
          throw new HttpError(413, `Upload exceeds max size of ${config.maxUploadBytes} bytes.`);
        }
        throw error;
      }
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

export interface NormalizeTranscribeFieldsOptions {
  defaultModel?: string;
  mapOpenAiModelAlias?: boolean;
}

function firstNonEmptyField(fields: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function setCanonicalField(
  target: Record<string, string>,
  fields: Record<string, string>,
  canonical: string,
  aliases: string[]
): void {
  const value = firstNonEmptyField(fields, [canonical, ...aliases]);
  for (const alias of aliases) delete target[alias];
  if (value !== undefined) target[canonical] = value;
}

export function normalizeTranscribeFields(
  fields: Record<string, string>,
  options: NormalizeTranscribeFieldsOptions = {}
): Record<string, string> {
  const normalized = { ...fields };

  const openAiSttModelAliases = new Set([
    'whisper-1',
    'gpt-4o-transcribe',
    'gpt-4o-mini-transcribe'
  ]);
  const requestedModel = firstNonEmptyField(fields, ['model']);
  if (requestedModel !== undefined) {
    const isOpenAiModelAlias = openAiSttModelAliases.has(requestedModel.toLowerCase());
    normalized.model =
      options.mapOpenAiModelAlias && isOpenAiModelAlias && options.defaultModel
        ? options.defaultModel
        : requestedModel;
  } else if (options.defaultModel) {
    normalized.model = options.defaultModel;
  }

  setCanonicalField(normalized, fields, 'vad_filter', ['vadFilter']);
  setCanonicalField(normalized, fields, 'min_silence_duration_ms', [
    'minSilenceDurationMs',
    'min_silence_ms',
    'minSilenceMs'
  ]);
  setCanonicalField(normalized, fields, 'beam_size', ['beamSize']);
  setCanonicalField(normalized, fields, 'word_timestamps', ['wordTimestamps']);
  setCanonicalField(normalized, fields, 'response_format', ['responseFormat']);

  return normalized;
}

export function normalizeSpeakRequest(
  body: unknown,
  fields: Record<string, string> = {}
): SpeakRequest {
  const objectBody = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const settings =
    objectBody.settings && typeof objectBody.settings === 'object' && !Array.isArray(objectBody.settings)
      ? (objectBody.settings as Record<string, unknown>)
      : {};

  const text = String(fields.text ?? objectBody.text ?? '');
  if (!text.trim()) throw new HttpError(400, 'Missing required text field.');

  const bodyString = (name: string): string | undefined =>
    typeof objectBody[name] === 'string'
      ? (objectBody[name] as string)
      : typeof settings[name] === 'string'
        ? (settings[name] as string)
        : undefined;
  const bodyNumber = (name: string): number | undefined =>
    typeof objectBody[name] === 'number'
      ? (objectBody[name] as number)
      : typeof settings[name] === 'number'
        ? (settings[name] as number)
        : undefined;

  const referenceId =
    fields.referenceId ??
    fields.reference_id ??
    fields.referenceAudioId ??
    fields.reference_audio_id ??
    bodyString('referenceId') ??
    bodyString('reference_id') ??
    bodyString('referenceAudioId') ??
    bodyString('reference_audio_id');

  return {
    text,
    voice: fields.voice ?? bodyString('voice'),
    referenceId,
    referenceAudioId: referenceId,
    language: fields.language ?? bodyString('language'),
    model: fields.model ?? bodyString('model'),
    speed: fieldNumber(fields, 'speed') ?? bodyNumber('speed'),
    exaggeration: fieldNumber(fields, 'exaggeration') ?? bodyNumber('exaggeration'),
    cfgWeight: fieldNumber(fields, 'cfg_weight') ?? fieldNumber(fields, 'cfgWeight') ?? bodyNumber('cfgWeight') ?? bodyNumber('cfg_weight'),
    temperature: fieldNumber(fields, 'temperature') ?? bodyNumber('temperature')
  };
}

export function sendError(reply: FastifyReply, error: unknown): void {
  if (error instanceof HttpError) {
    reply.code(error.statusCode).send({ ok: false, error: error.message });
    return;
  }
  const maybeStatus = (error as { statusCode?: unknown })?.statusCode;
  if (typeof maybeStatus === 'number' && maybeStatus >= 400 && maybeStatus < 600) {
    const message = error instanceof Error ? error.message : String(error);
    reply.code(maybeStatus).send({ ok: false, error: message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  reply.code(500).send({ ok: false, error: message });
}
