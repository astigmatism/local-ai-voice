# Deployment on Ubuntu Server 24.04 LTS

This guide assumes Ubuntu Server 24.04 LTS is installed, the VM can reach the internet for package/model downloads, and the passed-through NVIDIA GPU is visible with `lspci`.

## 1. Update the VM

```bash
sudo apt-get update
sudo apt-get full-upgrade -y
sudo reboot
```

## 2. Install base tools

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates curl wget gnupg lsb-release unzip jq git rsync \
  build-essential pkg-config cmake \
  python3 python3.12-venv python3-pip python3-dev \
  ffmpeg sox espeak-ng libsndfile1 pciutils usbutils htop nvtop ufw logrotate
```

`ffmpeg` is useful for test audio conversion even though faster-whisper decodes through PyAV. `espeak-ng` and `libsndfile1` are required by Kokoro/soundfile synthesis support.

## 3. Install Node.js 24 LTS and pnpm

For production systemd services, install Node so `/usr/bin/node` exists. NodeSource is convenient for Ubuntu Server; nvm is fine for local development but less convenient for systemd.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
corepack enable
corepack prepare pnpm@10.12.4 --activate
pnpm -v
```

Expected major Node version: `v24.x`.

## 4. Install NVIDIA driver

Use Ubuntu's driver tool first. Do not guess the branch if you do not know your GPU family.

```bash
sudo ubuntu-drivers devices
sudo ubuntu-drivers install
sudo reboot
```

Verify:

```bash
nvidia-smi
lspci | grep -i nvidia
```

If Secure Boot is enabled, NVIDIA kernel module signing can complicate loading. For an appliance VM, Secure Boot is usually simpler to disable unless you already manage MOK signing.

## 5. CUDA/toolkit decision

You usually do not need the full CUDA toolkit for inference if PyTorch CUDA wheels and the faster-whisper pip NVIDIA libraries satisfy runtime dependencies. Install the toolkit only when you need compiler tools, samples, or a specific CUDA branch.

Minimum inference verification:

```bash
nvidia-smi
python3 - <<'PY'
import subprocess
subprocess.run(['nvidia-smi'], check=True)
print('nvidia-smi ok')
PY
```

Optional full CUDA toolkit path:

```bash
# Follow NVIDIA's Ubuntu 24.04 CUDA repository instructions for your desired branch.
# After installation:
nvcc --version || true
```

## 6. Optional NVIDIA Container Toolkit

