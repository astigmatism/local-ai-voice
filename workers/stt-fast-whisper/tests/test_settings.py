import pytest
from fastapi import HTTPException

from app.main import Settings, resolve_transcribe_options


def test_default_settings_are_gpu_first():
    settings = Settings()
    assert settings.gpu_only is True
    assert settings.device == "cuda"
    assert settings.default_model == "large-v3-turbo"


def test_transcribe_options_accept_camel_case_aliases():
    options = resolve_transcribe_options(
        vadFilter=False,
        minSilenceDurationMs=250,
        beamSize=2,
        wordTimestamps=True,
    )
    assert options == {
        "vad_filter": False,
        "min_silence_duration_ms": 250,
        "beam_size": 2,
        "word_timestamps": True,
    }


def test_transcribe_options_prefer_snake_case_over_camel_case():
    options = resolve_transcribe_options(
        vad_filter=True,
        vadFilter=False,
        min_silence_duration_ms=500,
        minSilenceDurationMs=250,
        beam_size=3,
        beamSize=1,
        word_timestamps=False,
        wordTimestamps=True,
    )
    assert options == {
        "vad_filter": True,
        "min_silence_duration_ms": 500,
        "beam_size": 3,
        "word_timestamps": False,
    }


def test_transcribe_options_reject_invalid_numeric_values():
    with pytest.raises(HTTPException) as beam_error:
        resolve_transcribe_options(beam_size=0)
    assert beam_error.value.status_code == 400

    with pytest.raises(HTTPException) as silence_error:
        resolve_transcribe_options(min_silence_duration_ms=-1)
    assert silence_error.value.status_code == 400
