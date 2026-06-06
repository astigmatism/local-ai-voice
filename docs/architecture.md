# Architecture

## Goals

Local AI Voice is an appliance-style stack for a single Ubuntu Server 24.04 LTS VM on VMware ESXi 8.0 with one directly passed-through NVIDIA GPU. The architecture separates three concerns:

1. Public API, compatibility routing, management portal, and orchestration live in Node/TypeScript.
2. Model inference runtimes remain isolated Python worker processes bound to localhost.
3. Provider/model/voice/cache/upload/log filesystem areas are separated so STT and TTS engines can be swapped independently.

## Runtime topology

```text
Trusted LAN / orchestrator
        |
        v
0.0.0.0:8000
Node Fastify gateway
  |-- compatibility routes: /health, /speak, /transcribe, ...
  |-- modern routes: /api/*
  |-- React portal static files
  |-- nvidia-smi GPU summary
        |
        | localhost HTTP only
        +--> 127.0.0.1:8002 STT worker: FastAPI + faster-whisper/CTranslate2
        |
        +--> 127.0.0.1:8001 TTS worker: FastAPI + Chatterbox
        |
        +--> 127.0.0.1:8003 TTS worker: FastAPI + Kokoro
```

Only the Node gateway should bind publicly. Workers should never be opened directly to the LAN unless you intentionally add an internal service mesh or reverse proxy rule.

## GPU-first behavior

`GPU_ONLY=true` is the default in `.env.example`, systemd env templates, and both workers. When this flag is true:

- Workers require CUDA device selection.
- Workers check NVIDIA/CUDA visibility at health and model-load time.
- Workers reject CPU device selection.
- Workers report failed/unavailable states instead of silently running slow CPU inference.

System RAM is still needed for Ubuntu, Node, Python, model load buffers, file handling, and caches. It is not treated as a replacement for VRAM.

## Provider abstractions

Source-controlled provider metadata is located under:

```text
stt/providers/fast-whisper
tts/providers/chatterbox
tts/providers/kokoro
```

Production data layout is:

```text
/opt/local-ai-voice/app       Source checkout and built Node/portal assets
/opt/local-ai-voice/config    Environment and mutable appliance config
/opt/local-ai-voice/models    Optional local model directories
/opt/local-ai-voice/cache     Downloaded model caches
/opt/local-ai-voice/voices    Uploaded/reference voice clips
/opt/local-ai-voice/uploads   Transient input audio
/opt/local-ai-voice/output    Generated audio retained by policy
/opt/local-ai-voice/logs      File logs if enabled; systemd journal is primary
/opt/local-ai-voice/workers   Python virtualenvs
```

## TTS provider routing

The gateway exposes Chatterbox and Kokoro as first-class TTS providers. Requests may set `provider` explicitly, or the gateway can infer the provider from the requested TTS model. Chatterbox keeps reference WAV support under `/opt/local-ai-voice/voices/chatterbox`; Kokoro rejects reference audio and uses built-in voice IDs such as `af_heart`, `bf_emma`, `ff_siwis`, `jf_alpha`, and `zf_xiaoxiao`.

Hard unload/restart is provider-specific: `chatterbox` restarts `local-ai-voice-tts-chatterbox.service`, while `kokoro` restarts `local-ai-voice-tts-kokoro.service`.

## Worker contract

Every worker should implement this private HTTP contract:

| Route | Purpose |
| --- | --- |
| `GET /health` | Worker health, provider, state, GPU availability |
| `GET /gpu` | Worker-specific GPU/CUDA visibility |
| `GET /model/status` | Current provider/model/load state |
| `POST /model/load` | Explicit load/switch model |
| `POST /model/unload` | Soft unload; hard unload note |
| `POST /model/reload` | Unload then load |
| `GET /config` | Runtime config snapshot |
| `GET /voices` | TTS voice/reference descriptors, TTS workers only |
| `POST /transcribe` | STT inference, STT workers only |
| `POST /speak` | TTS inference, TTS workers only |

The public gateway API remains stable even when a worker implementation changes.

## State machine

Workers use this state model:

```text
unloaded -> loading -> loaded -> unloading -> unloaded
                         |
                         v
                       failed
```

`failed` includes an error string and should remain observable through `/api/services`, `/api/models/*`, and the portal.

## Soft unload vs hard unload

Soft unload is an in-process cleanup:

- Delete model references.
- Run Python garbage collection.
- Call `torch.cuda.empty_cache()` and `torch.cuda.ipc_collect()` where PyTorch is present.

Soft unload can free much of the reserved memory but cannot guarantee every byte is returned if references remain alive or a library allocator keeps pools reserved.

Hard unload is a process boundary:

- Restart the worker service through systemd.
- Let the OS tear down CUDA contexts and all process memory.

The gateway has a guarded hard-restart path. It is disabled by default with `ALLOW_SYSTEMD_RESTART=false` to avoid unsafe privilege assumptions.

## Compatibility preservation

The legacy baseline documented a public STT/API service on `0.0.0.0:8000`, Chatterbox on `127.0.0.1:8001`, and future STT worker on `127.0.0.1:8002`. This implementation keeps public port `8000`, keeps Chatterbox private on `8001`, places faster-whisper STT on `8002`, adds Kokoro private on `8003`, and maps the existing compatibility routes through the Node gateway.

## Concurrent TTS provider architecture

The TTS layer is a multi-provider registry, not a single global current model. Chatterbox and Kokoro can be running and loaded at the same time:

```text
0.0.0.0:8000       public Node/Fastify gateway and portal
127.0.0.1:8001     Chatterbox TTS worker
127.0.0.1:8002     STT worker, when installed
127.0.0.1:8003     Kokoro TTS worker
```

Each TTS provider has its own worker URL, systemd unit, health check, model status, default model, default voice, capabilities, and lifecycle controls. `TTS_DEFAULT_PROVIDER` chooses only the fallback provider for requests that omit `provider`; it does not unload, replace, or disable the other TTS worker.

The gateway routes speech requests by provider id:

```json
{ "provider": "chatterbox", "text": "Generate this with Chatterbox." }
{ "provider": "kokoro", "text": "Generate this with Kokoro." }
```

Provider lifecycle APIs are provider-scoped. `POST /api/models/tts/load`, `POST /api/models/tts/unload`, and `POST /api/models/tts/reload` forward to only the selected worker. If VRAM is insufficient, the selected worker should fail clearly; the gateway does not automatically unload the other provider unless a caller explicitly unloads it.
