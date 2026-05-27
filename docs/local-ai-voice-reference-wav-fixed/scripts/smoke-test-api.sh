#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"

curl -fsS "$BASE_URL/health" | jq .
curl -fsS "$BASE_URL/api/gpu" | jq .
curl -fsS "$BASE_URL/api/models" | jq '.stt[0], .tts[0]'

echo "Basic gateway smoke test completed."
