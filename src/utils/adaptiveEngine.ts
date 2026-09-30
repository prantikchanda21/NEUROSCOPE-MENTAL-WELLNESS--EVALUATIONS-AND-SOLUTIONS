import { Question, SentimentResult, AdaptiveSelectionMeta, EmotionClassification, RiskLevel, SemanticAnalysis } from '../types.js';
import { TOTAL_QUESTIONS, CATEGORIES } from '../data/questions.js';
import { dynamicMandatorySlot, hasImminentRiskLanguage } from './riskEngine.js';
import {
  analyzeTextSemantics,
  classifyEmotions,
  prewarmEmbeddings,
  rankBySemanticSimilarity,
  sentimentFromNeuroScope,
} from './semanticEngine.js';

/**
 * Adaptive Question Engine
 * ------------------------
 * Selects the next screening question in real time based on the user's
 * previous answer, combining four techniques:
 *
 * 1. Sentiment analysis   — this project's own fine-tuned NeuroScope
 *    DistilBERT (in-browser ONNX) blended with the offline valence lexicon.
 *    NeuroScope is the primary reader; the supporting hub RoBERTa model
 *    stands in only while NeuroScope is still downloading/unavailable; the
 *    lexicon is the always-available last-resort fallback, and explicit
 *    crisis phrases force a severe reading regardless of any of them.
 * 2. Information retrieval — semantic vector search over sentence embeddings
 *    (`all-MiniLM-L6-v2`), blended with TF-weighted keyword overlap. The TF
 *    scorer remains as the offline fallback and as a precision anchor on
 *    literal keyword matches.
 * 3. NDCG ranking metric   — quantifies how closely the produced (partly
 *    randomized) ranking matches the "ideal" relevance-sorted ranking.
 * 4. Randomization          — a bounded jitter term so two people (or the same
 *    person retaking the assessment) rarely see identical question paths,
 *    while category coverage and the mandatory safety question are preserved.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'for', 'with', 'my', 'me', 'i', 'it', 'that', 'this',
  'have', 'has', 'had', 'do', 'does', 'did', 'not', 'as', 'at', 'by', 'from',
  'so', 'if', 'than', 'then', 'about', 'over', 'been', 'feel', 'feeling', 'feels'
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) || []).filter(
    (t) => t.length > 2 && !STOPWORDS.has(t)
  );
}

// --- 1. Sentiment analysis -------------------------------------------------

/**
 * OFFLINE FALLBACK LEXICON.
 *
 * The primary valence reader is now the fine-tuned RoBERTa classifier in
 * semanticEngine.ts (`analyzeSentimentAsync` below blends the two). This
 * lexicon is retained because it costs nothing, needs no network, and gives
 * the app a deterministic reading when the transformer weights cannot be
 * downloaded (offline use, blocked CDN, unsupported browser). It is also the
 * source of the "one very heavy word" safety rule that promotes a mixed
 * message to severe.
 */
const SENTIMENT_LEXICON: Record<string, number> = {
  // severe / crisis-adjacent language
  suicide: -3, suicidal: -3, hopeless: -2.5, worthless: -2.5, unbearable: -2,
  agony: -2, dread: -2, panic: -2, terrified: -2, empty: -1.8, numb: -1.5,
  paranoid: -1.5, hallucination: -1.5, betrayed: -1.5, flashback: -1.8,
  explode: -1.6, despair: -2.2, devastated: -2, crushed: -1.8, broken: -1.5,
  breakdown: -2, traumatized: -1.8, trapped: -1.7,
  worthlessness: -2.5, selfharm: -3, harm: -1.2,
  // moderate negative — mood / distress
  depressed: -1.8, depression: -1.8, depressing: -1.5, distressed: -1.7,
  distress: -1.6, distressing: -1.7, miserable: -1.6, despondent: -1.7,
  anxious: -1, anxiety: -1, sad: -1, exhausted: -1, overwhelmed: -1.2,
  tired: -0.7, stressed: -1, drained: -1, lonely: -1.2, alone: -0.8,
  irritable: -0.8, frustrated: -0.8, angry: -1, burnout: -1, insomnia: -1,
  isolat: -1, withdrawing: -0.9, foggy: -0.6, disconnected: -0.8,
  grief: -1.5, grieving: -1.5, heartbroken: -1.6, defeated: -1.4,
  discouraged: -1, dispirited: -1.2, upset: -1, hurting: -1.3, hurt: -1,
  crying: -1.4, cry: -1.2, tearful: -1.2, suffering: -1.6, struggling: -1.1,
  bleak: -1.4, dark: -0.9, gloomy: -1, low: -0.6, downhearted: -1.2,
  // added from polyvagal / trauma-informed-care grounded item content:
  // automatic threat-detection (neuroception), sustained autonomic arousal,
  // hypervigilance, and self-medication/avoidance as a coping style.
  hypervigilant: -1.3, vigilant: -1, unsafe: -1.3, guarded: -0.9, wary: -0.8,
  scanning: -0.6, temper: -0.7, grudge: -0.6, resentful: -0.8,
  // added from the expanded 50-item pool: catastrophic/ruminative cognition,
  // dorsal-vagal freeze/shutdown, identity disruption, and boundary/masking
  // difficulties in relationships.
  catastroph: -1.4, rumination: -1.1, ruminate: -1.1, overthinking: -0.9,
  frozen: -1.3, freeze: -1.2, stuck: -0.8, shutdown: -1.2, paralyzed: -1.4,
  unrecognizable: -1.1, burden: -1.1, pointless: -1.5, blank: -0.8,
  // mild negative
  down: -0.4, busy: -0.2, restless: -0.5, procrastinating: -0.3, mask: -0.6,
  facade: -0.7, avoidance: -0.8, distract: -0.4, meh: -0.3, off: -0.3,
  // positive
  calm: 1, stable: 1, balanced: 1, peaceful: 1, manageable: 0.8, healthy: 1,
  supportive: 1, trusted: 0.8, optimistic: 1.2, happy: 1.2, hopeful: 1.2,
  good: 0.7, fine: 0.5, grateful: 1.2, relieved: 1, better: 0.8, thriving: 1.5,
  confident: 1, connected: 0.9, rested: 0.9, joyful: 1.4, joy: 1.3,
  content: 1, excited: 1.1, motivated: 1, energized: 1.1, proud: 1.2,
  loved: 1.2, appreciated: 1.1, secure: 1, okay: 0.4, ok: 0.4, improving: 0.9,
  // added: vagal-brake / co-regulation grounded positive terms
  soothe: 1, soothing: 1, grounded: 1, settle: 0.8, settled: 1, safe: 1.1,
  regulate: 0.8, regulated: 1,
  // added: repair/authenticity/help-seeking positive terms from the
  // expanded 50-item pool
  reconnect: 0.9, repair: 0.9, authentic: 1, boundaries: 0.7
};

