#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  stt)
    sudo systemctl restart local-ai-voice-stt-worker.service
    ;;
  tts)
    sudo systemctl restart local-ai-voice-tts-chatterbox.service
    ;;
  *)
    echo "Usage: $0 stt|tts" >&2
    exit 2
    ;;
esac
