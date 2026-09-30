export interface Question {
  id: number;
  category: string;
  categoryIndex: number;
  question: string;
  rationale: string;
  placeholder: string;
  quickPrompts: string[];
  /** Keyword/topic terms used by the adaptive retrieval engine to match this
   * question's relevance against the user's previous free-text answers. */
  keywords: string[];
  /** Marks a question that must always be included in every assessment
   * regardless of adaptive selection (e.g. the safety/self-harm screener). */
  mandatory?: boolean;
  /**
   * How a short, literal "yes" answer to THIS question should be read:
   *  - true  => "yes" points toward a symptom/concern (most items, e.g.
   *             "Do you frequently experience mood swings?").
   *  - false => "yes" points toward a healthy/positive resource (e.g.
   *             "Do you have a reliable support system?").
   * Left undefined for open-ended questions with no clean yes/no reading
   * (e.g. "How consistent is your sleep schedule?"), in which case a short
   * yes/no answer falls back to the general lexicon-based sentiment engine.
   * This lets one-word "yes"/"no" answers be scored correctly instead of
   * always reading as neutral.
   */
  yesMeansConcern?: boolean;
}

export interface SentimentResult {
  score: number; // -1 (severe) to 1 (calm)
  label: 'severe' | 'distressed' | 'neutral' | 'calm';
  magnitude: number; // 0 to 1, strength of detected emotional language
  /**
   * Which engine produced the reading:
   *  - 'neuroscope'          the project's own fine-tuned NeuroScope DistilBERT
   *                          dual-head model, mapped onto the tone scale — the
   *                          PRIMARY reader whenever that model is loaded
   *  - 'neuroscope+lexicon'  NeuroScope DistilBERT + lexicon merged
   *  - 'transformer'         supporting hub RoBERTa sentiment head (in-browser
   *                          ONNX), used only while NeuroScope is still
   *                          downloading/unavailable
   *  - 'lexicon'             the offline valence lexicon (always available)
   *  - 'lexicon+question'    lexicon combined with the question's yes/no polarity
   *  - 'hybrid'              RoBERTa + lexicon merged (fallback path, NeuroScope unavailable)
   *  - 'ensemble'            NeuroScope DistilBERT + RoBERTa fused by confidence-weighted
   *                          ensembling (see `ensembleTransformerSentiment`) — used whenever
   *                          BOTH models are loaded, instead of discarding RoBERTa's read
   *  - 'ensemble+lexicon'    the above ensemble further blended with the offline lexicon
   *  - 'groq'                a Groq-hosted LLM's own read of the text's tone/emotion (server
   *                          route `/api/tone-analysis`) — a third, independently-reasoned
   *                          opinion alongside the two on-device transformers
   *  - 'ensemble3'           NeuroScope DistilBERT + RoBERTa + Groq fused by confidence-weighted
   *                          three-way ensembling (see `ensembleThreeWaySentiment`) — used
   *                          whenever ALL THREE readers produced a result, so the verdict is
   *                          never resting on the two small on-device models alone
   *  - 'ensemble3+lexicon'   the three-way ensemble further blended with the offline lexicon
   * Optional so existing call sites that build a SentimentResult by hand keep working.
   */
  source?:
    | 'neuroscope'
    | 'neuroscope+lexicon'
    | 'transformer'
    | 'lexicon'
    | 'lexicon+question'
    | 'hybrid'
    | 'ensemble'
    | 'ensemble+lexicon'
    | 'groq'
    | 'local-llm'
    | 'ensemble3'
    | 'ensemble3+lexicon';
  /**
   * How much the transformer readings agreed, 0..1 (only set when `source` is
   * one of the 'ensemble*' variants). 1 = the models pointed the same way;
   * low values flag a genuinely ambiguous answer worth a clarifying follow-up
   * rather than a confident verdict from either model alone.
   */
  confidence?: number;
}

/** The seven Ekman emotions the multi-class classifier emits. */
export type EmotionLabel = 'anger' | 'disgust' | 'fear' | 'joy' | 'neutral' | 'sadness' | 'surprise';

export interface EmotionScore {
  label: EmotionLabel;
  score: number; // 0 to 1 probability
}

/**
 * Multi-class emotion read for one piece of text. `top` is the dominant
 * emotion; `all` is the full distribution sorted descending. Emotions in the
 * distress family (fear, sadness, anger, disgust) drive the risk engine.
 */
export interface EmotionClassification {
  top: EmotionScore;
  all: EmotionScore[];
  /** Total probability mass on fear/sadness/anger/disgust. */
  distressWeight: number;
  /** True when the dominant emotion is in the distress family. */
  distressDominant: boolean;
  source: 'transformer' | 'lexicon';
  /**
   * True only for the lexicon fallback's zero-hit case: no emotion word from
   * EMOTION_LEXICON was found anywhere in the text, so `top` is a hard-coded
   * "neutral, 100%" default rather than an actual read of the text. Callers
   * that display this as a confidence figure (e.g. the live emotion chip)
   * should treat `defaulted: true` as "no signal", not "100% neutral".
   */
  defaulted?: boolean;
}