// Phrase-level crisis markers. These are checked against the raw lowercased
// text (not single tokens) so that multi-word expressions of active risk are
// still caught even when the rest of the message reads as calm or mixed —
// a couple of upbeat words elsewhere should never dilute this signal away.
const CRISIS_PHRASES: string[] = [
  'kill myself', 'end my life', 'end it all', 'ending it all', 'not worth living',
  'better off dead', 'better off without me', 'want to die', 'wish i was dead',
  'wish i were dead', "don't want to be here", 'do not want to be here',
  'no reason to live', 'can\'t go on', 'cant go on', 'give up on life',
  'hurt myself', 'harming myself', 'self harm', 'self-harm', 'cutting myself'
];

/**
 * Phrase-level SYMPTOM markers (as opposed to CRISIS_PHRASES above, which are
 * about active self-harm risk). These describe a real clinical symptom in
 * plainly-worded, low-emotional-valence language — the exact phrasing several
 * of the app's own "Quick reflections" chips use (e.g. "Hearing voices or
 * seeing shadowy figures when fully awake", "Heightened sensitivity to loud
 * sounds or bright lights", "Racing thoughts moving too fast to keep track").
 * None of those sentences contain a word in SENTIMENT_LEXICON, so the base
 * scorer nets them out to a flat 0 and they were reading as "calm"/"neutral"
 * on the live tone chip even though the same answer, read by the LLM at
 * solution time with full question context, is correctly treated as
 * clinically significant. This list closes that gap: a match here means the
 * live chip should never rest below "distressed", no matter what the
 * word-by-word valence score says. It is deliberately scoped to phrases that
 * describe a symptom rather than single ambiguous words (e.g. "sensitive"
 * alone is too easily a positive/neutral word in other contexts), and it only
 * ever pulls a reading UP in severity — it never softens an already
 * distressed/severe reading.
 */
const SYMPTOM_PHRASES: string[] = [
  // Thought Patterns and Perception of Reality
  'hearing voices', 'hear voices', 'seeing shadowy figures', 'shadowy figures',
  'heightened sensitivity to loud sounds', 'sensitivity to loud sounds',
  'sensitivity to bright lights', 'racing thoughts moving too fast',
  'thoughts feel sluggish', 'wading through mud', 'disrupts my day',
  'watching me', 'conspiring against', "world isn't real", "world around you isn't real",
  // Daily Functioning and Physical Well-being
  'forgetting to eat', 'nauseated by food', 'crashing hard by mid-afternoon',
  'more sensitive than usual',
  // Stress, Coping, and Impulse Control
  'lash out impulsively', 'substance dependency', 'reckless driving', 'thrill-seeking',
  // Social Connections and Relationships
  'simmering internal resentment', 'tension usually remains', 'distance often lingers',
  'lasting distance that rarely gets addressed',
];

/** True when the text contains a known low-valence symptom phrase (see
 * SYMPTOM_PHRASES above). Used as a floor, not an override: it only ever
 * raises a "calm"/"neutral" reading up to "distressed", never lowers or
 * replaces a reading that's already distressed/severe. */
export function hasSymptomPhrase(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return SYMPTOM_PHRASES.some((p) => lower.includes(p));
}

