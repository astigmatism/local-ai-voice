# API compatibility baseline and mapping

The previous VM baseline exposed a public API on port `8000` and a Chatterbox worker on `127.0.0.1:8001`. This implementation maps those compatibility routes through the Node gateway.

## Legacy baseline

- Public STT/API service: `local-ai-voice-stt.service`
- Public bind: `0.0.0.0:8000`
- STT working directory: `/home/astigmatism/ai-services/stt`
- Chatterbox TTS service: `local-ai-voice-tts-chatterbox.service`
- Chatterbox bind: `127.0.0.1:8001`
- Chatterbox working directory: `/home/astigmatism/ai-services/tts-chatterbox`

## New mapping

| Legacy route | New owner | Internal worker |
| --- | --- | --- |
| `GET /health` | Node gateway | STT/TTS health fan-out |
| `GET /gpu` | Node gateway | gateway `nvidia-smi` |
| `GET /models` | Node gateway | catalog + worker state |
| `GET /voices` | Node gateway | voice catalog/reference uploads |
| `GET /model/default` | Node gateway config store | none |
| `GET /voice/default` | Node gateway config store | none |
| `POST /speak` | Node gateway | TTS worker `127.0.0.1:8001` |
| `POST /transcribe` | Node gateway | STT worker `127.0.0.1:8002` |
| `POST /v1/audio/transcriptions` and `POST /audio/transcriptions` | Node gateway | STT worker `127.0.0.1:8002` |

## Compatibility notes

- `/speak` accepts `text`, `voice`, `speed`, `exaggeration`, `cfg_weight`, `temperature`, `language`, and optional `reference_audio`.
- Uploaded reference descriptors from `/voices` include a `deleteUrl`; orchestrators can delete uploaded Chatterbox references with `DELETE /api/tts/reference-audio/:referenceId` or `DELETE /api/tts/reference-audio` plus a JSON id body.
- Reference-audio uploads must already be real WAV files. Browser clients that record in-app should encode microphone PCM to a `.wav`/`audio/wav` RIFF/WAVE payload before calling `/api/tts/reference-audio`; this gateway intentionally does not transcode WebM/Opus or MP4 containers for Chatterbox references.
- `/transcribe` returns legacy snake_case keys while `/api/stt/transcribe` returns modern camelCase keys.
- `/v1/audio/transcriptions` returns OpenAI-style `{ "text": "..." }`, `verbose_json`, `text`, `srt`, or `vtt` responses based on `response_format`.
- Default STT remains `large-v3-turbo`.
- VAD defaults remain enabled with `min_silence_duration_ms=1000`.
- Public port `8000` is preserved after cutover.

## Migration sequence

1. Deploy new gateway on `PUBLIC_PORT=8080`.
2. Verify `/api/health`, `/speak`, `/transcribe`, and `/v1/audio/transcriptions` using test audio.
3. Move the old public STT service off `8000` or stop it.
4. Set new gateway `PUBLIC_PORT=8000`.
5. Restart gateway and repeat compatibility tests.
6. Keep old service files and config for rollback until accepted.
