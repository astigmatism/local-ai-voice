from __future__ import annotations

import gc
import inspect
import io
import logging
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

STARTED_AT = time.time()
logger = logging.getLogger("local-ai-voice.tts-chatterbox")
REFERENCE_MIME_TYPES = {"audio/wav", "audio/x-wav", "audio/wave", "application/octet-stream"}


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


class Settings(BaseModel):
    role: str = "tts"
    provider: str = os.getenv("TTS_PROVIDER", "chatterbox")
    bind_host: str = os.getenv("TTS_BIND_HOST", "127.0.0.1")
    bind_port: int = int(os.getenv("TTS_BIND_PORT", "8001"))
    gpu_only: bool = env_bool("GPU_ONLY", True)
    device: str = os.getenv("TTS_DEVICE", "cuda")
    default_model: str = os.getenv("DEFAULT_TTS_MODEL", "chatterbox-turbo")
    default_language: str = os.getenv("DEFAULT_TTS_LANGUAGE", "en")
    cache_dir: Path = Path(os.getenv("CACHE_DIR", "/opt/local-ai-voice/cache")) / "tts" / "chatterbox"
    voice_dir: Path = Path(os.getenv("VOICE_DIR", "/opt/local-ai-voice/voices")) / "chatterbox"
    output_dir: Path = Path(os.getenv("OUTPUT_DIR", "/opt/local-ai-voice/output")) / "tts"
    max_reference_audio_bytes: int = int(os.getenv("MAX_UPLOAD_BYTES", "104857600"))
    auto_load_default: bool = env_bool("TTS_AUTO_LOAD_DEFAULT", True)
    preload_default: bool = env_bool("TTS_PRELOAD_DEFAULT", False)


class LoadRequest(BaseModel):
    provider: str | None = None
    model: str
    language: str | None = None
    options: dict[str, Any] | None = None


class UnloadRequest(BaseModel):
    strategy: str = "soft"
    clearCache: bool = True


class WorkerState(BaseModel):
    role: str = "tts"
    provider: str = "chatterbox"
    state: str = "unloaded"
    loadedModel: str | None = None
    defaultModel: str = "chatterbox-turbo"
    language: str | None = "en"
    device: str | None = None
    lastChangedAt: str | None = None
    error: str | None = None


settings = Settings()
state = WorkerState(provider=settings.provider, defaultModel=settings.default_model, language=settings.default_language)
_model: Any | None = None
app = FastAPI(title="Local AI Voice Chatterbox TTS worker", version="0.1.0")


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


def torch_cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def gpu_available() -> bool:
    return nvidia_smi_available() and torch_cuda_available()


def require_gpu(device: str) -> None:
    if settings.gpu_only and device != "cuda":
        raise HTTPException(status_code=400, detail="GPU_ONLY=true requires device='cuda'.")
    if settings.gpu_only and not gpu_available():
        raise HTTPException(status_code=503, detail="CUDA/NVIDIA GPU is not available to TTS worker.")


def class_for_model(model_id: str) -> tuple[type[Any], dict[str, Any]]:
    model_key = model_id.lower()
    if model_key in {"chatterbox-turbo", "turbo"}:
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        return ChatterboxTurboTTS, {}
    if model_key in {"chatterbox-multilingual", "multilingual", "chatterbox-multilingual-v3"}:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        return ChatterboxMultilingualTTS, {}
    if model_key in {"chatterbox", "chatterbox-english", "english"}:
        from chatterbox.tts import ChatterboxTTS

        return ChatterboxTTS, {}
    raise HTTPException(status_code=400, detail=f"Unsupported Chatterbox model: {model_id}")


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


def load_chatterbox_model(request: LoadRequest) -> WorkerState:
    global _model
    if request.provider and request.provider != settings.provider:
        raise HTTPException(status_code=400, detail=f"Unsupported TTS provider: {request.provider}")
    device = settings.device
    require_gpu(device)
    model_id = request.model
    language = request.language or settings.default_language
    set_state("loading", loadedModel=model_id, language=language, device=device, error=None)
    try:
        cls, kwargs = class_for_model(model_id)
        options = request.options or {}
        if "t3_model" in options:
            kwargs["t3_model"] = options["t3_model"]
        if "local_path" in options:
            kwargs["local_path"] = options["local_path"]
        settings.cache_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("HF_HOME", str(settings.cache_dir / "hf"))
        _model = cls.from_pretrained(device=device, **kwargs)
        set_state("loaded", loadedModel=model_id, language=language, device=device, error=None)
        return state
    except Exception as exc:
        _model = None
        set_state("failed", loadedModel=None, language=language, device=device, error=str(exc))
        raise


