# Web Worker inference + animation cleanup

## Web Workers (faster, non-blocking models)

All model loading and inference now runs in Web Workers instead of on the UI thread.

- `src/workers/semanticCore.ts` — the model side: creates the ONNX sessions, tokenizes,
  runs the forward pass and extracts logits/embeddings. No DOM/React references.
- `src/workers/semantic.worker.ts` — the worker entry that hosts one core.
- `src/utils/semanticTransport.ts` — main-thread side. Starts **two** workers:
  - `primary`: NeuroScope DistilBERT only, so the clinical read never queues behind another model.
  - `support`: RoBERTa sentiment, DistilRoBERTa emotions, MiniLM embeddings.
- `src/utils/semanticEngine.ts` — same public API as before. It keeps the caches, timeouts and
  the cheap risk logic (softmax, risk bands, imminent-language override, protective de-escalation),
  and calls the workers for the heavy part.
- `vite.config.ts` — `worker.format = 'es'` (the worker dynamically imports transformers.js).

Details:

- Tokenization now happens off-thread too (previously only ORT's session ran in its proxy worker).
- Embeddings come back as transferred `Float32Array` buffers (no `tolist()` boxing, no copy).
- Download-progress events are throttled to ~8/s, so a 65MB download no longer re-renders the UI on every chunk.
- Each model does one warm-up pass on load, so the first real answer is already fast.
- The old smoke-test + ORT-proxy retry path (extra inference at load, up to 12s timeout) is gone.
- Fallback: if a worker can't start (or crashes later), that role runs on the main thread exactly as
  before, and the engine reloads any models the crashed worker lost.
- `getSemanticRuntimeModes()` reports `'worker' | 'inline'` per role for diagnostics.

Multi-threaded WASM is wired in but only activates on a cross-origin-isolated page (COOP/COEP).
It is intentionally not enabled: Google sign-in (`accounts.google.com/gsi/client`) and Google Fonts
are cross-origin and would break under `require-corp`.

## Animations removed

- Landscape: 90 infinitely-twinkling stars, drifting particles, unused aurora keyframes;
  day/night crossfade 1000ms → 300ms.
- `HelixWaveEffect` overlay (and the `helixKey` remount that replayed it) — component deleted.
- `SpiralVortexEffect` — unused, deleted.
- 3D flip / blur / scale / slide entrances on the results dashboard, solution card, question card,
  intro, and assessing screens → a ~120–150ms fade.
- Landing page staggered entrance delays.
- Decorative pulsing dots/flames in the header, landing page and protocol tracker.

Kept on purpose: spinners/skeletons, the mic-recording pulse, the crisis card, progress bars,
the breathing-exercise animation, and modal open/close.
