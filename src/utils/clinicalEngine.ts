import { AnswerRecord, AssessmentResult, DimensionScore, NeuroScopeReading, RiskAssessment, SolutionItem } from '../types';
import { dynamicSevereBand, hasImminentRiskLanguage, scanRiskMarkers } from './riskEngine';

/**
 * Client-side safety net for AI-provider responses (the server already
 * sanitizes /api/assess and /api/reassess, but this keeps the dashboard
 * correct even if a response bypasses that — e.g. a cached response, or a
 * future call site). A free-form LLM occasionally spells a dimension score
 * out in words ("sixty") instead of a number, which used to render
 * literally as "sixty%" in the UI. This coerces every dimension's score to
 * a real 0-100 number before it ever reaches React state.
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function wordsToScore(raw: string): number | null {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/percent|per cent|%/g, '')
    .replace(/-/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (cleaned === 'hundred' || cleaned === 'a hundred' || cleaned === 'one hundred') return 100;
  const parts = cleaned.split(' ').filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  let total = 0;
  let matched = false;
  for (const part of parts) {
    if (part === 'hundred') {
      total = (total || 1) * 100;
      matched = true;
    } else if (part in NUMBER_WORDS) {
      total += NUMBER_WORDS[part];
      matched = true;
    } else {
      return null;
    }
  }
  return matched ? total : null;
}

function coerceDimensionScore(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
  if (typeof v === 'string') {
    const trimmed = v.trim();
    const bare = trimmed.replace(/%$/, '');
    if (/^-?\d+(\.\d+)?$/.test(bare)) {
      return Math.max(0, Math.min(100, Math.round(Number(bare))));
    }
    const fromWords = wordsToScore(trimmed);
    if (fromWords !== null) return Math.max(0, Math.min(100, Math.round(fromWords)));
  }
  return 50; // unrecognized shape: neutral fallback rather than a broken display
}

/** Runs every dimension score through `coerceDimensionScore`, in place of
 * whatever the AI provider actually sent. Safe to call on results already
 * produced by the local engine (their scores are already clean numbers). */
export function normalizeAssessmentResult<T extends { dimensionalScores?: DimensionScore[] }>(result: T): T {
  if (!result || !Array.isArray(result.dimensionalScores)) return result;
  return {
    ...result,
    dimensionalScores: result.dimensionalScores.map((d) => ({
      ...d,
      score: coerceDimensionScore((d as unknown as { score: unknown }).score),
    })),
  };
}

/** How the PRIMARY NeuroScope reading modulates the local clinical report.
 * Aggregate statistics over every per-answer reading collected during the run
 * drive the severity floor; a single dominant dimension tilts the verdict. */
export interface NeuroScopeAggregate {
  readings: number;
  /** Mean risk probability across classified answers (0..1). */
  meanRisk: number;
  /** Max risk probability seen in any single answer (0..1). */
  maxRisk: number;
  /** Dominant dimension by aggregated confidence across the run. */
  dominantStatus: string;
  dominantShare: number;
  /** The single answer with the highest pRisk (max-pooled evidence). */
  peak: NeuroScopeReading | null;
  /** How many answers landed in each dynamic band. */
  bands: { low: number; elevated: number; high: number; critical: number };
}

/** Folds every per-answer NeuroScope reading into the aggregate the report
 * uses. Accepts either bare readings (what the App collects) or full
 * SemanticAnalysis objects (readings travel on `.neuroscope`). */
export function aggregateNeuroScope(
  analyses: (NeuroScopeReading | SemanticAnalysisLite | undefined | null)[]
): NeuroScopeAggregate | null {
  const readings = analyses
    .map((a) => (a ? (a as SemanticAnalysisLite).neuroscope ?? (a as NeuroScopeReading) : null))
    .filter((r): r is NeuroScopeReading => !!r && typeof r === 'object' && typeof (r as NeuroScopeReading).pRisk === 'number');
  if (!readings.length) return null;

  const tally = new Map<string, number>();
  let peak: NeuroScopeReading | null = null;
  let meanRisk = 0;
  const bands = { low: 0, elevated: 0, high: 0, critical: 0 };
  for (const r of readings) {
    meanRisk += r.pRisk;
    if (!peak || r.pRisk > peak.pRisk) peak = r;
    tally.set(r.topStatus, (tally.get(r.topStatus) || 0) + r.pTop);
    bands[r.band] += 1;
  }
  let dominantStatus = 'Normal';
  let dominantShare = 0;
  for (const [status, weight] of tally) {
    if (weight > dominantShare) {
      dominantShare = weight;
      dominantStatus = status;
    }
  }
  return {
    readings: readings.length,
    meanRisk: meanRisk / readings.length,
    maxRisk: peak?.pRisk ?? 0,
    dominantStatus,
    dominantShare,
    peak,
    bands,
  };
}

/** Minimal structural view of SemanticAnalysis for the helpers above, so the
 * clinical engine stays import-light (full type lives in ../types). */
interface SemanticAnalysisLite {
  neuroscope?: NeuroScopeReading | null;
  [key: string]: unknown;
}

/**
 * Built-in Clinical & Psychological Assessment Rubric
 * Evaluates sentiment, behavioral indicators, somatic patterns, cognitive reality testing,
 * risk factors, and social connectedness based on the 20 screening questions.
 */

export const RISK_KEYWORDS = [
  'suicide', 'kill myself', 'end my life', 'harm myself', 'not worth living',
  'better off dead', 'want to die', 'overdose', 'cut myself', 'hang myself'
];

const SEVERE_ANXIETY_DEPRESSION_KEYWORDS = [
  'unbearable', 'hopeless', 'worthless', 'agony', 'paralyzed', 'nightmare',
  'can\'t take it', 'panic attacks', 'agony', 'suffocating', 'hallucination',
  'voices', 'paranoia', 'conspiring', 'substance', 'relapse', 'binge',
  // grounded in polyvagal (hypervigilance / persistent threat-detection) and
  // trauma-informed-care (intrusive re-experiencing, avoidance) literature
  'hypervigilant', 'flashback', 'reliving', 'on guard', 'explode', 'unsafe',
  // added from the expanded 50-item pool: catastrophic/ruminative cognition,
  // dorsal-vagal freeze/shutdown, identity disruption, pervasive burden
  'catastrophizing', 'frozen', 'shut down', 'stuck', 'unrecognizable',
  'don\'t know who i am', 'burden', 'pointless', 'blank'
];

const MILD_STRAIN_KEYWORDS = [
  'tired', 'stressed', 'exhausted', 'busy', 'overworked', 'burnout', 'procrastinating',
  'sleepy', 'irritated', 'restless', 'down', 'foggy', 'drained',
  'guarded', 'wary', 'temper', 'grudge', 'avoid',
  // added from the expanded 50-item pool
  'overthinking', 'replay', 'mask', 'facade', 'boundaries', 'people-pleasing',
  'linger', 'distance'
];

const RESILIENT_KEYWORDS = [
  'good', 'calm', 'fine', 'stable', 'balanced', 'peaceful', 'manageable',
  'consistent', 'healthy', 'supportive', 'trusted', 'optimistic', 'happy',
  // grounded in the polyvagal "vagal brake" / co-regulation concept: the
  // ability to actively settle the body, not just the absence of distress
  'settle', 'settled', 'grounded', 'soothe', 'regulated',
  // added from the expanded 50-item pool: repair capacity, authenticity,
  // and comfortable help-seeking as resilience markers
  'reconnect', 'repair', 'authentic', 'look forward'
];

/**
 * Lightweight, synchronous check for active self-harm / suicide risk
 * language in a single answer. Used to surface crisis resources
 * immediately, in the middle of an assessment, rather than waiting for the
 * final report — because an in-the-moment safety response should never be
 * delayed until the last question is answered.
 */
// A short, direct answer to the mandatory self-harm/safety screener — this
// is only ever checked against that one question, so any non-trivial
// affirmative or frequency word here (even a bare "yes") is treated as a
// reason to surface support immediately rather than assuming it needs to
// spell out specific risk language to count. Over-caution is the correct
// default for this specific question.
const SHORT_AFFIRMATIVE_ON_SAFETY_QUESTION =
  /^\s*(yes|yeah|yep|yup|definitely|sometimes|occasionally|a little|a bit|somewhat|often|frequently|honestly yes|kind of|sort of|sometimes i do)\b/i;

export function checkImmediateRisk(answerText: string): boolean {
  const lower = (answerText || '').toLowerCase();
  if (!lower.trim()) return false;
  return (
    RISK_KEYWORDS.some((kw) => lower.includes(kw)) ||
    lower.includes('active thoughts') ||
    lower.includes('passive wish') ||
    lower.includes('fleeting') ||
    (lower.includes('harm') && (lower.includes('myself') || lower.includes('self'))) ||
    SHORT_AFFIRMATIVE_ON_SAFETY_QUESTION.test(lower.trim())
  );
}

