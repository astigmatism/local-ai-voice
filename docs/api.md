# API

The Node gateway exposes compatibility routes at the root and modern routes under `/api`. OpenAPI UI is available at `/api/docs` on the running gateway.

## Compatibility routes

### `GET /health`

Returns gateway and worker health in a legacy-friendly shape.

### `GET /gpu`

Returns NVIDIA GPU status from the gateway host via `nvidia-smi`.

### `GET /models`

Returns STT and TTS model catalogs plus the legacy STT default/active model fields. TTS catalog entries include both `chatterbox` and `kokoro`.

### `GET /voices`

Returns voice/reference descriptors for the active TTS provider. Add `?provider=kokoro` to list Kokoro built-in voices. Uploaded Chatterbox reference WAV descriptors include `canDelete: true` and a `deleteUrl` pointing at the safe delete route.

### `GET /model/default`

Returns the configured default STT model.

### `GET /voice/default`

Returns the configured default TTS voice/model placeholder.

### `POST /speak`

Compatibility TTS endpoint.

Content types:

- `multipart/form-data`
- JSON is accepted by the modern route and also by the gateway compatibility handler.

Fields:

| Field | Required | Description |
| --- | --- | --- |
| `text` | yes | Text to synthesize. |
| `voice` | no | Voice/reference id when supported. If it is an uploaded reference id ending in `.wav`, the gateway validates it before forwarding. |
| `referenceId` / `referenceAudioId` | no | Stable reference WAV id returned by `/api/tts/reference-audio`. Overrides the active default reference. |
| `reference_audio` | no | One-request uploaded WAV reference clip. Overrides both `referenceId` and the active default. |
| `speed` | no | Forwarded if worker/model supports it. |
| `exaggeration` | no | Chatterbox-style control where supported. |
| `cfg_weight` | no | Chatterbox-style control where supported. |
| `temperature` | no | Sampling control where supported. |
| `language` | no | Required for some multilingual use. |
| `model` | no | Must match currently loaded model unless worker autoloads it. |
| `provider` | no | `chatterbox` or `kokoro`; if omitted, the configured default provider/model is used. |

Response:

- `200 OK`
- `content-type: audio/wav`
- `content-disposition: attachment; filename="speech.wav"`

Example:

```bash
curl -fsS -X POST http://127.0.0.1:8000/speak \
  -F text='Hello world' \
  --output speech.wav
```

### `POST /transcribe`

Compatibility STT endpoint.

Content type: `multipart/form-data`.

Fields:

| Field | Required | Description |
| --- | --- | --- |
| `file` / `audio` / `audio_file` / `audioFile` / `upload` | yes | Audio file. WAV, MP3, FLAC, OGG, M4A/MP4, AAC, Opus, WebM (`audio/webm` / `video/webm`), and `application/octet-stream` accepted. |
| `model` | no | Requested model. Must match loaded model unless worker autoloads default. |
| `language` | no | Language hint. |
| `vad_filter` / `vadFilter` | no | Boolean VAD toggle. |
| `min_silence_duration_ms` / `minSilenceDurationMs` | no | VAD silence threshold. |
| `beam_size` / `beamSize` | no | Beam search size. |
| `word_timestamps` / `wordTimestamps` | no | Boolean. |

Response includes:

```json
{
  "filename": "sample.wav",
  "model": "large-v3-turbo",
  "default_model": "large-v3-turbo",
  "active_model": "large-v3-turbo",
  "language": "en",
  "language_probability": 0.98,
  "vad_filter": true,
  "min_silence_duration_ms": 1000,
  "transcript": "...",
  "segments": []
}
```


### `POST /v1/audio/transcriptions` and `POST /audio/transcriptions`

OpenAI-style STT compatibility endpoint for orchestration tools that expect an audio transcription route.

Content type: `multipart/form-data`.

Fields:

| Field | Required | Description |
| --- | --- | --- |
| `file` | yes | Audio file. |
| `model` | no | `whisper-1`, `gpt-4o-transcribe`, and `gpt-4o-mini-transcribe` are accepted and mapped to the configured local STT default. Other model values are forwarded. |
| `language` | no | Language hint. |
| `response_format` / `responseFormat` | no | `json`, `verbose_json`, `text`, `srt`, or `vtt`. Defaults to `json`. |
| `vad_filter` / `vadFilter` | no | Boolean VAD toggle. |
| `min_silence_duration_ms` / `minSilenceDurationMs` | no | VAD silence threshold. |

Example:

```bash
curl -fsS -X POST http://127.0.0.1:8000/v1/audio/transcriptions \
  -F file=@sample.wav \
  -F model=whisper-1 \
  -F response_format=verbose_json | jq .
```

