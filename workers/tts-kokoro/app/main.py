from __future__ import annotations

import gc
import io
import json
import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

STARTED_AT = time.time()
logger = logging.getLogger("local-ai-voice.tts-kokoro")
SAMPLE_RATE = 24_000

KOKORO_VOICE_IDS = [
    "af_alloy",
    "af_aoede",
    "af_bella",
    "af_heart",
    "af_jessica",
    "af_kore",
    "af_nicole",
    "af_nova",
    "af_river",
    "af_sarah",
    "af_sky",
    "am_adam",
    "am_echo",
    "am_eric",
    "am_fenrir",
    "am_liam",
    "am_michael",
    "am_onyx",
    "am_puck",
    "am_santa",
    "bf_alice",
    "bf_emma",
    "bf_isabella",
    "bf_lily",
    "bm_daniel",
    "bm_fable",
    "bm_george",
    "bm_lewis",
    "ef_dora",
    "em_alex",
    "em_santa",
    "ff_siwis",
    "hf_alpha",
    "hf_beta",
    "hm_omega",
    "hm_psi",
    "if_sara",
    "im_nicola",
    "jf_alpha",
    "jf_gongitsune",
    "jf_nezumi",
    "jf_tebukuro",
    "jm_kumo",
    "pf_dora",
    "pm_alex",
    "pm_santa",
    "zf_xiaobei",
    "zf_xiaoni",
    "zf_xiaoxiao",
    "zf_xiaoyi",
    "zm_yunjian",
    "zm_yunxi",
    "zm_yunxia",
    "zm_yunyang",
]

VOICE_LANGUAGES = {
    "af": "en-us",
    "am": "en-us",
    "bf": "en-gb",
    "bm": "en-gb",
    "ef": "es",
    "em": "es",
    "ff": "fr-fr",
    "hf": "hi",
    "hm": "hi",
    "if": "it",
    "im": "it",
    "jf": "ja",
    "jm": "ja",
    "pf": "pt-br",
    "pm": "pt-br",
    "zf": "zh",
    "zm": "zh",
}

LANGUAGE_ALIASES = {
    "a": "a",
    "en": "a",
    "en-us": "a",
    "en_us": "a",
    "us": "a",
    "american": "a",
    "b": "b",
    "en-gb": "b",
    "en_gb": "b",
    "gb": "b",
    "british": "b",
    "e": "e",
    "es": "e",
    "es-es": "e",
    "spanish": "e",
    "f": "f",
    "fr": "f",
    "fr-fr": "f",
    "french": "f",
    "h": "h",
    "hi": "h",
    "hi-in": "h",
    "hindi": "h",
    "i": "i",
    "it": "i",
    "it-it": "i",
    "italian": "i",
    "j": "j",
    "ja": "j",
    "ja-jp": "j",
    "japanese": "j",
    "p": "p",
    "pt": "p",
    "pt-br": "p",
    "pt_br": "p",
    "portuguese": "p",
    "z": "z",
    "zh": "z",
    "zh-cn": "z",
    "zh_cn": "z",
    "mandarin": "z",
    "chinese": "z",
}

LANGUAGE_LABELS = {
    "a": "en-us",
    "b": "en-gb",
    "e": "es",
    "f": "fr-fr",
    "h": "hi",
    "i": "it",
    "j": "ja",
    "p": "pt-br",
    "z": "zh",
}


