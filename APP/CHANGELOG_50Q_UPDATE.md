# Update: 50-item pool, quick-analysis modes, on-demand exercises

## 1. Item pool expanded 35 → 50 (`src/data/questions.ts`)
Added 15 new items (ids 36–50, 3 per category, 10 per category total), grounded
in the same four sources already cited in `RESEARCH_GROUNDED_ADDITIONS.md`
(Porges 2007 polyvagal theory, Pilkonis et al. 2011 PROMIS item banks, Gibbons
et al. 2012 CAT-DI domain structure, SAMHSA TIP 57). New angles covered:
future-oriented anhedonia, guilt/self-blame, internalized irritability,
gut-brain stress coupling, dorsal-vagal freeze/shutdown, altered pain/
temperature sensitivity, catastrophic thinking, rumination, identity
disruption, freeze-as-coping-style, avoidance-via-busyness, help-seeking
difficulty, boundary-setting/people-pleasing, authentic emotional expression,
and relational repair capacity.

## 2. Quick-analysis modes (5 / 10 / 20 questions)
- `ASSESSMENT_MODES` and `AssessmentLength` (`src/types.ts`,
  `src/data/questions.ts`) define three lengths — Quick Check-In (5),
  Balanced Check-In (10), Full Assessment (20) — all drawing from the same
  50-item pool and scored by the same engine.
- The intro screen (`src/App.tsx`) now shows a mode picker before "Begin".
- `selectNextQuestion()` in `src/utils/adaptiveEngine.ts` takes a
  `totalQuestions` parameter and scales category-balance targets and the
  mandatory safety-question placement (~35% into the run) to whichever
  length was chosen, so even the 5-question mode reliably includes it.

## 3. Exercises are now conditional, not automatic
- New `shouldTriggerExercise(sentiment, isMandatoryQuestion)` in
  `adaptiveEngine.ts`: returns true only for very-negative sentiment,
  negative sentiment above a magnitude threshold, or the mandatory safety
  question — otherwise false.
- `App.tsx`'s new `handleAnswerSubmitted()` calls this after every answer.
  If it's false, the flow advances straight to the next question with no
  interruption. If it's true, the existing AI/local micro-intervention card
  (`DynamicSolutionCard`) still appears exactly as before.

## 4. Immediate crisis resources (not just at the end)
- `checkImmediateRisk()` (new export in `src/utils/clinicalEngine.ts`) scans
  the mandatory safety question's answer for active-risk language.
- New `src/components/ImmediateCrisisCard.tsx` surfaces helpline resources
  right there in the flow if risk is detected, before continuing — instead
  of only showing them in the final report.
- The final report's existing safety-alert banner in
  `AssessmentResultsView.tsx` is unchanged and still appears if warranted.

## 5. Scoring/ranking unchanged in method, extended in vocabulary
No new algorithms were introduced. The existing lexicon-based sentiment
analysis, TF/cosine information-retrieval relevance, NDCG ranking-quality
metric, and bounded-randomization selection now draw from the larger
50-item pool. `SENTIMENT_LEXICON` (`adaptiveEngine.ts`) and the
`SEVERE_ANXIETY_DEPRESSION_KEYWORDS` / `MILD_STRAIN_KEYWORDS` /
`RESILIENT_KEYWORDS` lists (`clinicalEngine.ts`) were extended with
vocabulary the 15 new items introduce (freeze/shutdown, catastrophizing,
rumination, boundaries, masking, repair, etc.).

## Note
This environment has no network access, so `npm install` / `tsc --noEmit` /
`vite build` could not be run here to verify compilation. Changes were
reviewed manually for type/import/logic consistency; please run
`npm install && npm run lint && npm run build` after unzipping to confirm.
