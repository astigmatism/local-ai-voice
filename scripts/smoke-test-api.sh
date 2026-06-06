#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"

curl -fsS "$BASE_URL/health" | jq .
curl -fsS "$BASE_URL/api/gpu" | jq .
curl -fsS "$BASE_URL/api/models" | jq '.stt[0], .tts[] | select(.provider == "kokoro" or .provider == "chatterbox")'
curl -fsS "$BASE_URL/api/voices?provider=kokoro" | jq '.provider, (.voices | length)'

echo "Basic gateway smoke test completed."
