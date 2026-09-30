/**
 * Shared tone-reading rules.
 *
 * ONE definition of the taxonomy, scales, output shape and repair rules that
 * every LLM reader in the tone ensemble must obey, so the Groq reader (server)
 * and the offline Phi-3 mini reader (browser) can never drift apart from the
 * scale NeuroScope DistilBERT and RoBERTa already use.
 *
 * Pure module: no imports, no DOM, no Node APIs. It is imported by
 * `server-app.ts`, by `localLlm.ts` and by the tests.
 */

export type ToneLabel = 'severe' | 'distressed' | 'neutral' | 'calm';

/** Most severe first. Used to pick the more severe of two disagreeing signals. */
export const TONE_SEVERITY_ORDER: readonly ToneLabel[] = ['severe', 'distressed', 'neutral', 'calm'];

/**
 * Output contract + guidance. Appended to each reader's own short intro.
 * (Moved verbatim out of `TONE_ANALYSIS_SYSTEM_PROMPT` in server-app.ts.)
 */
export const TONE_OUTPUT_SPEC = `Respond with ONLY a single JSON object, no prose before or after it, in exactly this shape:
{
  "label": "severe" | "distressed" | "neutral" | "calm",
  "score": <number from -1 (severe distress) to 1 (calm/positive)>,
  "magnitude": <number from 0 (no discernible emotional language) to 1 (very strong/certain)>,
  "topEmotion": "anger" | "disgust" | "fear" | "joy" | "neutral" | "sadness" | "surprise",
  "rationale": "<one short clause, under 15 words, on what drove this reading>"
}

Guidance:
- "severe" is for language suggesting crisis-level distress, hopelessness, or self-harm/suicidal ideation (even indirect, e.g. "everyone would be better off without me").
- "distressed" is for clear but non-crisis negative affect (anxious, low, overwhelmed, irritable).
- "calm" is for genuinely settled, content, or positive language.
- "neutral" is for factual, ambiguous, or affect-flat text.
- Never soften a "severe" read out of politeness — under-calling risk is the worse error here.`;

/**
 * Score -> label thresholds. These are the same cut-offs
 * `ensembleTransformerSentiment()` / `ensembleThreeWaySentiment()` apply to a
 * fused score, so a reader's label and score always mean the same thing.
 */
export function labelFromScore(score: number): ToneLabel {
  if (score <= -0.5) return 'severe';
  if (score < -0.05) return 'distressed';
  if (score > 0.05) return 'calm';
  return 'neutral';
}

function severityRank(label: ToneLabel): number {
  return TONE_SEVERITY_ORDER.indexOf(label);
}

/**
 * Pull the first balanced JSON object out of a model reply. Small local models
 * often wrap JSON in prose or code fences; the server-side Groq path used
 * `JSON.parse` on the raw text, which is too strict for a 3.8B model.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/```json|```/gi, '');
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface ToneReadingCore {
  label: ToneLabel;
  /** -1 (severe) .. 1 (calm) */
  score: number;
  /** 0 .. 1 */
  magnitude: number;
}

/**
 * Validate and repair a raw LLM reading so it obeys the shared taxonomy.
 *
 *  - Unknown label AND unusable score  -> null (no reading; the ensemble
 *    degrades to the two transformers, exactly like a Groq timeout).
 *  - Values are clamped to the shared scales.
 *  - Label and score must agree. If they disagree the MORE SEVERE one wins and
 *    the score is pulled to the matching band ("under-calling risk is the worse
 *    error", same rule as the Groq prompt). A reader can therefore never
 *    contradict itself into looking calmer than it said.
 */
export function reconcileToneReading(raw: unknown): ToneReadingCore | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const rawLabel = typeof r.label === 'string' ? (r.label.trim().toLowerCase() as ToneLabel) : undefined;
  const labelOk = !!rawLabel && TONE_SEVERITY_ORDER.includes(rawLabel);

  const numericScore = typeof r.score === 'number' ? r.score : Number(r.score);
  const scoreOk = Number.isFinite(numericScore);

  if (!labelOk && !scoreOk) return null;

  let score = scoreOk ? Math.max(-1, Math.min(1, numericScore)) : 0;
  const numericMagnitude = typeof r.magnitude === 'number' ? r.magnitude : Number(r.magnitude);
  let magnitude = Number.isFinite(numericMagnitude) ? Math.max(0, Math.min(1, numericMagnitude)) : 0;

  let label: ToneLabel;
  if (labelOk && scoreOk) {
    const fromScore = labelFromScore(score);
    label = severityRank(rawLabel!) <= severityRank(fromScore) ? rawLabel! : fromScore;
  } else if (labelOk) {
    label = rawLabel!;
  } else {
    label = labelFromScore(score);
  }

  // Pull the score into the chosen label's band when the label is the more severe signal.
  if (label === 'severe' && score > -0.5) score = -0.5;
  else if (label === 'distressed' && score >= -0.05) score = -0.1;
  else if (!scoreOk) {
    // Label only: use a representative score for the band.
    score = label === 'calm' ? 0.4 : label === 'neutral' ? 0 : label === 'distressed' ? -0.35 : -0.75;
  }

  // A distress label with no stated strength should not present as "no emotion".
  if (magnitude === 0 && label !== 'neutral') magnitude = Math.min(1, Math.abs(score));

  return { label, score: Number(score.toFixed(3)), magnitude: Number(magnitude.toFixed(3)) };
}

/**
 * Last-resort recovery for a reply that was cut off mid-JSON (a small local model
 * hitting its token limit) or wrapped in unusable prose: pull the three core
 * fields straight out of the text. Returns a partial object for
 * `reconcileToneReading`, which decides whether it is usable.
 */
export function salvageToneFields(raw: string): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  const label = /"label"\s*:\s*"([a-zA-Z]+)"/.exec(raw)?.[1];
  const score = /"score"\s*:\s*(-?\d*\.?\d+)/.exec(raw)?.[1];
  const magnitude = /"magnitude"\s*:\s*(-?\d*\.?\d+)/.exec(raw)?.[1];
  if (!label && !score) return null;
  return { label, score, magnitude };
}
