# STT provider workspace

This directory defines the source-controlled provider/model/runtime metadata for speech-to-text. Production model weights and caches live outside Git under `/opt/local-ai-voice/{models,cache,uploads,logs}`.

- `providers/`: provider descriptors and implementation notes.
- `models/`: model catalog metadata only, not weights.
- `runtime/`: venv/container metadata and install notes.
- `cache/`, `uploads/`, `logs/`: placeholders for layout documentation only.
