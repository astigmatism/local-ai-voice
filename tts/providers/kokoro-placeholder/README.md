# Kokoro placeholder

Reserved provider slot for a future fast TTS engine. Add a worker exposing the same private worker contract:

- `GET /health`
- `GET /model/status`
- `POST /model/load`
- `POST /model/unload`
- `POST /speak`
- `GET /config`

Do not change the gateway public API when adding this provider.
