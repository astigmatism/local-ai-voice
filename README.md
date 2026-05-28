# Local AI Voice Appliance

Local AI Voice is a Node-centric management and API gateway for a local speech appliance running on Ubuntu Server 24.04 LTS inside a VMware ESXi 8.0 virtual machine with one passed-through NVIDIA GPU.

The gateway owns the public API on port `8000`, serves the React management portal, and proxies private Python model workers on localhost:

```text
0.0.0.0:8000  Node/Fastify gateway + portal + compatibility API
127.0.0.1:8001 Chatterbox TTS worker
127.0.0.1:8002 faster-whisper STT worker
```

The default design is GPU-first. `GPU_ONLY=true` is the default, workers use CUDA by default, and selected models should fail clearly when CUDA is unavailable rather than silently falling back to CPU/system RAM.

## Why Fastify instead of NestJS?

The project uses Fastify with TypeScript because it is small, fast, production-friendly, and has first-class multipart/static/OpenAPI plugins. The worker/provider abstraction is intentionally framework-neutral, so the gateway can later move to NestJS without changing the public API or Python workers.

## Repository layout

```text
apps/gateway/                 TypeScript Fastify API gateway
apps/portal/                  React/Vite management portal
packages/shared/              Shared TypeScript API/domain types
workers/stt-fast-whisper/     Private FastAPI STT worker using faster-whisper
workers/tts-chatterbox/       Private FastAPI TTS worker using Chatterbox
stt/                          STT provider/model/runtime metadata scaffolding
tts/                          TTS provider/model/voice/runtime metadata scaffolding
systemd/                      Production service units and env template
scripts/                      Idempotent setup, deployment, smoke-test, and restart scripts
docs/                         Architecture, API, VM, GPU, security, and operations docs
```

## Defaults

| Category | Default |
| --- | --- |
| Public gateway | `0.0.0.0:8000` |
| STT worker | `127.0.0.1:8002` |
| TTS worker | `127.0.0.1:8001` |
| STT provider/model | `fast-whisper` / `large-v3-turbo` |
| TTS provider/model | `chatterbox` / `chatterbox-turbo` |
| Inference mode | GPU-only CUDA by default |
| Production root | `/opt/local-ai-voice` |

## Local development

These commands are for development on a machine with Node.js 24 LTS. Python workers can be run separately on the GPU VM.

```bash
corepack enable
corepack prepare pnpm@10.12.4 --activate
pnpm install
cp .env.example .env
pnpm dev
```

Gateway only:

```bash
pnpm --filter @local-ai-voice/gateway dev
```

Portal only:

```bash
pnpm --filter @local-ai-voice/portal dev
```

Validate the TypeScript workspace:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Production VM deployment overview

Read these first:

1. `docs/vm-setup-esxi8-ubuntu2404.md`
2. `docs/gpu-passthrough.md`
3. `docs/deployment.md`
4. `docs/model-management.md`
5. `docs/security.md`

Typical production flow after Ubuntu and NVIDIA driver verification:

```bash
sudo adduser --system --group --home /opt/local-ai-voice --shell /usr/sbin/nologin local-ai-voice
sudo usermod -aG video,render local-ai-voice
sudo apt-get update && sudo apt-get install -y git rsync curl jq build-essential python3.12-venv python3-pip ffmpeg
sudo mkdir -p /opt/local-ai-voice/app && sudo chown -R local-ai-voice:local-ai-voice /opt/local-ai-voice
sudo -u local-ai-voice git clone <your-repo-url> /opt/local-ai-voice/app
cd /opt/local-ai-voice/app
bash scripts/deploy-local.sh
bash scripts/setup-workers.sh
bash scripts/install-systemd.sh
sudo systemctl start local-ai-voice-stt-worker local-ai-voice-tts-chatterbox local-ai-voice-gateway
```

Then verify:

```bash
curl -fsS http://127.0.0.1:8000/health | jq .
curl -fsS http://127.0.0.1:8000/api/gpu | jq .
curl -fsS http://127.0.0.1:8000/api/models | jq .
```

## Model management

Use the portal or API endpoints:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/models/stt/load \
  -H 'content-type: application/json' \
  -d '{"model":"large-v3-turbo","computeType":"int8_float16"}' | jq .

curl -fsS -X POST http://127.0.0.1:8000/api/models/tts/load \
  -H 'content-type: application/json' \
  -d '{"model":"chatterbox-turbo","language":"en"}' | jq .
```

Soft unload asks the worker to delete model references and clear CUDA caches where possible. Hard unload restarts the worker process through systemd when `ALLOW_SYSTEMD_RESTART=true` and privileges are configured.

## Chatterbox reference WAV quick check

The portal card labeled **Chatterbox reference WAV** uploads a WAV to `/api/tts/reference-audio`, activates it by default, and displays the active reference id. Browser/orchestrator clients can also send a microphone recording if it has already been encoded as a real `.wav` file with an `audio/wav` content type and RIFF/WAVE header; the gateway validates WAV input but does not transcode WebM/Opus or MP4 recordings. The same flow can be checked from the shell:

```bash
# Upload and activate a reference WAV
curl -f -X POST http://127.0.0.1:8000/api/tts/reference-audio \
  -F "file=@./sample-reference.wav" \
  -F "provider=chatterbox" \
  -F "setDefault=true" | jq .

# Confirm active TTS state
curl -f http://127.0.0.1:8000/api/services/tts | jq .activeReferenceAudio

# Generate speech using the active/default reference
curl -f -X POST http://127.0.0.1:8000/api/tts/speak \
  -H "Content-Type: application/json" \
  -d '{"text":"This should use the uploaded reference WAV.","provider":"chatterbox"}' \
  --output out.wav

# Delete an uploaded reference WAV by the safe id returned from upload or /voices
curl -f -X DELETE http://127.0.0.1:8000/api/tts/reference-audio/<reference-id>.wav | jq .
```

For logs, check `journalctl -u local-ai-voice-gateway` and `journalctl -u local-ai-voice-tts-chatterbox`; the TTS worker logs a sanitized reference id when it applies reference audio.

## Compatibility API

The gateway preserves these legacy routes:

- `GET /health`
- `GET /gpu`
- `GET /models`
- `GET /voices`
- `GET /model/default`
- `GET /voice/default`
- `POST /speak`
- `POST /transcribe`
- `POST /v1/audio/transcriptions`

Modern orchestration routes live under `/api/*`. See `docs/api.md` or `/api/docs` on the running gateway. For WAV-based STT checks, see `docs/stt-test-plan.md` or run `scripts/test-transcription.sh /path/to/sample.wav`.

## Rollback

Before cutover, run the Node gateway on a non-production port by setting `PUBLIC_PORT=8080`. Keep the old Python public service disabled only after compatibility testing passes. Rollback is:

```bash
sudo systemctl stop local-ai-voice-gateway
sudo systemctl start local-ai-voice-stt.service
```

If you have already moved the STT worker to localhost-only, restore the previous unit file and bind setting from backup before restarting the legacy service.

## Important risks

- Exact Chatterbox package APIs/checkpoints are version-sensitive. The worker is scaffolded against `chatterbox-tts==0.1.7` and the upstream examples current during this build.
- A 10 GB VRAM GPU is useful but not unlimited. Do not expect STT large models and TTS models to remain resident together in all precision/settings combinations.
- ESXi direct passthrough behavior varies by GPU. Some consumer GPUs reset poorly after VM reboot and may require host reboot.
- This package does not include model weights, virtualenvs, `node_modules`, caches, generated audio, or secrets.
