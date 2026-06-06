# Kokoro provider metadata

This provider is implemented by `workers/tts-kokoro` and exposed through the Node gateway provider registry as `provider: kokoro`.

The default model is `kokoro-82m` from `hexgrad/Kokoro-82M`; the default voice is `af_heart`. Use `/api/voices?provider=kokoro` or `/voices?provider=kokoro` to list configured Kokoro voice IDs.
