#!/usr/bin/env bash
set -euo pipefail

SERVICES=(
  "local-ai-voice-gateway.service"
  "local-ai-voice-stt-worker.service"
  "local-ai-voice-tts-chatterbox.service"
)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$ROOT_DIR"

echo "==> Running from: $ROOT_DIR"

if [ ! -d ".git" ]; then
  echo "ERROR: This script must be run from inside the git repository root." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed or not available on PATH." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "ERROR: systemctl is not available. This script is intended for the systemd VM deployment." >&2
  exit 1
fi

echo "==> Stopping services"
for service in "${SERVICES[@]}"; do
  sudo systemctl stop "$service"
done

echo "==> Updating repository"
git fetch --prune
git pull --ff-only

echo "==> Preparing Node/pnpm"
if command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@10.12.4 --activate
else
  echo "ERROR: corepack was not found. Install Node.js 24 first." >&2
  exit 1
fi

echo "==> Installing/updating Node dependencies"
pnpm install --frozen-lockfile=false

echo "==> Running validation"
pnpm verify

echo "==> Running worker syntax checks"
bash scripts/test-workers.sh

echo "==> Restarting services"
for service in "${SERVICES[@]}"; do
  sudo systemctl restart "$service"
done

echo "==> Service status"
for service in "${SERVICES[@]}"; do
  sudo systemctl --no-pager --full status "$service" || true
done

echo "==> Running gateway smoke test"
bash scripts/smoke-test-api.sh

echo "==> Update and restart completed successfully."
