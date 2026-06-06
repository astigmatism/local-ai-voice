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
TERMINAL_PUNCTUATION = ".!?;:。！？"
DEFAULT_SAMPLE_RATE = 24_000
CHATTERBOX_MODEL_IDS = {
    "chatterbox-turbo",
    "turbo",
    "chatterbox",
    "chatterbox-english",
    "english",
    "chatterbox-multilingual",
    "chatterbox-multilingual-v3",
    "multilingual",
}
NON_CHATTERBOX_LEGACY_LANGUAGE_CODES = {"a", "b", "e", "f", "h", "i", "j", "p", "z"}


def first_env(names: list[str], default: str) -> str:
    for name in names:
        raw = os.getenv(name)
        if raw is not None and raw != "":
            return raw
    return default


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def env_float(names: list[str], default: float | None = None) -> float | None:
    raw = first_env(names, "")
    if raw == "":
        return default
    return float(raw)


def default_chatterbox_model_from_env() -> str:
    provider_specific = first_env(["TTS_CHATTERBOX_DEFAULT_MODEL", "CHATTERBOX_TTS_MODEL"], "")
    if provider_specific:
        return provider_specific
    legacy_global = first_env(["DEFAULT_TTS_MODEL"], "")
    if legacy_global and legacy_global.strip().lower() in CHATTERBOX_MODEL_IDS:
        return legacy_global
    return "chatterbox-turbo"