/** Raises a reading that undershoots a known symptom phrase up to
 * "distressed" — see hasSymptomPhrase. Applied as a final pass on top of
 * whichever reader (lexicon, NeuroScope, RoBERTa, ensemble) produced the
 * result, so a confident model "Normal"/"calm" verdict on emotionally-neutral
 * symptom language can never quietly stand uncorrected. */
export function applySymptomFloor(text: string, result: SentimentResult): SentimentResult {
  if (result.label === 'severe' || result.label === 'distressed') return result;
  if (!hasSymptomPhrase(text)) return result;
  return {
    ...result,
    label: 'distressed',
    score: Math.min(result.score, -0.25),
    magnitude: Math.max(result.magnitude, 0.55),
  };
}

/**
 * Scores free text for emotional polarity, then classifies it into one of
 * four everyday tone bands: calm, neutral, distressed, severe. The score
 * itself is a net average across every emotion word found — so a message
 * that mixes positive and negative language (e.g. "mostly okay but some
 * days I feel completely worthless") still nets out correctly instead of
 * being washed out to neutral, because a single strongly negative word like
 * "worthless" carries far more weight than a mild "okay". Explicit
 * crisis-level phrases always force a severe classification regardless of
 * anything else in the message.
 */
export function analyzeSentiment(text: string): SentimentResult {
  const lower = text.toLowerCase();
  // Was: CRISIS_PHRASES.some(...) only - a local variable shadowing the
  // exported hasCrisisPhrase() below, so it never picked up the broader
  // riskEngine markers even after that function was fixed to include them.
  // This is the base lexicon scorer behind every open-ended (non yes/no)
  // question's live badge, so this one line was the biggest source of the
  // "calm/neutral" misreads showing up across many different question cards.
  const hasCrisisPhraseHit = CRISIS_PHRASES.some((p) => lower.includes(p)) || hasImminentRiskLanguage(text);

  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return {
      score: hasCrisisPhraseHit ? -1 : 0,
      label: hasCrisisPhraseHit ? 'severe' : 'neutral',
      magnitude: hasCrisisPhraseHit ? 1 : 0,
      source: 'lexicon',
    };
  }

  let sum = 0;
  let hits = 0;
  let strongestNegative = 0;
  for (const tok of tokens) {
    for (const key of Object.keys(SENTIMENT_LEXICON)) {
      if (tok.startsWith(key) || key.startsWith(tok)) {
        const weight = SENTIMENT_LEXICON[key];
        sum += weight;
        hits += 1;
        if (weight < strongestNegative) strongestNegative = weight;
        break;
      }
    }
  }

  const rawScore = hits > 0 ? sum / Math.max(hits, tokens.length * 0.3) : 0;
  const score = Math.max(-1, Math.min(1, rawScore));
  const magnitude = Math.min(1, hits / Math.max(4, tokens.length));

  let label: SentimentResult['label'] = 'neutral';
  if (score <= -0.5) label = 'severe';
  else if (score < -0.05) label = 'distressed';
  else if (score > 0.05) label = 'calm';

  // A single very heavy word (e.g. "hopeless", "suicidal", "despair") should
  // read as severe even if a few mild positive words elsewhere pull the
  // average down — severity is about the presence of acute language, not
  // just the overall mean.
  if (strongestNegative <= -2 && label !== 'severe') label = 'severe';
  if (hasCrisisPhraseHit) label = 'severe';

  return {
    score: hasCrisisPhraseHit ? Math.min(score, -0.9) : score,
    label,
    magnitude: hasCrisisPhraseHit ? 1 : magnitude,
    source: 'lexicon',
  };
}

// --- 1a. Transformer sentiment (primary reader) ----------------------------

/** True when the text contains an explicit phrase-level crisis marker. Always
 * forces a severe reading — no model, however well calibrated, is allowed to
 * soften a stated intent to self-harm. */
export function hasCrisisPhrase(text: string): boolean {
  const lower = (text || '').toLowerCase();
  // CRISIS_PHRASES (15 literal phrases) is kept only as a cheap first check;
  // the real coverage comes from riskEngine's IMMINENT_MARKERS (a larger bank
  // regexes, shared with the mandatory safety screener's crisis interrupt), so
  // that indirect/passive language ("feel like a burden", "nobody would miss
  // me", "wish to go to sleep and not wake up") is caught here too, on every
  // question - not only the mandatory one. Previously this used ONLY the
  // smaller local list, so those phrases read as calm/neutral everywhere
  // except the one question that happened to have its own separate check.
  return CRISIS_PHRASES.some((p) => lower.includes(p)) || hasImminentRiskLanguage(text);
}

/**
 * Blends a primary transformer valence reading with the offline lexicon.
 * The transformer carries most of the weight (it understands negation,
 * intensity and context that a word list cannot); the lexicon keeps a
 * meaningful minority share because it is the sharper instrument for acute
 * single-word markers ("worthless", "suicidal") that the classifier
 * sometimes averages away inside a longer, otherwise calm answer.
 *
 * `resultSource` records which transformer supplied `primary`, so the UI can
 * show "NeuroScope DistilBERT + lexicon" vs. the RoBERTa-fallback "RoBERTa +
 * lexicon" rather than a single generic "hybrid" label for both.
 */