class Settings(BaseModel):
    role: str = "tts"
    provider: str = os.getenv("TTS_PROVIDER", "kokoro")
    bind_host: str = os.getenv("TTS_KOKORO_BIND_HOST", os.getenv("KOKORO_TTS_BIND_HOST", os.getenv("TTS_BIND_HOST", "127.0.0.1")))
    bind_port: int = int(os.getenv("TTS_KOKORO_BIND_PORT", os.getenv("KOKORO_TTS_BIND_PORT", os.getenv("TTS_BIND_PORT", "8003"))))
    gpu_only: bool = False
    device: str = "cuda"
    default_model: str = "kokoro-82m"
    default_voice: str = "af_heart"
    default_language: str = "a"
    repo_id: str = "hexgrad/Kokoro-82M"
    cache_dir: Path = Path(os.getenv("CACHE_DIR", "/opt/local-ai-voice/cache")) / "tts" / "kokoro"
    auto_load_default: bool = True
    preload_default: bool = False
    default_speed: float = 1.0
    chunk_silence_ms: int = 120
    split_pattern: str = r"\n+"

    def __init__(self, **data: Any) -> None:
        super().__init__(**data)
        self.gpu_only = env_bool("TTS_GPU_ONLY", env_bool("GPU_ONLY", True))
        self.device = first_env(["KOKORO_TTS_DEVICE", "TTS_KOKORO_DEVICE", "TTS_DEVICE"], "cuda")
        self.default_model = first_env(["TTS_KOKORO_DEFAULT_MODEL", "KOKORO_TTS_MODEL", "KOKORO_DEFAULT_TTS_MODEL"], "kokoro-82m")
        self.default_voice = first_env(["TTS_KOKORO_DEFAULT_VOICE", "KOKORO_TTS_VOICE", "KOKORO_DEFAULT_TTS_VOICE"], "af_heart")
        self.default_language = first_env(["TTS_KOKORO_DEFAULT_LANGUAGE", "KOKORO_TTS_LANGUAGE", "KOKORO_DEFAULT_TTS_LANGUAGE"], "a")
        self.repo_id = first_env(["KOKORO_REPO_ID", "KOKORO_TTS_REPO_ID"], "hexgrad/Kokoro-82M")
        self.auto_load_default = env_bool("KOKORO_TTS_AUTO_LOAD_DEFAULT", env_bool("TTS_AUTO_LOAD_DEFAULT", True))
        self.preload_default = env_bool("TTS_KOKORO_AUTOLOAD", env_bool("KOKORO_TTS_PRELOAD_DEFAULT", False))
        self.default_speed = float(first_env(["KOKORO_TTS_DEFAULT_SPEED"], "1.0"))
        self.chunk_silence_ms = int(first_env(["KOKORO_TTS_CHUNK_SILENCE_MS", "TTS_CHUNK_SILENCE_MS"], "120"))
        self.split_pattern = first_env(["KOKORO_TTS_SPLIT_PATTERN"], r"\n+")


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
    provider: str = "kokoro"
    state: str = "unloaded"
    loadedModel: str | None = None
    defaultModel: str = "kokoro-82m"
    language: str | None = "a"
    voice: str | None = "af_heart"
    repoId: str | None = "hexgrad/Kokoro-82M"
    device: str | None = None
    lastChangedAt: str | None = None
    error: str | None = None


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
            raise HTTPException(status_code=503, detail="CUDA/NVIDIA GPU is not available to Kokoro worker.")
        if torch_mps_available():
            return "mps"
        return "cpu"
    if settings.gpu_only and normalized != "cuda":
        raise HTTPException(status_code=400, detail="GPU_ONLY=true requires KOKORO_TTS_DEVICE='cuda'.")
    if normalized == "cuda" and not torch_cuda_available():
        status = 503 if settings.gpu_only else 400
        raise HTTPException(status_code=status, detail="CUDA/NVIDIA GPU is not available to Kokoro worker.")
    return normalized


def normalize_model_id(model_id: str) -> str:
    key = model_id.strip().lower()
    if key in {"kokoro", "kokoro-82m", "hexgrad/kokoro-82m"}:
        return "kokoro-82m"
    raise HTTPException(status_code=400, detail=f"Unsupported Kokoro model: {model_id}")


def repo_id_for_model(model_id: str, options: dict[str, Any] | None = None) -> str:
    options = options or {}
    explicit = options.get("repo_id") or options.get("repoId")
    if explicit:
        return str(explicit)
    normalize_model_id(model_id)
    return settings.repo_id


def voice_language_code(voice_id: str | None) -> str | None:
    if not voice_id:
        return None
    first_voice = voice_id.split(",", 1)[0].strip()
    if not first_voice:
        return None
    prefix = first_voice[:2]
    if prefix in {"af", "am"}:
        return "a"
    if prefix in {"bf", "bm"}:
        return "b"
    first = first_voice[0]
    return first if first in {"e", "f", "h", "i", "j", "p", "z"} else None


def normalize_language_code(language: str | None, voice_id: str | None = None) -> str:
    raw = (language or "").strip().lower()
    if raw:
        normalized = LANGUAGE_ALIASES.get(raw)
        if not normalized:
            raise HTTPException(status_code=400, detail=f"Unsupported Kokoro language code: {language}")
        return normalized
    inferred = voice_language_code(voice_id)
    if inferred:
        return inferred
    return LANGUAGE_ALIASES.get(settings.default_language.lower(), "a")