def default_chatterbox_language_from_env() -> str:
    provider_specific = first_env(["TTS_CHATTERBOX_DEFAULT_LANGUAGE", "CHATTERBOX_TTS_LANGUAGE"], "")
    if provider_specific:
        return provider_specific
    legacy_global = first_env(["DEFAULT_TTS_LANGUAGE"], "")
    if legacy_global and legacy_global.strip().lower() not in NON_CHATTERBOX_LEGACY_LANGUAGE_CODES:
        return legacy_global
    return "en"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class Settings(BaseModel):
    role: str = "tts"
    provider: str = os.getenv("TTS_PROVIDER", "chatterbox")
    bind_host: str = os.getenv(
        "TTS_CHATTERBOX_BIND_HOST",
        os.getenv("CHATTERBOX_TTS_BIND_HOST", os.getenv("TTS_BIND_HOST", "127.0.0.1")),
    )
    bind_port: int = int(
        os.getenv(
            "TTS_CHATTERBOX_BIND_PORT",
            os.getenv("CHATTERBOX_TTS_BIND_PORT", os.getenv("TTS_BIND_PORT", "8001")),
        )
    )
    gpu_only: bool = True
    device: str = "cuda"
    default_model: str = "chatterbox-turbo"
    default_language: str = "en"
    cache_dir: Path = Path(os.getenv("CACHE_DIR", "/opt/local-ai-voice/cache")) / "tts" / "chatterbox"
    voice_dir: Path = Path(os.getenv("VOICE_DIR", "/opt/local-ai-voice/voices")) / "chatterbox"
    output_dir: Path = Path(os.getenv("OUTPUT_DIR", "/opt/local-ai-voice/output")) / "tts"
    auto_load_default: bool = True
    preload_default: bool = False
    normalize_text: bool = True
    chunk_text: bool = True
    target_chunk_chars: int = 200
    max_chunk_chars: int = 300
    chunk_silence_ms: int = 180
    default_exaggeration: float | None = 0.5
    default_cfg_weight: float | None = 0.35
    default_temperature: float | None = None
    default_speed: float | None = None

    def __init__(self, **data: Any) -> None:
        super().__init__(**data)
        self.provider = first_env(["TTS_PROVIDER"], self.provider)
        self.bind_host = first_env(
            ["TTS_CHATTERBOX_BIND_HOST", "CHATTERBOX_TTS_BIND_HOST", "TTS_BIND_HOST"],
            "127.0.0.1",
        )
        self.bind_port = int(
            first_env(["TTS_CHATTERBOX_BIND_PORT", "CHATTERBOX_TTS_BIND_PORT", "TTS_BIND_PORT"], "8001")
        )
        self.gpu_only = env_bool("TTS_GPU_ONLY", env_bool("GPU_ONLY", True))
        self.device = first_env(["TTS_CHATTERBOX_DEVICE", "CHATTERBOX_TTS_DEVICE", "TTS_DEVICE"], "cuda")
        self.default_model = default_chatterbox_model_from_env()
        self.default_language = default_chatterbox_language_from_env()
        self.cache_dir = (
            Path(
                first_env(
                    ["TTS_CHATTERBOX_CACHE_DIR", "CHATTERBOX_TTS_CACHE_DIR", "CACHE_DIR"],
                    "/opt/local-ai-voice/cache",
                )
            )
            / "tts"
            / "chatterbox"
        )
        self.voice_dir = (
            Path(
                first_env(
                    ["TTS_CHATTERBOX_VOICE_DIR", "CHATTERBOX_TTS_VOICE_DIR", "VOICE_DIR"],
                    "/opt/local-ai-voice/voices",
                )
            )
            / "chatterbox"
        )
        self.output_dir = Path(first_env(["TTS_OUTPUT_DIR", "OUTPUT_DIR"], "/opt/local-ai-voice/output")) / "tts"
        self.auto_load_default = env_bool(
            "TTS_CHATTERBOX_AUTO_LOAD_DEFAULT",
            env_bool("CHATTERBOX_TTS_AUTO_LOAD_DEFAULT", env_bool("TTS_AUTO_LOAD_DEFAULT", True)),
        )
        self.preload_default = env_bool(
            "TTS_CHATTERBOX_AUTOLOAD",
            env_bool("CHATTERBOX_TTS_PRELOAD_DEFAULT", env_bool("TTS_PRELOAD_DEFAULT", False)),
        )
        self.normalize_text = env_bool("TTS_NORMALIZE_TEXT", True)
        self.chunk_text = env_bool("TTS_CHUNK_TEXT", True)
        self.target_chunk_chars = int(first_env(["TTS_TARGET_CHUNK_CHARS", "CHATTERBOX_TTS_TARGET_CHUNK_CHARS"], "200"))
        self.max_chunk_chars = int(first_env(["TTS_MAX_CHUNK_CHARS", "CHATTERBOX_TTS_MAX_CHUNK_CHARS"], "300"))
        self.chunk_silence_ms = int(first_env(["TTS_CHUNK_SILENCE_MS", "CHATTERBOX_TTS_CHUNK_SILENCE_MS"], "180"))
        self.default_exaggeration = env_float(["TTS_DEFAULT_EXAGGERATION", "CHATTERBOX_TTS_DEFAULT_EXAGGERATION"], 0.5)
        self.default_cfg_weight = env_float(["TTS_DEFAULT_CFG_WEIGHT", "CHATTERBOX_TTS_DEFAULT_CFG_WEIGHT"], 0.35)
        self.default_temperature = env_float(["TTS_DEFAULT_TEMPERATURE", "CHATTERBOX_TTS_DEFAULT_TEMPERATURE"], None)
        self.default_speed = env_float(["TTS_DEFAULT_SPEED", "CHATTERBOX_TTS_DEFAULT_SPEED"], None)


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
state = WorkerState(
    provider=settings.provider,
    defaultModel=settings.default_model,
    language=settings.default_language,
)
_model: Any | None = None
app = FastAPI(title="Local AI Voice Chatterbox TTS worker", version="0.1.0")


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


def torch_mps_available() -> bool:
    try:
        import torch

        return bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    except Exception:
        return False


def gpu_available() -> bool:
    return nvidia_smi_available() and torch_cuda_available()


def resolve_device(configured_device: str) -> str:
    normalized = configured_device.strip().lower()
    if normalized in {"", "auto"}:
        if torch_cuda_available():
            return "cuda"
        if settings.gpu_only:
            raise HTTPException(status_code=503, detail="CUDA/NVIDIA GPU is not available to Chatterbox worker.")
        if torch_mps_available():
            return "mps"
        return "cpu"
    if settings.gpu_only and normalized != "cuda":
        raise HTTPException(status_code=400, detail="GPU_ONLY=true requires TTS_CHATTERBOX_DEVICE='cuda'.")
    if normalized == "cuda" and not torch_cuda_available():
        status = 503 if settings.gpu_only else 400
        raise HTTPException(status_code=status, detail="CUDA/NVIDIA GPU is not available to Chatterbox worker.")
    return normalized