export function mergeSentimentReadings(
  primary: SentimentResult,
  secondary: SentimentResult,
  resultSource: SentimentResult['source'] = 'hybrid'
): SentimentResult {
  const score = Math.max(-1, Math.min(1, 0.65 * primary.score + 0.35 * secondary.score));
  const magnitude = Math.max(0, Math.min(1, 0.65 * primary.magnitude + 0.35 * secondary.magnitude));

  let label: SentimentResult['label'] = 'neutral';
  if (score <= -0.5) label = 'severe';
  else if (score < -0.05) label = 'distressed';
  else if (score > 0.05) label = 'calm';

  // Severity is sticky in both directions of the blend: if either reader saw
  // acute language, the merged reading stays severe.
  if (primary.label === 'severe' || secondary.label === 'severe') label = 'severe';

  return { score: Number(score.toFixed(3)), label, magnitude: Number(magnitude.toFixed(3)), source: resultSource };
}

/**
 * Transformer-first sentiment for free text. Prefers this project's own
 * fine-tuned NeuroScope DistilBERT (blended with the lexicon) whenever that
 * primary model has produced a reading; falls back to the supporting hub
 * RoBERTa model, and then to the lexicon alone, when NeuroScope is still
 * downloading or unavailable. Never throws and never returns nothing.
 */
export async function analyzeSentimentAsync(
  text: string,
  options?: { timeoutMs?: number }
): Promise<SentimentResult> {
  const lexiconReading = analyzeSentiment(text);
  // An explicit crisis phrase short-circuits every reader.
  if (hasCrisisPhrase(text)) return lexiconReading;
  if (!text || text.trim().length < 2) return lexiconReading;

  const semantics = await analyzeTextSemantics(text, {
    timeoutMs: options?.timeoutMs,
    includeRiskSimilarity: false,
  });
  // Every return below passes through applySymptomFloor: a model (NeuroScope,
  // RoBERTa, or their ensemble) can confidently call a symptom-phrase answer
  // "Normal"/"calm" since it was trained on emotionally-charged distress
  // language, not neutrally-worded symptom descriptions — the floor is what
  // keeps that confident-but-wrong verdict from reaching the UI unchanged.
  if (!semantics) return applySymptomFloor(text, lexiconReading);

  // PRIMARY: when NeuroScope + RoBERTa (and, when available, Groq's
  // independent LLM read) all produced a reading, `semantics.sentiment` is
  // already the confidence-weighted ensemble (see `ensembleThreeWaySentiment`
  // / `ensembleTransformerSentiment`) — blend that fused verdict with the
  // lexicon, and carry its agreement/confidence figure through unchanged.
  if (semantics.sentiment.source === 'ensemble' || semantics.sentiment.source === 'ensemble3') {
    const resultSource = semantics.sentiment.source === 'ensemble3' ? 'ensemble3+lexicon' : 'ensemble+lexicon';
    const merged = mergeSentimentReadings(semantics.sentiment, lexiconReading, resultSource);
    return applySymptomFloor(text, { ...merged, confidence: semantics.sentiment.confidence });
  }

  // NeuroScope alone (RoBERTa still downloading/unavailable for this pass).
  if (semantics.neuroscope) {
    const neuroscopeReading = sentimentFromNeuroScope(semantics.neuroscope);
    return applySymptomFloor(text, mergeSentimentReadings(neuroscopeReading, lexiconReading, 'neuroscope+lexicon'));
  }

  // FALLBACK: NeuroScope still downloading/unavailable — use the supporting
  // hub RoBERTa sentiment head blended with the lexicon instead of leaving
  // the tone chip on the plain lexicon reading.
  if (semantics.sentiment.source === 'transformer') {
    return applySymptomFloor(text, mergeSentimentReadings(semantics.sentiment, lexiconReading, 'hybrid'));
  }

  return applySymptomFloor(text, lexiconReading);
}

// --- 1b. Question-aware reading of short yes/no-style answers -------------

/**
 * Matches a short, direct answer (yes/no/frequency-style) with no other
 * substantial content, so it can be interpreted using the QUESTION's
 * polarity instead of falling through to the word-lexicon scorer (which
 * has nothing to score in a bare "yes" or "no" and would otherwise always
 * read it as flat neutral, regardless of what was actually being asked).
 */
const STRONG_AFFIRM = /^(yes|yeah|yep|yup|definitely|absolutely|totally|for sure|always|very much( so)?|often|frequently|constantly)[.!]*$/i;
const MILD_AFFIRM = /^(sometimes|occasionally|a little|a bit|somewhat|kind of|kinda|sort of|maybe|mostly)[.!]*$/i;
const STRONG_NEGATE = /^(no|nope|nah|not at all|never|definitely not|absolutely not|none)[.!]*$/i;
const MILD_NEGATE = /^(not really|not much|rarely|hardly|barely|not often)[.!]*$/i;