## Modern routes

### `GET /api/health`

Returns overall health, GPU state, and both worker states.

### `GET /api/system`

Returns Node version, OS memory/load, configured paths, disk usage, and port configuration.

### `GET /api/gpu`

Returns:

```json
{
  "available": true,
  "checkedAt": "2026-05-26T00:00:00.000Z",
  "devices": [
    {
      "index": 0,
      "name": "NVIDIA ...",
      "driverVersion": "...",
      "memoryTotalMiB": 10240,
      "memoryUsedMiB": 1234,
      "memoryFreeMiB": 9000,
      "utilizationGpuPercent": 10,
      "temperatureC": 55
    }
  ]
}
```

### `GET /api/services`

Returns STT health, active/default TTS health, and a `ttsProviders` array with Chatterbox/Kokoro provider states. The TTS object also includes `activeReferenceAudio` when a Chatterbox reference WAV is configured and active.

### `GET /api/services/stt`

Returns STT worker health.

### `GET /api/services/tts`

Returns TTS worker health plus the active Chatterbox reference metadata. Add `?provider=kokoro` to inspect Kokoro instead of the active/default TTS provider:

```json
{
  "ok": true,
  "provider": "chatterbox",
  "state": "loaded",
  "activeReferenceAudio": {
    "provider": "chatterbox",
    "referenceId": "reference-2026-05-27T00-00-00-000Z-uuid.wav",
    "filename": "sample-reference.wav",
    "contentType": "audio/wav",
    "sizeBytes": 123456,
    "active": true,
    "createdAt": "2026-05-27T00:00:00.000Z"
  }
}
```

### `GET /api/models`

Returns both STT and TTS catalogs, plus `ttsProviders` metadata describing model IDs, default model/voice, capabilities, worker URL, and systemd service for `chatterbox` and `kokoro`.

### `GET /api/models/stt`

Returns STT catalog and worker model status.

### `GET /api/models/tts`

Returns the TTS catalog and provider model status. Add `?provider=kokoro` to filter models/status to Kokoro. The response also includes a `statuses` map keyed by provider.

### `POST /api/models/stt/load`

Request:

```json
{
  "provider": "fast-whisper",
  "model": "large-v3-turbo",
  "computeType": "int8_float16",
  "options": {}
}
```

### `POST /api/models/stt/unload`

Request:

```json
{
  "strategy": "soft",
  "clearCache": true
}
```

`strategy` may be `soft` or `hard`. Hard restarts require additional systemd privileges.

### `POST /api/models/tts/load`

Request:

```json
{
  "provider": "kokoro",
  "model": "kokoro-82m",
  "language": "a",
  "options": {}
}
```

### `POST /api/models/tts/unload`

Same shape as STT unload, with an optional `provider` field. Hard unload restarts the provider-specific worker service when enabled: `local-ai-voice-tts-chatterbox.service` or `local-ai-voice-tts-kokoro.service`.

### `POST /api/stt/transcribe`

Modern STT route. Same multipart behavior as `/transcribe`, but returns camelCase fields. The gateway accepts both `file` and `audio` file fields, normalizes snake_case/camelCase option aliases, and injects the configured STT default model when the caller omits `model`.

### `POST /api/tts/speak`

Modern TTS route. Supports JSON or multipart. Returns WAV. For Chatterbox, the gateway applies reference audio in this priority order:

1. A multipart `reference_audio`, `reference`, or `voice` file on the current request.
2. An explicit `referenceId`, `referenceAudioId`, `reference_id`, or `reference_audio_id`.
3. The active/default reference WAV stored in `/api/config`.

JSON example using the active/default reference:

```bash
curl -f -X POST http://127.0.0.1:8000/api/tts/speak \
  -H 'Content-Type: application/json' \
  -d '{"text":"This should use the uploaded reference WAV.","provider":"chatterbox"}' \
  --output out.wav
```


JSON example using Kokoro built-in voice packs:

```bash
curl -f -X POST http://127.0.0.1:8000/api/tts/speak \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello from Kokoro.","provider":"kokoro","model":"kokoro-82m","voice":"af_heart","language":"a","speed":1.0}' \
  --output kokoro.wav
```

For Kokoro, `reference_audio`, `referenceId`, and reference-style `.wav` `voice` values are rejected because Kokoro uses named built-in voices.

JSON example overriding the active reference:

```json
{
  "text": "Test speech with my uploaded reference voice.",
  "provider": "chatterbox",
  "model": "chatterbox-turbo",
  "referenceId": "reference-2026-05-27T00-00-00-000Z-uuid.wav",
  "settings": {
    "speed": 1.0,
    "exaggeration": 0.5,
    "cfgWeight": 0.5,
    "temperature": 0.8,
    "language": "en"
  }
}
```

