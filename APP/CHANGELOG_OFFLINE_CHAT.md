# Offline Phi-3 now answers the "Chat with AI About This Feeling" box

Before: Phi-3 only produced a hidden tone reading, so with no cloud AI the chat used the built-in template bank.

Now (`DynamicSolutionCard.tsx` + `localLlm.ts`):
1. Cloud answer (Groq/Gemini) is tried first, unless the browser is offline.
2. If there is none (offline, no API keys, or the server returned its `local` template), the downloaded Phi-3 writes the reply.
3. If Phi-3 is not ready, times out (45 s) or returns nothing usable, the old template reply is used.

Safety: Phi-3 is never used when the risk band is high/critical/severe or the text has imminent-risk language;
those keep the built-in crisis-aware replies.

Replies from Phi-3 end with "(Written on your device by the offline AI.)". Delete ON_DEVICE_NOTE to hide it.
Copy both files over the ones in your project (DynamicSolutionCard.tsx is based on the groq-dual-pool-fixed zip).

# Update: offline AI now writes the solution card too, and a faster model

- `fetchDynamicFeelingSolution` shows the built-in card instantly, then the on-device model rewrites the title, empathy,
  nervous-system, perspective, first move, steps, "later today" and affirmation and swaps them in (card shows
  "Personalising this on your device…"). Any field the model gets wrong keeps the template text. Citations are dropped
  from an on-device card because the model did not use them.
- Same safety rule as the chat: never for severe/high/critical or imminent-risk text.
- `LOCAL_LLM_PROFILE` in `localLlm.ts`: 'fast' (Llama 3.2 1B, ~1.3 GB, default) or 'quality' (Phi-3 mini, ~2.3 GB).
  After switching: dropdown -> "Remove from this device", reload, download again.
- Files: localLlm.ts, localLlm.worker.ts, localLlmProtocol.ts, dynamicFeelingSolutions.ts, App.tsx, DynamicSolutionCard.tsx
