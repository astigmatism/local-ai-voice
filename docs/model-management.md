# Model management

## Defaults

| Role | Provider | Default model | Worker |
| --- | --- | --- | --- |
| STT | `fast-whisper` | `large-v3-turbo` | `workers/stt-fast-whisper` |
| TTS | `chatterbox` | `chatterbox-turbo` | `workers/tts-chatterbox` |

The default STT implementation is faster-whisper because it runs Whisper through CTranslate2, supports CUDA, offers lower memory use than the original OpenAI Whisper implementation, and supports GPU quantization options such as `int8_float16`. The default TTS implementation is Chatterbox because you requested it and the upstream package exposes Turbo, English, and multilingual variants.

## Production directories

```text
/opt/local-ai-voice/models/stt/<provider>/<model-id>        Optional local converted models
/opt/local-ai-voice/cache/stt/<provider>                    Downloaded STT cache
/opt/local-ai-voice/uploads/stt                             Transient transcription audio
/opt/local-ai-voice/logs/workers                            Worker logs if file logging is added

/opt/local-ai-voice/models/tts/<provider>/<model-id>        Optional local TTS checkpoints
/opt/local-ai-voice/cache/tts/<provider>                    Downloaded TTS cache
/opt/local-ai-voice/voices/<provider>                       Reference WAV clips
/opt/local-ai-voice/output/tts                              Generated audio if retained
```

Source-controlled metadata lives under `stt/` and `tts/`; model weights are never committed.

## STT model choices for about 10 GB VRAM

Recommended first choices:

1. `large-v3-turbo` with `int8_float16`: practical default for a 10 GB GPU.
2. `distil-large-v3` with `float16`: useful for English-heavy workloads and low latency.
3. `medium` or `small` with `int8_float16`: safer when TTS must stay resident.
4. `large-v3` with `int8_float16`: quality-focused, but may crowd the GPU when TTS is also loaded.

Load STT:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/models/stt/load \
  -H 'content-type: application/json' \
  -d '{"provider":"fast-whisper","model":"large-v3-turbo","computeType":"int8_float16"}' | jq .
```

Unload STT:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/models/stt/unload \
  -H 'content-type: application/json' \
  -d '{"strategy":"soft","clearCache":true}' | jq .
```

## TTS model choices

Represented Chatterbox model IDs:

| Model ID | Purpose | Notes |
| --- | --- | --- |
| `chatterbox-turbo` | Default lower-latency English model | Upstream examples use `ChatterboxTurboTTS`. Reference audio is expected for voice cloning. |
| `chatterbox` | Original English model | Exposes CFG/exaggeration-style controls where supported by installed package. |
| `chatterbox-multilingual` | 23+ language model | Worker supports `language` and optional `options.t3_model=v3` if installed package exposes it. |

Load TTS:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/models/tts/load \
  -H 'content-type: application/json' \
  -d '{"provider":"chatterbox","model":"chatterbox-turbo","language":"en"}' | jq .
```

Load multilingual v3 if the installed Chatterbox package supports it:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/models/tts/load \
  -H 'content-type: application/json' \
  -d '{"provider":"chatterbox","model":"chatterbox-multilingual","language":"fr","options":{"t3_model":"v3"}}' | jq .
```

Unload TTS:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/models/tts/unload \
  -H 'content-type: application/json' \
  -d '{"strategy":"soft","clearCache":true}' | jq .
```

## Soft unload behavior

Workers attempt:

```python
model = None
gc.collect()
torch.cuda.empty_cache()
torch.cuda.ipc_collect()
```

Important: `torch.cuda.empty_cache()` releases unused cached blocks back to the CUDA driver, but it does not free memory still referenced by Python objects or external libraries. If VRAM does not drop as expected, use hard unload.

## Hard unload behavior

Hard unload restarts the worker process. This is the most reliable boundary for CUDA context cleanup.

Manual hard restart:

```bash
bash scripts/hard-restart-worker.sh stt
bash scripts/hard-restart-worker.sh tts
```

Gateway-managed hard restart is disabled by default. To enable:

1. Configure a tightly scoped sudoers/polkit rule for `systemctl restart local-ai-voice-*-worker.service`.
2. Set `ALLOW_SYSTEMD_RESTART=true` in `/opt/local-ai-voice/config/local-ai-voice.env`.
3. Restart the gateway.

Then:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/models/tts/unload \
  -H 'content-type: application/json' \
  -d '{"strategy":"hard"}' | jq .
```

## GPU memory before/after switching

Check before loading:

```bash
curl -fsS http://127.0.0.1:8000/api/gpu | jq .
nvidia-smi
```

Load or unload a model, then check again:

```bash
curl -fsS http://127.0.0.1:8000/api/services | jq .
nvidia-smi
```

The portal shows gateway GPU state and worker load states on the main page.

## Adding a new STT provider

1. Add provider metadata under `stt/providers/<provider-id>`.
2. Add model descriptors under `stt/models/<provider-id>`.
3. Implement a private worker exposing the worker contract.
4. Add a systemd unit or worker manager entry.
5. Add model catalog entries in `apps/gateway/src/catalog.ts`.
6. Point `STT_WORKER_URL` and defaults to the new provider/model.

Do not change `/api/stt/transcribe` or `/transcribe` unless adding optional fields.

## Adding a new TTS provider

1. Add provider metadata under `tts/providers/<provider-id>`.
2. Add model descriptors under `tts/models/<provider-id>`.
3. Put voice/reference files under `/opt/local-ai-voice/voices/<provider-id>`.
4. Implement `POST /speak` in a private worker.
5. Add catalog entries and environment defaults.

The Kokoro placeholder documents this contract without shipping an implementation.
