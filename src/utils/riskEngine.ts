/**
 * Dynamic risk engine.
 *
 * Replaces every fixed "35% / -0.35" safety threshold in the app with a
 * continuously re-scored risk assessment that combines:
 *
 *   1. Explicit high-risk semantic markers (tiered, phrase-aware),
 *   2. Embedding similarity between the answer and a bank of crisis-language
 *      exemplars (catches phrasings no word list could enumerate),
 *   3. The transformer tone reading for the current answer,
 *   4. The *rate of change* in tone across the session — deterioration is
 *      weighted, not just absolute level,
 *   5. Sustained distress emotions across consecutive answers, and
 *   6. The response to the mandatory safety-screener question.
 *
 * Positive/steady answers contribute protective negative weight, so a person
 * reporting improvement is not pushed toward a severe verdict by old answers.
 *
 * This module deliberately has no imports from the adaptive/clinical engines
 * (callers inject the tone reading and the answer text) which keeps the import
 * graph acyclic and lets the Express server reuse it verbatim.
 */

import type {
  EmotionClassification,
  NeuroScopeReading,
  Question,
  RiskAssessment,
  RiskLevel,
  RiskSignal,
  SemanticAnalysis,
  SentimentResult,
} from '../types.js';

// ---------------------------------------------------------------------------
// Marker banks
// ---------------------------------------------------------------------------