export interface DirectAnswerReading {
  matched: boolean;
  strength: 'strong' | 'mild' | null;
  direction: 'affirm' | 'negate' | null;
}

/** Detects whether an answer is a short, direct yes/no/frequency response
 * (as opposed to a fuller free-text reflection), independent of question
 * polarity — used both for sentiment scoring and for phrasing responses
 * naturally around a one-word answer instead of quoting it out of context. */
export function readDirectAnswer(text: string): DirectAnswerReading {
  const trimmed = (text || '').trim();
  if (STRONG_AFFIRM.test(trimmed)) return { matched: true, strength: 'strong', direction: 'affirm' };
  if (MILD_AFFIRM.test(trimmed)) return { matched: true, strength: 'mild', direction: 'affirm' };
  if (STRONG_NEGATE.test(trimmed)) return { matched: true, strength: 'strong', direction: 'negate' };
  if (MILD_NEGATE.test(trimmed)) return { matched: true, strength: 'mild', direction: 'negate' };
  return { matched: false, strength: null, direction: null };
}

/**
 * The tone-detection entry point the rest of the app should call. Falls
 * back to the general lexicon-based analyzeSentiment() for normal free-text
 * answers, but when the answer is a short, direct yes/no/frequency response
 * AND the current question has a known yes/no polarity (yesMeansConcern),
 * it scores the answer against THAT question's meaning instead — so "yes"
 * to "Do you have a reliable support system?" reads as calm, while "yes" to
 * "Do you frequently experience mood swings?" reads as distressed, rather
 * than both landing on a flat, uninformative "neutral".
 */
export function analyzeAnswerSentiment(
  question: Pick<Question, 'yesMeansConcern' | 'mandatory'> | null | undefined,
  text: string
): SentimentResult {
  // Explicit crisis language overrides everything else, including the
  // direct yes/no shortcut below — a person can answer "yes" to an
  // unrelated question and still disclose active risk in the same
  // sentence, and that disclosure must never be dropped on the floor
  // because the reply also happened to parse as a short direct answer.
  if (hasCrisisPhrase(text)) return analyzeSentiment(text);

  const direct = readDirectAnswer(text);

  if (direct.matched && question && typeof question.yesMeansConcern === 'boolean') {
    // Resolve which direction ("affirm"/"negate") actually points toward a
    // concern for this specific question.
    const pointsToConcern =
      (direct.direction === 'affirm' && question.yesMeansConcern) ||
      (direct.direction === 'negate' && !question.yesMeansConcern);

    // The mandatory self-harm/safety screener always reads as severe on any
    // non-trivial affirmative — this is the one place where erring toward
    // over-caution is the only acceptable default.
    if (question.mandatory && pointsToConcern) {
      return { score: -0.95, label: 'severe', magnitude: 1, source: 'lexicon+question' };
    }

    if (pointsToConcern) {
      // A plain (non-mandatory) "yes" to a symptom question is a real
      // signal worth a proper, supportive answer — but on its own, without
      // any severe/crisis language, it should read as "distressed", not
      // "severe" (which is reserved for crisis-level content and the
      // mandatory safety screener above).
      const score = direct.strength === 'strong' ? -0.4 : -0.2;
      return { score, label: 'distressed', magnitude: direct.strength === 'strong' ? 0.85 : 0.55, source: 'lexicon+question' };
    }
    // Points toward the healthy/positive reading.
    const score = direct.strength === 'strong' ? 0.55 : 0.2;
    return { score, label: 'calm', magnitude: direct.strength === 'strong' ? 0.9 : 0.5, source: 'lexicon+question' };
  }

  // No question polarity to anchor to (open-ended question, or a fuller
  // free-text answer) — use the general word-lexicon analysis, then apply
  // the symptom-phrase floor so a low-valence-but-clinically-real answer
  // (e.g. "Heightened sensitivity to loud sounds or bright lights") never
  // rests on "calm"/"neutral" just because it has no emotional-valence words.
  return applySymptomFloor(text, analyzeSentiment(text));
}

/**
 * The async, transformer-first counterpart of `analyzeAnswerSentiment`.
 *
 * Order of precedence:
 *  1. Explicit crisis phrases -> severe (deterministic, model-independent).
 *  2. A short yes/no answer on a question with known polarity -> read against
 *     that question's meaning (a dense classifier has no way to know that
 *     "yes" here is concerning, so the deterministic rule stays in charge).
 *  3. Everything else -> NeuroScope DistilBERT blended with the lexicon
 *     (falling back to the supporting RoBERTa model, then the lexicon alone,
 *     while NeuroScope is still downloading/unavailable).
 *
 * Returns exactly the same shape as the sync version, so both can be used
 * interchangeably by callers.
 */
