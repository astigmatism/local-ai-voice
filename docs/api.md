# API

The Node gateway exposes compatibility routes at the root and modern routes under `/api`. OpenAPI UI is available at `/api/docs` on the running gateway.

## Compatibility routes

### `GET /health`

Returns gateway and worker health in a legacy-friendly shape.

### `GET /gpu`

Returns NVIDIA GPU status from the gateway host via `nvidia-smi`.

### `GET /models`

Returns STT and TTS model catalogs plus the legacy STT default/active model fields.

### `GET /voices`

Returns voice/reference descriptors. Currently includes the Chatterbox reference-upload placeholder.

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
| `voice` | no | Voice/reference id when supported. |
| `reference_audio` | no | Uploaded WAV reference clip. |
| `speed` | no | Forwarded if worker/model supports it. |
| `exaggeration` | no | Chatterbox-style control where supported. |
| `cfg_weight` | no | Chatterbox-style control where supported. |
| `temperature` | no | Sampling control where supported. |
| `language` | no | Required for some multilingual use. |
| `model` | no | Must match currently loaded model unless worker autoloads it. |

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
| `file` | yes | Audio file. WAV, MP3, FLAC, OGG, and common audio content types accepted. |
| `model` | no | Requested model. Must match loaded model unless worker autoloads default. |
| `language` | no | Language hint. |
| `vad_filter` | no | Boolean VAD toggle. |
| `min_silence_duration_ms` | no | VAD silence threshold. |
| `word_timestamps` | no | Boolean. |

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

Returns both worker health objects.

### `GET /api/services/stt`

Returns STT worker health.

### `GET /api/services/tts`

Returns TTS worker health.

### `GET /api/models`

Returns both STT and TTS catalogs.

### `GET /api/models/stt`

Returns STT catalog and worker model status.

### `GET /api/models/tts`

Returns TTS catalog and worker model status.

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
  "provider": "chatterbox",
  "model": "chatterbox-turbo",
  "language": "en",
  "options": {}
}
```

### `POST /api/models/tts/unload`

Same shape as STT unload.

### `POST /api/stt/transcribe`

Modern STT route. Same multipart behavior as `/transcribe`, but returns camelCase fields.

### `POST /api/tts/speak`

Modern TTS route. Supports JSON or multipart. Returns WAV.

### `POST /api/tts/reference-audio`

Uploads a reference WAV to the voice directory.

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/tts/reference-audio \
  -F file=@voice-reference.wav | jq .
```

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
  "language": "fr"
}
```

### `GET /api/logs`

Returns recent file log entries from `/opt/local-ai-voice/logs`. Systemd journal remains the primary production log source.

## Worker-only private API

Workers implement the private contract documented in `docs/architecture.md`. Do not expose worker ports publicly.
