from __future__ import annotations

import gc
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

STARTED_AT = time.time()


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


class Settings(BaseModel):
    role: str = "stt"
    provider: str = os.getenv("STT_PROVIDER", "fast-whisper")
    bind_host: str = os.getenv("STT_BIND_HOST", "127.0.0.1")
    bind_port: int = int(os.getenv("STT_BIND_PORT", "8002"))
    gpu_only: bool = env_bool("GPU_ONLY", True)
    device: str = os.getenv("STT_DEVICE", "cuda")
    default_model: str = os.getenv("DEFAULT_STT_MODEL", "large-v3-turbo")
    compute_type: str = os.getenv("DEFAULT_STT_COMPUTE_TYPE", "int8_float16")
    cache_dir: Path = Path(os.getenv("CACHE_DIR", "/opt/local-ai-voice/cache")) / "stt" / "fast-whisper"
    upload_dir: Path = Path(os.getenv("UPLOAD_DIR", "/opt/local-ai-voice/uploads")) / "stt"
    auto_load_default: bool = env_bool("STT_AUTO_LOAD_DEFAULT", True)
    preload_default: bool = env_bool("STT_PRELOAD_DEFAULT", False)
    default_vad_filter: bool = env_bool("STT_VAD_FILTER", True)
    default_min_silence_duration_ms: int = int(os.getenv("STT_MIN_SILENCE_DURATION_MS", "1000"))
    max_upload_bytes: int = int(os.getenv("MAX_UPLOAD_BYTES", "104857600"))


class LoadRequest(BaseModel):
    provider: str | None = None
    model: str
    computeType: str | None = None
    device: str | None = None
    options: dict[str, Any] | None = None


class UnloadRequest(BaseModel):
    strategy: str = "soft"
    clearCache: bool = True


class WorkerState(BaseModel):
    role: str = "stt"
    provider: str = "fast-whisper"
    state: str = "unloaded"
    loadedModel: str | None = None
    defaultModel: str = "large-v3-turbo"
    computeType: str | None = None
    device: str | None = None
    lastChangedAt: str | None = None
    error: str | None = None


settings = Settings()
state = WorkerState(provider=settings.provider, defaultModel=settings.default_model)
_model: Any | None = None
app = FastAPI(title="Local AI Voice STT worker", version="0.1.0")


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def set_state(next_state: str, **updates: Any) -> None:
    global state
    payload = state.model_dump()
    payload.update(updates)
    payload["state"] = next_state
    payload["lastChangedAt"] = now_iso()
    state = WorkerState(**payload)


