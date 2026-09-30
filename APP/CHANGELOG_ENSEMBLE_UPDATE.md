# Update: NeuroScope × RoBERTa confidence-weighted ensembling

## 1. Real ensembling instead of primary/fallback (`src/utils/semanticEngine.ts`)
Previously the app ran NeuroScope DistilBERT and the RoBERTa sentiment model
side by side but only ever used ONE reading for tone: NeuroScope once it was
loaded, RoBERTa only as a stand-in while NeuroScope was still downloading.
RoBERTa's read was discarded the moment NeuroScope became available, even
though both models run on the exact same answer.

New `ensembleTransformerSentiment(neuroscope, roberta)`:
- NeuroScope keeps the majority vote — 60% base, scaling up to 85% as its own
  top-class confidence (`pTop`) rises — because it is the model actually
  fine-tuned on this app's 7-way status + risk labels.
- RoBERTa's score pulls the remaining share of the fused reading.
- **Agreement** (both models on the same side of neutral) boosts the fused
  magnitude — two independent models corroborating each other is stronger
  evidence than either alone.
- **Disagreement** damps the fused magnitude instead of blindly averaging it
  to a falsely confident middle score, and is exposed as `confidence` (0..1)
  on the returned `SentimentResult` so downstream code can tell a
  corroborated reading apart from a genuinely ambiguous one.
- Severity stays sticky and safety-first: a `severe` label from either model,
  or NeuroScope's own risk flag, always wins. Suicidal/critical-band
  NeuroScope readings bypass the ensemble entirely — safety-critical output
  is never diluted by a generic sentiment model.
- `analyzeTextSemantics()` now calls this whenever both models have produced
  a reading for the same text (fresh pass AND the cache-upgrade path), instead
  of NeuroScope silently replacing RoBERTa's read.

## 2. Ensemble-aware dynamic question selection (`src/utils/adaptiveEngine.ts`)
- `analyzeSentimentAsync()` now recognizes the new `'ensemble'` source from
  `analyzeTextSemantics()` and blends it with the offline lexicon as
  `'ensemble+lexicon'`, carrying the `confidence` figure through.
- New `sentimentUncertainty()` reads that confidence: when the two models
  disagreed on the last answer (low confidence), `selectNextQuestion` /
  `selectNextQuestionAsync` now bias toward a follow-up question in the SAME
  category rather than moving to a fresh one — an ambiguous read gets
  clarified before the assessment moves on. This is purely additive (a new
  `uncertaintyBoost` term); the three existing scoring weights (relevance,
  category coverage, severity boost) are unchanged, so behavior for every
  non-ensemble path (lexicon-only, direct yes/no, single-model fallback) is
  identical to before.

## 3. Types (`src/types.ts`)
- `SentimentResult.source` gains `'ensemble'` and `'ensemble+lexicon'`.
- `SentimentResult` gains optional `confidence?: number` (0..1 model
  agreement, only set on ensemble reads).
- `SemanticAnalysis` gains optional `ensembleAgreement?: number | null`.

## 4. UI (`src/components/QuestionCard.tsx`, `src/components/DynamicSolutionCard.tsx`, `server-app.ts`)
- The tone-source chip/label maps in all three places now describe
  `'ensemble'` / `'ensemble+lexicon'` as "NeuroScope DistilBERT × RoBERTa
  ensemble" instead of mislabeling a fused reading as a single model.
- Question card and solution card now show an "Agree X%" badge whenever an
  ensemble reading is active, so the model agreement is visible, not just
  used internally.

## Compatibility
Every existing call site that branches on `sentiment.source` was audited
(`grep -rn "\.source"` across `src/` and `server-app.ts`); none of them use
exhaustive switches, so the two new source strings are additive and cannot
break an existing path. The mandatory safety screener's deterministic
yes/no override, the crisis-phrase short-circuit, and the offline lexicon
fallback are all untouched — the ensemble only ever replaces the *single-model*
tone reading, never the deterministic overrides that sit in front of it.

## Note on the RoBERTa model
The uploaded project only contained the NeuroScope DistilBERT checkpoint plus
the generic hub RoBERTa sentiment model (`Xenova/twitter-roberta-base-sentiment-latest`)
that was already wired in as a secondary/fallback signal — there was no second
project-specific fine-tuned RoBERTa checkpoint in `public/models/`. This
update ensembles NeuroScope DistilBERT with that RoBERTa model. If a separate
fine-tuned RoBERTa mental-health checkpoint exists, drop its ONNX export into
`public/models/` alongside `neuroscope-distilbert` and point
`SEMANTIC_MODELS.sentiment` in `semanticEngine.ts` at it — the ensembling
function itself needs no changes, since it already treats the RoBERTa input
as a generic `SentimentResult`.
