# Update: Two independent Groq key pools + Groq promoted to primary tone engine

## Why
Since the previous update (`CHANGELOG_GROQ_TONE_ENSEMBLE.md`), tone/emotion
assessment (`/api/tone-analysis`) and solution drafting (`/api/assess`,
`/api/feeling-solution`, `/api/reassess`, `/api/solution-followup`,
`/api/dimension-insight`) shared **one** two-key Groq pool
(`GROQ_API_KEY`, `GROQ_API_KEY_2`). In practice this meant a burst of
solution-drafting traffic could exhaust both keys right before a live
tone-analysis call needed them (or vice versa), silently degrading the tone
chip back to NeuroScope-only with no visible error. This update splits Groq
into two fully independent pools and promotes Groq to the primary voice in
the tone/emotion ensemble, while keeping the two tuned transformers as the
governing safety/consistency layer around it.

## 1. Two independent Groq pools (`server-app.ts`)
- **Tone pool** — `GROQ_API_KEY`, `GROQ_API_KEY_2`. Used ONLY by
  `/api/tone-analysis`.
- **Communication pool** — new `GROQ_API_KEY_3`, `GROQ_API_KEY_4`. Used by
  every solution-drafting route and `/api/translate`.
- `callAIWithFallback()` gains a `pool: 'tone' | 'communication'` parameter
  (default `'communication'`, so existing call sites that don't pass it are
  unaffected) that selects which pool's keys `callGroqWithKeyFallback()`
  walks through. Gemini (`GEMINI_API_KEY`) remains a single shared fallback
  rung for both pools — reached only once a pool's own two keys have both
  failed. Local Phi-4-mini/Phi-3 remains the communication pool's last
  resort; the tone route still deliberately skips it to stay fast.
- `/api/health` now reports `tonePool` / `communicationPool` separately
  (`keysConfigured`, `fallbackKeyConfigured`) alongside the existing
  aggregate `groqAvailable`/`groqKeysConfigured`.

## 2. Groq promoted to the PRIMARY tone/emotion engine (`src/utils/semanticEngine.ts`)
- `ensembleThreeWaySentiment()`'s Groq weight moved from a 0.15–0.4 minority
  tie-breaker range to a **0.55–0.8 majority range** — Groq's read now leads
  the fused tone/emotion reading whenever it answers.
- The two tuned transformers (NeuroScope DistilBERT + RoBERTa) remain the
  hard governing layer Groq's majority vote operates inside, not a peer it
  can simply outvote:
  - The critical-band / Suicidal-status safety bypass still fires **before**
    Groq is ever consulted — unchanged from the previous update.
  - Sticky severity is unchanged: any one of the three readers — or
    NeuroScope's own risk flag — calling `severe` keeps the fused label
    `severe`, so Groq's majority weight can escalate a reading but can never
    talk a corroborated transformer `severe` back down.
  - Groq's system prompt (`TONE_ANALYSIS_SYSTEM_PROMPT`) now explicitly
    states it is the primary reader but must classify into the exact same
    `severe/distressed/neutral/calm` taxonomy and score scales the two
    tuned transformers use, so its vote stays directly comparable rather
    than freelancing its own scale.

## 3. Docs + in-app guide updated
- `README.md`'s fallback-chain and NeuroScope-architecture sections rewritten
  for the two-pool split and Groq's new primary role.
- `.env` rewritten with the tone/communication pools clearly separated and
  `GROQ_API_KEY_3`/`GROQ_API_KEY_4` placeholders added (optional — every rung
  still degrades gracefully when a key is unset).
- `NetlifyGuideModal.tsx`'s in-app "API Keys Configuration" step now lists
  all four Groq env vars with which pool each belongs to.
- `zipExport.ts`'s generated `.env.example` (the in-app "download my
  project" feature) updated to match.

## Compatibility
`callAIWithFallback()`'s new `pool` param defaults to `'communication'`, so
every pre-existing call site that doesn't pass it keeps its old behavior
except for drawing from the (now-separate) communication pool instead of the
combined one. Only `/api/tone-analysis` was changed to pass `pool: 'tone'`
explicitly. `callGroqWithKeyFallback()` now takes the key array as an
explicit parameter instead of reading a single module-level constant; its
three call sites (`callAIWithFallback`, the translate service, and the
dimension-insight route) were all updated accordingly — translation draws
from the full combined key set (not part of either ensemble layer) and
dimension-insight draws from the communication pool.