export const DEFAULT_HELPLINES = [
  {
    name: 'India: Tele-MANAS (Govt of India 24/7 Helpline)',
    contact: 'Call 14416 or 1800-891-4416',
    description: 'Free, 24x7 toll-free crisis & tele-mental health support across India in English, Hindi & 20+ regional languages.',
    region: 'India (Toll-Free 24/7)',
    type: 'call' as const
  },
  {
    name: 'India: Crisis Text Line & WhatsApp (Vandrevala Foundation)',
    contact: 'WhatsApp or Call: +91 9999 666 555',
    description: 'Free, 24/7 suicide prevention & crisis counseling via WhatsApp chat and phone call across India.',
    region: 'India (Call & WhatsApp 24/7)',
    type: 'text' as const
  },
  {
    name: 'India: KIRAN National Mental Health Helpline',
    contact: 'Call 1800-599-0019',
    description: '24/7 national toll-free helpline by Ministry of Social Justice & Empowerment, Govt. of India.',
    region: 'India (Toll-Free)',
    type: 'call' as const
  },
  {
    name: 'India: AASRA 24/7 Suicide Prevention Helpline',
    contact: 'Call +91-9820466726',
    description: '24/7 confidential crisis intervention and emotional support helpline in India.',
    region: 'India (24/7)',
    type: 'call' as const
  },
  {
    name: 'US & Canada: Suicide & Crisis Lifeline',
    contact: 'Call or text 988',
    description: 'Free, confidential 24/7 support from trained crisis counselors.',
    region: 'US & Canada',
    type: 'call' as const
  },
  {
    name: 'US, UK & Canada: Crisis Text Line',
    contact: 'Text HOME to 741741',
    description: 'Free 24/7 crisis support via SMS messaging.',
    region: 'US / UK / Canada',
    type: 'text' as const
  },
  {
    name: 'International Helplines (Befrienders Worldwide)',
    contact: 'https://www.befrienders.org',
    description: 'Confidential crisis support and emotional assistance across 30+ countries globally.',
    region: 'Global',
    type: 'web' as const
  }
];

/** Curated crisis-level set: always includes at least two India lines and
 * two international lines together, rather than an arbitrary slice of the
 * list (which, in original array order, would surface India-only numbers
 * and never show an international option). Used for the mandatory
 * safety-screener crisis card and the "severe" tone dynamic solution. */
export const PRIORITY_CRISIS_HELPLINES = [
  DEFAULT_HELPLINES[0], // India: Tele-MANAS
  DEFAULT_HELPLINES[1], // India: Vandrevala (Call & WhatsApp)
  DEFAULT_HELPLINES[4], // US & Canada: 988
  DEFAULT_HELPLINES[6], // International: Befrienders Worldwide
];

/** Lighter-touch set for a "distressed but not crisis-level" tone — offered
 * as a gentle, optional invitation rather than an urgent alert, still
 * covering both India and an international option. */
export const SOFT_SUPPORT_HELPLINES = [
  DEFAULT_HELPLINES[0], // India: Tele-MANAS
  DEFAULT_HELPLINES[4], // US & Canada: 988
];

/* ------------------------------------------------------------------ *
 * Dynamic per-dimension judgement
 * ------------------------------------------------------------------
 * Previously every category landing in the same score band (e.g. "Mild
 * Strain") received one of only four fixed sentences, verbatim, no matter
 * which of the 5 life dimensions it was or what the person actually wrote.
 * This builds the summary from the specific signal that drove the score —
 * the actual matched keyword/tier per category — plus a category-aware
 * closing clause, so the "judgement" varies with the real evidence instead
 * of just the numeric band it happens to fall in.
 * ------------------------------------------------------------------ */

type SignalTier = 'risk' | 'severe' | 'mild' | 'resilient';
interface DimensionSignal { tier: SignalTier; term: string; }

const CATEGORY_FOCUS_NOUN: Record<string, string> = {
  'Mood and Emotional State': 'your emotional balance',
  'Daily Functioning and Physical Well-being': 'your physical rhythm and daily functioning',
  'Thought Patterns and Perception of Reality': 'your thought clarity and reality testing',
  'Stress, Coping, and Impulse Control': 'your coping bandwidth and impulse control',
  'Social Connections and Relationships': 'your social connection',
};

const STATUS_CLOSERS: Record<DimensionScore['status'], string[]> = {
  Optimal: [
    'looks steady and well-regulated right now.',
    'is holding a healthy, resilient baseline.',
    'shows solid footing with no red flags.',
  ],
  'Mild Strain': [
    'shows a slight wobble, though your underlying coping foundation is still active.',
    'is carrying light strain that hasn\u2019t tipped into anything disruptive yet.',
    'is mildly stretched but still fundamentally intact.',
  ],
  'Moderate Concern': [
    'is carrying a noticeable weight that\u2019s affecting your day-to-day equilibrium.',
    'shows a meaningful dip that\u2019s worth actively tending to.',
    'is under real, sustained pressure right now.',
  ],
  'Severe Strain': [
    'is under marked disruption and would benefit from targeted relief and active support.',
    'shows significant strain that deserves priority attention.',
    'has been pushed well past its comfortable range.',
  ],
};

const NEUTRAL_SIGNAL_OPENERS: Record<string, string[]> = {
  'Mood and Emotional State': [
    'No strong emotional red flags surfaced in your answers here;',
    'Your responses here read as fairly emotionally even-keeled;',
  ],
  'Daily Functioning and Physical Well-being': [
    'Your day-to-day routine and energy came through as broadly stable;',
    'Nothing in your answers pointed to major disruption in sleep, appetite, or routine;',
  ],
  'Thought Patterns and Perception of Reality': [
    'Your thinking patterns read as clear and grounded in your answers;',
    'No strong signs of rumination or distorted thinking surfaced here;',
  ],
  'Stress, Coping, and Impulse Control': [
    'Your responses suggest your coping toolkit is generally holding up;',
    'No major impulse-control or overwhelm signals came through here;',
  ],
  'Social Connections and Relationships': [
    'Your answers suggest your support network is reasonably intact;',
    'No strong isolation or conflict signals surfaced in this area;',
  ],
};

