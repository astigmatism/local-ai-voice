# TTS provider workspace

This directory defines the source-controlled provider/model/voice/runtime metadata for text-to-speech. Model weights, caches, generated WAVs, and reference voices are not committed.

- `providers/chatterbox`: default implementation.
- `providers/kokoro-placeholder`: reserved slot for a future high-speed TTS provider.
- `models/`: model metadata only.
- `voices/`: source layout placeholder for reference clips; production clips live under `/opt/local-ai-voice/voices`.