/** Imminent-risk language: intent, plan, means, active ideation. */
const IMMINENT_MARKERS: RegExp[] = [
  /\b(kill|killing)\s+(myself|me)\b/,
  /\bsuicid(e|al|ally)\b/,
  /\bend(ing)?\s+(my|it all|my own|it|everything|things|this)\b/,
  /\btak(e|ing)\s+my\s+(own\s+)?life\b/,
  /\b(have|had|made)\s+a\s+plan\b/,
  /\bplan(ned|ning)?\s+to\s+(die|end|kill|hurt)\b/,
  /\b(don'?t|do not|no longer)\s+want\s+to\s+(be here|live|be alive|wake up|exist)\b/,
  /\b(want|wish|wanted|wished)\s+to\s+(die|disappear|not wake|not exist|not be here)\b/,
  /\b(better off|happier)\s+(dead|without me|gone)\b/,
  /\bno\s+(reason|point)\s+(to|in)\s+(liv(e|ing)|keep(ing)?\s+going|be(ing)?\s+here|exist(ing)?)\b/,
  /\b(harm|harm(ing)?|hurt(ing)?|cut(ting)?|injur(e|ing))\s+(myself|me)\b/,
  /\bself[\s-]?harm\b/,
  /\boverdos(e|ed|ing)\b/,
  /\bgoodbye\s+(note|letter)\b/,
  /\b(can'?t|cannot)\s+(go on|keep going|take it|take this|do this)\s*(anymore|any\s*more)?\b/,
  /\b(want|wanted)\s+to\s+give\s+up\s+(on\s+)?(life|everything|it all)\b/,
  /\bfeel\s+(like\s+)?(a\s+)?burden\b/,
  /\bnobody\s+would\s+(miss|care|notice)\b/,
  /\btired\s+of\s+(living|being alive|life|existing|everything)\b/,
  /\bsick\s+of\s+(living|being alive|life|existing)\b/,
  /\b(life|everything)\s+(isn'?t|is not|feels)\s+(worth|worth it)\b/,
  /\bnot\s+worth\s+living\b/,
  /\brather\s+(not\s+(be\s+here|exist|wake up)|be\s+dead)\b/,
  /\bwish\s+i\s+(was|were)\s+(never\s+born|dead)\b/,
  /\bwish\s+i\s+(had\s+)?never\s+(been\s+)?born\b/,
  /\bwon'?t\s+be\s+(around|here)\s+(much longer|anymore)\b/,
  /\bnot\s+(going to|gonna)\s+be\s+(around|here)\s+(much longer|anymore)\b/,
  /\bwant\s+it\s+(all\s+)?to\s+(be\s+over|end|stop)\b/,
  /\bsay\s+goodbye\s+to\s+(everyone|everybody)\b/,
  /\bgetting\s+my\s+affairs\s+in\s+order\b/,
  /\b(thoughts|thinking)\s+(of|about)\s+(dying|death|ending it|ending my life|not existing|suicide)\b/,
  /\bi\s+(don'?t|do not)\s+want\s+to\s+be\s+alive\b/,
];

/** Serious but non-imminent distress markers (each carries a small weight). */
const DISTRESS_MARKERS: RegExp[] = [
  /\bhopeless(ness)?\b/,
  /\bworthless(ness)?\b/,
  /\bhelpless(ness)?\b/,
  /\btrapp(ed|ing)\b/,
  /\bno\s+way\s+out\b/,
  /\bempty|emptiness\b/,
  /\bnumb(ness)?\b/,
  /\bdespair\b/,
  /\bgiving?\s+up\b/,
  /\bcan'?t\s+cope\b/,
  /\bcompletely\s+(alone|isolated)\b/,
  /\bhate\s+myself\b/,
  /\bfeel\s+nothing\b/,
];

/** Words that read as recovery/protective and pull the score down. */
const PROTECTIVE_MARKERS: RegExp[] = [
  /\b(safe|safer|safety\s+plan)\b/,
  /\b(support(ive)?\s+(system|network|person|people)|have\s+people)\b/,
  /\b(therapist|therapy|counsell?or|psychiatrist|doctor|support\s+group)\b/,
  /\b(hopeful|optimistic|looking\s+forward)\b/,
  /\b(improving|improved|better\s+than|getting\s+better|progress)\b/,
  /\b(coping|manageable|managing|handling\s+it)\b/,
  /\b(grateful|thankful)\b/,
  /\b(exercise|walk(ing)?|meditat(e|ing|ion)|journal(ing)?|breath(e|ing))\b/,
  /\b(would\s+never|don'?t\s+want\s+to\s+die|value\s+my\s+life|love\s+my\s+life)\b/,
  // Denial of a catastrophizing/distortion premise the question itself was
  // asking about — e.g. "I usually consider likely outcomes, not just
  // worst-case ones" in answer to "do you assume the worst...". Small
  // classifiers are known to struggle with this shape of negation, so it is
  // a common source of false-positive severity reads; treating it as
  // protective evidence (not an override) lets the existing marker-based
  // scoring counterbalance it the same way it already does for other
  // protective language.
  /\b(don'?t|doesn'?t|didn'?t|not|never|rarely|seldom)\b[^.?!]{0,30}\b(assume|expect|think)\s+the\s+worst\b/,
  /\bnot\s+(just|only)\s+(the\s+)?worst[\s-]?case\b/,
  /\bconsider(ing)?\s+(the\s+)?(likely|realistic|probable)\s+outcomes?\b/,
  /\brarely\s+catastrophiz(e|ing)?\b/,
];

export interface MarkerScan {
  imminent: string[];
  distress: string[];
  protective: string[];
}

/** Scan one answer for risk/protective language. Exported so the clinical
 * engine and the server can share exactly the same marker semantics. */
export function scanRiskMarkers(text: string): MarkerScan {
  const lower = ` ${(text || '').toLowerCase()} `;
  const collect = (patterns: RegExp[]) => {
    const hits: string[] = [];
    for (const pattern of patterns) {
      const match = lower.match(pattern);
      if (match) hits.push(match[0].trim());
    }
    return hits;
  };
  return {
    imminent: collect(IMMINENT_MARKERS),
    distress: collect(DISTRESS_MARKERS),
    protective: collect(PROTECTIVE_MARKERS),
  };
}

/** True when the text carries imminent-risk language (used by the immediate
 * crisis interrupt, which must stay synchronous and deterministic). */
export function hasImminentRiskLanguage(text: string): boolean {
  return scanRiskMarkers(text).imminent.length > 0;
}

/** Short, unambiguous denial of a safety concern. Only ever applied to the
 * mandatory safety screener: a plain "never" or "I value my life" there is
 * protective evidence, and saying so keeps a good answer from being dragged
 * down by the distress vocabulary elsewhere in the session. Deliberately
 * narrow — a hedged "not really" is NOT treated as a denial. */
const SAFETY_DENIAL =
  /^\s*(no|nope|nah|never|none|not at all|definitely not|absolutely not|no way|no never|i would never|i value my life|i want to live|no thoughts|no plans)\b/i;

export function deniesSafetyConcern(text: string): boolean {
  return SAFETY_DENIAL.test((text || '').trim());
}

/** Plain-language marker strings for prompt grounding / explainability. */
export const HIGH_RISK_MARKER_STRINGS: string[] = [
  'suicide',
  'kill myself',
  'end my life',
  'take my own life',
  'want to die',
  'wish I would not wake up',
  'better off dead',
  'no reason to live',
  'hurt myself',
  'self-harm',
  'cutting myself',
  'overdose',
  'have a plan',
  'goodbye note',
  'cannot go on',
  'feel like a burden',
  'nobody would miss me',
];

// ---------------------------------------------------------------------------
// Session tracking + rate-of-change
// ---------------------------------------------------------------------------

export interface RiskSample {
  questionId: number;
  questionIndex: number;
  score: number; // tone score, -1..1
  label: SentimentResult['label'];
  magnitude: number;
  level: RiskLevel;
}

export interface SessionRiskTracker {
  samples: RiskSample[];
  /** Highest level seen so far in this session. */
  peakLevel: RiskLevel;
  /** Question indexes for which a crisis card has already been surfaced. */
  escalatedAt: number[];
  /** Rolling exponential mean of tone, for rate-of-change. */
  ema: number | null;
  lastAssessment: RiskAssessment | null;
}

const LEVEL_ORDER: RiskLevel[] = ['low', 'elevated', 'high', 'critical'];

export function createSessionRiskTracker(): SessionRiskTracker {
  return { samples: [], peakLevel: 'low', escalatedAt: [], ema: null, lastAssessment: null };
}

export function resetSessionRiskTracker(tracker: SessionRiskTracker): void {
  tracker.samples = [];
  tracker.peakLevel = 'low';
  tracker.escalatedAt = [];
  tracker.ema = null;
  tracker.lastAssessment = null;
}

function levelRank(level: RiskLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

/** Linear slope of the last `window` tone scores, in points-per-answer. A
 * negative slope means the person is reporting worsening state. */
export function toneTrend(tracker: SessionRiskTracker, window = 4): number {
  const values = tracker.samples.slice(-window).map((s) => s.score);
  if (values.length < 2) return 0;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : Number((num / den).toFixed(4));
}

/** How much the tone has moved since the previous sample (EMA-smoothed). */
function rateOfChange(tracker: SessionRiskTracker, score: number): number {
  const previous = tracker.ema;
  if (previous === null) return 0;
  return Number((score - previous).toFixed(4));
}

function updateEma(tracker: SessionRiskTracker, score: number): void {
  const alpha = 0.45;
  tracker.ema = tracker.ema === null ? score : Number((alpha * score + (1 - alpha) * tracker.ema).toFixed(4));
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export interface RiskInput {
  question: Question;
  answerText: string;
  tone: SentimentResult;
  questionIndex: number;
  /** Transformer semantic pass for this answer, when the models were ready. */
  semantics?: SemanticAnalysis | null;
  /** Whether this is the always-included safety screener. */
  isSafetyQuestion: boolean;
  /** True when a short answer to the safety screener affirmed concern
   * ("yes", "sometimes", "active thoughts or plans"). */
  affirmsConcern?: boolean;
  /** True when a short answer to the safety screener denied concern
   * ("never", "no", "I value my life"). */
  deniesConcern?: boolean;
}

interface Contribution {
  signals: RiskSignal[];
  total: number;
}

export function assessAnswerRisk(tracker: SessionRiskTracker, input: RiskInput): RiskAssessment {
  const { tone, answerText, semantics } = input;
  const signals: RiskSignal[] = [];
  let score = 0;

  const add = (kind: RiskSignal['kind'], detail: string, weight: number) => {
    if (weight === 0) return;
    signals.push({ kind, detail, weight });
    score += weight;
  };

  // --- 1. Explicit markers -------------------------------------------------
  const markers = scanRiskMarkers(answerText);
  if (markers.imminent.length) {
    // Imminent language dominates: one hit is already a strong signal, and the
    // contribution is capped so a long answer cannot stack to 100 on words alone.
    const weight = Math.min(45, 30 + (markers.imminent.length - 1) * 8);
    add('marker', `Active-risk language detected: "${markers.imminent[0]}"`, weight);
  }
  if (markers.distress.length) {
    add(
      'marker',
      `Distress markers present: ${markers.distress.slice(0, 3).map((m) => `"${m}"`).join(', ')}`,
      Math.min(16, markers.distress.length * 6)
    );
  }

  // --- 2. Semantic similarity to crisis language ---------------------------
  if (semantics?.riskSimilarity != null) {
    const sim = semantics.riskSimilarity;
    if (sim >= 0.72) add('semantic', 'Answer closely matches crisis-language patterns', 35);
    else if (sim >= 0.6) add('semantic', 'Answer is semantically similar to crisis-language patterns', 22);
    else if (sim >= 0.5) add('semantic', 'Answer partially resembles crisis-language patterns', 12);
  }

  // --- 2b. PRIMARY classifier (NeuroScope DistilBERT dual-head) ------------
  // The project's own fine-tuned model is the primary clinical read of every
  // answer; both of its heads contribute evidence here so the dynamic score
  // reflects the trained model, not just the keyword/lexicon heuristics.
  const ns = semantics?.neuroscope;
  if (ns) {
    if (ns.band === 'critical') add('neuroscope', ns.summary, 48);
    else if (ns.band === 'high') add('neuroscope', ns.summary, 30);
    else if (ns.band === 'elevated') add('neuroscope', ns.summary, 12);
    else if (ns.riskFlag) add('neuroscope', ns.summary, 5);

    if (ns.topStatus !== 'Normal' && ns.pTop >= 0.5) {
      add(
        'neuroscope',
        `${ns.topStatus} dimension dominant at ${Math.round(ns.pTop * 100)}% confidence`,
        Math.min(13, 5 + Math.round(ns.pTop * 8))
      );
    } else if (ns.topStatus === 'Normal' && ns.pTop >= 0.6 && ns.pRisk < 0.12) {
      add('protective', 'Primary classifier reads the answer as Normal with high confidence', -6);
    }
  }

  // --- 3. Transformer tone -------------------------------------------------
  if (tone.label === 'severe') add('tone', 'Tone reading is severe', 30);
  else if (tone.label === 'distressed') add('tone', 'Tone reading is distressed', 12);

  // --- 4. Rate of change (deterioration matters, not just level) -----------
  const delta = rateOfChange(tracker, tone.score);
  if (delta <= -0.35) add('rate', 'Sharp deterioration since the last answer', 25);
  else if (delta <= -0.2) add('rate', 'Marked deterioration since the last answer', 15);
  else if (delta <= -0.1) add('rate', 'Gradual worsening across recent answers', 7);

  const slope = toneTrend(tracker, 4);
  if (slope <= -0.12 && delta <= -0.05) {
    add('rate', 'Accelerating downward trend across the session', 8);
  }

  // --- 5. Sustained distress ----------------------------------------------
  const recent = tracker.samples.slice(-2);
  const consecutiveNegative =
    recent.length === 2 && recent.every((s) => s.score < -0.05) && tone.score < -0.05;
  if (consecutiveNegative) add('rate', 'Negative tone sustained across consecutive answers', 10);

  if (semantics?.emotions) {
    const emotionWeight = sustainedEmotionWeight(semantics.emotions, tracker.samples.length);
    if (emotionWeight > 0) {
      add(
        'emotion',
        `Sustained ${semantics.emotions.top.label} dominates the emotional read`,
        emotionWeight
      );
    }
  }

  // --- 6. Safety screener --------------------------------------------------
  if (input.isSafetyQuestion) {
    if (input.affirmsConcern) {
      add('safety', 'Safety screener was answered in the affirmative', 25);
    } else if (input.deniesConcern) {
      add('protective', 'Safety screener was answered with a clear denial of risk', -8);
    }
  }

  // --- 7. Protective factors ----------------------------------------------
  if (markers.protective.length) {
    add(
      'protective',
      `Protective factors present: ${markers.protective.slice(0, 3).map((m) => `"${m}"`).join(', ')}`,
      -Math.min(14, markers.protective.length * 5)
    );
  }
  if (tone.label === 'calm' && tone.magnitude >= 0.15) {
    add('protective', 'Answer reads as calm and steady', -10);
  }
  if (
    semantics?.emotions &&
    (semantics.emotions.top.label === 'joy' || semantics.emotions.top.label === 'neutral') &&
    semantics.emotions.distressWeight < 0.25
  ) {
    add('protective', 'Emotional read shows low distress load', -4);
  }

  // Markers alone must not be able to hold the score at critical forever.
  score = Math.max(0, Math.min(100, Math.round(score)));

  let level: RiskLevel = 'low';
  if (score >= 80) level = 'critical';
  else if (score >= 55) level = 'high';
  else if (score >= 30) level = 'elevated';

  // Hard safety override: explicit self-harm/suicide language is decisive on
  // its own. No amount of "calm" wording elsewhere, no classifier confidence,
  // and no additive-score shortfall is allowed to keep this below critical —
  // the whole point of a marker hit is that it does not wait for corroborating
  // evidence. This also guarantees `shouldRaiseImmediateSupport` fires on the
  // very answer that contained the marker, not on some later downstream trend.
  if (markers.imminent.length) {
    level = 'critical';
    score = Math.max(score, 80);
  }

  const sample: RiskSample = {
    questionId: input.question.id,
    questionIndex: input.questionIndex,
    score: tone.score,
    label: tone.label,
    magnitude: tone.magnitude,
    level,
  };
  tracker.samples.push(sample);
  updateEma(tracker, tone.score);
  if (levelRank(level) > levelRank(tracker.peakLevel)) tracker.peakLevel = level;

  const assessment: RiskAssessment = {
    score,
    level,
    signals,
    toneTrend: slope,
    samples: tracker.samples.length,
    escalatedAtQuestion: levelRank(level) >= levelRank('high') ? input.questionIndex : undefined,
  };
  tracker.lastAssessment = assessment;
  return assessment;
}

function sustainedEmotionWeight(emotions: EmotionClassification, sampleCount: number): number {
  if (!emotions.distressDominant) return 0;
  let weight = emotions.distressWeight >= 0.75 ? 12 : emotions.distressWeight >= 0.55 ? 8 : 5;
  // Fear and sadness are the two emotions most predictive of internalizing
  // distress in the PROMIS/CAT-DI literature the app cites.
  if (emotions.top.label === 'fear' || emotions.top.label === 'sadness') weight += 3;
  // Weight it up slightly once a pattern (rather than a single bad answer) shows.
  if (sampleCount >= 2) weight += 2;
  return Math.min(18, weight);
}

// ---------------------------------------------------------------------------
// Thresholds derived from risk (replacements for the fixed 35% constants)
// ---------------------------------------------------------------------------

/**
 * Wellness-score cutoff below which a category is reported as "Severe Strain".
 * Low risk preserves the original 35; as risk escalates the cutoff rises, so
 * a deteriorating presentation is flagged sooner.
 */
export function dynamicSevereBand(level: RiskLevel = 'low'): number {
  switch (level) {
    case 'critical':
      return 60;
    case 'high':
      return 50;
    case 'elevated':
      return 42;
    default:
      return 35;
  }
}

/**
 * The question index (0-based) at which the mandatory safety screener is
 * injected. High risk pulls the screener forward — a person showing warning
 * signs is asked about safety almost immediately instead of at 35% through.
 */
export function dynamicMandatorySlot(totalQuestions: number, level: RiskLevel = 'low'): number {
  const bounded = Math.max(2, totalQuestions);
  switch (level) {
    case 'critical':
      return Math.max(1, Math.min(bounded - 1, 1));
    case 'high':
      return Math.max(1, Math.min(bounded - 1, Math.round(bounded * 0.2)));
    case 'elevated':
      return Math.max(1, Math.min(bounded - 1, Math.round(bounded * 0.28)));
    default:
      return Math.max(1, Math.min(bounded - 1, Math.round(bounded * 0.35)));
  }
}

/**
 * Whether the supportive/soft-help block should be offered alongside a
 * solution. Replaces the single `tone.score <= -0.35` test with the full risk
 * picture, while keeping the original tone trigger as one of its inputs.
 */
export function shouldOfferSoftSupport(tone: SentimentResult, risk?: RiskAssessment | null): boolean {
  if (tone.label === 'severe' || tone.label === 'distressed') return true;
  if (risk && risk.level !== 'low') return true;
  return tone.score <= -0.35;
}

/** Should the immediate in-flow crisis card be raised for this answer? */
export function shouldRaiseImmediateSupport(risk: RiskAssessment, tracker: SessionRiskTracker): boolean {
  const critical = risk.level === 'critical';
  const worsening = levelRank(risk.level) >= levelRank('high') && risk.toneTrend <= -0.12;
  if (!critical && !worsening) return false;
  const index = risk.escalatedAtQuestion;
  if (index == null) return false;
  // Show it once per escalation point rather than on every subsequent answer.
  if (tracker.escalatedAt.includes(index)) return false;
  tracker.escalatedAt.push(index);
  return true;
}

/** Compact, human-readable risk summary for logs, prompts and the UI. */
export function describeRisk(risk: RiskAssessment): string {
  const top = risk.signals
    .slice()
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 3)
    .map((s) => `${s.detail} (${s.weight > 0 ? '+' : ''}${s.weight})`);
  return `Risk ${risk.level} (${risk.score}/100)${top.length ? ` — ${top.join('; ')}` : ''}`;
}
