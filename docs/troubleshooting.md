# Troubleshooting

## `nvidia-smi` not found

Install the NVIDIA driver:

```bash
sudo ubuntu-drivers devices
sudo ubuntu-drivers install
sudo reboot
```

Then:

```bash
which nvidia-smi
nvidia-smi
```

## `lspci` sees NVIDIA but `nvidia-smi` fails

Check Secure Boot and kernel logs:

```bash
mokutil --sb-state || true
journalctl -k -b | grep -iE 'nvidia|nouveau|secure|module' | tail -100
lsmod | grep -E 'nvidia|nouveau'
```

Likely causes:

- Secure Boot blocked the NVIDIA module.
- Nouveau grabbed the device.
- Driver branch does not support the GPU.
- GPU reset issue after passthrough VM reboot.

## Worker says GPU unavailable

STT uses both `nvidia-smi` and CTranslate2 CUDA visibility. Check:

```bash
source /opt/local-ai-voice/config/worker-libs.env 2>/dev/null || true
/opt/local-ai-voice/workers/stt/.venv/bin/python - <<'PY'
import ctranslate2
print(ctranslate2.get_cuda_device_count())
PY
```

TTS uses PyTorch CUDA visibility. Check:

```bash
/opt/local-ai-voice/workers/tts/.venv/bin/python - <<'PY'
import torch
print(torch.__version__)
print(torch.cuda.is_available())
print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')
PY
```

If these fail but `nvidia-smi` works, reinstall worker dependencies with `scripts/setup-workers.sh` and confirm the CUDA wheel index matches your driver capability.

## CTranslate2 cannot find cuDNN/cuBLAS

The setup script writes `/opt/local-ai-voice/config/worker-libs.env`. Confirm systemd loads it:

```bash
cat /opt/local-ai-voice/config/worker-libs.env
systemctl cat local-ai-voice-stt-worker
sudo systemctl restart local-ai-voice-stt-worker
journalctl -u local-ai-voice-stt-worker -n 100 --no-pager
```

## Out of memory on GPU

Symptoms:

- Worker `/model/load` returns failed.
- `nvidia-smi` shows high VRAM usage from another worker.
- PyTorch/CUDA OOM messages in journal.

Actions:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/models/tts/unload -H 'content-type: application/json' -d '{"strategy":"soft"}' | jq .
curl -fsS -X POST http://127.0.0.1:8000/api/models/stt/unload -H 'content-type: application/json' -d '{"strategy":"soft"}' | jq .
nvidia-smi
```

If memory remains allocated:

```bash
sudo systemctl restart local-ai-voice-stt-worker local-ai-voice-tts-chatterbox
```

Then choose a smaller model or lower-memory compute type.

## Portal loads but API fails

Check gateway logs and CORS/auth config:

```bash
journalctl -u local-ai-voice-gateway -n 200 --no-pager
curl -v http://127.0.0.1:8000/api/health
```

If `AUTH_ENABLED=true`, browser requests need Basic Auth or a reverse proxy session layer.

## Port conflict on 8000

Find listener:

```bash
sudo ss -ltnp | grep ':8000'
```

During migration, set `PUBLIC_PORT=8080` and restart gateway.

## Chatterbox import errors

The Chatterbox package and model APIs are version-sensitive. Check:

```bash
/opt/local-ai-voice/workers/tts/.venv/bin/pip show chatterbox-tts
/opt/local-ai-voice/workers/tts/.venv/bin/python - <<'PY'
from chatterbox.tts_turbo import ChatterboxTurboTTS
from chatterbox.tts import ChatterboxTTS
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
print('chatterbox imports ok')
PY
```

If imports changed upstream, pin a known-good package version or update `workers/tts-chatterbox/app/main.py` class mapping.

## Slow inference

Check that workers did not fall back to CPU:

```bash
curl -fsS http://127.0.0.1:8000/api/services | jq .
nvidia-smi
```

With `GPU_ONLY=true`, a CPU fallback should be reported as unavailable/failed, not silently accepted. If you intentionally set `GPU_ONLY=false`, performance may be much slower and is not the production default.
