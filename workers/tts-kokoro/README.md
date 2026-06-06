# Kokoro TTS worker

Private FastAPI worker for Kokoro TTS. It is intended to run on localhost, separately from the Node gateway and separately from the Chatterbox worker.

Default bind address: `127.0.0.1:8003`.

## Install

Install system prerequisites first:

```bash
sudo apt-get update
sudo apt-get install -y espeak-ng libsndfile1
```

Create the worker virtual environment and install CUDA PyTorch plus Kokoro dependencies through the repository setup script:

```bash
BASE_DIR=/opt/local-ai-voice bash scripts/setup-workers.sh
```

The setup script installs `kokoro==0.9.4`, `soundfile`, and `misaki[ja,zh]` in `workers/tts-kokoro/.venv`. Kokoro downloads model and voice assets to the Hugging Face cache on first use; do not commit those files.

## Environment

Common settings:

- `KOKORO_TTS_WORKER_URL=http://127.0.0.1:8003` for the gateway.
- `KOKORO_TTS_MODEL=kokoro-82m`.
- `KOKORO_TTS_VOICE=af_heart`.
- `KOKORO_TTS_DEVICE=cuda`.
- `KOKORO_REPO_ID=hexgrad/Kokoro-82M`.
- `KOKORO_TTS_PRELOAD_DEFAULT=false`.

`GPU_ONLY=true` requires `KOKORO_TTS_DEVICE=cuda` and fails clearly if CUDA is not visible. The worker does not silently fall back to CPU in GPU-only mode.

## API

The gateway proxies to these private worker routes:

- `GET /health`
- `GET /model/status`
- `POST /model/load`
- `POST /model/unload`
- `GET /voices`
- `POST /speak`

`POST /speak` accepts multipart form fields such as `text`, `voice`, `language`, `model`, `speed`, and `options`. Reference audio is rejected because Kokoro uses built-in voice packs rather than Chatterbox-style voice cloning.