def validate_voice_id(voice: str | None) -> str:
    selected = (voice or settings.default_voice).strip()
    if not selected:
        raise HTTPException(status_code=400, detail="Missing Kokoro voice id.")
    pieces = [piece.strip() for piece in selected.split(",") if piece.strip()]
    if not pieces:
        raise HTTPException(status_code=400, detail="Missing Kokoro voice id.")
    unknown = [piece for piece in pieces if piece not in KOKORO_VOICE_IDS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unsupported Kokoro voice id: {unknown[0]}")
    return ",".join(pieces)


def parse_options(options: str | None) -> dict[str, Any] | None:
    if not options:
        return None
    try:
        parsed = json.loads(options)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="options must be a JSON object.") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="options must be a JSON object.")
    return parsed


def label_from_voice_id(voice_id: str) -> str:
    prefix, _, name = voice_id.partition("_")
    language = VOICE_LANGUAGES.get(prefix, LANGUAGE_LABELS.get(voice_language_code(voice_id) or "", "unknown"))
    return f"{name.replace('_', ' ').title()} ({language})"


settings = Settings()
state = WorkerState(
    provider=settings.provider,
    defaultModel=settings.default_model,
    language=normalize_language_code(settings.default_language, settings.default_voice),
    voice=settings.default_voice,
    repoId=settings.repo_id,
)
_model: Any | None = None
_pipelines: dict[str, Any] = {}
app = FastAPI(title="Local AI Voice Kokoro TTS worker", version="0.1.0")


def load_kokoro_model(request: LoadRequest) -> WorkerState:
    global _model, _pipelines
    if request.provider and request.provider != settings.provider:
        raise HTTPException(status_code=400, detail=f"Unsupported TTS provider: {request.provider}")
    model_id = normalize_model_id(request.model)
    selected_voice = validate_voice_id(settings.default_voice)
    language = normalize_language_code(request.language or settings.default_language, selected_voice)
    device = resolve_device(settings.device)
    repo_id = repo_id_for_model(model_id, request.options)
    set_state("loading", loadedModel=model_id, language=language, voice=selected_voice, device=device, repoId=repo_id, error=None)
    try:
        settings.cache_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("HF_HOME", str(settings.cache_dir / "hf"))
        os.environ.setdefault("HF_HUB_CACHE", str(settings.cache_dir / "hf" / "hub"))
        try:
            from kokoro import KModel
        except ImportError:  # pragma: no cover - compatibility with package internals
            from kokoro.model import KModel

        _model = KModel(repo_id=repo_id).to(device).eval()
        _pipelines = {}
        set_state("loaded", loadedModel=model_id, language=language, voice=selected_voice, device=device, repoId=repo_id, error=None)
        return state
    except Exception as exc:
        _model = None
        _pipelines = {}
        set_state("failed", loadedModel=None, language=language, voice=selected_voice, device=device, repoId=repo_id, error=str(exc))
        raise


def unload_model(clear_cache: bool = True) -> WorkerState:
    global _model, _pipelines
    set_state("unloading")
    _model = None
    _pipelines = {}
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


@app.on_event("startup")
def preload_default_model() -> None:
    if not settings.preload_default:
        return
    load_kokoro_model(LoadRequest(model=settings.default_model, language=settings.default_language))


def get_pipeline(language: str) -> Any:
    if _model is None:
        raise HTTPException(status_code=409, detail="Kokoro model is not loaded.")
    if language not in _pipelines:
        try:
            from kokoro import KPipeline
        except ImportError:  # pragma: no cover - compatibility with package internals
            from kokoro.pipeline import KPipeline

        _pipelines[language] = KPipeline(lang_code=language, repo_id=state.repoId or settings.repo_id, model=_model)
    return _pipelines[language]


def to_numpy_audio(audio: Any) -> Any:
    import numpy as np

    try:
        import torch

        if isinstance(audio, torch.Tensor):
            audio = audio.detach().cpu().numpy()
    except Exception:
        pass
    array = np.asarray(audio)
    if array.ndim > 1:
        array = np.squeeze(array)
    return array.astype("float32", copy=False)


def concatenate_audio(pieces: list[Any], silence_ms: int) -> Any:
    import numpy as np

    if not pieces:
        raise HTTPException(status_code=500, detail="Kokoro returned no audio chunks.")
    arrays = [to_numpy_audio(piece) for piece in pieces]
    if len(arrays) == 1 or silence_ms <= 0:
        return arrays[0]
    silence = np.zeros(max(1, round(SAMPLE_RATE * silence_ms / 1000)), dtype="float32")
    combined: list[Any] = []
    for index, array in enumerate(arrays):
        combined.append(array)
        if index < len(arrays) - 1:
            combined.append(silence)
    return np.concatenate(combined)


