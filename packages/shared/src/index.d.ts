export type ServiceRole = 'stt' | 'tts';
export type LoadState = 'unloaded' | 'loading' | 'loaded' | 'unloading' | 'failed';
export type UnloadStrategy = 'soft' | 'hard';
export interface GpuDeviceInfo {
    index: number;
    name: string;
    driverVersion?: string;
    cudaVersion?: string;
    memoryTotalMiB?: number;
    memoryUsedMiB?: number;
    memoryFreeMiB?: number;
    utilizationGpuPercent?: number;
    temperatureC?: number;
    processes?: Array<{
        pid: number;
        name?: string;
        usedMemoryMiB?: number;
    }>;
}
export interface GpuStatus {
    available: boolean;
    checkedAt: string;
    error?: string;
    devices: GpuDeviceInfo[];
}
export interface WorkerHealth {
    ok: boolean;
    /** True when the gateway reached the worker HTTP endpoint. False means routing can continue to other providers. */
    reachable?: boolean;
    role: ServiceRole;
    provider: string;
    state: LoadState;
    loadedModel?: string | null;
    gpuOnly: boolean;
    gpuAvailable: boolean;
    version?: string;
    uptimeSeconds?: number;
    error?: string | null;
}
export interface ModelDescriptor {
    id: string;
    provider: string;
    role: ServiceRole;
    label: string;
    description?: string;
    languages?: string[];
    approximateVramMiB?: number;
    recommendedFor10Gb?: boolean;
    defaultComputeType?: string;
    supportsReferenceAudio?: boolean;
    supportsVoiceCloning?: boolean;
    supportsLanguageSelection?: boolean;
    notes?: string[];
}
export interface VoiceDescriptor {
    id: string;
    provider: string;
    label: string;
    path?: string;
    language?: string;
    referenceAudio?: boolean;
    createdAt?: string;
}
export interface LoadModelRequest {
    provider?: string;
    model: string;
    computeType?: string;
    language?: string;
    options?: Record<string, unknown>;
}
export interface UnloadModelRequest {
    provider?: string;
    strategy?: UnloadStrategy;
    clearCache?: boolean;
}
export interface ModelStatus {
    role: ServiceRole;
    provider: string;
    state: LoadState;
    loadedModel?: string | null;
    defaultModel?: string;
    computeType?: string | null;
    device?: string | null;
    lastChangedAt?: string;
    error?: string | null;
}
export interface TranscriptSegment {
    id?: number;
    start: number;
    end: number;
    text: string;
    avgLogprob?: number | null;
    noSpeechProb?: number | null;
    compressionRatio?: number | null;
    words?: Array<{
        start: number;
        end: number;
        word: string;
        probability?: number;
    }>;
}
export interface TranscriptResponse {
    filename?: string;
    provider: string;
    model: string;
    defaultModel?: string;
    activeModel?: string;
    language?: string | null;
    languageProbability?: number | null;
    vadFilter?: boolean;
    minSilenceDurationMs?: number;
    transcript: string;
    segments: TranscriptSegment[];
    durationSeconds?: number | null;
}
export interface SpeakRequest {
    text: string;
    provider?: string;
    voice?: string;
    /** Preferred stable reference WAV identifier returned by /api/tts/reference-audio. */
    referenceId?: string;
    /** Backward-compatible alias for referenceId. */
    referenceAudioId?: string;
    language?: string;
    speed?: number;
    exaggeration?: number;
    cfgWeight?: number;
    temperature?: number;
    model?: string;
    options?: Record<string, unknown>;
}
export interface TtsReferenceAudio {
    provider: string;
    referenceId: string;
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    active: boolean;
    createdAt: string;
}
export interface ConfigView {
    public: {
        host: string;
        port: number;
    };
    defaults: {
        sttProvider: string;
        sttModel: string;
        /** Default TTS provider used only when a speak request omits provider. */
        ttsProvider: string;
        ttsModel: string;
    };
    ttsProviders?: Record<string, {
        enabled: boolean;
        workerUrl: string;
        defaultModel: string;
        defaultVoice?: string;
        autoLoad: boolean;
    }>;
    paths: {
        baseDir: string;
        configDir: string;
        modelDir: string;
        cacheDir: string;
        voiceDir: string;
        uploadDir: string;
        outputDir: string;
        logDir: string;
    };
    gpuOnly: boolean;
    maxUploadBytes: number;
    generatedRetentionHours: number;
    authEnabled: boolean;
}
export declare const loadStateOrder: LoadState[];
