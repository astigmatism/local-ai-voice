#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-local-ai-voice-source.zip}"
zip -r "$OUT" . \
  -x 'node_modules/*' \
  -x '*/node_modules/*' \
  -x '.git/*' \
  -x '*/.venv/*' \
  -x '*/dist/*' \
  -x 'models/*' \
  -x 'cache/*' \
  -x 'uploads/*' \
  -x 'output/*' \
  -x 'logs/*'

echo "Wrote $OUT"