def nvidia_smi_available() -> bool:
    if shutil.which("nvidia-smi") is None:
        return False
    try:
        subprocess.run(["nvidia-smi"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        return True
    except Exception:
        return False


def ctranslate_cuda_available() -> bool:
    try:
        import ctranslate2

        return int(ctranslate2.get_cuda_device_count()) > 0
    except Exception:
        return False


def gpu_available() -> bool:
    return nvidia_smi_available() and ctranslate_cuda_available()


def require_gpu(device: str) -> None:
    if settings.gpu_only and device != "cuda":
        raise HTTPException(status_code=400, detail="GPU_ONLY=true requires device='cuda'.")
    if settings.gpu_only and not gpu_available():
        raise HTTPException(status_code=503, detail="CUDA/NVIDIA GPU is not available to STT worker.")


def unload_model(clear_cache: bool = True) -> WorkerState:
    global _model
    set_state("unloading")
    _model = None
    gc.collect()
    if clear_cache:
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except Exception:
            pass
    set_state("unloaded", loadedModel=None, error=None)
    return state


def load_whisper_model(request: LoadRequest) -> WorkerState:
    global _model
    model_id = request.model
    compute_type = request.computeType or settings.compute_type
    device = request.device or settings.device
    require_gpu(device)
    set_state("loading", loadedModel=model_id, computeType=compute_type, device=device, error=None)
    try:
        from faster_whisper import WhisperModel

        settings.cache_dir.mkdir(parents=True, exist_ok=True)
        _model = WhisperModel(
            model_id,
            device=device,
            compute_type=compute_type,
            download_root=str(settings.cache_dir),
        )
        set_state("loaded", loadedModel=model_id, computeType=compute_type, device=device, error=None)
        return state
    except Exception as exc:
        _model = None
        set_state("failed", loadedModel=None, error=str(exc), computeType=compute_type, device=device)
        raise


def first_not_none(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def resolve_transcribe_options(
    *,
    vad_filter: bool | None = None,
    vadFilter: bool | None = None,
    min_silence_duration_ms: int | None = None,
    minSilenceDurationMs: int | None = None,
    beam_size: int | None = None,
    beamSize: int | None = None,
    word_timestamps: bool | None = None,
    wordTimestamps: bool | None = None,
) -> dict[str, Any]:
    vad_enabled = bool(first_not_none(vad_filter, vadFilter, settings.default_vad_filter))
    silence_ms = int(
        first_not_none(
            min_silence_duration_ms,
            minSilenceDurationMs,
            settings.default_min_silence_duration_ms,
        )
    )
    effective_beam_size = int(first_not_none(beam_size, beamSize, 5))
    effective_word_timestamps = bool(first_not_none(word_timestamps, wordTimestamps, False))

    if silence_ms < 0:
        raise HTTPException(status_code=400, detail="min_silence_duration_ms must be >= 0")
    if effective_beam_size < 1:
        raise HTTPException(status_code=400, detail="beam_size must be >= 1")

    return {
        "vad_filter": vad_enabled,
        "min_silence_duration_ms": silence_ms,
        "beam_size": effective_beam_size,
        "word_timestamps": effective_word_timestamps,
    }


@app.on_event("startup")
def preload_default_model() -> None:
    if not settings.preload_default:
        return

    load_whisper_model(
        LoadRequest(
            model=settings.default_model,
            computeType=settings.compute_type,
            device=settings.device,
        )
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": state.state != "failed" and (not settings.gpu_only or gpu_available()),
        "role": "stt",
        "provider": settings.provider,
        "state": state.state,
        "loadedModel": state.loadedModel,
        "gpuOnly": settings.gpu_only,
        "gpuAvailable": gpu_available(),
        "version": "0.1.0",
        "uptimeSeconds": round(time.time() - STARTED_AT),
        "error": state.error,
    }


@app.get("/gpu")
def gpu() -> dict[str, Any]:
    return {"available": gpu_available(), "nvidiaSmi": nvidia_smi_available(), "ctranslate2Cuda": ctranslate_cuda_available()}


@app.get("/model/status")
def model_status() -> dict[str, Any]:
    return state.model_dump()


@app.post("/model/load")
def model_load(request: LoadRequest) -> dict[str, Any]:
    if request.provider and request.provider != settings.provider:
        raise HTTPException(status_code=400, detail=f"Unsupported STT provider: {request.provider}")
    return load_whisper_model(request).model_dump()


@app.post("/model/unload")
def model_unload(request: UnloadRequest) -> dict[str, Any]:
    if request.strategy not in {"soft", "hard"}:
        raise HTTPException(status_code=400, detail="strategy must be soft or hard")
    # Hard unload is best handled by systemd restarting the worker process. This endpoint performs the
    # safe in-process cleanup and reports that the gateway/systemd should own the hard boundary.
    result = unload_model(clear_cache=request.clearCache)
    payload = result.model_dump()
    if request.strategy == "hard":
        payload["hardUnloadNote"] = "Use systemd restart for a true process boundary."
    return payload


@app.post("/model/reload")
def model_reload(request: LoadRequest) -> dict[str, Any]:
    unload_model(clear_cache=True)
    return load_whisper_model(request).model_dump()


@app.get("/config")
def config() -> dict[str, Any]:
    return settings.model_dump(mode="json")


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model: str | None = Form(default=None),
    language: str | None = Form(default=None),
    vad_filter: bool | None = Form(default=None),
    vadFilter: bool | None = Form(default=None),
    min_silence_duration_ms: int | None = Form(default=None),
    minSilenceDurationMs: int | None = Form(default=None),
    beam_size: int | None = Form(default=None),
    beamSize: int | None = Form(default=None),
    word_timestamps: bool | None = Form(default=None),
    wordTimestamps: bool | None = Form(default=None),
) -> dict[str, Any]:
    global _model
    requested_model = model or settings.default_model
    if _model is None:
        if not settings.auto_load_default:
            raise HTTPException(status_code=409, detail="STT model is not loaded.")
        load_whisper_model(LoadRequest(model=requested_model))
    elif state.loadedModel != requested_model:
        raise HTTPException(
            status_code=409,
            detail=f"Loaded STT model is {state.loadedModel}; load {requested_model} explicitly before transcribing.",
        )

    options = resolve_transcribe_options(
        vad_filter=vad_filter,
        vadFilter=vadFilter,
        min_silence_duration_ms=min_silence_duration_ms,
        minSilenceDurationMs=minSilenceDurationMs,
        beam_size=beam_size,
        beamSize=beamSize,
        word_timestamps=word_timestamps,
        wordTimestamps=wordTimestamps,
    )

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")
    if len(audio_bytes) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Upload exceeds max size of {settings.max_upload_bytes} bytes.",
        )

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, dir=settings.upload_dir, suffix=suffix) as tmp:
        tmp.write(audio_bytes)
        tmp_path = Path(tmp.name)

    try:
        vad_enabled = options["vad_filter"]
        silence_ms = options["min_silence_duration_ms"]
        vad_parameters = {"min_silence_duration_ms": silence_ms} if vad_enabled else None
        segments_iter, info = _model.transcribe(
            str(tmp_path),
            language=language,
            vad_filter=vad_enabled,
            vad_parameters=vad_parameters,
            beam_size=options["beam_size"],
            word_timestamps=options["word_timestamps"],
        )
        segments = []
        transcript_parts: list[str] = []
        for idx, segment in enumerate(segments_iter):
            text = segment.text.strip()
            transcript_parts.append(text)
            segment_payload = {
                "id": idx,
                "start": segment.start,
                "end": segment.end,
                "text": text,
                "avgLogprob": getattr(segment, "avg_logprob", None),
                "noSpeechProb": getattr(segment, "no_speech_prob", None),
                "compressionRatio": getattr(segment, "compression_ratio", None),
            }
            words = getattr(segment, "words", None)
            if words:
                segment_payload["words"] = [
                    {
                        "start": word.start,
                        "end": word.end,
                        "word": word.word,
                        "probability": getattr(word, "probability", None),
                    }
                    for word in words
                ]
            segments.append(segment_payload)
        return {
            "filename": file.filename,
            "provider": settings.provider,
            "model": state.loadedModel or requested_model,
            "defaultModel": settings.default_model,
            "activeModel": state.loadedModel,
            "language": getattr(info, "language", None),
            "languageProbability": getattr(info, "language_probability", None),
            "vadFilter": vad_enabled,
            "minSilenceDurationMs": silence_ms,
            "durationSeconds": getattr(info, "duration", None),
            "transcript": " ".join(part for part in transcript_parts if part).strip(),
            "segments": segments,
        }
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass