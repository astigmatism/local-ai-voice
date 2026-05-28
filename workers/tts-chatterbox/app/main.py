from __future__ import annotations

import gc
import inspect
import io
import logging
import os
import re
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
    normalize_text: bool = env_bool("TTS_NORMALIZE_TEXT", True)
    chunk_text: bool = env_bool("TTS_CHUNK_TEXT", True)
    target_chunk_chars: int = int(os.getenv("TTS_TARGET_CHUNK_CHARS", "200"))
    max_chunk_chars: int = int(os.getenv("TTS_MAX_CHUNK_CHARS", "300"))
    chunk_silence_ms: int = int(os.getenv("TTS_CHUNK_SILENCE_MS", "180"))
    default_exaggeration: float | None = float(os.getenv("TTS_DEFAULT_EXAGGERATION", "0.5"))
    default_cfg_weight: float | None = float(os.getenv("TTS_DEFAULT_CFG_WEIGHT", "0.35"))


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



TERMINAL_PUNCTUATION = (".", "?", "!")
SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")
SOFT_BOUNDARIES = (",", ";", ":", " - ", " -- ", "—", "–")


def normalize_tts_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    normalized = re.sub(r"\n\s*[-*+]\s+", ". ", normalized)
    normalized = re.sub(r"\s*\n\s*", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if normalized and normalized[-1] not in TERMINAL_PUNCTUATION:
        normalized = f"{normalized}."
    return normalized


def ensure_terminal_punctuation(text: str) -> str:
    stripped = text.strip()
    if stripped and stripped[-1] not in TERMINAL_PUNCTUATION:
        return f"{stripped}."
    return stripped


def split_long_segment(segment: str, max_chars: int) -> list[str]:
    remaining = segment.strip()
    chunks: list[str] = []
    while len(remaining) > max_chars:
        window = remaining[: max_chars + 1]
        split_at = -1
        for boundary in SOFT_BOUNDARIES:
            candidate = window.rfind(boundary)
            if candidate > max_chars // 2:
                split_at = candidate + len(boundary)
                break
        if split_at <= 0:
            candidate = window.rfind(" ")
            if candidate > max_chars // 2:
                split_at = candidate
        if split_at <= 0:
            split_at = max_chars
        chunks.append(ensure_terminal_punctuation(remaining[:split_at]))
        remaining = remaining[split_at:].strip()
    if remaining:
        chunks.append(ensure_terminal_punctuation(remaining))
    return chunks


def chunk_tts_text(text: str, target_chars: int, max_chars: int) -> list[str]:
    if max_chars < 80:
        raise HTTPException(status_code=500, detail="TTS_MAX_CHUNK_CHARS must be at least 80.")
    target = max(80, min(target_chars, max_chars))
    sentences = [part.strip() for part in SENTENCE_BOUNDARY.split(text) if part.strip()]
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        sentence = ensure_terminal_punctuation(sentence)
        if len(sentence) > max_chars:
            if current:
                chunks.append(ensure_terminal_punctuation(current))
                current = ""
            chunks.extend(split_long_segment(sentence, max_chars))
            continue
        candidate = f"{current} {sentence}".strip() if current else sentence
        if current and len(candidate) > target:
            chunks.append(ensure_terminal_punctuation(current))
            current = sentence
        else:
            current = candidate
    if current:
        chunks.append(ensure_terminal_punctuation(current))
    return chunks or [ensure_terminal_punctuation(text)]


def prepare_tts_chunks(text: str) -> list[str]:
    prepared = normalize_tts_text(text) if settings.normalize_text else text.strip()
    if not prepared:
        raise HTTPException(status_code=400, detail="Missing required text field.")
    if not settings.chunk_text or len(prepared) <= settings.max_chunk_chars:
        return [ensure_terminal_punctuation(prepared)]
    return chunk_tts_text(prepared, settings.target_chunk_chars, settings.max_chunk_chars)


def concatenate_wavs(wavs: list[Any], sample_rate: int, silence_ms: int) -> Any:
    if len(wavs) == 1:
        return wavs[0]
    import torch

    pieces: list[Any] = []
    for index, wav in enumerate(wavs):
        pieces.append(wav)
        if index == len(wavs) - 1 or silence_ms <= 0:
            continue
        silence_samples = max(1, round(sample_rate * silence_ms / 1000))
        if wav.dim() == 1:
            silence_shape = (silence_samples,)
        else:
            silence_shape = (*wav.shape[:-1], silence_samples)
        pieces.append(torch.zeros(silence_shape, dtype=wav.dtype, device=wav.device))
    return torch.cat(pieces, dim=-1)


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
        effective_exaggeration = (
            exaggeration if exaggeration is not None else settings.default_exaggeration
        )
        effective_cfg_weight = (
            cfg_weight
            if cfg_weight is not None
            else cfgWeight
            if cfgWeight is not None
            else settings.default_cfg_weight
        )
        kwargs = supported_generate_kwargs(
            _model,
            {
                "audio_prompt_path": str(prompt_path) if prompt_path else None,
                "language_id": language_id,
                "exaggeration": effective_exaggeration,
                "cfg_weight": effective_cfg_weight,
                "temperature": temperature,
                "speed": speed,
            },
            require_reference_audio=prompt_path is not None,
        )
        chunks = prepare_tts_chunks(text)
        logger.info(
            "Generating Chatterbox speech chunks=%s total_chars=%s "
            "max_chunk_chars=%s cfg_weight=%s exaggeration=%s",
            len(chunks),
            len(text),
            settings.max_chunk_chars,
            kwargs.get("cfg_weight"),
            kwargs.get("exaggeration"),
        )
        generated_wavs: list[Any] = []
        try:
            for index, chunk in enumerate(chunks, start=1):
                logger.info(
                    "Generating Chatterbox chunk index=%s/%s chars=%s",
                    index,
                    len(chunks),
                    len(chunk),
                )
                generated_wavs.append(_model.generate(chunk, **kwargs))
        except TypeError as exc:
            if prompt_path and "audio_prompt_path" in str(exc):
                raise HTTPException(
                    status_code=501,
                    detail="Loaded Chatterbox provider rejected reference audio parameter audio_prompt_path.",
                ) from exc
            raise
        sample_rate = int(getattr(_model, "sr", 24000))
        wav = concatenate_wavs(generated_wavs, sample_rate, settings.chunk_silence_ms)
        payload = wav_bytes(wav, sample_rate)
        headers = {
            "content-disposition": 'attachment; filename="speech.wav"',
            "x-sample-rate": str(sample_rate),
            "x-engine": "chatterbox-tts",
            "x-local-ai-voice-engine": "chatterbox-tts",
            "x-local-ai-voice-model": str(state.loadedModel),
        }
        headers["x-local-ai-voice-chunks"] = str(len(chunks))
        headers["x-local-ai-voice-max-chunk-chars"] = str(settings.max_chunk_chars)
        if prompt_path:
            headers["x-local-ai-voice-reference-audio"] = prompt_path.name
        return Response(content=payload, media_type="audio/wav", headers=headers)
    finally:
        if temp_prompt is not None:
            try:
                temp_prompt.unlink(missing_ok=True)
            except Exception:
                pass