import type {
  LoadModelRequest,
  ModelStatus,
  SpeakRequest,
  TranscriptResponse,
  UnloadModelRequest,
  WorkerHealth,
  ServiceRole
} from '@local-ai-voice/shared';
import type { UploadedAudio } from './storage.js';

export interface WorkerClientOptions {
  role: ServiceRole;
  provider: string;
  baseUrl: string;
  timeoutMs: number;
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
      const response = await fetch(this.url(pathname), { ...init, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async json<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(pathname, init);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Worker ${this.role} ${pathname} failed: ${response.status} ${body}`);
    }
    return (await response.json()) as T;
  }

  async health(): Promise<WorkerHealth> {
    try {
      return await this.json<WorkerHealth>('/health');
    } catch (error) {
      return {
        ok: false,
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

  async config(): Promise<Record<string, unknown>> {
    return await this.json<Record<string, unknown>>('/config');
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
      throw new Error(`TTS worker speak failed: ${response.status} ${body}`);
    }
    return response;
  }
}
