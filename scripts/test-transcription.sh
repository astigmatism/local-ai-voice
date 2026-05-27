#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
AUDIO_FILE="${1:-}"

if [ -z "$AUDIO_FILE" ]; then
  echo "Usage: BASE_URL=http://127.0.0.1:8000 $0 /path/to/sample.wav" >&2
  exit 2
fi

if [ ! -f "$AUDIO_FILE" ]; then
  echo "Audio file not found: $AUDIO_FILE" >&2
  exit 2
fi

if command -v jq >/dev/null 2>&1; then
  JSON_FILTER=(jq .)
else
  JSON_FILTER=(cat)
fi

echo "== Gateway health =="
curl -fsS "$BASE_URL/api/services/stt" | "${JSON_FILTER[@]}"

echo
echo "== Modern STT route: /api/stt/transcribe =="
curl -fsS -X POST "$BASE_URL/api/stt/transcribe" \
  -F "audio=@${AUDIO_FILE};type=audio/wav" \
  -F vadFilter=true \
  -F minSilenceDurationMs=1000 \
  -F wordTimestamps=false | "${JSON_FILTER[@]}"

echo
echo "== Legacy compatibility route: /transcribe =="
curl -fsS -X POST "$BASE_URL/transcribe" \
  -F "file=@${AUDIO_FILE};type=audio/wav" \
  -F vad_filter=true \
  -F min_silence_duration_ms=1000 | "${JSON_FILTER[@]}"

echo
echo "== OpenAI-compatible route: /v1/audio/transcriptions =="
curl -fsS -X POST "$BASE_URL/v1/audio/transcriptions" \
  -F "file=@${AUDIO_FILE};type=audio/wav" \
  -F model=whisper-1 \
  -F response_format=verbose_json | "${JSON_FILTER[@]}"