export async function analyzeAnswerSentimentAsync(
  question: Pick<Question, 'yesMeansConcern' | 'mandatory'> | null | undefined,
  text: string,
  options?: { timeoutMs?: number }
): Promise<SentimentResult> {
  if (hasCrisisPhrase(text)) return analyzeSentiment(text);
  const direct = readDirectAnswer(text);
  if (direct.matched && question && typeof question.yesMeansConcern === 'boolean') {
    return analyzeAnswerSentiment(question, text);
  }
  return analyzeSentimentAsync(text, options);
}

/**
 * The full semantic pass for one answer: transformer tone, the 7-way emotion
 * distribution, and similarity to crisis-language exemplars. This is what the
 * dynamic risk engine consumes. Returns null when the models were unavailable
 * (callers then fall back to the lexicon-only reading).
 */
export async function analyzeAnswerSemantics(
  question: Pick<Question, 'yesMeansConcern' | 'mandatory'> | null | undefined,
  text: string,
  options?: { timeoutMs?: number }
): Promise<SemanticAnalysis | null> {
  const clean = (text || '').trim();
  if (clean.length < 2) return null;
  if (hasCrisisPhrase(clean)) {
    // Still compute the emotion distribution for the UI, but guarantee the
    // tone reading is severe.
    const emotions = await classifyEmotions(clean);
    return {
      text: clean,
      sentiment: { score: -0.95, label: 'severe', magnitude: 1, source: 'lexicon' },
      emotions,
      riskSimilarity: 1,
      degraded: emotions.source === 'lexicon',
    };
  }

  const semantics = await analyzeTextSemantics(clean, { timeoutMs: options?.timeoutMs });

  // A short, direct yes/no/frequency answer against a question with known
  // polarity is fully deterministic (see analyzeAnswerSentiment) — most
  // importantly the mandatory safety screener's severe override on a bare
  // "yes" — and must never be superseded by a transformer's context-free
  // reading of the same bare text, which the shared semantic cache may also
  // be holding under a completely different, unrelated question that
  // happened to get the same one-word answer. Everything else about the
  // semantic pass (emotions, risk-language similarity) is still useful
  // supporting evidence and is kept; only the tone verdict is overridden.
  const direct = readDirectAnswer(clean);
  if (direct.matched && question && typeof question.yesMeansConcern === 'boolean') {
    const sentiment = analyzeAnswerSentiment(question, clean);
    if (semantics) return { ...semantics, sentiment };
    return {
      text: clean,
      sentiment,
      emotions: { top: { label: 'neutral', score: 0 }, all: [], distressWeight: 0, distressDominant: false, source: 'lexicon' },
      riskSimilarity: sentiment.label === 'severe' ? 1 : null,
      degraded: true,
    };
  }

  return semantics;
}

/** Multi-class emotion distribution for a piece of text (never null; the
 * lexicon-based estimate is returned when the classifier is unavailable). */
export async function analyzeEmotions(text: string): Promise<EmotionClassification> {
  return classifyEmotions(text);
}

// --- 2. Information retrieval: TF-weighted relevance -----------------------

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/** The text a question is embedded as. Shared by the warm-up pass and the
 * ranking pass so both hit the same embedding-cache keys. */
export function questionEmbeddingText(question: Question): string {
  return `${question.question} ${question.keywords.join(' ')} ${question.category}`;
}

/** Fire-and-forget embedding warm-up for the whole question pool. Called when
 * an assessment starts, so the first adaptive selection is already vectorized.
 * Resolves silently when the embedding model is not yet available. */
export async function warmQuestionEmbeddings(pool: Question[]): Promise<number> {
  return prewarmEmbeddings(pool.map(questionEmbeddingText));
}

/** Cosine-style relevance between the answer's term vector and a question's
 * keyword vector. Retained as the offline fallback for semantic vector search
 * and as a precision anchor on literal keyword matches (a question whose
 * keyword is quoted verbatim in the answer is maximally relevant no matter
 * what the embedding space says). */
function irRelevance(answerTokens: string[], keywords: string[]): number {
  if (answerTokens.length === 0 || keywords.length === 0) return 0;
  const answerTF = termFrequency(answerTokens);
  const keywordTokens = keywords.flatMap((k) => tokenize(k));
  const keywordTF = termFrequency(keywordTokens);

  let dot = 0;
  keywordTF.forEach((kWeight, term) => {
    const aWeight = answerTF.get(term) || (answerTF.get(term.slice(0, -1)) ?? 0);
    dot += kWeight * aWeight;
  });

  const answerMag = Math.sqrt(Array.from(answerTF.values()).reduce((s, v) => s + v * v, 0));
  const keywordMag = Math.sqrt(Array.from(keywordTF.values()).reduce((s, v) => s + v * v, 0));
  if (answerMag === 0 || keywordMag === 0) return 0;

  return Math.max(0, Math.min(1, dot / (answerMag * keywordMag)));
}

// --- 3. NDCG ranking-quality metric -----------------------------------------

/** Standard Normalized Discounted Cumulative Gain @k. Compares the relevance
 * values in the order they were actually ranked against the ideal
 * (descending-sorted) order of those same values. */
