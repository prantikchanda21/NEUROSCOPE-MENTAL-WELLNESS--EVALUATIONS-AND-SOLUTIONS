# Update: Groq joins the tone/emotion assessment ensemble (3-way)

## Why
Before this change, the *assessment* side of the app (the tone/emotion read
driving the risk engine, adaptive question selection, and the live chip) was
a **2-way** ensemble of two small on-device transformers only: NeuroScope
DistilBERT (this project's own fine-tuned dual-head model) and the generic
hub RoBERTa sentiment model (`ensembleTransformerSentiment` in
`semanticEngine.ts`). The *solution*-drafting side already used a Groq LLM
(with Gemini + a local Phi model as fallbacks), but nothing on the LLM side
ever touched the tone/emotion **read itself** — the assessment rested on the
two small transformers alone.

This update adds a Groq-hosted LLM as a **third, independently-reasoned
opinion** in the assessment ensemble, so tone/emotion classification is never
resting on DistilBERT + RoBERTa alone — a general-purpose LLM's contextual
reasoning (negation, sarcasm, hedging, indirect distress phrasing) is folded
in as a genuine third vote, not just used to write the eventual response.

## 1. New server route: `POST /api/tone-analysis` (`server-app.ts`)
- A dedicated system prompt (`TONE_ANALYSIS_SYSTEM_PROMPT`) asks a Groq model
  to classify one piece of user text into the app's existing tone scale
  (`severe / distressed / neutral / calm`), a `-1..1` valence score, a
  `0..1` magnitude, and a top Ekman emotion — the same contract the two
  transformers already produce, so it plugs straight into the existing
  ensemble machinery.
- Goes through the **same** `Groq (GROQ_API_KEY) → Groq (GROQ_API_KEY_2) →
  Gemini (GEMINI_API_KEY)` fallback chain (`callAIWithFallback`) the
  "solution" routes already use, skipping only the local-Phi rung here to
  keep this fast (it runs once per free-text answer during a live
  assessment, not once per completed run).
- **This is a separate Groq call from solution generation.** `/api/assess`,
  `/api/feeling-solution`, `/api/reassess`, `/api/solution-followup` keep
  making their own, differently-prompted Groq calls to draft the empathetic
  write-up — `/api/tone-analysis` only ever reads tone, it never drafts a
  response.
- Fails soft: any error, timeout, or fully-exhausted fallback chain returns
  `{ available: false }` with HTTP 200, never an error status. The ensemble
  degrades to NeuroScope × RoBERTa exactly as before whenever this happens.

## 2. Client: `fetchGroqToneReading()` + `ensembleThreeWaySentiment()` (`src/utils/semanticEngine.ts`)
- `fetchGroqToneReading(text, timeoutMs = 6000)` calls the new route with an
  `AbortController`-bounded timeout, never throws, and returns `null` on any
  failure (offline, timeout, malformed response, `available: false`).
- `ensembleThreeWaySentiment(neuroscope, roberta, groq)` builds directly on
  top of the existing `ensembleTransformerSentiment()` rather than
  duplicating its logic:
  - Fuses NeuroScope + RoBERTa first (unchanged weighting/safety rules).
  - The **critical-band / Suicidal-status safety bypass is checked before
    Groq is ever consulted** — a safety-critical NeuroScope reading is never
    diluted by a generic LLM's opinion, exactly the same guarantee the 2-way
    ensemble already made for RoBERTa.
  - Otherwise blends Groq's read into the two-transformer fusion with a
    weight that **shrinks as the transformers' own agreement rises** (little
    left to correct) and **grows when they disagree** (more room for Groq's
    contextual reasoning to help tie-break an ambiguous answer).
  - Sticky severity: any one of the three readers calling `severe` — or
    NeuroScope's own raw risk flag — keeps the fused label `severe`.
  - When `groq` is `null`, this function returns the unchanged two-way
    ensemble result — **zero behavior change** when Groq is unavailable.
- `analyzeTextSemantics()` now fetches all three readings concurrently
  (`Promise.all`) and uses `ensembleThreeWaySentiment` whenever both
  transformers produced a read, carrying Groq's raw reading through on
  `SemanticAnalysis.groq` for transparency/debugging.

## 3. Types (`src/types.ts`)
- `SentimentResult.source` gains `'groq'`, `'ensemble3'`, `'ensemble3+lexicon'`.
- `SemanticAnalysis` gains optional `groq?: SentimentResult | null`.

## 4. Adaptive question selection (`src/utils/adaptiveEngine.ts`)
- `analyzeSentimentAsync()` and `sentimentUncertainty()` now recognize
  `'ensemble3'` / `'ensemble3+lexicon'` alongside the existing `'ensemble'` /
  `'ensemble+lexicon'` — a low-agreement three-way ensemble read biases the
  next question toward a same-category follow-up, exactly like a low-agreement
  two-way read already did.

## 5. UI (`QuestionCard.tsx`, `DynamicSolutionCard.tsx`) + server prompt labels (`server-app.ts`)
- The tone-source chip/label maps in all three places now describe
  `'ensemble3'` / `'ensemble3+lexicon'` as "NeuroScope DistilBERT × RoBERTa ×
  Groq ensemble" and `'groq'` as "Groq (LLM tone read)", so the third reader's
  contribution is visible, not just used internally.
- The "Agree X%" badge condition now also fires for the three-way ensemble.

## Compatibility
Every branch on `sentiment.source` across `src/` and `server-app.ts` uses `===`
equality checks (never an exhaustive `switch`), so the three new source
strings are purely additive: no existing path changes behavior, and every
call site degrades gracefully to its pre-existing behavior whenever Groq's
reading is `null` (unset/exhausted keys, timeout, or offline).

## Note on "two Groq calls"
The app now makes Groq calls for two distinct purposes, each independently
routed through the full fallback chain:
1. **Assessment** — `/api/tone-analysis`: reads tone/emotion, feeds the
   ensemble above.
2. **Solution** — `/api/feeling-solution`, `/api/reassess`,
   `/api/solution-followup`, `/api/assess`, `/api/dimension-insight`: drafts
   the empathetic response/solution, grounded in the (now three-way) primary
   clinical reading.

Both keep Gemini (`GEMINI_API_KEY`) and a local last-resort model as
fallbacks. The local model defaults to Phi-4-mini but is fully swappable via
`LOCAL_LLM_MODEL` (e.g. `LOCAL_LLM_MODEL=phi3` with `ollama pull phi3` or an
LM Studio Phi-3-mini load) — no code changes required either way.
