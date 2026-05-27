#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/astigmatism/local-ai-voice}"
SERVICE_NAME="${SERVICE_NAME:-local-ai-voice-api.service}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"

echo "== Local AI Voice server update =="
echo "App dir: $APP_DIR"
echo "Service: $SERVICE_NAME"
echo "Branch: $BRANCH"
echo

echo "== Verifying git working tree =="
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean on the server."
  echo "Refusing to overwrite local changes."
  git status --short
  exit 1
fi

echo
echo "== Fetching latest source =="
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo
echo "== Checking Node tooling =="
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed."
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "Error: corepack is not installed or not available."
  exit 1
fi

corepack enable

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm is not available after enabling corepack."
  exit 1
fi

echo "node: $(node --version)"
echo "pnpm: $(pnpm --version)"

echo
echo "== Installing dependencies =="
pnpm install --frozen-lockfile

echo
echo "== Running checks =="

if pnpm run | grep -q '^  lint'; then
  pnpm lint
else
  echo "No lint script found; skipping lint."
fi

if pnpm run | grep -q '^  typecheck'; then
  pnpm typecheck
else
  echo "No typecheck script found; skipping typecheck."
fi

if pnpm run | grep -q '^  test'; then
  pnpm test
else
  echo "No test script found; skipping tests."
fi

if pnpm run | grep -q '^  build'; then
  pnpm build
else
  echo "No build script found; skipping build."
fi

echo
echo "== Restarting service =="
sudo systemctl restart "$SERVICE_NAME"

echo
echo "== Service status =="
systemctl --no-pager --full status "$SERVICE_NAME"

echo
echo "== Listening ports =="
ss -tulpn | grep -E ':8000|:8001|:8002|:8010' || true

echo
echo "Update complete."
