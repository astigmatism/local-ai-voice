# TTS worker: Chatterbox

Private FastAPI worker for Chatterbox text-to-speech. The Node gateway is the public API and this worker binds to `127.0.0.1:8001` by default.

The worker supports the provider/model abstraction used by the gateway:

- `chatterbox-turbo`
- `chatterbox`
- `chatterbox-multilingual`

Reference audio is received from the gateway either as a safe `referenceAudioId` that resolves under `VOICE_DIR/chatterbox` or as a one-request multipart `reference_audio` upload. The worker validates that reference files are readable RIFF/WAVE files before synthesis, logs only the sanitized reference id, and calls Chatterbox generation with `audio_prompt_path` when a reference is present.

Exact upstream Chatterbox APIs can shift; keep the worker venv pinned and test model loading after upgrading `chatterbox-tts`. If a future Chatterbox package removes `audio_prompt_path` from `generate`, the worker returns a clear provider capability error instead of silently ignoring the reference audio.
