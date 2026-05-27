#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${BASE_DIR:-/opt/local-ai-voice}"
APP_DIR="${APP_DIR:-$BASE_DIR/app}"
PYTHON_BIN="${PYTHON_BIN:-python3.12}"
PYTORCH_CUDA_INDEX_URL="${PYTORCH_CUDA_INDEX_URL:-https://download.pytorch.org/whl/cu128}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python3"
fi

STT_VENV="$BASE_DIR/workers/stt/.venv"
TTS_VENV="$BASE_DIR/workers/tts/.venv"

create_venv() {
  local venv_path="$1"
  if [ ! -x "$venv_path/bin/python" ]; then
    "$PYTHON_BIN" -m venv "$venv_path"
  fi
  "$venv_path/bin/python" -m pip install --upgrade pip setuptools wheel
}

create_venv "$STT_VENV"
"$STT_VENV/bin/pip" install -r "$APP_DIR/workers/stt-fast-whisper/requirements.txt"

mkdir -p "$BASE_DIR/config"
STT_LD_LIBRARY_PATH="$($STT_VENV/bin/python - <<'PYLIBS'
import os
paths = []
try:
    import nvidia.cublas.lib
    paths.append(os.path.dirname(nvidia.cublas.lib.__file__))
except Exception:
    pass
try:
    import nvidia.cudnn.lib
    paths.append(os.path.dirname(nvidia.cudnn.lib.__file__))
except Exception:
    pass
print(":".join(paths))
PYLIBS
)"
if [ -n "$STT_LD_LIBRARY_PATH" ]; then
  printf 'LD_LIBRARY_PATH=%s\n' "$STT_LD_LIBRARY_PATH" > "$BASE_DIR/config/worker-libs.env"
fi

create_venv "$TTS_VENV"
"$TTS_VENV/bin/pip" install torch torchaudio --index-url "$PYTORCH_CUDA_INDEX_URL"
"$TTS_VENV/bin/pip" install -r "$APP_DIR/workers/tts-chatterbox/requirements.txt"

echo "Worker virtual environments are ready."
