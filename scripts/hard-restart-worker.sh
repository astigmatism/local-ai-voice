#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  stt)
    sudo systemctl restart local-ai-voice-stt-worker.service
    ;;
  tts|tts-chatterbox|chatterbox)
    sudo systemctl restart local-ai-voice-tts-chatterbox.service
    ;;
  tts-kokoro|kokoro)
    sudo systemctl restart local-ai-voice-tts-kokoro.service
    ;;
  *)
    echo "Usage: $0 stt|tts|chatterbox|kokoro" >&2
    exit 2
    ;;
esac
