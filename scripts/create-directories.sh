#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${BASE_DIR:-/opt/local-ai-voice}"
APP_USER="${APP_USER:-local-ai-voice}"
APP_GROUP="${APP_GROUP:-local-ai-voice}"

sudo install -d -m 0755 -o "$APP_USER" -g "$APP_GROUP" "$BASE_DIR"
for dir in app config models cache voices uploads output logs workers workers/stt workers/tts workers/tts-kokoro; do
  sudo install -d -m 0775 -o "$APP_USER" -g "$APP_GROUP" "$BASE_DIR/$dir"
done

sudo install -d -m 0775 -o "$APP_USER" -g "$APP_GROUP" \
  "$BASE_DIR/cache/stt/fast-whisper" \
  "$BASE_DIR/cache/tts/chatterbox" \
  "$BASE_DIR/cache/tts/kokoro" \
  "$BASE_DIR/voices/chatterbox" \
  "$BASE_DIR/uploads/stt" \
  "$BASE_DIR/output/tts" \
  "$BASE_DIR/logs/gateway" \
  "$BASE_DIR/logs/workers"

echo "Created runtime directories under $BASE_DIR"
