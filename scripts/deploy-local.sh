#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${BASE_DIR:-/opt/local-ai-voice}"
APP_DIR="${APP_DIR:-$BASE_DIR/app}"
APP_USER="${APP_USER:-local-ai-voice}"
APP_GROUP="${APP_GROUP:-local-ai-voice}"

bash scripts/create-directories.sh
SRC_DIR="$(pwd -P)"
DEST_DIR="$(cd "$APP_DIR" && pwd -P)"
if [ "$SRC_DIR" != "$DEST_DIR" ]; then
  sudo rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .venv \
    --exclude dist \
    ./ "$APP_DIR/"
  sudo chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
else
  echo "Source is already $APP_DIR; skipping rsync copy."
fi

sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && corepack enable && corepack prepare pnpm@10.12.4 --activate && pnpm install --frozen-lockfile=false && pnpm build"

echo "Deployment copy/build complete at $APP_DIR"