export function computeNDCG(relevancesInRankedOrder: number[]): number {
  if (relevancesInRankedOrder.length === 0) return 0;
  const dcg = relevancesInRankedOrder.reduce(
    (sum, rel, i) => sum + rel / Math.log2(i + 2),
    0
  );
  const ideal = [...relevancesInRankedOrder].sort((a, b) => b - a);
  const idcg = ideal.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  return idcg > 0 ? dcg / idcg : 0;
}

// --- 4. Category coverage + randomized adaptive selection ------------------

function categoryCounts(sequence: Question[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cat of CATEGORIES) counts[cat] = 0;
  for (const q of sequence) counts[q.category] = (counts[q.category] || 0) + 1;
  return counts;
}

export interface AdaptiveSelectionResult {
  question: Question;
  meta: AdaptiveSelectionMeta;
}

/**
 * How unsure the fused NeuroScope × RoBERTa ensemble was about the last
 * answer, 0 (models agreed) to 1 (models pointed opposite ways). 0 for any
 * reading that isn't an ensemble read (lexicon-only, single-model fallback,
 * direct yes/no) — those paths are unaffected by this term.
 */
function sentimentUncertainty(sentiment: SentimentResult): number {
  if (
    sentiment.source !== 'ensemble' &&
    sentiment.source !== 'ensemble+lexicon' &&
    sentiment.source !== 'ensemble3' &&
    sentiment.source !== 'ensemble3+lexicon'
  )
    return 0;
  if (typeof sentiment.confidence !== 'number') return 0;
  return Math.max(0, Math.min(1, 1 - sentiment.confidence));
}

/**
 * Picks the next question given everything asked so far and the answer just
 * given. Guarantees: (a) no repeats, (b) the mandatory safety question is
 * always asked early — at a slot that tightens as the session risk rises, so
 * a deteriorating presentation is screened for safety sooner than the old
 * flat 35% mark allowed, (c) categories stay roughly balanced across the run,
 * (d) selection is otherwise adaptive + randomized, (e) when the two
 * transformers disagreed on the last answer's tone, a follow-up question in
 * the SAME category is favored over moving to a fresh one — an ambiguous
 * read deserves a clarifying question before the assessment moves on, so the
 * final picture reflects a resolved read rather than whichever model happened
 * to be louder.
 */
export function selectNextQuestion(
  pool: Question[],
  sequenceSoFar: Question[],
  lastAnswerText: string,
  currentCategory: string,
  totalQuestions: number = TOTAL_QUESTIONS,
  lastQuestion?: Question,
  riskLevel: RiskLevel = 'low'
): AdaptiveSelectionResult {
  const askedIds = new Set(sequenceSoFar.map((q) => q.id));
  const remaining = pool.filter((q) => !askedIds.has(q.id));
  const sentiment = analyzeAnswerSentiment(lastQuestion, lastAnswerText);

  // Force the mandatory safety screener in early, scaled to the run length
  // (e.g. by slot 2 of 5, slot 4 of 10, slot 7 of 20) if not yet asked. The
  // slot moves earlier as the session risk level rises.
  const mandatoryForceSlot = dynamicMandatorySlot(totalQuestions, riskLevel);
  const mandatoryPending = remaining.find((q) => q.mandatory && !askedIds.has(q.id));
  if (mandatoryPending && sequenceSoFar.length >= mandatoryForceSlot) {
    return {
      question: mandatoryPending,
      meta: { irRelevance: 1, ndcg: 1, sentiment }
    };
  }

  const answerTokens = tokenize(lastAnswerText);
  const counts = categoryCounts(sequenceSoFar);
  const targetPerCategory = totalQuestions / CATEGORIES.length;

  const scored = remaining.map((q) => {
    const ir = irRelevance(answerTokens, q.keywords);
    const coverageBonus = Math.max(0, targetPerCategory - (counts[q.category] || 0)) / targetPerCategory;
    const sentimentBoost =
      (sentiment.label === 'severe' || sentiment.label === 'distressed') && q.category === currentCategory
        ? 0.4
        : 0;
    const uncertaintyBoost = q.category === currentCategory ? sentimentUncertainty(sentiment) : 0;
    const idealRelevance = 0.45 * ir + 0.35 * coverageBonus + 0.2 * sentimentBoost + 0.15 * uncertaintyBoost;
    const jitter = Math.random() * 0.15;
    const combinedScore = idealRelevance + jitter;
    return { q, ir, idealRelevance, combinedScore };
  });

  // Actual (randomized) ranking vs. ideal (pure relevance) ranking, for NDCG.
  const rankedByCombined = [...scored].sort((a, b) => b.combinedScore - a.combinedScore);
  const ndcg = computeNDCG(rankedByCombined.map((s) => s.idealRelevance));

  const top = rankedByCombined[0];
  return {
    question: top.q,
    meta: { irRelevance: top.ir, ndcg, sentiment }
  };
}

