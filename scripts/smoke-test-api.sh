#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
GATEWAY_READY_TIMEOUT_SECONDS="${GATEWAY_READY_TIMEOUT_SECONDS:-30}"

echo "==> Waiting for gateway readiness at ${BASE_URL}/health"

for attempt in $(seq 1 "$GATEWAY_READY_TIMEOUT_SECONDS"); do
  if curl -fsS "$BASE_URL/health" >/dev/null; then
    echo "Gateway is ready."
    break
  fi

  if [ "$attempt" -eq "$GATEWAY_READY_TIMEOUT_SECONDS" ]; then
    echo "ERROR: Gateway did not become ready within ${GATEWAY_READY_TIMEOUT_SECONDS} seconds." >&2
    echo "Last attempted URL: ${BASE_URL}/health" >&2
    exit 1
  fi

  sleep 1
done

curl -fsS "$BASE_URL/health" | jq .
curl -fsS "$BASE_URL/api/gpu" | jq .
curl -fsS "$BASE_URL/api/models" | jq '.stt[0], .tts[] | select(.provider == "kokoro" or .provider == "chatterbox")'
curl -fsS "$BASE_URL/api/voices?provider=kokoro" | jq '.provider, (.voices | length)'

echo "Basic gateway smoke test completed."