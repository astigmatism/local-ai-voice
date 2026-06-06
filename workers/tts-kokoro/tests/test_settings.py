from app.main import normalize_language_code, validate_voice_id, voice_language_code


def test_normalizes_common_language_aliases() -> None:
    assert normalize_language_code("en-US") == "a"
    assert normalize_language_code("en-gb") == "b"
    assert normalize_language_code("pt-BR") == "p"
    assert normalize_language_code("zh") == "z"


def test_infers_language_from_voice() -> None:
    assert voice_language_code("af_heart") == "a"
    assert voice_language_code("bf_emma") == "b"
    assert voice_language_code("jf_alpha") == "j"
    assert normalize_language_code(None, "zf_xiaoxiao") == "z"


def test_rejects_unknown_voice_id() -> None:
    try:
        validate_voice_id("../voice.pt")
    except Exception as exc:  # FastAPI HTTPException is sufficient here without importing it.
        assert "Unsupported Kokoro voice id" in str(exc)
    else:
        raise AssertionError("expected voice validation to reject path-like input")
