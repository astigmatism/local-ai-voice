# TTS provider workspace

This directory defines the source-controlled provider/model/voice/runtime metadata for text-to-speech. Model weights, caches, generated WAVs, and reference voices are not committed.

- `providers/chatterbox`: default implementation with uploaded/reference WAV support.
- `providers/kokoro`: Kokoro 82M implementation with built-in voice IDs and no reference audio uploads.
- `models/`: model metadata only.
- `voices/`: source layout placeholder for reference clips; production Chatterbox clips live under `/opt/local-ai-voice/voices/chatterbox`.

Runtime caches live under `/opt/local-ai-voice/cache/tts/<provider>`. Kokoro downloads model and voice assets from Hugging Face into the configured cache on first use.