/**
 * One combined semantic pass over a piece of user text: fine-tuned sentiment,
 * multi-class emotion distribution, and cosine similarity to the high-risk
 * semantic marker bank (null when embeddings were not available in time).
 */
export interface SemanticAnalysis {
  text: string;
  sentiment: SentimentResult;
  emotions: EmotionClassification;
  /** Cosine similarity (0..1) to the nearest high-risk exemplar, or null when
   * the embedding model was unavailable/timed out. */
  riskSimilarity: number | null;
  /** Reading from the project's own fine-tuned DistilBERT dual-head model —
   * the PRIMARY classification pass. Null when that model was still
   * downloading or unavailable (supporting models then carry the read). */
  neuroscope?: NeuroScopeReading | null;
  /** Independent tone/emotion read from a Groq-hosted LLM (server route
   * `/api/tone-analysis`), used as the third ensemble member alongside the two
   * on-device transformers. Null when the request timed out, was skipped, or
   * every configured provider (Groq, Groq #2, Gemini) failed — the ensemble
   * then degrades gracefully to NeuroScope + RoBERTa only. */
  groq?: SentimentResult | null;
  /** Tone read from the offline, on-device Phi-3 mini (see `utils/localLlm.ts`).
   * Only ever populated when the cloud reader (`groq`) produced nothing, so the
   * two are never both present. Enters the ensemble at a minority weight under
   * the same safety bypass and sticky-severity rules as Groq. */
  localLlm?: SentimentResult | null;
  /** True when at least one model was unavailable, so the reading is a blend
   * of transformer output and the offline lexicon fallback. */
  degraded: boolean;
  /** Agreement across whichever readers actually produced a reading for this
   * text (mirrors `sentiment.confidence`) — two-way (NeuroScope + RoBERTa) or
   * three-way (+ Groq) depending on what was available. Null when only one
   * reader (or none) produced a reading. */
  ensembleAgreement?: number | null;
}

/** Loading state of the in-browser transformer stack. */
export type SemanticEngineStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';

export interface SemanticModelState {
  state: 'pending' | 'loading' | 'ready' | 'failed';
  progress: number; // 0 to 1 for this model's download
}

export interface SemanticEngineState {
  status: SemanticEngineStatus;
  models: Record<SemanticModelKey, SemanticModelState>;
  /** Overall download progress, 0 to 1. */
  progress: number;
  /** Short human-readable description of what is loading right now. */
  detail: string;
  /** Why the engine is unavailable, when it is. */
  reason?: string;
}

export type SemanticModelKey = 'sentiment' | 'emotion' | 'embedding' | 'neuroscope';

/** The seven dimensions the primary NeuroScope DistilBERT classifier emits. */
export type NeuroScopeStatus =
  | 'Normal'
  | 'Depression'
  | 'Suicidal'
  | 'Anxiety'
  | 'Bipolar'
  | 'Stress'
  | 'Personality Disorder';

/**
 * Reading of ONE piece of text from the project's own fine-tuned DistilBERT
 * dual-head model (`public/models/neuroscope-distilbert`, in-browser ONNX).
 * This is the app's PRIMARY clinical classifier; the RoBERTa sentiment head,
 * the emotion classifier and the MiniLM embeddings now act as supporting
 * signals around it, and Gemini/Groq only write copy FROM these readings.
 */
export interface NeuroScopeReading {
  /** Dominant dimension (argmax over the 7-way status head). */
  topStatus: NeuroScopeStatus;
  /** Softmax probability of the dominant dimension (0..1). */
  pTop: number;
  /** Full status distribution, sorted descending (top 3). */
  top3: { label: NeuroScopeStatus; p: number }[];
  /** Sigmoid of the binary risk head — probability of concern (0..1). */
  pRisk: number;
  /** True when pRisk crossed the model's recall-first threshold (0.22). */
  riskFlag: boolean;
  /** Dynamic risk band derived from pRisk + status confidence:
   * low | elevated | high | critical. Feeds the dynamic risk engine. */
  band: RiskLevel;
  /** Human-readable summary of WHY this band was chosen (top status + risk p). */
  summary: string;
  source: 'neuroscope-distilbert';
}

/** Progressive risk level produced by the dynamic risk engine. */
export type RiskLevel = 'low' | 'elevated' | 'high' | 'critical';

export interface RiskSignal {
  kind: 'marker' | 'semantic' | 'tone' | 'rate' | 'emotion' | 'safety' | 'protective' | 'neuroscope';
  detail: string;
  weight: number; // signed contribution to the 0-100 risk score
}

/**
 * Dynamic, evidence-weighted risk assessment for an in-progress assessment.
 * Replaces the fixed 35% severity threshold: the score is built from explicit
 * high-risk semantic markers, embedding similarity to crisis language,
 * transformer tone, the *rate of change* across consecutive answers, sustained
 * distress emotions, and the mandatory safety-screener response.
 */
