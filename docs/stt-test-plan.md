# STT test plan

Use this plan with one of the WAV files on your desktop after the gateway and STT worker are running. It also includes a WebM check for browser/MediaRecorder uploads, which commonly arrive as `audio/webm`.

## 1. Confirm service state

```bash
BASE_URL=http://127.0.0.1:8000
curl -fsS "$BASE_URL/api/services/stt" | jq .
curl -fsS "$BASE_URL/api/models/stt" | jq .status
```

Expected result:

- The STT worker responds.
- `state` is either `loaded` or `unloaded`.
- If `GPU_ONLY=true`, `gpuAvailable` should be `true` before transcription can succeed.

## 2. Run the bundled transcription smoke test

```bash
cd /opt/local-ai-voice/app
BASE_URL=http://127.0.0.1:8000 ./scripts/test-transcription.sh "$HOME/Desktop/sample.wav"
# Optional browser-recording check:
BASE_URL=http://127.0.0.1:8000 ./scripts/test-transcription.sh "$HOME/Desktop/browser-recording.webm"
```

The script infers the upload MIME type from the file extension, so `.wav` is sent as `audio/wav` and `.webm` is sent as `audio/webm`. It exercises all supported public STT shapes:

- `POST /api/stt/transcribe` with modern camelCase options and an `audio` file field.
- `POST /transcribe` with legacy snake_case options and a `file` file field.
- Browser MediaRecorder/WebM uploads, including `audio/webm`, are accepted by the gateway and forwarded to the STT worker.
- `POST /v1/audio/transcriptions` and `POST /audio/transcriptions` with `model=whisper-1`, mapped to the configured local STT default.

## 3. Manual curl checks

Modern route:

```bash
curl -fsS -X POST "$BASE_URL/api/stt/transcribe" \
  -F "audio=@$HOME/Desktop/sample.wav;type=audio/wav" \
  -F vadFilter=true \
  -F minSilenceDurationMs=1000 | jq .
```

Legacy route:

```bash
curl -fsS -X POST "$BASE_URL/transcribe" \
  -F "file=@$HOME/Desktop/sample.wav;type=audio/wav" \
  -F vad_filter=true \
  -F min_silence_duration_ms=1000 | jq .
```

OpenAI-compatible route:

```bash
curl -fsS -X POST "$BASE_URL/v1/audio/transcriptions" \
  -F "file=@$HOME/Desktop/sample.wav;type=audio/wav" \
  -F model=whisper-1 \
  -F response_format=verbose_json | jq .
```

Browser/MediaRecorder WebM route:

```bash
curl -fsS -X POST "$BASE_URL/api/stt/transcribe" \
  -F "audio=@$HOME/Desktop/browser-recording.webm;type=audio/webm" \
  -F vadFilter=true \
  -F minSilenceDurationMs=1000 | jq .
```

The gateway should not return `Unsupported audio content type: audio/webm`. If your orchestrator uploads a generic filename like `blob`, the gateway now infers a `.webm` extension from the MIME type before forwarding it.


## 4. Interpret failures

| Symptom | Likely area | What to check |
| --- | --- | --- |
| `415 Expected multipart/form-data` | Orchestration request shape | Ensure the caller uploads multipart/form-data rather than JSON/base64. |
| `415 Unsupported audio content type` | Gateway upload allowlist | Use this patched gateway for browser recordings; it accepts `audio/webm`, `audio/webm;codecs=opus`, `video/webm`, WAV, MP3, FLAC, OGG, M4A/MP4, AAC, and Opus. |
| `400 Missing required file field` | Orchestration request shape | Confirm the file field is `file`, `audio`, `audio_file`, `audioFile`, or `upload`. |
| `409 Loaded STT model is ...` | Model state mismatch | Load the same model shown by `/model/default`, or omit `model` so the gateway injects the configured default. |
| `503 CUDA/NVIDIA GPU is not available` | Worker host/GPU | Check `nvidia-smi`, `ctranslate2.get_cuda_device_count()`, and the systemd environment. |
| Curl succeeds but orchestration fails | Orchestration app | Compare the orchestration request path, content type, file field name, and model field to the working curl command. |

## 5. Direct worker isolation check

Run this only on the model host, because the worker should bind to localhost:

```bash
curl -fsS -X POST http://127.0.0.1:8002/transcribe \
  -F "file=@$HOME/Desktop/sample.wav;type=audio/wav" \
  -F model=large-v3-turbo \
  -F vad_filter=true | jq .
```

If the direct worker succeeds but gateway routes fail, investigate the Node gateway. If both fail with the same model or GPU error, investigate the STT worker/model environment.
