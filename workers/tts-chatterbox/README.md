# TTS worker: Chatterbox

Private FastAPI worker for Chatterbox text-to-speech. The Node gateway is the public API and this worker binds to `127.0.0.1:8001` by default.

The worker supports the provider/model abstraction used by the gateway:

- `chatterbox-turbo`
- `chatterbox`
- `chatterbox-multilingual`

Exact upstream Chatterbox APIs can shift; keep the worker venv pinned and test model loading after upgrading `chatterbox-tts`.