def class_for_model(model_id: str) -> tuple[Any, dict[str, Any]]:
    key = model_id.strip().lower()
    if key in {"turbo", "chatterbox-turbo"}:
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        return ChatterboxTurboTTS, {}
    if key in {"chatterbox", "chatterbox-english", "english"}:
        from chatterbox.tts import ChatterboxTTS

        return ChatterboxTTS, {}
    if key in {"chatterbox-multilingual", "chatterbox-multilingual-v3", "multilingual"}:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        return ChatterboxMultilingualTTS, {}
    raise HTTPException(status_code=400, detail=f"Unsupported Chatterbox model: {model_id}")


def load_chatterbox_model(request: LoadRequest) -> WorkerState:
    global _model
    if request.provider and request.provider != settings.provider:
        raise HTTPException(status_code=400, detail=f"Unsupported TTS provider: {request.provider}")
    model_id = request.model
    language = request.language or settings.default_language
    device = resolve_device(settings.device)
    set_state("loading", loadedModel=model_id, language=language, device=device, error=None)
    try:
        model_cls, kwargs = class_for_model(model_id)
        options = request.options or {}
        if "t3_model" in options:
            kwargs["t3_model"] = options["t3_model"]
        if "local_path" in options:
            kwargs["local_path"] = options["local_path"]
        settings.cache_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("HF_HOME", str(settings.cache_dir / "hf"))
        os.environ.setdefault("HF_HUB_CACHE", str(settings.cache_dir / "hf" / "hub"))
        _model = model_cls.from_pretrained(device=device, **kwargs)
        set_state("loaded", loadedModel=model_id, language=language, device=device, error=None)
        return state
    except Exception as exc:
        _model = None
        set_state("failed", loadedModel=None, language=language, device=device, error=str(exc))
        raise


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


def looks_like_wav_header(header: bytes) -> bool:
    return len(header) >= 12 and header[0:4] in {b"RIFF", b"RF64"} and header[8:12] == b"WAVE"