/**
 * Semantic-vector-search selection: the primary selection path.
 *
 * The user's previous answer and every remaining question are embedded with
 * `all-MiniLM-L6-v2`; relevance becomes cosine similarity in embedding space
 * instead of TF-weighted keyword overlap, so a question can be picked because
 * it is *about the same thing* the person just described even when they used
 * none of its keywords ("I keep replaying arguments in my head at 3am" now
 * reaches the rumination item, which shares no words with it).
 *
 * TF-weighted relevance is kept as a minority term: it is the sharper signal
 * when the person literally quotes a keyword, and it is the fallback when the
 * embedding model is unavailable. Everything else — category coverage,
 * sentiment boost, bounded jitter, NDCG reporting, and the risk-scaled
 * mandatory safety slot — is unchanged from the synchronous selector.
 */
export async function selectNextQuestionAsync(
  pool: Question[],
  sequenceSoFar: Question[],
  lastAnswerText: string,
  currentCategory: string,
  totalQuestions: number = TOTAL_QUESTIONS,
  lastQuestion?: Question,
  riskLevel: RiskLevel = 'low',
  options?: { timeoutMs?: number; precomputedSentiment?: SentimentResult }
): Promise<AdaptiveSelectionResult> {
  const askedIds = new Set(sequenceSoFar.map((q) => q.id));
  const remaining = pool.filter((q) => !askedIds.has(q.id));
  const sentiment =
    options?.precomputedSentiment ??
    (await analyzeAnswerSentimentAsync(lastQuestion, lastAnswerText, { timeoutMs: options?.timeoutMs }));

  const mandatoryForceSlot = dynamicMandatorySlot(totalQuestions, riskLevel);
  const mandatoryPending = remaining.find((q) => q.mandatory && !askedIds.has(q.id));
  if (mandatoryPending && sequenceSoFar.length >= mandatoryForceSlot) {
    return { question: mandatoryPending, meta: { irRelevance: 1, ndcg: 1, sentiment, semantic: false } };
  }

  const answerTokens = tokenize(lastAnswerText);
  const counts = categoryCounts(sequenceSoFar);
  const targetPerCategory = totalQuestions / CATEGORIES.length;

  // Vector search over the candidates (cached after the warm-up pass).
  const semanticScores =
    lastAnswerText && lastAnswerText.trim().length >= 2
      ? await rankBySemanticSimilarity(
          lastAnswerText,
          remaining.map((q) => ({ id: q.id, text: questionEmbeddingText(q) }))
        )
      : null;
  const semanticUsed = !!semanticScores && semanticScores.size > 0;

  const scored = remaining.map((q) => {
    const tf = irRelevance(answerTokens, q.keywords);
    const semantic = semanticScores?.get(q.id);
    // 72/28 blend: semantic similarity carries the ranking, literal keyword
    // overlap keeps its say (and takes over entirely when embeddings are off).
    let ir = semantic == null ? tf : Math.max(0, Math.min(1, 0.72 * semantic + 0.28 * tf));
    // A verbatim keyword in the answer is unambiguous — never let the
    // embedding space talk that signal down.
    if (tf >= 0.35) ir = Math.max(ir, tf);

    const coverageBonus = Math.max(0, targetPerCategory - (counts[q.category] || 0)) / targetPerCategory;
    const sentimentBoost =
      (sentiment.label === 'severe' || sentiment.label === 'distressed') && q.category === currentCategory
        ? 0.4
        : 0;
    const uncertaintyBoost = q.category === currentCategory ? sentimentUncertainty(sentiment) : 0;
    const idealRelevance = 0.45 * ir + 0.35 * coverageBonus + 0.2 * sentimentBoost + 0.15 * uncertaintyBoost;
    const jitter = Math.random() * 0.15;
    return { q, ir, idealRelevance, combinedScore: idealRelevance + jitter };
  });

  const rankedByCombined = [...scored].sort((a, b) => b.combinedScore - a.combinedScore);
  const ndcg = computeNDCG(rankedByCombined.map((s) => s.idealRelevance));
  const top = rankedByCombined[0];

  return {
    question: top.q,
    meta: { irRelevance: top.ir, ndcg, sentiment, semantic: semanticUsed },
  };
}

/** Chooses a randomized-but-sensible opening question (always from the Mood
 * category, so the intake still starts with a grounding baseline question). */
export function getOpeningQuestion(pool: Question[]): Question {
  const openers = pool.filter((q) => q.category === CATEGORIES[0]);
  return openers[Math.floor(Math.random() * openers.length)];
}

// --- 5. Exercise-gating: only interrupt the flow when it actually helps -----

/**
 * Decides whether to show the per-question response card after a given
 * answer. Every answer gets a response now — the "exercise" framing only
 * applied to distressed/severe tones, but calm and neutral answers deserve
 * a reply just as much: a calm answer should be met with genuine
 * appreciation, and a neutral answer with a light, encouraging nudge and a
 * couple of tips — not silence. The response itself (see
 * dynamicFeelingSolutions.ts) adapts its framing to the detected tone;
 * this gate just decides whether to show a card at all, and now it always
 * does, so no one's check-in is skipped regardless of how they're doing.
 */
export function shouldTriggerExercise(_sentiment: SentimentResult, _isMandatoryQuestion = false): boolean {
  return true;
}