def wav_bytes(samples: Any) -> bytes:
    import soundfile as sf

    buffer = io.BytesIO()
    sf.write(buffer, samples, SAMPLE_RATE, format="WAV")
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
                "id": "kokoro-82m",
                "provider": settings.provider,
                "label": "Kokoro 82M",
                "languages": list(LANGUAGE_LABELS.values()),
                "supportsReferenceAudio": False,
                "supportsVoiceCloning": False,
                "supportsLanguageSelection": True,
            }
        ],
    }


@app.post("/model/load")
def model_load(request: LoadRequest) -> dict[str, Any]:
    return load_kokoro_model(request).model_dump()


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
    return load_kokoro_model(request).model_dump()


@app.get("/config")
def config() -> dict[str, Any]:
    return settings.model_dump(mode="json")


@app.get("/voices")
def voices() -> dict[str, Any]:
    return {
        "voices": [
            {
                "id": voice_id,
                "provider": settings.provider,
                "label": label_from_voice_id(voice_id),
                "language": VOICE_LANGUAGES.get(voice_id[:2]) or LANGUAGE_LABELS.get(voice_language_code(voice_id) or ""),
                "referenceAudio": False,
            }
            for voice_id in KOKORO_VOICE_IDS
        ]
    }


@app.post("/speak")
async def speak(
    text: str = Form(...),
    provider: str | None = Form(default=None),
    voice: str | None = Form(default=None),
    language: str | None = Form(default=None),
    model: str | None = Form(default=None),
    speed: float | None = Form(default=None),
    options: str | None = Form(default=None),
    referenceAudioId: str | None = Form(default=None),
    reference_audio_id: str | None = Form(default=None),
    exaggeration: float | None = Form(default=None),
    cfg_weight: float | None = Form(default=None),
    cfgWeight: float | None = Form(default=None),
    temperature: float | None = Form(default=None),
    reference_audio: UploadFile | None = File(default=None),
) -> Response:
    del exaggeration, cfg_weight, cfgWeight, temperature
    global _model
    if provider and provider != settings.provider:
        raise HTTPException(status_code=400, detail=f"Unsupported TTS provider: {provider}")
    if reference_audio is not None or referenceAudioId or reference_audio_id:
        raise HTTPException(status_code=400, detail="Kokoro does not support reference audio or voice cloning.")
    if not text.strip():
        raise HTTPException(status_code=400, detail="Missing required text field.")

    request_options = parse_options(options)
    requested_model = normalize_model_id(model or settings.default_model)
    selected_voice = validate_voice_id(voice or settings.default_voice)
    language_code = normalize_language_code(language, selected_voice)
    if _model is None:
        if not settings.auto_load_default:
            raise HTTPException(status_code=409, detail="TTS model is not loaded.")
        load_kokoro_model(LoadRequest(model=requested_model, language=language_code, options=request_options))
    elif state.loadedModel != requested_model:
        raise HTTPException(
            status_code=409,
            detail=f"Loaded TTS model is {state.loadedModel}; load {requested_model} explicitly before synthesis.",
        )

    pipeline = get_pipeline(language_code)
    effective_speed = speed if speed is not None else settings.default_speed
    logger.info(
        "Generating Kokoro speech chars=%s voice=%s language=%s speed=%s model=%s",
        len(text),
        selected_voice,
        language_code,
        effective_speed,
        state.loadedModel,
    )
    try:
        chunks = list(
            pipeline(
                text.strip(),
                voice=selected_voice,
                speed=effective_speed,
                split_pattern=settings.split_pattern,
            )
        )
    except re.error as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Kokoro split pattern: {settings.split_pattern}") from exc
    audio_chunks = [chunk[2] for chunk in chunks]
    samples = concatenate_audio(audio_chunks, settings.chunk_silence_ms)
    payload = wav_bytes(samples)
    headers = {
        "content-disposition": 'attachment; filename="speech.wav"',
        "x-sample-rate": str(SAMPLE_RATE),
        "x-engine": "kokoro-tts",
        "x-local-ai-voice-engine": "kokoro-tts",
        "x-local-ai-voice-model": str(state.loadedModel),
        "x-local-ai-voice-provider": settings.provider,
        "x-local-ai-voice-voice": selected_voice,
        "x-local-ai-voice-language": language_code,
        "x-local-ai-voice-chunks": str(len(chunks)),
    }
    return Response(content=payload, media_type="audio/wav", headers=headers)
