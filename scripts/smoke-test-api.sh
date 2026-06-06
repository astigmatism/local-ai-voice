#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
GATEWAY_READY_TIMEOUT_SECONDS="${GATEWAY_READY_TIMEOUT_SECONDS:-30}"
SERVICES_READY_TIMEOUT_SECONDS="${SERVICES_READY_TIMEOUT_SECONDS:-60}"

echo "==> Waiting for gateway readiness at ${BASE_URL}/health"

for attempt in $(seq 1 "$GATEWAY_READY_TIMEOUT_SECONDS"); do
  if curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then
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

echo "==> Waiting for voice services readiness"

for attempt in $(seq 1 "$SERVICES_READY_TIMEOUT_SECONDS"); do
  health_json="$(curl -fsS "$BASE_URL/health" 2>/dev/null || true)"

  if [ -n "$health_json" ]; then
    stt_reachable="$(printf '%s' "$health_json" | jq -r '.stt.reachable == true')"
    chatterbox_reachable="$(printf '%s' "$health_json" | jq -r '.ttsProviders[]? | select(.id == "chatterbox") | .reachable == true' | head -n 1)"
    kokoro_reachable="$(printf '%s' "$health_json" | jq -r '.ttsProviders[]? | select(.id == "kokoro") | .reachable == true' | head -n 1)"

    if [ "$stt_reachable" = "true" ] && [ "$chatterbox_reachable" = "true" ] && [ "$kokoro_reachable" = "true" ]; then
      echo "Voice services are reachable."
      break
    fi
  fi

  if [ "$attempt" -eq "$SERVICES_READY_TIMEOUT_SECONDS" ]; then
    echo "ERROR: Voice services did not become ready within ${SERVICES_READY_TIMEOUT_SECONDS} seconds." >&2
    echo "Last /health response:" >&2
    printf '%s\n' "$health_json" | jq . >&2 || printf '%s\n' "$health_json" >&2
    exit 1
  fi

  sleep 1
done

curl -fsS "$BASE_URL/health" | jq .
curl -fsS "$BASE_URL/api/gpu" | jq .
curl -fsS "$BASE_URL/api/models" | jq '.stt[0], .tts[] | select(.provider == "kokoro" or .provider == "chatterbox")'
curl -fsS "$BASE_URL/api/voices?provider=kokoro" | jq '.provider, (.voices | length)'

echo "Basic gateway smoke test completed."