This project runs workers in Python virtualenvs by default. Install the NVIDIA Container Toolkit only if you later convert workers to containers.

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
```

## 7. Create service user and directories

```bash
sudo adduser --system --group --home /opt/local-ai-voice --shell /usr/sbin/nologin local-ai-voice
sudo usermod -aG video,render local-ai-voice
sudo install -d -m 0755 -o local-ai-voice -g local-ai-voice /opt/local-ai-voice
```

Clone or copy this repo:

```bash
sudo -u local-ai-voice git clone <your-repo-url> /opt/local-ai-voice/app
cd /opt/local-ai-voice/app
bash scripts/create-directories.sh
```

For a zip upload instead of Git:

```bash
sudo -u local-ai-voice unzip local-ai-voice-appliance.zip -d /opt/local-ai-voice/app
```

## 8. Build Node gateway and portal

```bash
cd /opt/local-ai-voice/app
sudo -u local-ai-voice -H bash -lc 'corepack enable && corepack prepare pnpm@10.12.4 --activate && pnpm install --frozen-lockfile=false && pnpm build'
```

## 9. Prepare Python workers

```bash
cd /opt/local-ai-voice/app
bash scripts/setup-workers.sh
```

This creates:

```text
/opt/local-ai-voice/workers/stt/.venv
/opt/local-ai-voice/workers/tts/.venv
/opt/local-ai-voice/workers/tts-kokoro/.venv
/opt/local-ai-voice/config/worker-libs.env
```

`worker-libs.env` is generated so faster-whisper/CTranslate2 can find pip-installed cuBLAS/cuDNN libraries.

### PyTorch GPU verification

```bash
/opt/local-ai-voice/workers/tts/.venv/bin/python - <<'PY'
import torch
print('chatterbox torch', torch.__version__)
print('cuda available', torch.cuda.is_available())
print('device', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')
PY

/opt/local-ai-voice/workers/tts-kokoro/.venv/bin/python - <<'PY'
import torch
print('kokoro torch', torch.__version__)
print('cuda available', torch.cuda.is_available())
print('device', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')
PY
```

### faster-whisper GPU verification

```bash
source /opt/local-ai-voice/config/worker-libs.env 2>/dev/null || true
/opt/local-ai-voice/workers/stt/.venv/bin/python - <<'PY'
import ctranslate2
print('ct2 cuda devices', ctranslate2.get_cuda_device_count())
PY
```

## 10. Configure environment

Install systemd units and create the env file:

```bash
cd /opt/local-ai-voice/app
bash scripts/install-systemd.sh
sudoedit /opt/local-ai-voice/config/local-ai-voice.env
```

Keep these defaults unless you know why you are changing them:

```text
GPU_ONLY=true
DEFAULT_STT_MODEL=large-v3-turbo
DEFAULT_STT_COMPUTE_TYPE=int8_float16
DEFAULT_TTS_MODEL=chatterbox-turbo
STT_WORKER_URL=http://127.0.0.1:8002
TTS_WORKER_URL=http://127.0.0.1:8001
KOKORO_TTS_WORKER_URL=http://127.0.0.1:8003
KOKORO_TTS_MODEL=kokoro-82m
KOKORO_TTS_VOICE=af_heart
KOKORO_TTS_DEVICE=cuda
```

## 11. Configure firewall

Expose only the gateway by default:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow from 192.168.0.0/16 to any port 8000 proto tcp
sudo ufw enable
sudo ufw status verbose
```

Change `192.168.0.0/16` to your trusted LAN/VPN range.

## 12. Start services

```bash
sudo systemctl start local-ai-voice-stt-worker.service
sudo systemctl start local-ai-voice-tts-chatterbox.service
sudo systemctl start local-ai-voice-tts-kokoro.service
sudo systemctl start local-ai-voice-gateway.service
sudo systemctl status local-ai-voice-gateway.service --no-pager
```

Verify:

```bash
curl -fsS http://127.0.0.1:8000/api/health | jq .
curl -fsS http://127.0.0.1:8000/api/gpu | jq .
curl -fsS http://127.0.0.1:8000/api/models | jq .
```

## 13. API smoke tests

Load STT:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/models/stt/load \
  -H 'content-type: application/json' \
  -d '{"model":"large-v3-turbo","computeType":"int8_float16"}' | jq .
```

Load TTS:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/models/tts/load \
  -H 'content-type: application/json' \
  -d '{"provider":"chatterbox","model":"chatterbox-turbo","language":"en"}' | jq .

# Optional Kokoro provider on the independent port 8003
curl -fsS -X POST http://127.0.0.1:8000/api/models/tts/load \
  -H 'content-type: application/json' \
  -d '{"provider":"kokoro","model":"kokoro-82m","language":"a"}' | jq .
```

Transcribe:

```bash
curl -fsS -X POST http://127.0.0.1:8000/transcribe \
  -F file=@sample.wav \
  -F vad_filter=true \
  -F min_silence_duration_ms=1000 | jq .

./scripts/test-transcription.sh sample.wav
```

Speak:

```bash
curl -fsS -X POST http://127.0.0.1:8000/speak \
  -F text='Hello from the local AI voice appliance.' \
  --output speech.wav
file speech.wav

curl -fsS http://127.0.0.1:8000/api/voices?provider=kokoro | jq '.voices[0:5]'
curl -fsS -X POST http://127.0.0.1:8000/api/tts/speak \
  -H 'content-type: application/json' \
  -d '{"provider":"kokoro","model":"kokoro-82m","voice":"af_heart","language":"a","text":"Hello from Kokoro."}' \
  --output kokoro.wav
```

## 14. Updates

```bash
cd /opt/local-ai-voice/app
sudo -u local-ai-voice git pull --ff-only
sudo -u local-ai-voice -H bash -lc 'corepack enable && pnpm install --frozen-lockfile=false && pnpm build'
bash scripts/setup-workers.sh
sudo systemctl daemon-reload
sudo systemctl restart local-ai-voice-stt-worker local-ai-voice-tts-chatterbox local-ai-voice-gateway
```

## 15. Rollback

Before public cutover, keep legacy units installed and test the new gateway on `PUBLIC_PORT=8080`.

Rollback after gateway cutover:

```bash
sudo systemctl stop local-ai-voice-gateway.service
sudo systemctl stop local-ai-voice-stt-worker.service local-ai-voice-tts-chatterbox.service
sudo systemctl start local-ai-voice-stt.service
```

If you changed the old STT worker to bind localhost only, restore its previous unit/env from backup before starting it.

## Running both TTS workers under systemd

Production deployment installs separate private systemd services for Chatterbox and Kokoro. They should both be enabled when the appliance has enough VRAM headroom:

```bash
sudo systemctl enable --now local-ai-voice-tts-chatterbox.service
sudo systemctl enable --now local-ai-voice-tts-kokoro.service
sudo systemctl enable --now local-ai-voice-gateway.service
```

The gateway remains the only public service. Workers bind to localhost:

```text
0.0.0.0:8000       gateway
127.0.0.1:8001     Chatterbox worker
127.0.0.1:8002     STT worker, if installed
127.0.0.1:8003     Kokoro worker
```

Use `TTS_CHATTERBOX_ENABLED=true` and `TTS_KOKORO_ENABLED=true` to expose both providers through the gateway. Use `TTS_CHATTERBOX_AUTOLOAD=true` and `TTS_KOKORO_AUTOLOAD=true` when both models should warm during worker startup. `TTS_DEFAULT_PROVIDER=chatterbox` or `kokoro` controls only fallback behavior for providerless requests.

Verify the deployed port map:

```bash
curl -f http://127.0.0.1:8000/api/services/tts | jq .
curl -f http://127.0.0.1:8001/health | jq .
curl -f http://127.0.0.1:8003/health | jq .
sudo ss -ltnp | grep -E ':8000|:8001|:8002|:8003'
```
