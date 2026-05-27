#!/usr/bin/env bash
set -euo pipefail

python3 -m compileall -q workers/stt-fast-whisper/app workers/tts-chatterbox/app

if [ -x "workers/stt-fast-whisper/.venv/bin/pytest" ]; then
  (cd workers/stt-fast-whisper && .venv/bin/pytest)
fi
if [ -x "workers/tts-chatterbox/.venv/bin/pytest" ]; then
  (cd workers/tts-chatterbox && .venv/bin/pytest)
fi

echo "Worker syntax checks passed. Install worker venvs to run full worker tests."