### `GET /api/voices`

Returns voice descriptors for a TTS provider. Without a query parameter, the active/default TTS provider is used.

```bash
curl -fsS http://127.0.0.1:8000/api/voices?provider=kokoro | jq '.voices[0:5]'
curl -fsS http://127.0.0.1:8000/api/voices?provider=chatterbox | jq .
```

Kokoro descriptors are built-in voices such as `af_heart`, `bf_emma`, and `zf_xiaoxiao`. Chatterbox descriptors include the `reference-upload` placeholder plus uploaded reference WAVs.

### `GET /api/tts/providers`

Returns provider descriptors and live health/status for all configured TTS providers. This is the portal's provider-capability source and is useful for checking whether the Kokoro worker on `127.0.0.1:8003` is available.

### `POST /api/tts/reference-audio`

Uploads a Chatterbox reference WAV under the provider voice directory, validates that the upload is a RIFF/WAVE file, and by default makes it the active reference for future speak requests. The upload may come from a selected WAV file or an orchestrator/browser recorder that has already encoded microphone PCM as a real `.wav` file. The gateway accepts and stores WAV; it does not transcode WebM/Opus, MP4/M4A, or other browser recording containers for reference-audio uploads. The response intentionally returns a stable id rather than an absolute server path.

```bash
curl -f -X POST http://127.0.0.1:8000/api/tts/reference-audio \
  -F "file=@./sample-reference.wav" \
  -F "provider=chatterbox" \
  -F "setDefault=true" | jq .
```

Response:

```json
{
  "ok": true,
  "provider": "chatterbox",
  "referenceId": "reference-2026-05-27T00-00-00-000Z-uuid.wav",
  "id": "reference-2026-05-27T00-00-00-000Z-uuid.wav",
  "filename": "sample-reference.wav",
  "contentType": "audio/wav",
  "sizeBytes": 123456,
  "active": true,
  "canDelete": true,
  "deleteUrl": "/api/tts/reference-audio/reference-2026-05-27T00-00-00-000Z-uuid.wav"
}
```

Invalid MIME types, non-WAV extensions, non-RIFF/WAVE file headers, traversal-style reference ids, missing files, and unreadable files return explicit 4xx errors.

### `DELETE /api/tts/reference-audio/:referenceId`

Deletes a previously uploaded Chatterbox reference WAV from the provider voice directory. The `referenceId` must be the safe basename returned by the upload or `/voices` response; path traversal and arbitrary file paths are rejected. If the deleted file was the service's active/default reference, the active reference is cleared.

```bash
curl -f -X DELETE \
  http://127.0.0.1:8000/api/tts/reference-audio/reference-2026-05-27T00-00-00-000Z-uuid.wav | jq .
```

Response:

```json
{
  "ok": true,
  "deleted": true,
  "provider": "chatterbox",
  "referenceId": "reference-2026-05-27T00-00-00-000Z-uuid.wav",
  "id": "reference-2026-05-27T00-00-00-000Z-uuid.wav",
  "filename": "reference-2026-05-27T00-00-00-000Z-uuid.wav",
  "contentType": "audio/wav",
  "sizeBytes": 123456,
  "activeReferenceCleared": false
}
```

For clients that cannot route dynamic URL segments easily, the same delete operation is also available as `DELETE /api/tts/reference-audio` with a JSON body containing `referenceId`, `referenceAudioId`, or `id`:

```bash
curl -f -X DELETE http://127.0.0.1:8000/api/tts/reference-audio \
  -H 'Content-Type: application/json' \
  -d '{"id":"reference-2026-05-27T00-00-00-000Z-uuid.wav"}' | jq .
```

Missing references return `404`. Unsafe ids such as `../sample.wav` return `400` and are never interpreted as filesystem paths.

### `GET /api/config`

Returns non-secret runtime configuration and mutable defaults.

### `PATCH /api/config/stt`

Request:

```json
{
  "defaultModel": "medium",
  "computeType": "int8_float16"
}
```

### `PATCH /api/config/tts`

Request:

```json
{
  "defaultModel": "chatterbox-multilingual",
  "language": "fr",
  "activeReferenceId": "reference-2026-05-27T00-00-00-000Z-uuid.wav"
}
```

Set `activeReferenceId` to `null` to clear the default Chatterbox reference.

### `GET /api/logs`

Returns recent file log entries from `/opt/local-ai-voice/logs`. Systemd journal remains the primary production log source.

## Worker-only private API

Workers implement the private contract documented in `docs/architecture.md`. Do not expose worker ports publicly.
