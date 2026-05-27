from pathlib import Path

import pytest
from fastapi import HTTPException

from app import main
from app.main import Settings


def test_default_settings_are_gpu_first():
    settings = Settings()
    assert settings.gpu_only is True
    assert settings.device == "cuda"
    assert settings.default_model == "chatterbox-turbo"


def test_missing_reference_audio_id_fails_clearly(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(main.settings, "voice_dir", tmp_path)
    with pytest.raises(HTTPException) as exc:
        main.safe_voice_path("missing.wav")
    assert exc.value.status_code == 404
    assert "not found" in str(exc.value.detail).lower()


def test_reference_audio_id_rejects_path_traversal(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(main.settings, "voice_dir", tmp_path)
    with pytest.raises(HTTPException) as exc:
        main.safe_voice_path("../outside.wav")
    assert exc.value.status_code == 400
    assert "invalid reference audio id" in str(exc.value.detail).lower()
