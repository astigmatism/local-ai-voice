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

mime_type_for_file() {
  case "${1##*.}" in
    wav|WAV) echo "audio/wav" ;;
    webm|WEBM) echo "audio/webm" ;;
    mp3|MP3) echo "audio/mpeg" ;;
    flac|FLAC) echo "audio/flac" ;;
    ogg|OGG|opus|OPUS) echo "audio/ogg" ;;
    m4a|M4A|mp4|MP4) echo "audio/mp4" ;;
    aac|AAC) echo "audio/aac" ;;
    *) echo "audio/wav" ;;
  esac
}

AUDIO_MIME_TYPE="${AUDIO_MIME_TYPE:-$(mime_type_for_file "$AUDIO_FILE")}"

if command -v jq >/dev/null 2>&1; then
  JSON_FILTER=(jq .)
else
  JSON_FILTER=(cat)
fi

echo "== Gateway health =="
echo "Audio MIME type: $AUDIO_MIME_TYPE"
curl -fsS "$BASE_URL/api/services/stt" | "${JSON_FILTER[@]}"

echo
echo "== Modern STT route: /api/stt/transcribe =="
curl -fsS -X POST "$BASE_URL/api/stt/transcribe" \
  -F "audio=@${AUDIO_FILE};type=${AUDIO_MIME_TYPE}" \
  -F vadFilter=true \
  -F minSilenceDurationMs=1000 \
  -F wordTimestamps=false | "${JSON_FILTER[@]}"

echo
echo "== Legacy compatibility route: /transcribe =="
curl -fsS -X POST "$BASE_URL/transcribe" \
  -F "file=@${AUDIO_FILE};type=${AUDIO_MIME_TYPE}" \
  -F vad_filter=true \
  -F min_silence_duration_ms=1000 | "${JSON_FILTER[@]}"

echo
echo "== OpenAI-compatible route: /v1/audio/transcriptions =="
curl -fsS -X POST "$BASE_URL/v1/audio/transcriptions" \
  -F "file=@${AUDIO_FILE};type=${AUDIO_MIME_TYPE}" \
  -F model=whisper-1 \
  -F response_format=verbose_json | "${JSON_FILTER[@]}"