def looks_like_wav_file(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return looks_like_wav_header(handle.read(12))
    except OSError:
        return False


def safe_voice_path(reference_audio_id: str | None) -> Path | None:
    if reference_audio_id is None:
        return None
    requested = reference_audio_id.strip()
    if not requested or requested == "reference-upload":
        return None
    path_value = Path(requested)
    if path_value.name != requested or path_value.is_absolute() or path_value.suffix.lower() != ".wav":
        raise HTTPException(status_code=400, detail="Invalid reference audio id.")
    base = settings.voice_dir.resolve()
    target = (settings.voice_dir / requested).resolve()
    if not target.is_relative_to(base):
        raise HTTPException(status_code=400, detail="Invalid reference audio id.")
    if not target.exists():
        raise HTTPException(status_code=404, detail="Reference audio not found.")
    if not target.is_file() or not looks_like_wav_file(target):
        raise HTTPException(status_code=400, detail="Reference audio must be a readable WAV file.")
    return target


def normalize_tts_text(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    if normalized and normalized[-1] not in TERMINAL_PUNCTUATION:
        normalized += "."
    return normalized


def split_long_text_on_words(text: str, max_chars: int) -> list[str]:
    pieces: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > max_chars:
            pieces.append(current)
            current = word
        else:
            current = candidate
    if current:
        pieces.append(current)
    if pieces:
        return pieces
    return [text[index : index + max_chars] for index in range(0, len(text), max_chars)]


def ensure_terminal_punctuation(chunk: str) -> str:
    stripped = chunk.strip()
    if stripped and stripped[-1] not in TERMINAL_PUNCTUATION:
        stripped += "."
    return stripped


def prepare_tts_chunks(text: str) -> list[str]:
    working = normalize_tts_text(text) if settings.normalize_text else text.strip()
    if not working:
        return []
    max_chars = max(1, settings.max_chunk_chars)
    target_chars = max(1, min(settings.target_chunk_chars, max_chars))
    if not settings.chunk_text or len(working) <= max_chars:
        return [ensure_terminal_punctuation(working)]

    sentences = [part.strip() for part in re.split(r"(?<=[.!?;:。！？])\s+", working) if part.strip()]
    if not sentences:
        sentences = [working]

    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        sentence_parts = [sentence]
        if len(sentence) > max_chars:
            sentence_parts = split_long_text_on_words(sentence, max_chars)
        for part in sentence_parts:
            candidate = f"{current} {part}".strip()
            if current and len(candidate) > target_chars:
                chunks.append(ensure_terminal_punctuation(current))
                current = part
            elif len(part) > max_chars:
                chunks.extend(ensure_terminal_punctuation(piece) for piece in split_long_text_on_words(part, max_chars))
                current = ""
            else:
                current = candidate
    if current:
        chunks.append(ensure_terminal_punctuation(current))
    return chunks


def supported_generate_kwargs(model: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    filtered = {key: value for key, value in kwargs.items() if value is not None}
    try:
        signature = inspect.signature(model.generate)
    except (TypeError, ValueError):
        return filtered
    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in signature.parameters.values()):
        return filtered
    return {key: value for key, value in filtered.items() if key in signature.parameters}


def concatenate_wavs(wavs: list[Any], silence_ms: int) -> Any:
    if not wavs:
        raise HTTPException(status_code=500, detail="Chatterbox returned no audio chunks.")
    if len(wavs) == 1 or silence_ms <= 0:
        return wavs[0]
    try:
        import torch

        first = wavs[0]
        if isinstance(first, torch.Tensor):
            dim = -1 if first.ndim > 1 else 0
            silence_samples = max(1, round(DEFAULT_SAMPLE_RATE * silence_ms / 1000))
            shape = list(first.shape)
            shape[dim] = silence_samples
            silence = torch.zeros(shape, dtype=first.dtype, device=first.device)
            pieces: list[Any] = []
            for index, wav in enumerate(wavs):
                pieces.append(wav)
                if index < len(wavs) - 1:
                    pieces.append(silence)
            return torch.cat(pieces, dim=dim)
    except Exception:
        pass

    import numpy as np

    arrays = [np.asarray(wav) for wav in wavs]
    silence = np.zeros(max(1, round(DEFAULT_SAMPLE_RATE * silence_ms / 1000)), dtype=arrays[0].dtype)
    pieces_np: list[Any] = []
    for index, array in enumerate(arrays):
        pieces_np.append(array)
        if index < len(arrays) - 1:
            pieces_np.append(silence)
    return np.concatenate(pieces_np, axis=-1)


def wav_bytes(wav: Any, sample_rate: int) -> bytes:
    try:
        import torchaudio as ta

        buffer = io.BytesIO()
        payload = wav.detach().cpu() if hasattr(wav, "detach") else wav
        ta.save(buffer, payload, sample_rate, format="wav")
        buffer.seek(0)
        return buffer.read()
    except Exception:
        import numpy as np
        import soundfile as sf

        payload = wav.detach().cpu().numpy() if hasattr(wav, "detach") else wav
        samples = np.asarray(payload)
        if samples.ndim > 1:
            samples = np.squeeze(samples)
        buffer = io.BytesIO()
        sf.write(buffer, samples, sample_rate, format="WAV")
        buffer.seek(0)
        return buffer.read()


async def save_uploaded_reference_audio(reference_audio: UploadFile) -> Path:
    contents = await reference_audio.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded reference audio is empty.")
    if not looks_like_wav_header(contents[:12]):
        raise HTTPException(status_code=400, detail="Reference audio upload must be a WAV file.")
    settings.voice_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(reference_audio.filename or "reference.wav").suffix.lower()
    if suffix not in {".wav", ".wave"}:
        suffix = ".wav"
    handle = tempfile.NamedTemporaryFile(prefix="upload-", suffix=suffix, dir=settings.voice_dir, delete=False)
    try:
        with handle:
            handle.write(contents)
        return Path(handle.name)
    except Exception:
        Path(handle.name).unlink(missing_ok=True)
        raise


@app.on_event("startup")
def preload_default_model() -> None:
    if not settings.preload_default:
        return
    load_chatterbox_model(LoadRequest(model=settings.default_model, language=settings.default_language))


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
    return {
        "available": gpu_available(),
        "nvidiaSmi": nvidia_smi_available(),
        "torchCuda": torch_cuda_available(),
    }


@app.get("/model/status")
def model_status() -> dict[str, Any]:
    return state.model_dump()


@app.get("/status")
def status() -> dict[str, Any]:
    """Compatibility alias for orchestration systems that poll /status."""
    return model_status()


@app.get("/models")
def models() -> dict[str, Any]:
    return {
        "provider": settings.provider,
        "models": [
            {
                "id": "chatterbox-turbo",
                "provider": settings.provider,
                "label": "Chatterbox Turbo",
                "languages": ["en"],
                "supportsReferenceAudio": True,
                "supportsVoiceCloning": True,
                "supportsLanguageSelection": False,
            },
            {
                "id": "chatterbox",
                "provider": settings.provider,
                "label": "Chatterbox English",
                "languages": ["en"],
                "supportsReferenceAudio": True,
                "supportsVoiceCloning": True,
                "supportsLanguageSelection": False,
            },
            {
                "id": "chatterbox-multilingual",
                "provider": settings.provider,
                "label": "Chatterbox Multilingual",
                "languages": ["ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh"],
                "supportsReferenceAudio": True,
                "supportsVoiceCloning": True,
                "supportsLanguageSelection": True,
            },
        ],
    }


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
    stored = [
        {
            "id": path.name,
            "provider": settings.provider,
            "label": path.name,
            "referenceAudio": True,
            "path": str(path),
        }
        for path in sorted(settings.voice_dir.glob("*.wav"))
        if path.is_file()
    ]
    return {
        "voices": [
            {
                "id": "reference-upload",
                "provider": settings.provider,
                "label": "Uploaded reference WAV",
                "referenceAudio": True,
            },
            *stored,
        ]
    }


@app.post("/speak")
async def speak(
    text: str = Form(...),
    provider: str | None = Form(default=None),
    voice: str | None = Form(default=None),
    referenceId: str | None = Form(default=None),
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
    if provider and provider != settings.provider:
        raise HTTPException(status_code=400, detail=f"Unsupported TTS provider: {provider}")
    if not text.strip():
        raise HTTPException(status_code=400, detail="Missing required text field.")

    requested_model = model or settings.default_model
    requested_language = language or state.language or settings.default_language
    if _model is None:
        if not settings.auto_load_default:
            raise HTTPException(status_code=409, detail="Chatterbox model is not loaded.")
        load_chatterbox_model(LoadRequest(model=requested_model, language=requested_language))
    elif state.loadedModel != requested_model:
        raise HTTPException(status_code=409, detail=f"Loaded Chatterbox model is {state.loadedModel}, not {requested_model}.")

    uploaded_path: Path | None = None
    try:
        reference_id = referenceId or referenceAudioId or reference_audio_id or voice
        prompt_path = safe_voice_path(reference_id)
        if reference_audio is not None:
            uploaded_path = await save_uploaded_reference_audio(reference_audio)
            prompt_path = uploaded_path

        chunks = prepare_tts_chunks(text)
        if not chunks:
            raise HTTPException(status_code=400, detail="Missing required text field.")

        generated: list[Any] = []
        for chunk in chunks:
            kwargs = supported_generate_kwargs(
                _model,
                {
                    "audio_prompt_path": str(prompt_path) if prompt_path else None,
                    "language_id": requested_language,
                    "exaggeration": exaggeration if exaggeration is not None else settings.default_exaggeration,
                    "cfg_weight": cfg_weight if cfg_weight is not None else cfgWeight if cfgWeight is not None else settings.default_cfg_weight,
                    "temperature": temperature if temperature is not None else settings.default_temperature,
                    "speed": speed if speed is not None else settings.default_speed,
                },
            )
            generated.append(_model.generate(chunk, **kwargs))
        wav = concatenate_wavs(generated, settings.chunk_silence_ms)
        sample_rate = int(getattr(_model, "sr", DEFAULT_SAMPLE_RATE))
        payload = wav_bytes(wav, sample_rate)
        return Response(
            content=payload,
            media_type="audio/wav",
            headers={
                "content-disposition": 'attachment; filename="speech.wav"',
                "x-sample-rate": str(sample_rate),
                "x-engine": "chatterbox-tts",
                "x-local-ai-voice-engine": "chatterbox-tts",
                "x-local-ai-voice-model": state.loadedModel or requested_model,
            },
        )
    finally:
        if uploaded_path is not None:
            uploaded_path.unlink(missing_ok=True)