const TIER_TEMPLATES: Record<Exclude<SignalTier, 'resilient'>, (term: string) => string> = {
  risk: (term) => `A response touching on "${term}" was flagged as a priority safety signal;`,
  severe: (term) => `Language like "${term}" pointed to real weight in this area;`,
  mild: (term) => `Signs such as "${term}" suggest mild strain here;`,
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Simple deterministic index so the same inputs always render the same
 * sentence within one report, but different categories/scores naturally
 * land on different variants instead of one sentence being reused everywhere. */
function pickIndex(seed: string, length: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % length;
}

function buildDynamicDimensionSummary(
  category: string,
  status: DimensionScore['status'],
  scoreVal: number,
  signals: DimensionSignal[]
): string {
  const noun = CATEGORY_FOCUS_NOUN[category] || 'this area';
  const closerOptions = STATUS_CLOSERS[status];
  const closer = closerOptions[pickIndex(`${category}|${status}|${scoreVal}`, closerOptions.length)];

  // Prefer the most severe signal actually detected (risk > severe > mild),
  // so the sentence names the real evidence rather than a generic band.
  const priority: SignalTier[] = ['risk', 'severe', 'mild'];
  const bestSignal = priority
    .map((tier) => signals.find((s) => s.tier === tier))
    .find((s): s is DimensionSignal => !!s);

  if (bestSignal) {
    const opener = TIER_TEMPLATES[bestSignal.tier as Exclude<SignalTier, 'resilient'>](bestSignal.term);
    return `${opener} ${cap(noun)} ${closer}`;
  }

  const resilientSignal = signals.find((s) => s.tier === 'resilient');
  if (resilientSignal) {
    return `References to "${resilientSignal.term}" reflect steady footing here; ${noun} ${closer}`;
  }

  const openers = NEUTRAL_SIGNAL_OPENERS[category] || ['Nothing notable stood out in your answers here;'];
  const opener = openers[pickIndex(`${category}|${scoreVal}`, openers.length)];
  return `${opener} ${noun} ${closer}`;
}

export function analyzeAnswersLocally(
  answers: AnswerRecord[],
  customFeedback?: string,
  risk?: RiskAssessment | null,
  neuroscope?: NeuroScopeAggregate | null
): AssessmentResult {
  // Category accumulators
  const categories = [
    'Mood and Emotional State',
    'Daily Functioning and Physical Well-being',
    'Thought Patterns and Perception of Reality',
    'Stress, Coping, and Impulse Control',
    'Social Connections and Relationships'
  ];

  const cleanFeedback = customFeedback?.trim() || '';
  const feedbackLower = cleanFeedback.toLowerCase();

  // Severity cutoff driven by the live risk engine (semantic high-risk
  // markers + rate-of-change across the run) instead of a fixed percentage.
  // At low risk this evaluates to the original 35-point band, so nothing
  // changes for an ordinary assessment; it only tightens when the dynamic
  // tracker has actually seen escalating signals.
  const severeBand = dynamicSevereBand(risk?.level ?? 'low');

  let totalDistressPoints = 0;
  let hasCriticalSafetyFlag = false;

  // Dynamic risk triggers: a critical live-risk level (imminent semantic
  // markers, sharp negative rate-of-change, or an affirmed safety screener)
  // activates priority care even if no single answer repeats a keyword.
  if (risk?.level === 'critical') {
    hasCriticalSafetyFlag = true;
  }

  // Check safety question specifically (Q15) or explicit active self-harm in custom feedback
  if (cleanFeedback && RISK_KEYWORDS.some((kw) => feedbackLower.includes(kw))) {
    hasCriticalSafetyFlag = true;
  }
  if (cleanFeedback && hasImminentRiskLanguage(cleanFeedback)) {
    hasCriticalSafetyFlag = true;
  }

  let dimensionScores: DimensionScore[] = categories.map((cat) => {
    const catAnswers = answers.filter((a) => a.category === cat);
    let catDistress = 0;

    // Tracks which specific keyword actually drove the distress math for
    // this category, so the summary can name the real signal instead of
    // reusing one fixed sentence for every category that lands in the same
    // score band.
    const matchedSignals: { tier: 'risk' | 'severe' | 'mild' | 'resilient'; term: string }[] = [];

    catAnswers.forEach((record) => {
      const lower = record.answer.toLowerCase();

      // Semantic high-risk marker scan: catches crisis phrasing that the
      // literal keyword list misses ("I have a plan", "nobody would miss
      // me", "I can't go on") and feeds the same escalation path.
      const markers = scanRiskMarkers(record.answer);
      if (markers.imminent.length > 0) {
        hasCriticalSafetyFlag = true;
      }

      // Check safety question specifically (Q15: self-harm)
      if (record.questionId === 15) {
        if (RISK_KEYWORDS.some((kw) => lower.includes(kw)) || lower.includes('active thoughts') || lower.includes('harm')) {
          hasCriticalSafetyFlag = true;
          catDistress += 5;
        } else if (lower.includes('passive wish') || lower.includes('intrusive')) {
          catDistress += 3;
          matchedSignals.push({ tier: 'severe', term: lower.includes('passive wish') ? 'passive wish' : 'intrusive' });
        }
      }

      const riskHit = RISK_KEYWORDS.find((kw) => lower.includes(kw));
      const severeHit = SEVERE_ANXIETY_DEPRESSION_KEYWORDS.find((kw) => lower.includes(kw));
      const mildHit = MILD_STRAIN_KEYWORDS.find((kw) => lower.includes(kw));
      const resilientHit = RESILIENT_KEYWORDS.find((kw) => lower.includes(kw));

      // Check general risk words
      if (markers.imminent.length > 0 || riskHit) {
        catDistress += 5;
        hasCriticalSafetyFlag = true;
        matchedSignals.push({ tier: 'risk', term: riskHit || markers.imminent[0] });
      } else if (severeHit || markers.distress.length >= 2) {
        catDistress += 3;
        matchedSignals.push({ tier: 'severe', term: severeHit || markers.distress[0] });
      } else if (mildHit || markers.distress.length === 1) {
        catDistress += 2;
        matchedSignals.push({ tier: 'mild', term: mildHit || markers.distress[0] });
      } else if (resilientHit || markers.protective.length > 0) {
        catDistress += 0.5;
        matchedSignals.push({ tier: 'resilient', term: resilientHit || markers.protective[0] });
      } else {
        catDistress += 1.5;
      }
    });

    const maxCatPoints = (catAnswers.length || 1) * 5;
    totalDistressPoints += catDistress;

    // Convert to 0-100 well-being score (higher is healthier)
    const wellnessRatio = Math.max(0, Math.min(1, 1 - catDistress / maxCatPoints));
    const scoreVal = Math.round(wellnessRatio * 100);

    let status: DimensionScore['status'] = 'Optimal';
    if (scoreVal < severeBand) status = 'Severe Strain';
    else if (scoreVal < 60) status = 'Moderate Concern';
    else if (scoreVal < 80) status = 'Mild Strain';

    const summary = buildDynamicDimensionSummary(cat, status, scoreVal, matchedSignals);

    return {
      category: cat,
      score: scoreVal,
      status,
      summary
    };
  });

  // If the user submitted custom feedback, dynamically recalibrate dimension scores to reflect their exact lived experience
  if (cleanFeedback.length > 0) {
    const isHeartbroken = /heartbreak|heartbroken|breakup|broke up|ex-|partner|divorce|cheated|dumped|love lost|unrequited|grief|lost love|relationship/i.test(feedbackLower);
    const isAnxious = /panic|chest tight|racing heart|terror|scared|dread|can't breathe|shaking|anxiety/i.test(feedbackLower);
    const isBurnout = /burnout|exhaust|workload|boss|job|career|exam|exams|studying|deadline|drained|tired|overwork/i.test(feedbackLower);
    const isOverthinking = /overthinking|racing thoughts|can't stop thinking|mind won't shut off|loop|obsess|confus/i.test(feedbackLower);
    const isLonely = /lonely|alone|no friends|abandoned|nobody cares|unseen|alienated|isolated/i.test(feedbackLower);
    const isDepressed = /depress|empty|numb|hopeless|worthless|pointless|crying|suicid/i.test(feedbackLower);
    const isHopeful = /hopeful|better|relieved|grateful|optimistic|healing|calmer|peace/i.test(feedbackLower);

    dimensionScores = dimensionScores.map((d) => {
      let score = d.score;
      let summary = d.summary;

      if (isHeartbroken) {
        if (d.category === 'Mood and Emotional State') {
          score = Math.max(15, Math.min(score - 20, 35));
          summary = `Recalibrated: Deep emotional ache and acute heartache processing noted from your reflection ("${cleanFeedback.slice(0, 35)}${cleanFeedback.length > 35 ? '...' : ''}").`;
        } else if (d.category === 'Social Connections and Relationships') {
          score = Math.max(18, Math.min(score - 25, 38));
          summary = `Recalibrated: Acute relational rupture and interpersonal grief placing heavy strain on attachment reserves.`;
        }
      } else if (isBurnout) {
        if (d.category === 'Daily Functioning and Physical Well-being') {
          score = Math.max(18, Math.min(score - 25, 34));
          summary = `Recalibrated: Severe autonomic fatigue and physiological energy depletion reflecting your shared experience.`;
        } else if (d.category === 'Stress, Coping, and Impulse Control') {
          score = Math.max(22, Math.min(score - 15, 42));
          summary = `Recalibrated: Coping bandwidth drained by cumulative workload, academic pressure, or boundary erosion.`;
        }
      } else if (isAnxious) {
        if (d.category === 'Stress, Coping, and Impulse Control') {
          score = Math.max(15, Math.min(score - 25, 32));
          summary = `Recalibrated: Acute sympathetic fight-or-flight arousal and nervous system alarm loops active.`;
        } else if (d.category === 'Thought Patterns and Perception of Reality') {
          score = Math.max(20, Math.min(score - 15, 40));
          summary = `Recalibrated: Cognitive threat-detection hypervigilance and somatic anxiety patterns.`;
        }
      } else if (isLonely) {
        if (d.category === 'Social Connections and Relationships') {
          score = Math.max(15, Math.min(score - 30, 30));
          summary = `Recalibrated: Profound emotional isolation and unmet evolutionary need for safe co-regulation.`;
        }
      } else if (isOverthinking) {
        if (d.category === 'Thought Patterns and Perception of Reality') {
          score = Math.max(20, Math.min(score - 20, 38));
          summary = `Recalibrated: Prefrontal cognitive loop overdrive and rumination cycles requiring somatic decoupling.`;
        }
      } else if (isDepressed) {
        if (d.category === 'Mood and Emotional State') {
          score = Math.max(15, Math.min(score - 25, 28));
          summary = `Recalibrated: Heavy depressive numbness, low dopamine motivation, and deep emotional weight.`;
        }
      } else if (isHopeful) {
        score = Math.min(95, score + 15);
        summary = `Recalibrated: Positive upward shift and conscious resilience noted from your encouraging reflection.`;
      } else {
        if (d.category === 'Mood and Emotional State') {
          score = Math.max(20, Math.min(score - 10, 50));
          summary = `Recalibrated to integrate your personal reflection: "${cleanFeedback.slice(0, 45)}${cleanFeedback.length > 45 ? '...' : ''}".`;
        }
      }

      let status: DimensionScore['status'] = 'Optimal';
      if (score < severeBand) status = 'Severe Strain';
      else if (score < 60) status = 'Moderate Concern';
      else if (score < 80) status = 'Mild Strain';

      return {
        ...d,
        score,
        status,
        summary
      };
    });
  }

  // Calculate overall severity
  const avgWellness = dimensionScores.reduce((acc, d) => acc + d.score, 0) / dimensionScores.length;

  let overallVerdict = 'Flourishing & Mentally Resilient';
  let severityLevel: AssessmentResult['severityLevel'] = 'optimal';
  let verdictSummary = '';
  let motivationalMessage = '';

  if (cleanFeedback.length > 0) {
    // FRESH RECALIBRATED REPORT BASED ON CUSTOM EXPRESSION
    const isHeartbroken = /heartbreak|heartbroken|breakup|broke up|ex-|partner|divorce|cheated|dumped|love lost|unrequited|grief|lost love|relationship/i.test(feedbackLower);
    const isAnxious = /panic|chest tight|racing heart|terror|scared|dread|can't breathe|shaking|anxiety/i.test(feedbackLower);
    const isBurnout = /burnout|exhaust|workload|boss|job|career|exam|exams|studying|deadline|drained|tired|overwork/i.test(feedbackLower);
    const isOverthinking = /overthinking|racing thoughts|can't stop thinking|mind won't shut off|loop|obsess|confus/i.test(feedbackLower);
    const isLonely = /lonely|alone|no friends|abandoned|nobody cares|unseen|alienated|isolated/i.test(feedbackLower);
    const isDepressed = /depress|empty|numb|hopeless|worthless|pointless|crying/i.test(feedbackLower);
    const isHopeful = /hopeful|better|relieved|grateful|optimistic|healing|calmer|peace/i.test(feedbackLower);

    if (isHeartbroken) {
      severityLevel = hasCriticalSafetyFlag ? 'critical' : 'high';
      overallVerdict = hasCriticalSafetyFlag
        ? 'Recalibrated: Acute Relational Heartbreak & Vulnerability (Priority Care Active)'
        : 'Recalibrated: Profound Heartbreak & Relational Grief Processing';
      verdictSummary = `Your screening report has been freshly recalibrated to directly honor your personal expression: "${cleanFeedback}". Heartbreak is not merely psychological—neuroimaging confirms that relational rupture and romantic rejection activate the dorsal anterior cingulate cortex, triggering the identical neural pathways as severe physical pain. Your autonomic system is processing profound attachment grief, somatic ache, and emotional vulnerability.`;
      motivationalMessage = `Heartbreak carries an excruciating weight, and your tears and heartache are proof of how deeply and beautifully you are capable of loving. Be exceedingly tender with yourself today. You do not have to "move on" or fix everything right now; just taking one gentle breath at a time is a triumph of courage. You are fundamentally whole, worthy of fierce tenderness, and this dark valley is a chapter, not your whole story.`;
    } else if (isBurnout) {
      severityLevel = hasCriticalSafetyFlag ? 'critical' : 'high';
      overallVerdict = hasCriticalSafetyFlag
        ? 'Recalibrated: Autonomic Burnout & Vulnerability (Priority Care Active)'
        : 'Recalibrated: Cumulative Physiological Burnout & Energy Depletion';
      verdictSummary = `Freshly recalibrated around your reflection: "${cleanFeedback}". Your nervous system has endured prolonged sympathetic overdrive followed by an unavoidable parasympathetic exhaustion crash. Your fatigue is a biological boundary demanding genuine, non-demanding restorative pauses.`;
      motivationalMessage = `Burnout is an environmental toll on your nervous system, never an inherent character flaw. Give yourself unconditional permission to lower impossible expectations today. Rest is not something you have to earn; resting is how your brain rebuilds resilience.`;
    } else if (isAnxious) {
      severityLevel = hasCriticalSafetyFlag ? 'critical' : 'high';
      overallVerdict = hasCriticalSafetyFlag
        ? 'Recalibrated: Acute Panic Arousal & Vulnerability (Priority Care Active)'
        : 'Recalibrated: Sympathetic Hyperarousal & Acute Anxiety Strain';
      verdictSummary = `Freshly recalibrated to address your expression: "${cleanFeedback}". Your amygdala and locus coeruleus have activated an intense sympathetic surge, causing somatic tightness, rapid breathing, and perceived threat alarms.`;
      motivationalMessage = `Even when acute panic screams that you are in immediate danger, remind yourself: this is an uncomfortable surge of adrenaline, not a true catastrophe. Your lungs can slow down, your heart will find its gentle rhythm, and this temporary wave will subside.`;
    } else if (isLonely) {
      severityLevel = hasCriticalSafetyFlag ? 'critical' : 'moderate';
      overallVerdict = hasCriticalSafetyFlag
        ? 'Recalibrated: Acute Isolation & Vulnerability (Priority Care Active)'
        : 'Recalibrated: Social Disconnection Strain & Need for Co-Presence';
      verdictSummary = `Freshly recalibrated incorporating your reflection: "${cleanFeedback}". Experiencing profound loneliness triggers the evolutionary threat alarm in the mammalian brain, heightening stress hormones and somatic fatigue.`;
      motivationalMessage = `Feeling solitary or misunderstood is deeply painful, but your current isolation is a circumstance, not a permanent identity. You belong on this earth, and meaningful, safe connection is still reachable for you.`;
    } else if (isDepressed) {
      severityLevel = hasCriticalSafetyFlag ? 'critical' : 'high';
      overallVerdict = hasCriticalSafetyFlag
        ? 'Recalibrated: Severe Depressive Heaviness & Vulnerability (Priority Care Active)'
        : 'Recalibrated: Depressive Weight & Neurochemical Depletion';
      verdictSummary = `Freshly recalibrated taking into account your expression: "${cleanFeedback}". Emotional numbness or heaviness is your mind's protective shutdown when psychological burdens have exceeded current coping bandwidth.`;
      motivationalMessage = `When heaviness makes everything feel bleak, remember that depression alters perception like tinted glass. The warmth and beauty of the world have not disappeared; you are simply navigating through a heavy fog. You are worthy of patient, compassionate holding.`;
    } else if (isOverthinking) {
      severityLevel = hasCriticalSafetyFlag ? 'critical' : 'moderate';
      overallVerdict = hasCriticalSafetyFlag
        ? 'Recalibrated: Cognitive Hyperarousal & Vulnerability (Priority Care Active)'
        : 'Recalibrated: Narrative Loop Overdrive & Racing Cognitions';
      verdictSummary = `Freshly recalibrated to reflect your reflection: "${cleanFeedback}". Your prefrontal cortex is stuck in cognitive problem-solving overdrive, generating endless catastrophic branches.`;
      motivationalMessage = `You do not have to believe or solve every thought your brain presents today. Ground your senses into the immediate present—your feet on the floor, the temperature of the air—and step off the thought treadmill.`;
    } else if (isHopeful) {
      severityLevel = 'mild';
      overallVerdict = 'Recalibrated: Emerging Psychological Resilience & Recovery';
      verdictSummary = `Freshly recalibrated reflecting your encouraging note: "${cleanFeedback}". Your active mindset and conscious perspective are creating healthy neurochemical momentum.`;
      motivationalMessage = `Every micro-step of optimism and self-compassion strengthens new synaptic pathways. Keep honoring this forward momentum and celebrating your inner strength.`;
    } else {
      // General expression
      severityLevel = hasCriticalSafetyFlag ? 'critical' : (avgWellness < 50 ? 'high' : 'moderate');
      overallVerdict = hasCriticalSafetyFlag
        ? `Recalibrated: Acute Vulnerability on "${cleanFeedback.slice(0, 30)}${cleanFeedback.length > 30 ? '...' : ''}" (Priority Care Active)`
        : `Recalibrated: Tailored Synthesis on "${cleanFeedback.slice(0, 35)}${cleanFeedback.length > 35 ? '...' : ''}"`;
      verdictSummary = `Your assessment has been freshly recalibrated to directly incorporate your personal words: "${cleanFeedback}". This tailored synthesis adjusts your multidimensional profile to reflect your lived context beyond standardized questions.`;
      motivationalMessage = `Thank you for sharing your authentic voice. Integrating your subjective experience allows for genuine, personalized neuro-emotional recovery. Take this one gentle step at a time.`;
    }
  } else if (hasCriticalSafetyFlag) {
    severityLevel = 'critical';
    overallVerdict = 'Acute Emotional Distress with Safety Precaution';
    verdictSummary = 'Your responses indicate profound emotional weight and thoughts of vulnerability that deserve immediate, compassionate human support. You are not alone, and healing is reachable with appropriate guidance.';
    motivationalMessage = 'Right now in this heavy moment, please know your life holds irreplaceable worth. The pain you feel is real, but it is not permanent. Reaching out for a listening ear is an act of fierce courage. There are caring individuals waiting to walk alongside you today.';
  } else if (avgWellness < 40) {
    severityLevel = 'high';
    overallVerdict = 'Elevated Psychological Fatigue & Multi-Domain Strain';
    verdictSummary = 'You are experiencing substantial emotional and physiological exhaustion across multiple domains. Cognitive load, mood shifts, or sleep disruptions indicate your nervous system is operating in prolonged survival mode.';
    motivationalMessage = 'When our mental battery is drained to zero, even small demands feel like mountains. Give yourself unconditional permission to breathe. You have survived difficult chapters before, and this current dip does not define your future resilience.';
  } else if (avgWellness < 65) {
    severityLevel = 'moderate';
    overallVerdict = 'Moderate Emotional Wear & Reactive Burnout';
    verdictSummary = 'You are navigating moderate psychological friction—likely involving mood instability, sleep irregular rhythm, or cognitive fog under stress. While your coping mechanisms are functioning, emotional depletion is noticeable.';
    motivationalMessage = 'Be exceptionally gentle with your mind right now. Growth is cyclical, not linear. A period of low motivation or foggy mornings is simply a signal from your biology asking for restorative pauses, not a personal flaw.';
  } else if (avgWellness < 85) {
    severityLevel = 'mild';
    overallVerdict = 'Mild Transient Stress & Environmental Strain';
    verdictSummary = 'You maintain a good core psychological baseline with mild situational stress, periodic fatigue, or mild mood fluctuation. Your executive functioning and social foundations remain largely intact.';
    motivationalMessage = 'You have strong inner resources and self-awareness. Taking proactive steps today—like gentle circadian resets and mindfulness breaks—will quickly replenish your energy and return you to full vitality!';
  } else {
    severityLevel = 'optimal';
    overallVerdict = 'High Emotional Stability & Cognitive Vitality';
    verdictSummary = 'Your responses reflect solid emotional regulation, clear reality testing, dependable routines, and an active supportive network. Your nervous system demonstrates admirable psychological flexibility.';
    motivationalMessage = 'You are operating from a place of wonderful balance and inner clarity. Keep nourishing these healthy habits and consider extending your warmth and grounded presence to those around you.';
  }

  // ------------------------------------------------------------------
  // PRIMARY classifier modulation (NeuroScope DistilBERT dual-head).
  // Per-answer readings from the project's own fine-tuned model are folded
  // into an aggregate that can raise (never lower) the final severity: the
  // model is recall-first, so sustained risk probability across the run must
  // be honored even when the keyword scan stayed quiet.
  // ------------------------------------------------------------------
  if (neuroscope && neuroscope.readings > 0) {
    if (neuroscope.bands.critical > 0 || neuroscope.meanRisk >= 0.5) {
      hasCriticalSafetyFlag = true;
      severityLevel = 'critical';
      if (!cleanFeedback) {
        overallVerdict = 'Acute Distress Flagged by the NeuroScope Primary Classifier';
        verdictSummary = `${verdictSummary} Your session's primary model reading — a fine-tuned DistilBERT trained on 51,067 mental-health statements (risk recall 0.92) — crossed the critical band, so this report leads with immediate support.`;
      }
    } else if (
      (neuroscope.bands.high >= 2 || neuroscope.meanRisk >= 0.35) &&
      (severityLevel === 'optimal' || severityLevel === 'mild')
    ) {
      severityLevel = 'high';
      if (!cleanFeedback) {
        overallVerdict = 'Sustained Distress Flagged by the NeuroScope Primary Classifier';
      }
    } else if (
      (neuroscope.bands.elevated >= 2 || neuroscope.meanRisk >= 0.25) &&
      severityLevel === 'optimal'
    ) {
      severityLevel = 'moderate';
    }

    // Dimension-aware framing: the primary model's dominant dimension is
    // named in the verdict (custom-recalibrated titles keep their own text).
    if (severityLevel !== 'optimal' || neuroscope.meanRisk >= 0.25) {
      const sharePct = Math.round(neuroscope.dominantShare * 100);
      if (neuroscope.dominantStatus !== 'Normal') {
        overallVerdict = `${overallVerdict} — ${neuroscope.dominantStatus} Pattern Detected`;
      }
      verdictSummary = `${verdictSummary} Across ${neuroscope.readings} classified answers, the primary NeuroScope model read this session as primarily ${neuroscope.dominantStatus} (dominant confidence ${sharePct}%) with an average risk signal of ${Math.round(
        neuroscope.meanRisk * 100
      )}%${
        neuroscope.peak && neuroscope.peak.topStatus !== 'Normal'
          ? `, peaking at ${neuroscope.peak.topStatus} (${Math.round(neuroscope.peak.pRisk * 100)}% risk) on one answer`
          : ''
      }.`;
    } else if (neuroscope.dominantStatus === 'Normal' && neuroscope.meanRisk < 0.15) {
      verdictSummary = `${verdictSummary} The primary NeuroScope classifier (fine-tuned on 51,067 statements, macro-F1 0.79) read your answers as predominantly Normal with a low risk signal (${Math.round(
        neuroscope.meanRisk * 100
      )}%) — a reading worth trusting alongside your own self-report.`;
    }
  }

  // Helper to retrieve user answer text for a specific question ID
  const getAnswerForQ = (id: number): string => {
    const rec = answers.find((a) => a.questionId === id);
    return (rec?.answer || '').toLowerCase();
  };

  const allText = (answers.map((a) => a.answer).join(' ') + ' ' + cleanFeedback).toLowerCase();

  // Dynamic Library of Evidence-Grounded Solutions
  const candidateSolutions: SolutionItem[] = [];

  // =========================================================================
  // 1. HYPER-DYNAMIC CUSTOM EXPRESSION PROTOCOLS (Top Priority if User Typed Feedback)
  // =========================================================================
  if (cleanFeedback.length > 0) {
    const fbLower = cleanFeedback.toLowerCase();
    const snippet = cleanFeedback.length > 40 ? cleanFeedback.slice(0, 38) + '...' : cleanFeedback;

    if (/breakup|broke up|ex-|partner|divorce|cheated|dumped|love lost|unrequited|heartbreak|heartbroken|dating/i.test(fbLower)) {
      candidateSolutions.push({
        id: 'sol-custom-heartbreak',
        title: 'Relational Heartbreak & Attachment Somatic Holding',
        category: 'Relational Healing',
        difficulty: 'Mindset',
        matchedTrigger: `Dynamically Calibrated to your words: "${snippet}"`,
        neuroTarget: 'Endogenous Opioids, Oxytocin & Dorsal Anterior Cingulate',
        timeEstimate: '5 min',
        interactiveToolType: 'timer',
        actionSteps: [
          'Allow yourself to feel the relational ache in waves of 90 seconds without suppressing it or compulsively checking your phone or their socials.',
          'Place both hands gently over your sternum with warm pressure and speak aloud: "This hurts deeply because it mattered. I am allowed to grieve and recover at my own natural pace."',
          'Institute a strict 14-day digital boundary to allow neurochemical dopamine receptor reset and break compulsive attachment withdrawal loops.'
        ],
        scientificRationale: 'Interpersonal rejection activates physical pain pathways in the dorsal anterior cingulate cortex and triggers acute opioid withdrawal; somatic self-soothing and digital boundaries allow receptor equilibrium to restore.'
      });
    } else if (/exam|exams|study|studying|test|grade|grades|gpa|college|university|school|thesis|deadline/i.test(fbLower)) {
      candidateSolutions.push({
        id: 'sol-custom-academic',
        title: 'High-Stakes Academic Panic & Working Memory Shield',
        category: 'Executive Functioning',
        difficulty: 'Quick 2-min',
        matchedTrigger: `Dynamically Calibrated to your academic pressure: "${snippet}"`,
        neuroTarget: 'Dorsolateral Prefrontal Cortex & Noradrenaline Dampening',
        timeEstimate: '2 min',
        interactiveToolType: 'breathing',
        actionSteps: [
          'Perform 3 physiological sighs (two nasal inhales, one long mouth exhale) immediately before opening study materials to discharge acute adrenaline.',
          'Externalize tasks onto a physical sheet: write only the next 15-minute micro-objective (e.g. "Review formulas on Page 42"), shielding working memory from catastrophic overwhelm.',
          'Adopt the "Good Enough First Draft" rule: complete rough recall practice without evaluating perfection until after the study sprint.'
        ],
        scientificRationale: 'Acute test anxiety causes noradrenaline to flood the prefrontal cortex, blinding working memory; physiological sighs restore vagal brake control and liberate cognitive RAM.'
      });
    } else if (/work|job|boss|career|colleague|coworker|client|office|manager|workload/i.test(fbLower)) {
      candidateSolutions.push({
        id: 'sol-custom-workplace',
        title: 'Workplace Boundary Containment & Shutdown Ritual',
        category: 'Work & Burnout',
        difficulty: 'Daily Routine',
        matchedTrigger: `Dynamically Calibrated to workplace stress: "${snippet}"`,
        neuroTarget: 'Sympathetic-Parasympathetic Switchboard & Cortisol Clearance',
        timeEstimate: '5 min',
        interactiveToolType: 'journal',
        actionSteps: [
          'Establish a strict non-negotiable mental "shutdown ritual" at the end of your workday: close all tabs, write tomorrow\'s top 2 priorities, and shut your laptop.',
          'Disable workplace notification channels (Slack, Teams, Email) on your mobile device between 7:00 PM and 8:30 AM.',
          'Practice the bandwidth boundary script: "I want to ensure this is done to high standard; given current capacity, should this take precedence over [existing task]?"'
        ],
        scientificRationale: 'Autonomic nervous systems require unmistakable physical demarcations to transition from sympathetic task-execution to parasympathetic regenerative rest.'
      });
    } else if (/grief|died|loss|passed away|bereavement|funeral|mourning|miss (him|her|them)/i.test(fbLower)) {
      candidateSolutions.push({
        id: 'sol-custom-grief',
        title: 'Compassionate Grief Wave-Riding & Somatic Containment',
        category: 'Relational Healing',
        difficulty: 'Mindset',
        matchedTrigger: `Dynamically Calibrated to your grief expression: "${snippet}"`,
        neuroTarget: 'Insular Cortex & Mammalian Caregiving Networks',
        timeEstimate: '5 min',
        interactiveToolType: 'timer',
        actionSteps: [
          'Release the expectation to "move on" or follow linear stages; grant grief permission to arrive as an unpredictable tide.',
          'When an acute wave crests, place a hand over your heart, sit comfortably, and breathe slowly without trying to fix or distract from the sensation.',
          'Dedicate a 10-minute intentional memory window each evening (looking at a photo, writing a thought) so grief is honored rather than repressed during the day.'
        ],
        scientificRationale: 'Bereavement disrupts autonomic neural maps of the loved one; dedicated containment windows prevent chronic emotional exhaustion while integrating the loss into autobiographical memory.'
      });
    } else if (/lonely|alone|isolated|no friends|nobody cares|alienat|invisible/i.test(fbLower)) {
      candidateSolutions.push({
        id: 'sol-custom-loneliness',
        title: 'Low-Demand Ambient Co-Presence & Micro-Connection Bridge',
        category: 'Social Support',
        difficulty: 'Quick 2-min',
        matchedTrigger: `Dynamically Calibrated to your feelings of loneliness: "${snippet}"`,
        neuroTarget: 'Social Defense Alarm Circuitry & Ventral Vagal Nerve',
        timeEstimate: '10 min',
        interactiveToolType: 'timer',
        actionSteps: [
          'Spend 20 minutes in a neutral "third place" (a local library, quiet neighborhood cafe, or community park) to bathe in passive ambient human co-presence without demands.',
          'Send one low-pressure micro-message (a funny photo, short memory, or interesting link) to an acquaintance with zero expectation of a long reply.',
          'Remind your nervous system: loneliness is a biological alarm like hunger, signaling a need for safety, not a personal flaw.'
        ],
        scientificRationale: 'Passive ambient co-presence dampens the evolutionary hyper-vigilance alarm triggered by perceived isolation without inducing social battery depletion.'
      });
    } else if (/worthless|failure|hate myself|guilt|shame|not good enough|burden|imposter/i.test(fbLower)) {
      candidateSolutions.push({
        id: 'sol-custom-shame',
        title: 'Metacognitive Self-Compassion & Inner Critic Neutralization',
        category: 'Thought Patterns',
        difficulty: 'Mindset',
        matchedTrigger: `Dynamically Calibrated to your inner dialogue: "${snippet}"`,
        neuroTarget: 'Default Mode Network & Amygdala Threat Subsystem',
        timeEstimate: '2 min',
        interactiveToolType: 'journal',
        actionSteps: [
          'Catch harsh self-talk in real time and ask: "Would I say these exact words to a dear friend in pain?"',
          'Translate the critic into an ally statement: "I made an error or feel vulnerable right now, but that is part of being human. My worth is non-negotiable."',
          'Place a warm palm over your upper chest and take 3 deep, grounding breaths to physically signal safety to your limbic system.'
        ],
        scientificRationale: 'Replaces threat-system self-criticism (cortisol/noradrenaline) with mammalian caregiving circuitry (oxytocin/endorphins), mitigating toxic shame.'
      });
    } else {
      // Dynamic synthesis for any other custom personal expression
      candidateSolutions.push({
        id: 'sol-custom-dynamic-integration',
        title: 'Targeted Emotional Decompression & Somatic Safety Re-Anchor',
        category: 'Personalized Neuro-Reset',
        difficulty: 'Quick 2-min',
        matchedTrigger: `Dynamically Calibrated to your personal words: "${snippet}"`,
        neuroTarget: 'Ventral Vagal Complex & Prefrontal Executive Integration',
        timeEstimate: '2 min',
        interactiveToolType: 'breathing',
        actionSteps: [
          'Acknowledge and name the exact feeling you expressed ("I am feeling...") without self-criticism or urgency to suppress it.',
          'Execute 3 consecutive Physiological Sighs: two deep nasal inhales followed by a prolonged 8-second mouth exhale.',
          'Identify one tiny micro-action within your immediate control today that protects your peace and honors your capacity.'
        ],
        scientificRationale: 'Conscious emotional labeling coupled with elongated exhalations activates the parasympathetic vagal brake, shifting cortical processing from limbic panic to prefrontal agency.'
      });
    }
  }

  // =========================================================================
  // 2. 20-QUESTION CLINICAL SYMPTOM PROTOCOL MAPPING
  // =========================================================================

  // Q5: Sleep Schedule / Insomnia / Nighttime racing thoughts
  const q5Text = getAnswerForQ(5);
  if (/insomnia|racing|can't sleep|wake|waking|irregular|exhausted|hours|screen/i.test(q5Text) || /insomnia|can't sleep|wake up/i.test(allText)) {
    candidateSolutions.push({
      id: 'sol-circadian-insomnia',
      title: 'Stimulus Control & Bedtime Somatic De-Escalation',
      category: 'Sleep Optimization',
      difficulty: 'Daily Routine',
      matchedTrigger: 'Calibrated to Question #5: Sleep Onset & Rest Consistency',
      neuroTarget: 'Suprachiasmatic Nucleus & Ventrolateral Preoptic Nucleus',
      timeEstimate: 'Evening Routine',
      interactiveToolType: 'timer',
      actionSteps: [
        'Apply the 20-minute stimulus control rule: if still awake after 20 minutes in bed, get up and sit in dim lighting with non-stimulating reading until drowsy.',
        'View 10-15 minutes of direct natural sunlight within 30 minutes of morning awakening to set your biological circadian timer.',
        'Perform a 5-minute "Worry Dump" journal 1 hour before bed to externalize cognitive loops off your active working memory.'
      ],
      scientificRationale: 'Stimulus control therapy decouples the bedroom environment from conditioned hyperarousal, while morning photons calibrate suprachiasmatic melatonin timing.'
    });
  }

  // Q4 & Q10: Anxiety, panic, chest tightness, racing thoughts, catastrophic loops
  const q4Text = getAnswerForQ(4);
  const q10Text = getAnswerForQ(10);
  if (/panic|chest tight|racing|dread|what if|catastroph|loop|intrusive|fast/i.test(q4Text + ' ' + q10Text) || /panic|chest tight|racing heart/i.test(allText)) {
    candidateSolutions.push({
      id: 'sol-vagal-reset',
      title: 'Physiological Sigh & 4-7-8 Parasympathetic Vagal Reset',
      category: 'Immediate Grounding',
      difficulty: 'Quick 2-min',
      matchedTrigger: 'Calibrated to Question #4 & #10: Acute Dread & Catastrophic Loops',
      neuroTarget: 'Vagus Nerve & Cardiac Sinoatrial Pacemaker Cells',
      timeEstimate: '2 min',
      interactiveToolType: 'breathing',
      actionSteps: [
        'Take two consecutive deep inhales through your nose (one full inhale, followed by a sharp top-off sniff).',
        'Release a long, unforced exhale through your mouth for 6 to 8 seconds with an audible sigh.',
        'Repeat for 3 to 5 consecutive cycles whenever you feel somatic dread, chest tightness, or a racing pulse.'
      ],
      scientificRationale: 'The double inhale re-inflates collapsed pulmonary alveoli while the extended exhale triggers vagal nerve deceleration of cardiac pacemaker cells, dropping heart rate within seconds.'
    });

    candidateSolutions.push({
      id: 'sol-thought-defusion',
      title: 'Cognitive Defusion & Metacognitive "Leaves on a Stream"',
      category: 'Thought Patterns',
      difficulty: 'Mindset',
      matchedTrigger: 'Calibrated to Question #10: Intrusive & Racing Thought Loops',
      neuroTarget: 'Default Mode Network & Salience Network Decoupling',
      timeEstimate: '3 min',
      interactiveToolType: 'timer',
      actionSteps: [
        'When repetitive catastrophic loops trigger, mentally prefix them: "I notice my mind is offering the thought that..."',
        'Visualize each alarming thought written across a dry leaf floating down a moving woodland river.',
        'Observe the leaf float by without fighting it, pushing it away, or diving into the water after it.'
      ],
      scientificRationale: 'Decouples the default mode network (DMN) from the salience network, diminishing the subjective threat value of cognitive narratives.'
    });
  }

  // Q3: Anhedonia / loss of joy / activities feel like chore
  const q3Text = getAnswerForQ(3);
  if (/chore|meaningless|flat|lost interest|no joy|force myself|numb/i.test(q3Text) || /chore|meaningless|no joy|lost interest/i.test(allText)) {
    candidateSolutions.push({
      id: 'sol-behavioral-activation',
      title: 'Micro-Dopamine Bridging & Low-Friction Behavioral Activation',
      category: 'Mood Recovery',
      difficulty: 'Quick 2-min',
      matchedTrigger: 'Calibrated to Question #3: Anhedonia & Lost Joy in Activities',
      neuroTarget: 'Ventral Striatum & Mesolimbic Dopaminergic Circuits',
      timeEstimate: '5 min',
      interactiveToolType: 'timer',
      actionSteps: [
        'Select one ultra-low-friction activity (e.g. stepping outside for 3 minutes, listening to one nostalgic song, opening the blinds).',
        'Execute the action BEFORE waiting for motivation: physiological movement stimulates dopamine release, which subsequently generates motivation.',
        'Physically check off the completed micro-action on paper to trigger striatal reward registration.'
      ],
      scientificRationale: 'Behavioral activation bypasses depressive hypofrontality by utilizing somatic movement to stimulate ventral striatal dopamine release.'
    });
  }

  // Q8: Brain fog / distractibility / decision paralysis / focus drift
  const q8Text = getAnswerForQ(8);
  const q7Text = getAnswerForQ(7);
  if (/brain fog|focus|concentrat|paralyz|distract|hygiene|chore|monumental|procrastinat/i.test(q8Text + ' ' + q7Text) || /brain fog|cannot focus/i.test(allText)) {
    candidateSolutions.push({
      id: 'sol-executive-chunking',
      title: 'Externalized Working Memory & 15-Minute Dopamine Micro-Blocks',
      category: 'Daily Functioning',
      difficulty: 'Quick 2-min',
      matchedTrigger: 'Calibrated to Question #8: Brain Fog & Decision Paralysis',
      neuroTarget: 'Dorsolateral Prefrontal Cortex & Striatal Task Initiation',
      timeEstimate: '15 min',
      interactiveToolType: 'timer',
      actionSteps: [
        'Perform a 2-minute "Brain Dump" onto physical paper—refuse to hold more than 2 active tasks in mental RAM.',
        'Pick the single smallest piece of the most intimidating task and set a timer for only 15 minutes.',
        'When the timer rings, grant yourself full freedom to either stop or continue for another 15 minutes.'
      ],
      scientificRationale: 'Reduces cognitive friction in the dorsolateral prefrontal cortex by eliminating choice paralysis and micro-lowering task initiation thresholds.'
    });
  }

  // Q9: Dissociation / depersonalization / derealization / unreal feelings
  const q9Text = getAnswerForQ(9);
  if (/spectator|robotic|foggy|dreamlike|unreal|detached|watching myself/i.test(q9Text) || /dissociat|foggy|unreal/i.test(allText)) {
    candidateSolutions.push({
      id: 'sol-grounding-54321',
      title: '5-4-3-2-1 Sensory Grounding & Bilateral Tactile Butterfly Anchor',
      category: 'Thought Patterns',
      difficulty: 'Quick 2-min',
      matchedTrigger: 'Calibrated to Question #9: Dissociative Sensations & Foggy Reality',
      neuroTarget: 'Primary Somatosensory Cortex & Parietal Spatial Integration',
      timeEstimate: '2 min',
      interactiveToolType: 'grounding',
      actionSteps: [
        'Identify 5 distinct physical objects you can see, 4 textures you can touch, 3 sounds you can hear, 2 scents, and 1 taste.',
        'Cross your arms over your chest and alternate gentle rhythmic finger taps on opposite shoulders (Bilateral Butterfly Hug).',
        'Press your bare feet firmly into the floor and consciously register the solid, unmoving resistance beneath you.'
      ],
      scientificRationale: 'Stimulates the primary somatosensory cortex and parietal lobes, shifting awareness out of internal rumination and anchoring presence in the physical environment.'
    });
  }

  // Q2 & Q18: Mood volatility / sudden shifts / snapping / irritability
  const q2Text = getAnswerForQ(2);
  const q18Text = getAnswerForQ(18);
  if (/anger|tears|short fuse|snap|irritab|rapid shift|resentment/i.test(q2Text + ' ' + q18Text) || /short fuse|snap|mood swing/i.test(allText)) {
    candidateSolutions.push({
      id: 'sol-tipp-regulation',
      title: 'DBT TIPP Autonomic Crisis Modulation Protocol',
      category: 'Emotional Stability',
      difficulty: 'Quick 2-min',
      matchedTrigger: 'Calibrated to Question #2 & #18: Emotional Volatility & Irritability',
      neuroTarget: 'Trigeminal Nerve & Mammalian Dive Reflex',
      timeEstimate: '2 min',
      interactiveToolType: 'timer',
      actionSteps: [
        'Temperature: Splash cold water over your cheeks and eyes or hold an ice cube in your palm for 30 seconds.',
        'Paced Breathing: Exhale noticeably slower than you inhale (4-second inhale, 7-second exhale).',
        'Paired Muscle Relaxation: Clench your fists tightly for 5 seconds, then release completely with a slow unforced exhale.'
      ],
      scientificRationale: 'Triggers the mammalian dive reflex via trigeminal nerve stimulation, rapidly dropping heart rate and diverting blood flow away from amygdalar hyper-reactivity toward prefrontal control.'
    });
  }

  // Q13: Stress freeze / shutdown / panic
  const q13Text = getAnswerForQ(13);
  if (/shut down|freeze|dissociate|panic|worst possible|lash out/i.test(q13Text)) {
    candidateSolutions.push({
      id: 'sol-somatic-orienting',
      title: 'Neuro-Somatic Orienting & Autonomic Freeze Discharge',
      category: 'Immediate Grounding',
      difficulty: 'Quick 2-min',
      matchedTrigger: 'Calibrated to Question #13: Stress Freeze & Shutdown Reactivity',
      neuroTarget: 'Periaqueductal Gray & Polyvagal Dorsal Complex',
      timeEstimate: '2 min',
      interactiveToolType: 'grounding',
      actionSteps: [
        'Slowly rotate your neck and head to look around the room, letting your eyes linger on 3 neutral or comforting objects.',
        'Shake out your hands and bounce your heels gently on the floor for 30 seconds to discharge immobilized motor energy.',
        'Say out loud: "I am safe in this room right now; there is no immediate physical threat in this moment."'
      ],
      scientificRationale: 'Engages the brainstem orienting reflex to signal environmental safety to the periaqueductal gray, facilitating transition out of autonomic dorsal freeze.'
    });
  }

  // Q14 & Q16: Impulsive urges / substance reliance / reckless escapism
  const q14Text = getAnswerForQ(14);
  const q16Text = getAnswerForQ(16);
  if (/substance|drinking|alcohol|numb|shopping|overspending|reckless|impulsive/i.test(q14Text + ' ' + q16Text) || /substance|impulsive/i.test(allText)) {
    candidateSolutions.push({
      id: 'sol-urge-surfing',
      title: 'Urge Surfing & The 90-Second Neuro-Pause Protocol',
      category: 'Impulse Control',
      difficulty: 'Mindset',
      matchedTrigger: 'Calibrated to Question #14 & #16: Impulsive Urges & Escapist Reflexes',
      neuroTarget: 'Nucleus Accumbens & Anterior Cingulate Cortex',
      timeEstimate: '2 min',
      interactiveToolType: 'timer',
      actionSteps: [
        'When an impulsive craving, anger burst, or escapist urge strikes, picture it as an ocean wave with a rising crest.',
        'Set a timer for 90 seconds—the biological half-life of a neurochemical surge in the bloodstream.',
        'Ride the wave through slow nasal breathing until the physiological intensity crests and naturally subsides.'
      ],
      scientificRationale: 'Prevents the habitual dopamine-seeking reflex loop by allowing neurochemical adrenaline and dopamine spikes to metabolize before behavioral action occurs.'
    });
  }

  // Q17 & Q20: Isolation / ghosting texts / lack of support system
  const q17Text = getAnswerForQ(17);
  const q20Text = getAnswerForQ(20);
  if (/ghosting|secluded|alone|no one|isolated|drained to engage/i.test(q17Text + ' ' + q20Text) || /alone|isolated/i.test(allText)) {
    candidateSolutions.push({
      id: 'sol-social-micropacing',
      title: 'Low-Friction Social Micro-Pacing & Passive Co-Presence',
      category: 'Social Support',
      difficulty: 'Quick 2-min',
      matchedTrigger: 'Calibrated to Question #17 & #20: Social Withdrawal & Isolation',
      neuroTarget: 'Evolutionary Social Safety Network & Oxytocin Baseline',
      timeEstimate: '5 min',
      interactiveToolType: 'timer',
      actionSteps: [
        'Send a low-friction message (a photo, funny meme, or article) to one trusted contact with no expectation of an extended chat.',
        'Spend 20 minutes in a third place (library, coffee shop, community park) to experience passive ambient social co-presence.',
        'Communicate your boundary gently: "My energy is a bit low today, but thinking of you and wanted to check in."'
      ],
      scientificRationale: 'Passive co-presence and low-demand social contact dampen the evolutionary hyper-vigilance alarm triggered by perceived isolation without causing social exhaustion.'
    });
  }

  // Q19: Trust anxiety / fear of betrayal / guardedness
  const q19Text = getAnswerForQ(19);
  if (/questioning|secretly hate|guarded|hesitant|betrayed|suspicious/i.test(q19Text)) {
    candidateSolutions.push({
      id: 'sol-relational-grounding',
      title: 'Interpersonal Reality-Testing & Attachment Boundary Shield',
      category: 'Social Support',
      difficulty: 'Mindset',
      matchedTrigger: 'Calibrated to Question #19: Relational Guardedness & Rejection Fear',
      neuroTarget: 'Insular Cortex & Attachment Security Networks',
      timeEstimate: '3 min',
      interactiveToolType: 'journal',
      actionSteps: [
        'Separate feelings from facts: write down the factual evidence for and against the suspicion.',
        'Remind yourself: "Past hurt makes my alarm system hypersensitive. A delayed text or neutral tone is not evidence of betrayal."',
        'Choose to test trust in small, low-risk micro-vulnerabilities rather than binary all-or-nothing assessments.'
      ],
      scientificRationale: 'Calibrates insular threat reactivity by systematically testing cognitive attributions against objective relational data.'
    });
  }

  // Q1: General low energy / fatigue / somatic exhaustion
  const q1Text = getAnswerForQ(1);
  if (/exhausted|low energy|empty|overwhelmed|tired/i.test(q1Text) || /fatigue|burnout|drained/i.test(allText)) {
    candidateSolutions.push({
      id: 'sol-energy-pacing',
      title: 'Somatic Energy Pacing & "Spoon Ledger" Management',
      category: 'Daily Functioning',
      difficulty: 'Daily Routine',
      matchedTrigger: 'Calibrated to Question #1: Baseline Fatigue & Depleted Energy',
      neuroTarget: 'Mitochondrial Reserves & Autonomic Homeostasis',
      timeEstimate: 'Daily Cadence',
      interactiveToolType: 'journal',
      actionSteps: [
        'Budget your daily vitality into 5 discrete "energy tokens" and allocate them strictly before accepting non-critical requests.',
        'Incorporate 5-minute zero-input rest breaks (eyes closed, no phone, no podcasts) between demanding cognitive blocks.',
        'Grant yourself explicit permission to lower perfectionist standards on secondary duties from 100% to a healthy 70%.'
      ],
      scientificRationale: 'Prevents the boom-and-bust cycle of chronic fatigue by halting activities before autonomic and mitochondrial reserves reach zero.'
    });
  }

  // High wellness / flourishing fallback protocols
  if (avgWellness >= 75) {
    candidateSolutions.push(
      {
        id: 'sol-flow-architecture',
        title: 'Deep Neuro-Flow Architecture & 90-Minute Ultradian Sprints',
        category: 'Cognitive Vitality',
        difficulty: 'Daily Routine',
        matchedTrigger: 'Calibrated to your high baseline stability & executive focus',
        neuroTarget: 'Theta-Alpha Wave Synchrony & Locus Coeruleus',
        timeEstimate: 'Morning Deep Work',
        interactiveToolType: 'timer',
        actionSteps: [
          'Structure an uninterrupted 90-minute ultradian rhythm deep-work sprint free from digital notifications and tab switching.',
          'Align complex creative or analytical problem solving with your peak circadian alertness peak (typically morning or late afternoon).',
          'Include deliberate intermittent decompression intervals to safeguard your neuroplastic baseline.'
        ],
        scientificRationale: 'Optimizes theta-alpha wave synchrony in the brain, accelerating neuroplastic consolidation and sustained creative stamina.'
      },
      {
        id: 'sol-resilience-maintenance',
        title: 'Proactive Autonomic Stacking & Prosocial Altruism',
        category: 'Emotional Vitality',
        difficulty: 'Daily Routine',
        matchedTrigger: 'Calibrated to maintain your thriving emotional baseline',
        neuroTarget: 'Vagal Tone & Endogenous Oxytocin Networks',
        timeEstimate: 'Daily Cadence',
        interactiveToolType: 'journal',
        actionSteps: [
          'Maintain consistent daily circadian light exposure and 7-8 hours of regular sleep architecture.',
          'Share your grounded state by actively listening to or mentoring someone in your community.',
          'Keep a brief nightly micro-gratitude note identifying 3 specific moments that brought genuine ease.'
        ],
        scientificRationale: 'Prosocial engagement elevates baseline oxytocin and vagal tone, creating an emotional buffer against future situational stressors.'
      }
    );
  }

  // Deduplicate candidate solutions by ID
  const seenIds = new Set<string>();
  const uniqueCandidates: SolutionItem[] = [];
  for (const sol of candidateSolutions) {
    if (!seenIds.has(sol.id)) {
      seenIds.add(sol.id);
      uniqueCandidates.push(sol);
    }
  }

  // Sort weakest categories to ensure the weakest domain has a matching solution
  const sortedDims = [...dimensionScores].sort((a, b) => a.score - b.score);
  const weakestCat = sortedDims[0]?.category;

  // Curate final 3-4 solutions prioritizing custom feedback, then weakest domains and user needs
  const solutions: SolutionItem[] = [];

  // 1. Always prioritize custom calibrated solution first if present
  const customSol = uniqueCandidates.find((s) => s.id.startsWith('sol-custom'));
  if (customSol) {
    solutions.push(customSol);
  }

  // 2. Add solutions that specifically match the user's weakest category
  const weakestMatches = uniqueCandidates.filter(
    (s) => s.category.toLowerCase().includes((weakestCat || '').toLowerCase().slice(0, 5)) && !solutions.some((ex) => ex.id === s.id)
  );
  for (const wm of weakestMatches) {
    if (solutions.length >= 2) break;
    solutions.push(wm);
  }

  // 3. Add remaining solutions from unique candidates
  for (const sol of uniqueCandidates) {
    if (solutions.length >= 4) break;
    if (!solutions.some((s) => s.id === sol.id)) {
      solutions.push(sol);
    }
  }

  // 4. Guaranteed diverse defaults only if candidate pool was small
  const defaultPool: SolutionItem[] = [
    {
      id: 'sol-def-vagal-reset',
      title: 'Physiological Sigh & Parasympathetic Vagal Reset',
      category: 'Immediate Grounding',
      difficulty: 'Quick 2-min',
      matchedTrigger: 'Calibrated for instant autonomic nervous system balancing',
      neuroTarget: 'Vagus Nerve & Heart Rate Variability',
      timeEstimate: '2 min',
      interactiveToolType: 'breathing',
      actionSteps: [
        'Take two consecutive deep inhales through your nose (one long, one sharp top-off).',
        'Release a slow, unforced exhale through your mouth for 6 to 8 seconds.',
        'Repeat for 3 to 5 cycles whenever your heart races or tension rises.'
      ],
      scientificRationale: 'Triggers the vagus nerve and activates the parasympathetic nervous system, rapidly reducing cortisol and decelerating heart rate.'
    },
    {
      id: 'sol-def-circadian-anchor',
      title: 'Circadian Light Anchoring & Nighttime Blue Light Quarantine',
      category: 'Daily Functioning',
      difficulty: 'Daily Routine',
      matchedTrigger: 'Calibrated for cellular restoration and sleep architecture',
      neuroTarget: 'Suprachiasmatic Nucleus & Melatonin Secretion',
      timeEstimate: 'Morning & Night',
      interactiveToolType: 'timer',
      actionSteps: [
        'View direct natural sunlight within 30 minutes of waking for 10-15 minutes.',
        'Dim screens and artificial blue lighting 90 minutes before your planned bedtime.',
        'Engage in a 10-minute progressive relaxation if racing thoughts delay sleep.'
      ],
      scientificRationale: 'Calibrates melatonin onset and adenosine clearing, stabilizing rapid eye movement (REM) and slow-wave sleep architecture.'
    },
    {
      id: 'sol-def-thought-defusion',
      title: 'Cognitive Defusion & Metacognitive Labeling',
      category: 'Thought Patterns',
      difficulty: 'Mindset',
      matchedTrigger: 'Calibrated to quiet runaway catastrophic narratives',
      neuroTarget: 'Default Mode Network & Salience Attenuation',
      timeEstimate: '3 min',
      interactiveToolType: 'timer',
      actionSteps: [
        'Mentally prefix catastrophic thoughts with: "I notice my mind is generating the thought that..."',
        'Visualize placing the thought onto a leaf floating down a moving river.',
        'Redirect attention to a tactile physical sensation (the feeling of your feet on the floor).'
      ],
      scientificRationale: 'Decouples amygdala hyper-reactivity from prefrontal narrative loops, decreasing perceived emotional threat.'
    }
  ];

  for (const defSol of defaultPool) {
    if (solutions.length >= 3) break;
    if (!solutions.some((s) => s.id === defSol.id || s.title === defSol.title)) {
      solutions.push(defSol);
    }
  }

  return {
    overallVerdict,
    severityLevel,
    verdictSummary,
    dimensionalScores: dimensionScores,
    personalizedSolutions: solutions,
    motivationalMessage,
    providerUsed: 'clinical-engine',
    riskAssessment: risk ?? undefined,
    timestamp: new Date().toISOString(),
    isCustomRevised: !!customFeedback,
    customFeedbackNote: cleanFeedback || undefined,
    safetyAlert: hasCriticalSafetyFlag
      ? {
          isCritical: true,
          guidance: 'If you or someone you know is struggling or in crisis, immediate compassionate help is available. You are worthy of care and support.',
          helplineNumbers: DEFAULT_HELPLINES
        }
      : undefined
  };
}

/**
 * Dynamic discovery helper: yields alternate neuro-calibrated protocols that are not currently in view
 */
export function getAlternateProtocols(
  currentIds: string[],
  answers: AnswerRecord[],
  dimensionScores: DimensionScore[],
  customFeedback?: string
): SolutionItem[] {
  const alternateCatalog: SolutionItem[] = [
    {
      id: 'sol-alt-polyvagal-humming',
      title: 'Vocalic Vagal Tone & Resonant Exhalation Humming',
      category: 'Immediate Grounding',
      difficulty: 'Quick 2-min',
      matchedTrigger: 'Sensory Vagal Reset Protocol',
      neuroTarget: 'Laryngeal Superior & Recurrent Vagal Branches',
      timeEstimate: '2 min',
      interactiveToolType: 'breathing',
      actionSteps: [
        'Sit upright, inhale gently through your nose for 4 seconds.',
        'Exhale with a low-frequency hum ("vooo" or "mmmm") for 8 to 10 seconds, feeling the vibration in your throat and chest.',
        'Repeat for 6 cycles to stimulate the vagus nerve endings running through the vocal cords.'
      ],
      scientificRationale: 'Low-frequency resonant acoustic vibration stimulates mechanoreceptors in the larynx, sending afferent inhibitory signals directly into the nucleus tractus solitarius to suppress sympathetic drive.'
    },
    {
      id: 'sol-alt-dopamine-reset',
      title: 'Digital Fasting & High-Friction Dopamine Reset',
      category: 'Impulse Control',
      difficulty: 'Daily Routine',
      matchedTrigger: 'Calibrated to restore neurochemical baseline sensitivity',
      neuroTarget: 'Ventral Tegmental Area & Nucleus Accumbens D2 Receptors',
      timeEstimate: '60 min',
      interactiveToolType: 'timer',
      actionSteps: [
        'Place your phone in a drawer or outside your bedroom for 60 uninterrupted minutes.',
        'Engage in low-stimulation analogue activity (reading paper books, sketching, stretching, walking).',
        'Notice the temporary phantom urge to check your screen and observe it fade without feeding it.'
      ],
      scientificRationale: 'Intermittent digital fasting prevents synaptic D2 receptor downregulation, restoring sensitivity to subtle natural rewards and elevating sustained daily drive.'
    },
    {
      id: 'sol-alt-micro-somatics',
      title: 'Isometric Somatic Tension Release Protocol',
      category: 'Immediate Grounding',
      difficulty: 'Quick 2-min',
      matchedTrigger: 'Calibrated to release physical muscle armoring',
      neuroTarget: 'Motor Cortex & Muscle Spindle Reflex Arc',
      timeEstimate: '3 min',
      interactiveToolType: 'timer',
      actionSteps: [
        'Press your palms together in front of your chest with 70% force for 7 seconds, holding your breath gently.',
        'Release abruptly with a deep, open-mouth exhale, letting your arms fall limply.',
        'Repeat with your quadriceps and calves, feeling the sudden rush of warm circulation.'
      ],
      scientificRationale: 'Isometric contraction followed by sudden release induces deep post-contraction muscular inhibition via Golgi tendon organs, interrupting subconscious postural hyperarousal.'
    },
    {
      id: 'sol-alt-values-compass',
      title: 'Core Values Compass & Cognitive Re-Orientation',
      category: 'Thought Patterns',
      difficulty: 'Mindset',
      matchedTrigger: 'Calibrated to navigate existential overwhelm & decision fatigue',
      neuroTarget: 'Ventromedial Prefrontal Cortex & Self-Referential Processing',
      timeEstimate: '5 min',
      interactiveToolType: 'journal',
      actionSteps: [
        'Identify your single highest priority value for this week (e.g. Peace, Courage, Connection, Rest, Integrity).',
        'Filter today\'s to-do list through this compass: which commitments align with this value, and which drain you unnecessarily?',
        'Say no to one minor request that conflicts with your chosen value.'
      ],
      scientificRationale: 'Self-affirmation and values clarification engage the ventromedial prefrontal cortex, buffering against neuroendocrine stress reactivity and decision fatigue.'
    }
  ];

  const currentSet = new Set(currentIds);
  return alternateCatalog.filter((item) => !currentSet.has(item.id));
}
