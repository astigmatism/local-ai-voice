from app.main import Settings


def test_default_settings_are_gpu_first():
    settings = Settings()
    assert settings.gpu_only is True
    assert settings.device == "cuda"
    assert settings.default_model == "large-v3-turbo"
