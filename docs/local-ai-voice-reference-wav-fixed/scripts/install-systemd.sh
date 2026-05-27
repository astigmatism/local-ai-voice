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

sudo systemctl daemon-reload
sudo systemctl enable local-ai-voice-stt-worker.service local-ai-voice-tts-chatterbox.service local-ai-voice-gateway.service

echo "Installed systemd units. Edit $BASE_DIR/config/local-ai-voice.env before starting services."
