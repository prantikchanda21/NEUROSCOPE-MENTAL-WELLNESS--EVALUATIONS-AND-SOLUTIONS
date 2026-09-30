# Offline Phi-3 mini (header dropdown) — governed by the NeuroScope / RoBERTa rules

## What users see
A small **Offline AI** dropdown in the header. "Download (about 2.3 GB)" fetches Phi-3 mini once;
the browser caches it and it then runs on the user's own device, also without internet. Progress bar,
"Remove from this device", and a plain "not available on this device" message when there is no WebGPU.
On later visits it loads itself from the cache (about 4 s after start-up, so it never competes with the
NeuroScope / support workers).

## What it does in the app
It fills the **LLM slot of the tone ensemble when Groq gives nothing** (offline, rate-limited, all
providers down). It only ever returns a JSON tone reading; it never writes text to the user.
It is not called at all when Groq answered.

## Rules it obeys (same as the transformers)
1. **Same taxonomy and scales** — `severe/distressed/neutral/calm`, score -1..1, magnitude 0..1.
   The output spec now lives once in `src/utils/toneRules.ts` and is used by BOTH the server's Groq prompt
   (text verified identical to before) and the Phi prompt.
2. **Repair before use** — `reconcileToneReading()` clamps values and, if label and score disagree, the
   MORE SEVERE one wins. Truncated / prose-wrapped replies are salvaged; unusable replies are dropped
   (ensemble stays on NeuroScope + RoBERTa).
3. **Safety bypass first** — never consulted when NeuroScope is in the critical band / Suicidal status or the
   text has imminent-risk language; those are decided without it.
4. **Sticky severity** — a `severe` from NeuroScope, RoBERTa or Phi, or NeuroScope's risk flag, keeps the
   fused label `severe`; Phi can escalate but can never talk a severe read down.
5. **Minority weight** — `LOCAL_LLM_VOTE_PROFILE` (0.25–0.45) vs Groq's `GROQ_VOTE_PROFILE` (0.55–0.8);
   the tuned transformers keep the majority when Phi is the third voice. Tweak in `semanticEngine.ts`.

## Files
New: `src/utils/toneRules.ts`, `src/utils/localLlm.ts`, `src/workers/localLlm.worker.ts`,
`src/workers/localLlmProtocol.ts`, `src/components/OfflineModelMenu.tsx`,
`scripts/test-tone-rules.ts`, `scripts/test-local-llm-ensemble.ts`.
Changed: `HeaderNav.tsx` (adds the dropdown), `semanticEngine.ts` (vote profiles + offline fallback),
`types.ts` (`'local-llm'` source, `localLlm` field), `server-app.ts` (imports the shared spec), `package.json`
(`npm run test:rules`).

## Model
`microsoft/Phi-3-mini-4k-instruct-onnx-web`, dtype `q4f16`, WebGPU only (838 MB + 1.45 GB). Change
`LOCAL_LLM_MODEL_ID` in `localLlm.ts` to use `onnx-community/Phi-3.5-mini-instruct-onnx-web` (the model in the
official transformers.js demo) if the Phi-3 build fails to load in your setup.

## Limits
- Desktop Chrome/Edge with WebGPU and ≥4 GB memory. Phones, Safari and most Firefox builds show "not available".
- Each reading is bounded to 10 s (`LOCAL_LLM_TIMEOUT_MS`); on timeout it is skipped.
- Offline drafting of full solution text is NOT included — only the tone reading.
