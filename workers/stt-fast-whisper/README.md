# STT worker: faster-whisper

Private FastAPI worker for GPU-first speech-to-text. The Node gateway is the only public API surface; this worker binds to `127.0.0.1:8002` by default.

The worker intentionally fails when `GPU_ONLY=true` and CUDA/NVIDIA visibility is missing. It does not silently fall back to CPU.

See `docs/model-management.md` and `docs/deployment.md` for production setup.
