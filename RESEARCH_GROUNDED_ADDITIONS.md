# Research-Grounded Content Update

This update adds 10 new screening questions (2 per existing category, IDs 26–35) to
`src/data/questions.ts`, plus matching updates to the sentiment lexicon and keyword
lists that the existing adaptive engine (`src/utils/adaptiveEngine.ts`) and clinical
scoring engine (`src/utils/clinicalEngine.ts`) already use. No new algorithm was
introduced — the existing lexicon-based sentiment analysis, IR relevance scoring,
NDCG ranking-quality metric, and bounded-randomization question selection now simply
have a larger, more clinically grounded pool of questions and answer options to draw
from and score.

## Sources used

- **Porges, S. W. (2007). "The Polyvagal Perspective." *Biological Psychology*.**
  Grounded: neuroception (automatic, below-conscious threat/safety detection), the
  myelinated "vagal brake" (capacity to actively self-calm), and the Social
  Engagement System / co-regulation (how a calm person nearby can help settle
  someone else's body and mood).
- **Pilkonis et al. (2011). "Item Banks for Measuring Emotional Distress from
  PROMIS: Depression, Anxiety, and Anger." *Assessment*.**
  Grounded: the highest-discrimination item stems from validated depression
  (hopelessness, worthlessness, failure), anxiety (sudden panic, racing/pounding
  heart, dread of something bad happening), and anger (staying angry for hours,
  feeling ready to explode, trouble controlling temper) item banks.
- **Gibbons et al. (2012). "Development of a Computerized Adaptive Test for
  Depression." *Archives of General Psychiatry*.**
  Grounded: the mood / cognition / behavior / somatic / suicide domain structure
  used to keep new items balanced across category and severity.
- **SAMHSA TIP 57, "Trauma-Informed Care in Behavioral Health Services" (2014).**
  Grounded: avoidance and self-medication as coping strategies, hypervigilance and
  intrusive re-experiencing, and betrayal-trauma's effect on trust in later
  relationships.

## What changed

- `src/data/questions.ts` — 10 new `QUESTION_POOL` entries (ids 26–35), each with a
  research-grounded `rationale`, `keywords` for the IR relevance scorer, and four
  `quickPrompts` (canned answers) written in the same plain-language register as the
  existing 25 items. `TOTAL_QUESTIONS` stays at 20, so the adaptive engine now
  selects 20 out of a **35**-item pool instead of 25 — more room for the existing
  bounded-randomization jitter to produce varied, non-repeating question paths.
- `src/utils/adaptiveEngine.ts` — added sentiment-lexicon entries for vocabulary the
  new items introduce (`hypervigilant`, `flashback`, `unsafe`, `guarded`, `wary`,
  `explode`, `temper`, `grudge`, plus positive/regulating terms `soothe`,
  `grounded`, `settle`, `safe`, `regulated`) so the existing sentiment scorer picks
  up polarity in free-text answers to the new questions correctly.
- `src/utils/clinicalEngine.ts` — mirrored the same additions into the
  `SEVERE_ANXIETY_DEPRESSION_KEYWORDS`, `MILD_STRAIN_KEYWORDS`, and
  `RESILIENT_KEYWORDS` lists used for local dimension scoring, so scoring stays
  consistent with the new question content.

No changes were made to `clinicalEngine.ts`'s category-scoring logic, to
`dynamicFeelingSolutions.ts`, or to `dynamicFollowUpResponses.ts` — both already
match on free-text patterns generically, so they work with the new answers without
modification. `npx tsc --noEmit` and `npx vite build` both pass cleanly on the
updated project.
