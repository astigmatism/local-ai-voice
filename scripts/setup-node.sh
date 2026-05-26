#!/usr/bin/env bash
set -euo pipefail

if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack was not found. Install Node.js 24 LTS first." >&2
  exit 1
fi

corepack enable
corepack prepare pnpm@10.12.4 --activate
pnpm install --frozen-lockfile=false
pnpm build
