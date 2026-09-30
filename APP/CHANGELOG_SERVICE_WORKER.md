# Service worker / offline support

## What it does
- After ONE online visit the whole app opens and runs with no network (shell, NeuroScope DistilBERT, local fallbacks).
- `/sw.js` is generated at build time by `vite-plugin-sw.ts` from `src/sw/service-worker.js`; no new npm packages.
- precache (blocks install): index.html, hashed JS/CSS, icons, landscapes, manifest (files <= 2 MB).
- warm (background, ~10 s after load): the 66 MB ONNX model + tokenizer/config files + any chunk > 2 MB.
- Navigation is network-first (3 s), then cached index.html. `/api/*` is never intercepted.
- Hugging Face models (RoBERTa, emotions, MiniLM) and the Phi-3 / Llama download stay in transformers.js's own
  Cache API store; the worker deliberately does not touch them. Registration asks for persistent storage so the
  browser does not evict them.
- New deploys install in the background and take over when all tabs are closed (no mid-session file swaps).
- Production builds only; `npm run dev` never registers the worker.

## Files
New: src/sw/service-worker.js, vite-plugin-sw.ts, src/utils/registerServiceWorker.ts, public/manifest.webmanifest
Changed: vite.config.ts, src/main.tsx, index.html, vercel.json, netlify.toml

## Test
1. `npm run build && npx vite preview`, open http://localhost:4173 once, wait ~30 s.
2. DevTools > Application > Service Workers (activated) and Cache Storage (neuroscope-*).
3. Network tab > Offline, reload: the app should load and run the local model.
