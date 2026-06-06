# Operations

## Service control

```bash
sudo systemctl status local-ai-voice-gateway --no-pager
sudo systemctl status local-ai-voice-stt-worker --no-pager
sudo systemctl status local-ai-voice-tts-chatterbox --no-pager

sudo systemctl restart local-ai-voice-gateway
sudo systemctl restart local-ai-voice-stt-worker
sudo systemctl restart local-ai-voice-tts-chatterbox
```

Follow logs:

```bash
bash scripts/tail-logs.sh
```

Or individually:

```bash
journalctl -u local-ai-voice-gateway -n 200 --no-pager
journalctl -u local-ai-voice-stt-worker -n 200 --no-pager
journalctl -u local-ai-voice-tts-chatterbox -n 200 --no-pager
```

## Health checks

```bash
curl -fsS http://127.0.0.1:8000/api/health | jq .
curl -fsS http://127.0.0.1:8000/api/system | jq .
curl -fsS http://127.0.0.1:8000/api/gpu | jq .
curl -fsS http://127.0.0.1:8000/api/services | jq .
```

## GPU monitoring

```bash
watch -n 1 nvidia-smi
nvtop
```

Look for:

- Python worker process VRAM allocation.
- Unexpected CPU fallback symptoms: low GPU utilization and high CPU for inference.
- Memory not dropping after soft unload; use hard restart if needed.

## Disk monitoring

```bash
df -h /opt/local-ai-voice
sudo du -h -d 2 /opt/local-ai-voice/cache /opt/local-ai-voice/voices /opt/local-ai-voice/uploads /opt/local-ai-voice/output | sort -h
```

Clean transient uploads older than seven days:

```bash
sudo find /opt/local-ai-voice/uploads -type f -mtime +7 -delete
```

Clean generated output older than the configured retention policy:

```bash
sudo find /opt/local-ai-voice/output -type f -mtime +2 -delete
```

Do not delete model caches unless you are prepared to re-download them.

## Backups

Back up:

```text
/opt/local-ai-voice/config
/opt/local-ai-voice/app
/opt/local-ai-voice/voices
```

Optionally back up model caches if internet bandwidth is limited:

```text
/opt/local-ai-voice/cache
/opt/local-ai-voice/models
```

Usually exclude:

```text
/opt/local-ai-voice/uploads
/opt/local-ai-voice/output
/opt/local-ai-voice/logs
/opt/local-ai-voice/workers/*/.venv
```

## Updating dependencies

Node:

```bash
cd /opt/local-ai-voice/app
sudo -u local-ai-voice -H bash -lc 'corepack enable && pnpm install --frozen-lockfile=false && pnpm build && pnpm test'
sudo systemctl restart local-ai-voice-gateway
```

Workers:

```bash
cd /opt/local-ai-voice/app
bash scripts/setup-workers.sh
sudo systemctl restart local-ai-voice-stt-worker local-ai-voice-tts-chatterbox
```

When upgrading Chatterbox, test all model variants explicitly before making it the production default.

## Running on a staging port

Set in `/opt/local-ai-voice/config/local-ai-voice.env`:

```text
PUBLIC_PORT=8080
```

Then:

```bash
sudo systemctl restart local-ai-voice-gateway
curl -fsS http://127.0.0.1:8080/api/health | jq .
```

Use this before moving public port `8000` from the legacy service to the Node gateway.

## Rollback checklist

1. Stop gateway.
2. Stop new workers if they conflict with old services.
3. Restore previous unit files/env for legacy service if modified.
4. Start legacy public STT/API service.
5. Verify compatibility routes.

Commands:

```bash
sudo systemctl stop local-ai-voice-gateway
sudo systemctl stop local-ai-voice-stt-worker local-ai-voice-tts-chatterbox
sudo systemctl start local-ai-voice-stt.service
curl -fsS http://127.0.0.1:8000/health | jq .
```

## Operating concurrent Chatterbox and Kokoro

Daily status checks should look at the combined gateway view and the private worker health endpoints:

```bash
curl -f http://127.0.0.1:8000/api/services/tts | jq .
curl -f http://127.0.0.1:8001/health | jq .
curl -f http://127.0.0.1:8003/health | jq .
```

One TTS provider can be unhealthy while the other continues to serve requests. Restart only the failed worker unless you intentionally want a full TTS restart:

```bash
sudo systemctl restart local-ai-voice-tts-chatterbox.service
sudo systemctl restart local-ai-voice-tts-kokoro.service
```

Changing the default provider through `PATCH /api/config/tts` is safe: it only changes fallback routing for providerless `/api/tts/speak` and `/speak` requests and does not unload any provider.