@app.on_event("startup")
def preload_default_model() -> None:
    if not settings.preload_default:
        return

    load_chatterbox_model(
        LoadRequest(
            model=settings.default_model,
            language=settings.default_language,
        )
    )


def looks_like_wav(data: bytes) -> bool:
    return len(data) >= 12 and data[:4] in {b"RIFF", b"RF64"} and data[8:12] == b"WAVE"


def validate_reference_bytes(data: bytes, filename: str | None, content_type: str | None) -> None:
    if content_type and content_type not in REFERENCE_MIME_TYPES:
        raise HTTPException(status_code=415, detail=f"Reference audio must be WAV; got {content_type}.")
    if not data:
        raise HTTPException(status_code=400, detail="Reference audio file is empty.")
    if len(data) > settings.max_reference_audio_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Reference audio exceeds max size of {settings.max_reference_audio_bytes} bytes.",
        )
    suffix = Path(filename or "reference.wav").suffix.lower()
    if suffix not in {".wav", ".wave"}:
        raise HTTPException(status_code=400, detail="Reference audio filename must end in .wav.")
    if not looks_like_wav(data):
        raise HTTPException(status_code=400, detail="Reference audio is not a valid RIFF/WAVE file.")


def validate_reference_file(path: Path) -> None:
    if path.suffix.lower() != ".wav":
        raise HTTPException(status_code=400, detail="Reference audio id must point to a .wav file.")
    if not path.exists():
        raise HTTPException(status_code=404, detail="Reference audio not found.")
    if not path.is_file():
        raise HTTPException(status_code=400, detail="Reference audio is not a regular file.")
    if not os.access(path, os.R_OK):
        raise HTTPException(status_code=403, detail="Reference audio is not readable by the TTS worker.")
    with path.open("rb") as handle:
        if not looks_like_wav(handle.read(12)):
            raise HTTPException(status_code=400, detail="Reference audio is not a valid RIFF/WAVE file.")


def safe_voice_path(reference_audio_id: str | None) -> Path | None:
    if not reference_audio_id:
        return None
    if (
        "/" in reference_audio_id
        or "\\" in reference_audio_id
        or Path(reference_audio_id).name != reference_audio_id
    ):
        raise HTTPException(status_code=400, detail="Invalid reference audio id")
    candidate = settings.voice_dir / reference_audio_id
    resolved_base = settings.voice_dir.resolve()
    resolved_candidate = candidate.resolve()
    if resolved_base not in resolved_candidate.parents:
        raise HTTPException(status_code=400, detail="Invalid reference audio id")
    validate_reference_file(resolved_candidate)
    return resolved_candidate


def supported_generate_kwargs(model: Any, kwargs: dict[str, Any], require_reference_audio: bool) -> dict[str, Any]:
    filtered = {key: value for key, value in kwargs.items() if value is not None}
    try:
        signature = inspect.signature(model.generate)
    except Exception:
        return filtered
    if require_reference_audio and "audio_prompt_path" not in signature.parameters:
        raise HTTPException(
            status_code=501,
            detail="Loaded Chatterbox provider does not support reference audio via audio_prompt_path.",
        )
    return {key: value for key, value in filtered.items() if key in signature.parameters}


def wav_bytes(wav: Any, sample_rate: int) -> bytes:
    import torchaudio as ta

    buffer = io.BytesIO()
    ta.save(buffer, wav.detach().cpu(), sample_rate, format="wav")
    buffer.seek(0)
    return buffer.read()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": state.state != "failed" and (not settings.gpu_only or gpu_available()),
        "role": "tts",
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
    return {"available": gpu_available(), "nvidiaSmi": nvidia_smi_available(), "torchCuda": torch_cuda_available()}


@app.get("/model/status")
def model_status() -> dict[str, Any]:
    return state.model_dump()


@app.post("/model/load")
def model_load(request: LoadRequest) -> dict[str, Any]:
    return load_chatterbox_model(request).model_dump()


