import type {
  LoadModelRequest,
  ModelStatus,
  SpeakRequest,
  TranscriptResponse,
  UnloadModelRequest,
  WorkerHealth,
  ServiceRole,
  VoiceDescriptor
} from '@local-ai-voice/shared';
import type { UploadedAudio } from './storage.js';

export interface WorkerClientOptions {
  role: ServiceRole;
  provider: string;
  baseUrl: string;
  timeoutMs: number;
}

export class WorkerClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly workerStatus?: number
  ) {
    super(message);
  }
}

function statusForWorkerResponse(workerStatus: number): number {
  if (workerStatus === 409) return 503;
  if (workerStatus >= 500) return 502;
  return workerStatus;
}

function messageFromFetchError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Worker request timed out.';
  return error instanceof Error ? error.message : String(error);
}

export class WorkerClient {
  private readonly role: ServiceRole;
  private readonly provider: string;
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;

  constructor(options: WorkerClientOptions) {
    this.role = options.role;
    this.provider = options.provider;
    this.baseUrl = new URL(options.baseUrl);
    this.timeoutMs = options.timeoutMs;
  }

  private url(pathname: string): string {
    const url = new URL(pathname, this.baseUrl);
    return url.toString();
  }

  private async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(this.url(pathname), { ...init, signal: controller.signal });
    } catch (error) {
      throw new WorkerClientError(
        503,
        `${this.provider} ${this.role} worker is unavailable at ${this.baseUrl.origin}: ${messageFromFetchError(error)}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async json<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(pathname, init);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new WorkerClientError(
        statusForWorkerResponse(response.status),
        `Worker ${this.role} ${this.provider} ${pathname} failed: ${response.status} ${body}`,
        response.status
      );
    }
    return (await response.json()) as T;
  }

  async health(): Promise<WorkerHealth> {
    try {
      const health = await this.json<WorkerHealth>('/health');
      return { ...health, provider: health.provider ?? this.provider, reachable: true };
    } catch (error) {
      return {
        ok: false,
        reachable: false,
        role: this.role,
        provider: this.provider,
        state: 'failed',
        gpuOnly: true,
        gpuAvailable: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async modelStatus(): Promise<ModelStatus> {
    return await this.json<ModelStatus>('/model/status');
  }

  async loadModel(payload: LoadModelRequest): Promise<ModelStatus> {
    return await this.json<ModelStatus>('/model/load', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async unloadModel(payload: UnloadModelRequest): Promise<ModelStatus> {
    return await this.json<ModelStatus>('/model/unload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async reloadModel(payload: LoadModelRequest): Promise<ModelStatus> {
    return await this.json<ModelStatus>('/model/reload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async config(): Promise<Record<string, unknown>> {
    return await this.json<Record<string, unknown>>('/config');
  }

  async voices(): Promise<{ voices: VoiceDescriptor[] }> {
    return await this.json<{ voices: VoiceDescriptor[] }>('/voices');
  }

  private uploadBlob(upload: UploadedAudio, fallbackType: string): Blob {
    const bytes = new Uint8Array(upload.buffer.byteLength);
    bytes.set(upload.buffer);
    return new Blob([bytes], { type: upload.mimetype || fallbackType });
  }

  async transcribe(upload: UploadedAudio, fields: Record<string, string>): Promise<TranscriptResponse> {
    const form = new FormData();
    const blob = this.uploadBlob(upload, 'application/octet-stream');
    form.append('file', blob, upload.filename || 'audio.wav');
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) form.append(key, value);
    }
    return await this.json<TranscriptResponse>('/transcribe', { method: 'POST', body: form });
  }

  async speak(payload: SpeakRequest, referenceAudio?: UploadedAudio): Promise<Response> {
    const form = new FormData();
    form.append('text', payload.text);
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'text' || value === undefined || value === null) continue;
      if (typeof value === 'object') form.append(key, JSON.stringify(value));
      else form.append(key, String(value));
    }
    if (referenceAudio) {
      const blob = this.uploadBlob(referenceAudio, 'audio/wav');
      form.append('reference_audio', blob, referenceAudio.filename || 'reference.wav');
    }
    const response = await this.request('/speak', { method: 'POST', body: form });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new WorkerClientError(
        statusForWorkerResponse(response.status),
        `TTS worker ${this.provider} speak failed: ${response.status} ${body}`,
        response.status
      );
    }
    return response;
  }
}