export interface RiskAssessment {
  score: number; // 0 to 100
  level: RiskLevel;
  signals: RiskSignal[];
  /** Rolling tone slope across recent answers (negative = deteriorating). */
  toneTrend: number;
  /** Number of answers analyzed so far in this session. */
  samples: number;
  /** 0-based index of the question whose answer drove the escalation, if any. */
  escalatedAtQuestion?: number;
}

export interface AdaptiveSelectionMeta {
  irRelevance: number; // 0 to 1, information-retrieval relevance of the chosen question to the prior answer
  ndcg: number; // 0 to 1, ranking-quality score (NDCG) of the adaptive selection
  sentiment: SentimentResult;
  /** True when the relevance figure came from embedding-based semantic vector
   * search (false when it fell back to TF-weighted keyword overlap). */
  semantic?: boolean;
}

/**
 * How many questions a given assessment run will ask. 'quick' and 'balanced'
 * exist for people who don't want to spend much time up front; 'full' is the
 * complete adaptive screening. All three draw from the same 50-item pool and
 * use the same scoring engine — only the length differs.
 */
export type AssessmentLength = 5 | 10 | 20;

export interface AssessmentModeOption {
  length: AssessmentLength;
  label: string;
  description: string;
  estimatedMinutes: string;
}

export interface PsycheExample {
  id: string;
  text: string;
  primaryEmotion: string;
  secondaryEmotion: string;
  emotion: string;
  domain: string;
  screeningCategory: string;
  cognitiveDistortion: string;
  somaticTags: string;
  riskLevel: string;
  primaryNeed: string;
  responseStrategy: string;
  technique: string;
  tool: string;
  reflection: string;
  sampleReply: string;
  searchText: string;
  retrievalScore?: number;
}

export interface AnswerRecord {
  questionId: number;
  questionText: string;
  category: string;
  answer: string;
}

export interface DimensionScore {
  category: string;
  score: number; // 0 to 100 where 100 is optimal/thriving
  status: 'Optimal' | 'Mild Strain' | 'Moderate Concern' | 'Severe Strain';
  summary: string;
}

export interface SolutionItem {
  id: string;
  title: string;
  category: string;
  difficulty: 'Quick 2-min' | 'Daily Routine' | 'Mindset' | 'Professional';
  actionSteps: string[];
  scientificRationale: string;
  matchedTrigger?: string;
  neuroTarget?: string;
  timeEstimate?: string;
  interactiveToolType?: 'breathing' | 'timer' | 'grounding' | 'journal';
}

export interface AssessmentResult {
  overallVerdict: string;
  severityLevel: 'optimal' | 'mild' | 'moderate' | 'high' | 'critical';
  verdictSummary: string;
  dimensionalScores: DimensionScore[];
  personalizedSolutions: SolutionItem[];
  motivationalMessage: string;
  safetyAlert?: {
    isCritical: boolean;
    guidance: string;
    helplineNumbers: {
      name: string;
      contact: string;
      description: string;
      region?: string;
      type?: 'call' | 'text' | 'web';
    }[];
  };
  providerUsed: 'gemini' | 'groq' | 'clinical-engine';
  /** Live dynamic risk reading captured across the run (semantic markers +
   * rate-of-change), carried into the report so downstream surfaces can
   * adapt their framing without re-deriving it. */
  riskAssessment?: RiskAssessment;
  timestamp: string;
  isCustomRevised?: boolean;
  customFeedbackNote?: string;
}

export type AIProvider = 'gemini' | 'groq' | 'auto';

/* ------------------------------------------------------------------
 * Per-dimension deep-dive ("detailed insight" dropdown on each of the
 * five Biopsychosocial Breakdown cards). Built from THREE sources that
 * are combined: Gemini, Groq and the project research corpus
 * (peer-reviewed papers + clinical/neuroscience books).
 * ------------------------------------------------------------------ */

/** Raw structured brief as produced by one model (or by the merge step). */
export interface DimensionInsightDraft {
  /** One-line summary of where the person stands in this area. */
  headline: string;
  /** Plain-language brief of the person's condition in this area. */
  conditionSummary: string;
  /** What was noticed in the person's own answers. */
  keyObservations: string[];
  strengths: string[];
  watchPoints: string[];
  /** What the papers/books say about this pattern (only provided sources). */
  researchInsight: string;
  nextSteps: string[];
  whenToSeekSupport: string;
  /** 1-based indexes into the research passages supplied to the model. */
  usedSources: number[];
}

export interface DimensionInsightSource {
  label: string;
  full: string;
  kind: 'paper' | 'book';
}

export interface DimensionInsight extends Omit<DimensionInsightDraft, 'usedSources'> {
  category: string;
  sources: DimensionInsightSource[];
  /** Which of the three ingredients actually contributed to this brief. */
  engines: { gemini: boolean; groq: boolean; research: boolean };
  mode: 'gemini+groq' | 'gemini' | 'groq' | 'local' | 'research-local';
  /** True when a final pass reconciled the Gemini and Groq drafts. */
  synthesized: boolean;
  generatedAt: string;
}
