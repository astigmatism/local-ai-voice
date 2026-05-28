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


def test_normalize_tts_text_adds_terminal_punctuation():
    assert main.normalize_tts_text("  Hello   world  ") == "Hello world."


def test_prepare_tts_chunks_splits_long_text_at_sentence_boundaries(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(main.settings, "normalize_text", True)
    monkeypatch.setattr(main.settings, "chunk_text", True)
    monkeypatch.setattr(main.settings, "target_chunk_chars", 80)
    monkeypatch.setattr(main.settings, "max_chunk_chars", 120)
    text = "First sentence is short. " + "Second sentence has enough detail to force a separate chunk. " * 3
    chunks = main.prepare_tts_chunks(text)
    assert len(chunks) > 1
    assert all(chunk[-1] in main.TERMINAL_PUNCTUATION for chunk in chunks)
    assert all(len(chunk) <= 120 for chunk in chunks)


def test_prepare_tts_chunks_splits_very_long_sentence_on_word_boundary(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(main.settings, "normalize_text", True)
    monkeypatch.setattr(main.settings, "chunk_text", True)
    monkeypatch.setattr(main.settings, "target_chunk_chars", 90)
    monkeypatch.setattr(main.settings, "max_chunk_chars", 100)
    text = " ".join(["word"] * 60)
    chunks = main.prepare_tts_chunks(text)
    assert len(chunks) > 1
    assert all(len(chunk) <= 101 for chunk in chunks)
    assert all(chunk[-1] in main.TERMINAL_PUNCTUATION for chunk in chunks)
