#!/usr/bin/env bash
set -euo pipefail

journalctl -u local-ai-voice-gateway.service -u local-ai-voice-stt-worker.service -u local-ai-voice-tts-chatterbox.service -f