@app.post("/model/unload")
def model_unload(request: UnloadRequest) -> dict[str, Any]:
    if request.strategy not in {"soft", "hard"}:
        raise HTTPException(status_code=400, detail="strategy must be soft or hard")
    result = unload_model(clear_cache=request.clearCache)
    payload = result.model_dump()
    if request.strategy == "hard":
        payload["hardUnloadNote"] = "Use systemd restart for a true process boundary."
    return payload


@app.post("/model/reload")
def model_reload(request: LoadRequest) -> dict[str, Any]:
    unload_model(clear_cache=True)
    return load_chatterbox_model(request).model_dump()


@app.get("/config")
def config() -> dict[str, Any]:
    return settings.model_dump(mode="json")


@app.get("/voices")
def voices() -> dict[str, Any]:
    settings.voice_dir.mkdir(parents=True, exist_ok=True)
    return {
        "voices": [
            {
                "id": path.name,
                "provider": settings.provider,
                "label": path.name,
                "referenceAudio": True,
                "path": str(path),
            }
            for path in sorted(settings.voice_dir.glob("*.wav"))
        ]
    }


@app.post("/speak")
async def speak(
    text: str = Form(...),
    voice: str | None = Form(default=None),
    referenceAudioId: str | None = Form(default=None),
    reference_audio_id: str | None = Form(default=None),
    language: str | None = Form(default=None),
    model: str | None = Form(default=None),
    speed: float | None = Form(default=None),
    exaggeration: float | None = Form(default=None),
    cfg_weight: float | None = Form(default=None),
    cfgWeight: float | None = Form(default=None),
    temperature: float | None = Form(default=None),
    reference_audio: UploadFile | None = File(default=None),
) -> Response:
    global _model
    requested_model = model or settings.default_model
    if _model is None:
        if not settings.auto_load_default:
            raise HTTPException(status_code=409, detail="TTS model is not loaded.")
        load_chatterbox_model(LoadRequest(model=requested_model, language=language or settings.default_language))
    elif state.loadedModel != requested_model:
        raise HTTPException(
            status_code=409,
            detail=f"Loaded TTS model is {state.loadedModel}; load {requested_model} explicitly before synthesis.",
        )

    language_id = language or state.language or settings.default_language
    prompt_path: Path | None = safe_voice_path(referenceAudioId or reference_audio_id or voice)
    temp_prompt: Path | None = None
    if reference_audio is not None:
        reference_bytes = await reference_audio.read()
        validate_reference_bytes(reference_bytes, reference_audio.filename, reference_audio.content_type)
        settings.voice_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(delete=False, dir=settings.voice_dir, suffix=".wav") as tmp:
            tmp.write(reference_bytes)
            temp_prompt = Path(tmp.name)
            prompt_path = temp_prompt

    try:
        if prompt_path:
            logger.info("Applying Chatterbox reference audio id=%s", prompt_path.name)
        kwargs = supported_generate_kwargs(
            _model,
            {
                "audio_prompt_path": str(prompt_path) if prompt_path else None,
                "language_id": language_id,
                "exaggeration": exaggeration,
                "cfg_weight": cfg_weight if cfg_weight is not None else cfgWeight,
                "temperature": temperature,
                "speed": speed,
            },
            require_reference_audio=prompt_path is not None,
        )
        try:
            wav = _model.generate(text, **kwargs)
        except TypeError as exc:
            if prompt_path and "audio_prompt_path" in str(exc):
                raise HTTPException(
                    status_code=501,
                    detail="Loaded Chatterbox provider rejected reference audio parameter audio_prompt_path.",
                ) from exc
            raise
        sample_rate = int(getattr(_model, "sr", 24000))
        payload = wav_bytes(wav, sample_rate)
        headers = {
            "content-disposition": 'attachment; filename="speech.wav"',
            "x-sample-rate": str(sample_rate),
            "x-engine": "chatterbox-tts",
            "x-local-ai-voice-engine": "chatterbox-tts",
            "x-local-ai-voice-model": str(state.loadedModel),
        }
        if prompt_path:
            headers["x-local-ai-voice-reference-audio"] = prompt_path.name
        return Response(content=payload, media_type="audio/wav", headers=headers)
    finally:
        if temp_prompt is not None:
            try:
                temp_prompt.unlink(missing_ok=True)
            except Exception:
                pass