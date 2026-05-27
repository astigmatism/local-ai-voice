#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${BASE_DIR:-/opt/local-ai-voice}"
APP_DIR="${APP_DIR:-$BASE_DIR/app}"

sudo install -m 0644 "$APP_DIR/systemd/local-ai-voice-gateway.service" /etc/systemd/system/local-ai-voice-gateway.service
sudo install -m 0644 "$APP_DIR/systemd/local-ai-voice-stt-worker.service" /etc/systemd/system/local-ai-voice-stt-worker.service
sudo install -m 0644 "$APP_DIR/systemd/local-ai-voice-tts-chatterbox.service" /etc/systemd/system/local-ai-voice-tts-chatterbox.service
sudo install -m 0644 "$APP_DIR/systemd/local-ai-voice-logrotate" /etc/logrotate.d/local-ai-voice

if [ ! -f "$BASE_DIR/config/local-ai-voice.env" ]; then
  sudo install -m 0640 -o local-ai-voice -g local-ai-voice "$APP_DIR/systemd/local-ai-voice.env.example" "$BASE_DIR/config/local-ai-voice.env"
fi

if [ ! -f "$BASE_DIR/config/worker-libs.env" ]; then
  cat >&2 <<EOF
WARNING: $BASE_DIR/config/worker-libs.env does not exist.

The STT systemd unit loads this optional file to expose Python venv NVIDIA
runtime libraries such as libcublas.so.12 to faster-whisper. If CUDA STT is
enabled, missing this file can cause /transcribe to fail with errors like:

  RuntimeError: Library libcublas.so.12 is not found or cannot be loaded

Run the worker setup script with the same BASE_DIR/APP_DIR before starting
the services, for example:

  BASE_DIR="$BASE_DIR" APP_DIR="$APP_DIR" bash "$APP_DIR/scripts/setup-workers.sh"

EOF
fi

sudo systemctl daemon-reload
sudo systemctl enable local-ai-voice-stt-worker.service local-ai-voice-tts-chatterbox.service local-ai-voice-gateway.service

echo "Installed systemd units. Edit $BASE_DIR/config/local-ai-voice.env before starting services."
