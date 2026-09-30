import { EmotionClassification, PsycheExample, Question, RiskAssessment, SemanticAnalysis, SentimentResult } from '../types';
import { analyzeAnswerSentiment, readDirectAnswer } from './adaptiveEngine';
import { PRIORITY_CRISIS_HELPLINES, SOFT_SUPPORT_HELPLINES } from './clinicalEngine';
import { shouldOfferSoftSupport } from './riskEngine';
import {
  composeEmpatheticParagraph,
  composeNervousSystemParagraph,
  composePerspectiveShiftParagraph,
  detectResearchTheme,
  ResearchComposeInput,
  ResearchTheme,
  RetrievedPassage,
} from './researchKnowledge';
import { generateLocalSolution, isLocalLlmReady, type LocalSolutionDraft } from './localLlm';
import { hasImminentRiskLanguage } from './riskEngine';
import { summarizeSources } from './researchRetrieval';

/**
 * Everything the local/remote engines learned about the current answer before
 * a solution is composed: the transformer tone reading, the rolling dynamic
 * risk assessment, the full semantic pass (including the 7-way emotion
 * distribution), and the research-corpus passages retrieved for this exact
 * answer. All four are optional — when the models are cold or the browser
 * cannot run them, composition falls back to the lexicon + lexical retrieval.
 */
export interface SolutionEvidence {
  tone?: SentimentResult | null;
  risk?: RiskAssessment | null;
  semantics?: SemanticAnalysis | null;
  passages?: RetrievedPassage[] | null;
  psycheExamples?: PsycheExample[] | null;
  /** Every PRIMARY NeuroScope reading from this run so far — sent to the
   * server so Gemini/Groq write from the full trained-model picture. */
  neuroscopeReadings?: import('../types').NeuroScopeReading[] | null;
}

/** Fields that surface the evidence itself in the card: the emotion chips, the
 * risk band, and the "grounded in" citation list. Lexicon-guessed emotions are
 * deliberately hidden — a chip is a claim that a model actually classified it. */
function evidenceFields(evidence?: SolutionEvidence | null): Partial<DynamicFeelingSolution> {
  const emotions: EmotionClassification | null | undefined = evidence?.semantics?.emotions;
  const sources = evidence?.passages?.length ? summarizeSources(evidence.passages) : [];
  return {
    emotions: emotions && emotions.source === 'transformer' ? emotions : undefined,
    evidenceSources: sources.length ? sources : undefined,
    riskLevel: evidence?.risk?.level,
  };
}

/** Rotating set of extra motivational lines added to distressed (non-crisis)
 * responses, so repeated distressed answers across an assessment don't all
 * get the exact same closing sentence. */
const EXTRA_MOTIVATION_LINES = [
  'You are doing something genuinely brave by looking at this honestly instead of pushing it away.',
  'Every time you name what you are feeling instead of ignoring it, you are building real resilience.',
  'This feeling is real, but it is not permanent — and reaching for support like this is a strong move, not a weak one.',
  'Whatever today looks like, checking in with yourself like this matters, and it adds up over time.',
  'You do not have to fix everything today — this one honest answer is already a meaningful step.',
];

/**
 * Wraps a "distressed-tone" solution with a bit of extra warmth: a rotating
 * motivational line on top of the branch's own affirmation, and — when the
 * live risk reading says support would actually help (distressed tone, an
 * elevated+ dynamic risk level, or a strongly negative score) — a couple of
 * gentle, optional support-line suggestions (India + international)
 * alongside the coping steps, framed as an invitation rather than an alarm.
 */
function withDistressedSupport(
  sol: DynamicFeelingSolution,
  tone: SentimentResult,
  questionNumber: number,
  risk?: RiskAssessment | null
): DynamicFeelingSolution {
  const motivationLine = EXTRA_MOTIVATION_LINES[questionNumber % EXTRA_MOTIVATION_LINES.length];
  const offerSoftSupport = shouldOfferSoftSupport(tone, risk);
  return {
    ...sol,
    toneLevel: sol.toneLevel || 'distressed',
    affirmation: `${sol.affirmation} ${motivationLine}`,
    helplines:
      sol.helplines && sol.helplines.length > 0
        ? sol.helplines
        : offerSoftSupport
        ? SOFT_SUPPORT_HELPLINES.map((hl) => ({ name: hl.name, contact: hl.contact, region: hl.region }))
        : undefined,
  };
}

/**
 * Composes the three research-grounded core sections (Empathetic Assessment,
 * Nervous System explanation, Cognitive Perspective Shift) as one dynamic,
 * high-detail paragraph each, personalized to this user's answer, question
 * and tone. Shared by every branch below so no two answers read the same.
 */
function composedCore(
  theme: ResearchTheme,
  ctx: {
    quoteSnippet: string;
    question: Question;
    tone: SentimentResult;
    questionNumber: number;
    retrieved?: RetrievedPassage[];
    neuroscope?: ResearchComposeInput['neuroscope'];
    dominantEmotion?: string;
    dominantEmotionScore?: number;
  }
): Pick<DynamicFeelingSolution, 'conversationalEmpathy' | 'detailedAnalysis' | 'perspectiveShift'> {
  const input: ResearchComposeInput = {
    theme,
    userSnippet: ctx.quoteSnippet,
    questionText: ctx.question.question,
    category: ctx.question.category,
    focus: (ctx.question.keywords || []).slice(0, 2).join(' and '),
    toneLabel: ctx.tone.label,
    toneMagnitude: ctx.tone.magnitude,
    questionNumber: ctx.questionNumber,
    seedText: String(ctx.question.id ?? ''),
    retrieved: ctx.retrieved,
    neuroscope: ctx.neuroscope,
    dominantEmotion: ctx.dominantEmotion,
    dominantEmotionScore: ctx.dominantEmotionScore,
  };
  return {
    conversationalEmpathy: composeEmpatheticParagraph(input),
    detailedAnalysis: composeNervousSystemParagraph(input),
    perspectiveShift: composePerspectiveShiftParagraph(input),
  };
}

export interface DynamicFeelingSolution {
  emotionalStateLabel: string;
  neuralRegion: string;
  sentimentTone: 'anxious' | 'fatigued' | 'distressed' | 'disconnected' | 'resilient' | 'seeking_balance';
  userQuoteAnalysis?: string;
  conversationalEmpathy?: string;
  detailedAnalysis?: string;
  neurobiologyInsight?: string;
  perspectiveShift?: string;
  immediateSolutionTitle: string;
  immediateActionRightNow?: string;
  immediateSolutionSteps: string[];
  practicalStepToday?: string;
  scientificRationale: string;
  interactiveTool?: {
    type: 'breathing_sigh' | 'grounding_54321' | 'cognitive_defusion' | 'somatic_release' | 'dopamine_spark';
    title: string;
    instructions: string;
  };
  affirmation: string;
  highlightedPill: string;
  suggestedFollowUps?: string[];
  providerUsed?: string;
  /** True while the on-device model is still writing a personalised version of this card. */
  personalizing?: boolean;
  /** Overall tone band for this answer: calm, neutral, distressed, or severe.
   * Drives whether the card leads with an appreciation message or with
   * crisis-support resources instead of a standard solution. */
  toneLevel?: 'calm' | 'neutral' | 'distressed' | 'severe';
  /** Shown only when toneLevel is 'severe' — a short set of support lines to
   * reach out to right now, alongside the calming steps. */
  helplines?: { name: string; contact: string; region?: string }[];
  /** True when the response is an appreciation for a calm/positive answer
   * rather than a corrective "solution". */
  isAppreciation?: boolean;
  /** On-device 7-way emotion distribution for this answer (only set when the
   * transformer classifier actually produced it). */
  emotions?: EmotionClassification;
  /** Short citations for the research passages this solution was grounded in,
   * e.g. "Porges (2007), The Polyvagal Theory". */
  evidenceSources?: string[];
  /** Current dynamic risk band for the run (low / elevated / high / critical). */
  riskLevel?: 'low' | 'elevated' | 'high' | 'critical';
}

/**
 * Calls the server Gemini/Groq AI endpoint for an authentic, real-time dynamic response.
 * Falls back gracefully to the rich local dynamic neuro-solution generator if offline or delayed.
 */
export async function fetchDynamicFeelingSolution(
  question: Question,
  userAnswer: string,
  questionNumber: number,
  totalQuestions: number,
  evidence?: SolutionEvidence | null,
  /** Called once, later, with a personalised version written by the on-device model. */
  onUpgrade?: (upgraded: DynamicFeelingSolution) => void
): Promise<DynamicFeelingSolution> {
  const fields = evidenceFields(evidence);
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
    const controller = new AbortController();
    // Slightly above the server's own 8.5s AI budget, so a slow provider is cut off
    // server-side first and the local generator only steps in when it truly has to.
    const timeoutId = setTimeout(() => controller.abort(), 10500);

    const res = await fetch('/api/feeling-solution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        questionId: question.id,
        questionText: question.question,
        category: question.category,
        userAnswer: (userAnswer || '').trim(),
        questionNumber,
        totalQuestions,
        riskAssessment: evidence?.risk ?? undefined,
        semanticProfile: evidence?.semantics ?? undefined,
        neuroscopeReadings:
          evidence?.neuroscopeReadings && evidence.neuroscopeReadings.length
            ? evidence.neuroscopeReadings
            : evidence?.semantics?.neuroscope
              ? [evidence.semantics.neuroscope]
              : undefined,
        researchPassages: evidence?.passages ?? undefined,
        psycheExamples: evidence?.psycheExamples ?? undefined,
      }),
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      // providerUsed 'local' means the server had no AI provider and sent its own template.
      if (data && data.immediateSolutionTitle && data.immediateSolutionSteps && data.providerUsed !== 'local') {
        return {
          ...fields,
          emotionalStateLabel: data.emotionalStateLabel || 'Real-Time Neural Calibration',
          neuralRegion: data.neuralRegion || 'Prefrontal Cortex & Vagus Nerve',
          sentimentTone: data.sentimentTone || 'seeking_balance',
          userQuoteAnalysis: data.userQuoteAnalysis,
          conversationalEmpathy: data.conversationalEmpathy || data.userQuoteAnalysis,
          detailedAnalysis: data.detailedAnalysis || data.neurobiologyInsight,
          perspectiveShift: data.perspectiveShift,
          immediateSolutionTitle: data.immediateSolutionTitle,
          immediateActionRightNow: data.immediateActionRightNow,
          immediateSolutionSteps: Array.isArray(data.immediateSolutionSteps)
            ? data.immediateSolutionSteps
            : [data.immediateSolutionSteps],
          practicalStepToday: data.practicalStepToday,
          scientificRationale: data.scientificRationale || 'Evidence-based cognitive and somatic regulation.',
          interactiveTool: data.interactiveTool || {
            type: 'breathing_sigh',
            title: 'Physiological Sigh Breathing',
            instructions: 'Inhale twice, long slow exhale to stimulate vagal brake.',
          },
          affirmation: data.affirmation || 'You are taking proactive, compassionate steps to understand your mind.',
          highlightedPill: data.highlightedPill || `AI Dynamic Solution #${questionNumber}`,
          suggestedFollowUps: data.suggestedFollowUps || [
            'Why does my body react physically when I feel like this?',
            'What should I do if this feeling hits while I am at work?',
            'Can you give me a gentler micro-step to start with?',
          ],
          providerUsed: data.providerUsed || 'gemini',
          toneLevel: data.toneLevel,
          helplines: data.helplines,
          isAppreciation: data.isAppreciation,
          // The server echoes its own grounding; prefer what it actually used.
          evidenceSources: data.evidenceSources?.length ? data.evidenceSources : fields.evidenceSources,
        };
      }
    }
  } catch (err) {
    console.info('Using dynamic local feeling synthesis engine:', err);
  }

  // Fallback to rich dynamic local heuristic. It is shown immediately; if the
  // on-device model is ready and this answer is not high-risk, a personalised
  // version replaces it a few seconds later via `onUpgrade`.
  const base = generateDynamicFeelingSolution(question, userAnswer, questionNumber, evidence);
  if (onUpgrade && canPersonalizeOnDevice(base, userAnswer, evidence)) {
    void personalizeOnDevice(base, question, userAnswer, evidence, onUpgrade);
    return { ...base, personalizing: true };
  }
  return base;
}

/** Same rule as the tone ensemble and the chat: never for high-risk or crisis text. */
function canPersonalizeOnDevice(
  base: DynamicFeelingSolution,
  userAnswer: string,
  evidence?: SolutionEvidence | null
): boolean {
  if (!isLocalLlmReady()) return false;
  if (base.toneLevel === 'severe' || (base.helplines && base.helplines.length > 0)) return false;
  const band = String(evidence?.risk?.level || evidence?.semantics?.neuroscope?.band || '').toLowerCase();
  if (band === 'high' || band === 'critical') return false;
  const ns = evidence?.semantics?.neuroscope;
  if (ns && (ns.topStatus === 'Suicidal' || ns.band === 'critical')) return false;
  if (hasImminentRiskLanguage(userAnswer || '')) return false;
  return true;
}

async function personalizeOnDevice(
  base: DynamicFeelingSolution,
  question: Question,
  userAnswer: string,
  evidence: SolutionEvidence | null | undefined,
  onUpgrade: (upgraded: DynamicFeelingSolution) => void
): Promise<void> {
  let draft: LocalSolutionDraft | null = null;
  try {
    draft = await generateLocalSolution({
      questionText: question.question,
      userAnswer,
      toneLabel: base.toneLevel ?? evidence?.tone?.label,
      dominantEmotion:
        evidence?.semantics?.emotions?.source === 'transformer' ? evidence.semantics.emotions.top?.label : undefined,
    });
  } catch {
    draft = null;
  }
  // Always report back so the card can stop showing "personalising…".
  if (!draft) {
    onUpgrade({ ...base, personalizing: false });
    return;
  }
  onUpgrade({
    ...base,
    ...(draft.immediateSolutionTitle ? { immediateSolutionTitle: draft.immediateSolutionTitle } : {}),
    ...(draft.conversationalEmpathy ? { conversationalEmpathy: draft.conversationalEmpathy } : {}),
    ...(draft.detailedAnalysis ? { detailedAnalysis: draft.detailedAnalysis } : {}),
    ...(draft.perspectiveShift ? { perspectiveShift: draft.perspectiveShift } : {}),
    ...(draft.immediateActionRightNow ? { immediateActionRightNow: draft.immediateActionRightNow } : {}),
    ...(draft.immediateSolutionSteps ? { immediateSolutionSteps: draft.immediateSolutionSteps } : {}),
    ...(draft.practicalStepToday ? { practicalStepToday: draft.practicalStepToday } : {}),
    ...(draft.affirmation ? { affirmation: draft.affirmation } : {}),
    // The template's citations no longer describe this text.
    evidenceSources: undefined,
    providerUsed: 'on-device',
    personalizing: false,
  });
}

/**
 * Generates an instant, personalized neuroscience-informed solution and reflection
 * for the user's specific response to a mental health question.
 */
export function generateDynamicFeelingSolution(
  question: Question,
  userAnswer: string,
  questionNumber: number = 1,
  evidence?: SolutionEvidence | null
): DynamicFeelingSolution {
  const solution = buildDynamicFeelingSolution(question, userAnswer, questionNumber, evidence);
  return { ...solution, ...evidenceFields(evidence) };
}

function buildDynamicFeelingSolution(
  question: Question,
  userAnswer: string,
  questionNumber: number = 1,
  evidence?: SolutionEvidence | null
): DynamicFeelingSolution {
  const risk = evidence?.risk;
  const text = (userAnswer || '').trim();
  const lower = text.toLowerCase();

  // Detect a short, direct yes/no/frequency-style answer so we can phrase
  // responses naturally around it (referencing what was actually asked)
  // instead of quoting a bare "yes" with no context.
  const direct = readDirectAnswer(text);
  const isShortYesNo = direct.matched;
  const questionShort = question.question.length > 90 ? `${question.question.slice(0, 87)}...` : question.question;
  const userSnippet = text
    ? isShortYesNo
      ? `${text}" to "${questionShort}`
      : text.length > 80
      ? `${text.slice(0, 77)}...`
      : text
    : '';

  // 0. Overall tone banding (calm / neutral / distressed / severe). Uses the
  // question's own yes/no polarity when the answer is a short, direct
  // response (see analyzeAnswerSentiment), and falls back to the general
  // lexicon-based analyzer for fuller free-text answers. A severe reading
  // always leads with support + helplines; a calm reading leads with
  // appreciation instead of a "fix-it" solution.
  let tone = evidence?.tone || analyzeAnswerSentiment(question, text);

  // The trained classifier is the clinical authority (recall-first design):
  // when its read of THIS answer lands in the high/critical risk band, that
  // escalates the tone family even if the lexicon-based read came back mild,
  // mirroring the same rule the server endpoint applies (`severeBand`).
  const nsBandForTone = evidence?.semantics?.neuroscope?.band;
  if ((nsBandForTone === 'critical' || nsBandForTone === 'high') && tone.label !== 'severe') {
    tone = { ...tone, label: 'severe' };
  }

  // Pre-quoted snippet of the user's own words for the research-grounded
  // paragraph composers; short yes/no answers are quoted in question context.
  const quoteSnippet = text
    ? isShortYesNo
      ? `"${text}" (your answer to "${questionShort}")`
      : `"${text.length > 80 ? `${text.slice(0, 77)}...` : text}"`
    : '';
  // Real classifier signals for THIS answer, when the on-device models
  // produced them: the fine-tuned NeuroScope dual-head reading (dominant
  // dimension + confidence + risk band) and the dominant Ekman emotion from
  // the transformer emotion classifier. Both are threaded into the paragraph
  // composers below so the "dynamic" response is actually grounded in what
  // the models read, not just keyword matches on the raw text.
  const nsReading = evidence?.semantics?.neuroscope || undefined;
  const emotionDist = evidence?.semantics?.emotions;
  const dominantEmotion =
    emotionDist && emotionDist.source === 'transformer' ? emotionDist.top?.label : undefined;
  const dominantEmotionScore =
    emotionDist && emotionDist.source === 'transformer' ? emotionDist.top?.score : undefined;

  const coreCtx = {
    quoteSnippet,
    question,
    tone,
    questionNumber,
    retrieved: evidence?.passages || undefined,
    neuroscope: nsReading,
    dominantEmotion,
    dominantEmotionScore,
  };

  // The dynamic risk tracker can reach a critical reading without any single
  // answer being outright severe (sustained negative rate-of-change plus
  // high-risk markers across answers), so it leads with support too.
  if (tone.label === 'severe' || risk?.level === 'critical') {
    const core = composedCore('severe', coreCtx);
    return {
      emotionalStateLabel: 'What You Shared Sounds Really Heavy',
      neuralRegion: 'Stress Response System',
      sentimentTone: 'distressed',
      toneLevel: 'severe',
      highlightedPill: `Support Right Now #${questionNumber}`,
      userQuoteAnalysis: userSnippet
        ? `Thank you for being honest about "${userSnippet}" — that takes real courage to put into words.`
        : `What you're describing sounds like a genuinely heavy moment.`,
      conversationalEmpathy: `${core.conversationalEmpathy} If things ever feel unsafe or like too much to handle by yourself, please reach out to one of the support lines below — free, confidential, and staffed by real people ready to listen, any hour. In the meantime, here's something small you can do right now to help your body feel steadier.`,
      detailedAnalysis: core.detailedAnalysis,
      perspectiveShift: core.perspectiveShift,
      immediateSolutionTitle: 'A Few Things That Can Help Right Now',
      immediateActionRightNow: 'Place a hand on your chest, and take one slow breath in through your nose and out through your mouth.',
      immediateSolutionSteps: [
        'Take five slow breaths — in for 4 seconds, out for 6 seconds — to help your body settle.',
        'Name three things you can see around you right now, to bring your mind back to the present.',
        'If you can, reach out to someone you trust — a friend, family member, or one of the helplines below — and let them know how you\'re feeling.',
        'Be as gentle with yourself as you would be with a close friend going through this.',
      ],
      practicalStepToday:
        'If it feels safe to do so, tell one person in your life how you are really doing today.',
      scientificRationale:
        'Slow, extended-exhale breathing helps calm the body\'s stress response, and naming things you can see helps bring an overwhelmed mind back to the present moment.',
      interactiveTool: {
        type: 'breathing_sigh',
        title: 'Slow Steady Breathing',
        instructions: 'In for 4 seconds, out for 6 seconds. Let your shoulders drop with every exhale.',
      },
      affirmation: 'This feeling is real, and so is the possibility of things getting lighter. Support is available, and reaching for it is a strong thing to do.',
      helplines: PRIORITY_CRISIS_HELPLINES.map((hl) => ({ name: hl.name, contact: hl.contact, region: hl.region })),
      suggestedFollowUps: [
        'What can I do if this feeling gets worse tonight?',
        'How do I tell someone close to me how I really feel?',
        'What does a support helpline call actually look like?',
      ],
      providerUsed: 'local',
    };
  }

  if (tone.label === 'calm' && tone.magnitude >= 0.15) {
    return {
      emotionalStateLabel: 'Steady, Grounded, and Doing Well',
      neuralRegion: 'Balanced Nervous System',
      sentimentTone: 'resilient',
      toneLevel: 'calm',
      isAppreciation: true,
      highlightedPill: `Nice Check-In #${questionNumber}`,
      userQuoteAnalysis: userSnippet
        ? `Reflecting on "${userSnippet}": that's a genuinely good sign — you're in a settled, steady place right now.`
        : `Your answer reflects a calm, settled state of mind.`,
      ...composedCore('calm', coreCtx),
      immediateSolutionTitle: 'Keep This Going',
      immediateActionRightNow: 'Take a moment to actually notice how this steadiness feels in your body.',
      immediateSolutionSteps: [
        'Take a slow breath and notice what "feeling okay" feels like right now — so you can recognize it again later.',
        'Think of one small thing that helped get you here, and consider doing more of it.',
        'If you feel like it, share this good moment with someone close to you.',
      ],
      practicalStepToday:
        'Keep up whatever routine, habit, or mindset has been working for you lately.',
      scientificRationale:
        'Consciously noticing positive states helps the brain reinforce and return to them more easily over time.',
      affirmation: 'You are doing well, and that is worth recognizing. Keep going.',
      suggestedFollowUps: [
        'What habits have been helping me feel this way?',
        'How do I hold onto this feeling during a stressful week?',
        'What is one small thing I can do to keep this momentum going?',
      ],
      providerUsed: 'local',
    };
  }

  // 1. Keyword Categorization
  const isAnxious =
    lower.includes('anxi') ||
    lower.includes('panic') ||
    lower.includes('worry') ||
    lower.includes('nervous') ||
    lower.includes('tense') ||
    lower.includes('overwhelm') ||
    lower.includes('dread') ||
    lower.includes('chest') ||
    lower.includes('racing') ||
    lower.includes('fear') ||
    lower.includes('heart') ||
    lower.includes('scared') ||
    question.question.toLowerCase().includes('anxiety');

  const isFatigued =
    lower.includes('exhaust') ||
    lower.includes('tired') ||
    lower.includes('drain') ||
    lower.includes('burnout') ||
    lower.includes('sleep') ||
    lower.includes('insomnia') ||
    lower.includes('no energy') ||
    lower.includes('heavy') ||
    lower.includes('foggy') ||
    lower.includes('bed') ||
    // Only fall back to "this category is generally about fatigue" when the
    // tone itself actually reads negative — otherwise a fine/positive
    // answer to a Daily Functioning question would get miscategorized as
    // fatigue purely because of its category, regardless of what was said.
    (question.category.includes('Daily Functioning') && tone.label === 'distressed');

  const isNumbOrSad =
    lower.includes('sad') ||
    lower.includes('depress') ||
    lower.includes('empty') ||
    lower.includes('cry') ||
    lower.includes('crying') ||
    lower.includes('hopeless') ||
    lower.includes('worthless') ||
    lower.includes('lost interest') ||
    lower.includes('flat') ||
    lower.includes('meaningless') ||
    lower.includes('grief') ||
    lower.includes('heartbreak') ||
    lower.includes('chore');

  const isDisconnectedOrAlone =
    lower.includes('alone') ||
    lower.includes('lonely') ||
    lower.includes('isolat') ||
    lower.includes('withdrawn') ||
    lower.includes('no one') ||
    lower.includes('misunderstood') ||
    lower.includes('left out') ||
    lower.includes('abandon') ||
    lower.includes('burden') ||
    // Same reasoning as isFatigued above: only assume disconnection from the
    // category alone when the tone itself is actually distressed.
    (question.category.includes('Social Connections') && tone.label === 'distressed');

  const isOverthinking =
    lower.includes('racing thoughts') ||
    lower.includes('rumina') ||
    lower.includes('overthink') ||
    lower.includes('loop') ||
    lower.includes("can't stop thinking") ||
    lower.includes('cant stop') ||
    lower.includes('worst case') ||
    lower.includes('obsess') ||
    lower.includes('paranoia') ||
    // Same reasoning as isFatigued/isDisconnectedOrAlone above.
    (question.category.includes('Thought Patterns') && tone.label === 'distressed');

  const isResilientOrCalm =
    (lower.includes('good') ||
      lower.includes('calm') ||
      lower.includes('peace') ||
      lower.includes('manageable') ||
      lower.includes('stable') ||
      lower.includes('balanced') ||
      lower.includes('steady') ||
      lower.includes('fine') ||
      lower.includes('happy')) &&
    !isAnxious &&
    !isNumbOrSad;

  if (isAnxious) {
    return withDistressedSupport({
      emotionalStateLabel: 'Sympathetic Hyper-Arousal & Amygdala Surge',
      neuralRegion: 'Amygdala, Locus Coeruleus & Sympathetic Trunk',
      sentimentTone: 'anxious',
      highlightedPill: `Dynamic Coping #${questionNumber}`,
      userQuoteAnalysis: userSnippet
        ? `Reflecting on "${userSnippet}": your nervous system is signaling hyper-vigilance, firing rapid noradrenergic alert impulses that trigger somatic tension.`
        : `Your response indicates sympathetic elevation and rapid arousal.`,
      ...composedCore('anxious', coreCtx),
      immediateSolutionTitle: 'Physiological Double-Sigh & Vagal Brake',
      immediateActionRightNow: 'Take two quick nasal inhales right now, then release a long, slow 8-second exhale out of your mouth.',
      immediateSolutionSteps: [
        'Take a deep breath in through your nose until your lungs are 80% full.',
        'Without exhaling, take a sharp second "top-off" inhale through your nose to pop open collapsed alveoli.',
        'Release a long, smooth, audible sigh out of your mouth for 6 to 8 seconds.',
        'Repeat this double-sigh 2 to 3 times to immediately decelerate heart rate.',
      ],
      practicalStepToday:
        'Eliminate or delay one non-essential demand on your to-do list today to lower cognitive friction.',
      scientificRationale:
        'Stanford neurobiology research demonstrates that the cyclic physiological sigh increases intrathoracic pressure and activates the vagus nerve (parasympathetic branch), slowing SA node cardiac firing faster than any other behavioral intervention.',
      interactiveTool: {
        type: 'breathing_sigh',
        title: 'Physiological Sigh Pacer',
        instructions: 'Follow the animated circle: Inhale through nose, top-off inhale, then long slow exhale.',
      },
      affirmation: 'My nervous system is currently alert, but I am in control and safe in this physical moment.',
      suggestedFollowUps: [
        'Why does my chest feel so tight when I get anxious?',
        'What should I do if this feeling hits while I am at work?',
        'How can I fall asleep when my mind is racing like this?',
      ],
      providerUsed: 'local',
    }, tone, questionNumber, risk);
  }

  if (isOverthinking) {
    return withDistressedSupport({
      emotionalStateLabel: 'Default Mode Network Hyper-Coherence (Rumination)',
      neuralRegion: 'Posterior Cingulate Cortex & Medial Prefrontal Cortex',
      sentimentTone: 'distressed',
      highlightedPill: `Cognitive Unhooking #${questionNumber}`,
      userQuoteAnalysis: userSnippet
        ? `Reflecting on "${userSnippet}": your thoughts are looping through repetitive narrative circuits in the Default Mode Network.`
        : `Your thought patterns show signs of cognitive loops and ruminative strain.`,
      ...composedCore('overthinking', coreCtx),
      immediateSolutionTitle: 'Cognitive Defusion: "I Am Having the Thought That..."',
      immediateActionRightNow: 'Notice the worry thought and reframe it mentally as: "I notice my mind is generating a story about..."',
      immediateSolutionSteps: [
        'Notice the central anxious thought currently occupying your mind.',
        'Prefix it internally with: "I notice I am having the thought that..."',
        'Next, step back further: "I notice that my brain is generating the story that..."',
        'Look at the thought as external weather passing through the sky of your awareness.',
      ],
      practicalStepToday:
        'Schedule a dedicated 10-minute "Worry Window" at 5 PM. When intrusive loops arise earlier, tell yourself: "I will review this at 5 PM."',
      scientificRationale:
        'ACT (Acceptance and Commitment Therapy) cognitive defusion creates psychological distance between the observing self and verbal cognitive content, reducing emotional reactivity by over 40%.',
      interactiveTool: {
        type: 'cognitive_defusion',
        title: 'Cognitive Defusion Anchor',
        instructions: 'Transform "I will fail" into "I notice my mind is generating a thought about failure."',
      },
      affirmation: 'Thoughts are biological data packets generated by my brain, not definitive truths or binding commands.',
      suggestedFollowUps: [
        'How do I stop replaying embarrassing or regretful memories?',
        'Can you give me a phrase to interrupt racing thoughts?',
        'Why does overthinking get so much worse late at night?',
      ],
      providerUsed: 'local',
    }, tone, questionNumber, risk);
  }

  if (isFatigued) {
    return withDistressedSupport({
      emotionalStateLabel: 'Dopaminergic & Circadian Neurological Depletion',
      neuralRegion: 'Ventral Striatum & Ventrolateral Preoptic Nucleus',
      sentimentTone: 'fatigued',
      highlightedPill: `Somatic Restoration #${questionNumber}`,
      userQuoteAnalysis: userSnippet
        ? `Reflecting on "${userSnippet}": your physiological battery is experiencing high allostatic load and diminished neurotransmitter reserve.`
        : `Your daily rhythm indicates heavy biological exhaustion and depleted cognitive stamina.`,
      ...composedCore('fatigued', coreCtx),
      immediateSolutionTitle: 'Non-Sleep Deep Rest (NSDR) Micro-Reset',
      immediateActionRightNow: 'Unclench your jaw, drop your shoulders 2 inches away from your ears, and soften your eyes into a wide peripheral gaze.',
      immediateSolutionSteps: [
        'Drop your shoulders 2 inches away from your ears right now.',
        'Unclench your jaw and let your tongue rest gently on the floor of your mouth.',
        'Gently expand your visual field to take in the peripheral room edges without moving your eyes.',
        'Allow yourself 30 seconds of zero demand before continuing.',
      ],
      practicalStepToday:
        'Choose ONE single micro-task to finish today, and grant yourself full permission to let everything else wait until tomorrow.',
      scientificRationale:
        'Panoramic peripheral vision and jaw relaxation immediately down-regulate prefrontal vigilance, restoring striatal dopamine tone and easing mental fatigue.',
      interactiveTool: {
        type: 'somatic_release',
        title: 'Panoramic Peripheral Gaze',
        instructions: 'Soften your gaze and become aware of everything to your left and right simultaneously.',
      },
      affirmation: 'Rest is not a reward I must earn; it is a biological requirement my nervous system deserves.',
      suggestedFollowUps: [
        'How can I get work done when I have zero motivation?',
        'What is the difference between depression and burnout?',
        'How do I recharge my battery when I do not have time for a vacation?',
      ],
      providerUsed: 'local',
    }, tone, questionNumber, risk);
  }

  if (isNumbOrSad) {
    return withDistressedSupport({
      emotionalStateLabel: 'Hypo-Arousal & Dorsal Vagal Shutdown Response',
      neuralRegion: 'Dorsal Vagal Complex & Subgenual Anterior Cingulate',
      sentimentTone: 'distressed',
      highlightedPill: `Gentle Re-engagement #${questionNumber}`,
      userQuoteAnalysis: userSnippet
        ? `Reflecting on "${userSnippet}": feeling heavy, flat, or tearful is your nervous system's adaptive conservation mode when overwhelmed.`
        : `Your responses point to emotional exhaustion and low hedonic tone.`,
      ...composedCore('numb_sad', coreCtx),
      immediateSolutionTitle: 'Micro-Sensory Activation & Self-Compassion',
      immediateActionRightNow: 'Rest one warm palm over your sternum or wrap your arms around yourself in a comforting hold.',
      immediateSolutionSteps: [
        'Place one warm hand over your sternum or gently squeeze your own upper arms.',
        'Feel the comforting physical warmth and boundary of your own body.',
        'Whisper or think: "This is a moment of suffering, and suffering is part of being human. May I be gentle with myself."',
        'Take one deep, nourishing breath into your heart center.',
      ],
      practicalStepToday:
        'Step outside for 5 minutes of direct daylight, or drink a cup of warm tea without checking your phone.',
      scientificRationale:
        'Self-directed somatic touch stimulates skin C-tactile afferent nerve fibers, triggering endogenous oxytocin release that gently signals emotional safety to the limbic core.',
      interactiveTool: {
        type: 'somatic_release',
        title: 'Heart-Hand Somatic Touch',
        instructions: 'Rest your palm over your heart. Breathe softly into the warmth of your touch.',
      },
      affirmation: 'It is okay to feel flat or heavy right now. Heavy feelings are visitors, not permanent residents.',
      suggestedFollowUps: [
        'Why do I feel so numb even when good things happen?',
        'How do I talk to my friends about how sad I feel?',
        'What are low-energy ways to feel a tiny bit better today?',
      ],
      providerUsed: 'local',
    }, tone, questionNumber, risk);
  }

  if (isDisconnectedOrAlone) {
    return withDistressedSupport({
      emotionalStateLabel: 'Social Pain Signal & Anterior Insula Activation',
      neuralRegion: 'Dorsal Anterior Cingulate Cortex & Right Anterior Insula',
      sentimentTone: 'disconnected',
      highlightedPill: `Social Safety Reconnect #${questionNumber}`,
      userQuoteAnalysis: userSnippet
        ? `Reflecting on "${userSnippet}": social disconnection activates the same pain circuits as physical injury; your brain is asking for safety.`
        : `Your words express isolation or feeling unsupported by your surroundings.`,
      ...composedCore('disconnected', coreCtx),
      immediateSolutionTitle: '5-4-3-2-1 Sensory Grounding to Reconnect',
      immediateActionRightNow: 'Look around your room and name 3 physical colors you see, grounding yourself in physical reality.',
      immediateSolutionSteps: [
        'Identify 3 physical objects around you right now and note their colors.',
        'Feel 2 distinct textures beneath your fingers (e.g. your clothes, the desk surface).',
        'Notice 1 sound in your immediate background.',
        'Remind yourself: Millions of human beings are feeling this exact vulnerability right now. You are not broken.',
      ],
      practicalStepToday:
        'Send a brief low-pressure text (e.g., "Thinking of you, hope your day is going well") to one person, or spend 15 minutes in a public space like a quiet café or park.',
      scientificRationale:
        'Sensory grounding forces the brain to redirect blood flow from the dorsal anterior cingulate back into the primary somatosensory and visual cortices, ending the spiral of emotional alienation.',
      interactiveTool: {
        type: 'grounding_54321',
        title: '5-4-3-2-1 Grounding Anchor',
        instructions: 'Name 3 things you see, 2 things you can touch, and 1 sound you can hear.',
      },
      affirmation: 'I am grounded in this present room, and my feelings are deserving of kindness and understanding.',
      suggestedFollowUps: [
        'Why does it feel so hard to reach out to people when I need them most?',
        'How can I stop feeling like an emotional burden to others?',
        'How do I find people who truly understand me?',
      ],
      providerUsed: 'local',
    }, tone, questionNumber, risk);
  }

  // Generic distressed fallback — a short yes/no or brief answer pointed
  // toward a concern for this question (via its yesMeansConcern polarity)
  // but didn't match any of the specific keyword categories above. Still
  // gets a real, question-aware solution plus the same motivation/soft
  // support treatment, referencing the question's own topic and rationale
  // instead of assuming a specific emotional flavor that wasn't stated.
  if (tone.label === 'distressed') {
    const categoryLower = question.category.toLowerCase();
    return withDistressedSupport({
      emotionalStateLabel: 'A Point Worth Paying Attention To',
      neuralRegion: 'Autonomic Nervous System & Prefrontal Regulation',
      sentimentTone: 'seeking_balance',
      highlightedPill: `Noted & Supported #${questionNumber}`,
      userQuoteAnalysis: isShortYesNo
        ? `Your "${text}" on that question is a real answer, even in one word — and it points toward something in the ${categoryLower} area worth a closer look.`
        : userSnippet
        ? `Reflecting on "${userSnippet}": this points toward something in the ${categoryLower} area worth a closer look.`
        : `Your response points toward something in the ${categoryLower} area worth a closer look.`,
      ...composedCore(detectResearchTheme(lower, question.category, nsReading), coreCtx),
      immediateSolutionTitle: 'A Short Grounding Reset',
      immediateActionRightNow: 'Take one slow breath in through your nose, and let it out twice as slowly through your mouth.',
      immediateSolutionSteps: [
        'Take three slow breaths, making each exhale longer than the inhale.',
        'Name one small, kind thing you can do for yourself in the next hour.',
        'If it helps, jot down what prompted this answer — seeing it in words can make it easier to address.',
        'If this is a recurring pattern rather than a one-off, treat it as real information worth acting on.',
      ],
      practicalStepToday:
        'Mention this to one person you trust today, even briefly — naming it out loud often makes it feel more manageable.',
      scientificRationale:
        'Simply labeling a difficulty (affect labeling) engages prefrontal regulation of the emotional response, which measurably reduces its intensity.',
      interactiveTool: {
        type: 'breathing_sigh',
        title: 'Slow Reset Breath',
        instructions: 'In for 4 seconds, out for 6 seconds. Repeat three times.',
      },
      affirmation: 'Naming something honestly — even in one word — is real progress, not a small thing.',
      suggestedFollowUps: [
        'Can you say more about why this has been coming up?',
        'What is one small step that would make this a little easier this week?',
        'When does this tend to show up the most?',
      ],
      providerUsed: 'local',
    }, tone, questionNumber, risk);
  }

  // Neutral tone: not distressing, but not especially uplifting either.
  // Rather than defaulting to the generic "you're doing great" framing
  // below, this gives concrete, small ways to actively build more
  // positivity from an even baseline.
  if (tone.label === 'neutral') {
    return {
      emotionalStateLabel: 'Steady, With Room To Build',
      neuralRegion: 'Baseline Reward & Regulatory Network',
      sentimentTone: 'seeking_balance',
      toneLevel: 'neutral',
      highlightedPill: `Positivity Boost #${questionNumber}`,
      userQuoteAnalysis: isShortYesNo
        ? `Your "${text}" reads as fairly even — not a red flag, but also not a lot of momentum to work with yet.`
        : userSnippet
        ? `Reflecting on "${userSnippet}": this reads as fairly even — a stable, workable place to build from.`
        : `Your answer reads as fairly even right now — a stable, workable place to build from.`,
      ...composedCore('neutral', coreCtx),
      immediateSolutionTitle: 'Three Small Ways To Add A Little More Light Today',
      immediateActionRightNow: 'Think of one tiny thing that reliably makes you smile, and do it in the next 10 minutes if you can.',
      immediateSolutionSteps: [
        'Do one small thing today purely because you enjoy it, not because it is productive.',
        'Reach out to one person just to say something appreciative, funny, or kind.',
        'Write down one thing, however small, that went okay today.',
        'Get 10 minutes of daylight or movement — both reliably lift baseline mood.',
      ],
      practicalStepToday: 'Pick one of the ideas above and actually do it today, rather than just reading it.',
      scientificRationale:
        'Deliberately engaging in small positive-affect activities (behavioral activation) reliably raises baseline mood and dopaminergic reward signaling, even when nothing is "wrong" to begin with.',
      interactiveTool: {
        type: 'dopamine_spark',
        title: 'Micro-Joy Spark',
        instructions: 'Think of the smallest possible thing that would make the next hour 5% better, and do it.',
      },
      affirmation: 'I do not need to wait for a hard moment to invest in my own wellbeing.',
      suggestedFollowUps: [
        'What are some small things that reliably boost my mood?',
        'How can I build more positive moments into an ordinary day?',
        'What is behavioral activation and why does it work?',
      ],
      providerUsed: 'local',
    };
  }

  // Default / Balanced / Thriving or General Reflection
  return {
    emotionalStateLabel: 'Adaptive Neuroplastic Balance & Self-Awareness',
    neuralRegion: 'Ventromedial Prefrontal Cortex & Frontoparietal Control Network',
    sentimentTone: isResilientOrCalm ? 'resilient' : 'seeking_balance',
    toneLevel: 'calm',
    highlightedPill: `Neuro-Integrative Insight #${questionNumber}`,
    userQuoteAnalysis: userSnippet
      ? `Reflecting on "${userSnippet}": putting your inner feelings into words actively strengthens prefrontal regulation over emotional centers.`
      : `Reflecting on Question #${questionNumber}: taking a deliberate moment to check in promotes self-regulation.`,
    ...composedCore(isResilientOrCalm ? 'calm' : 'general', coreCtx),
    immediateSolutionTitle: 'Coherent Heart-Rhythm Resonance',
    immediateActionRightNow: 'Inhale gently for 4 seconds, exhale smoothly for 4 seconds, and release tension from your forehead.',
    immediateSolutionSteps: [
      'Take a gentle 4-second inhale through your nose into your diaphragm.',
      'Exhale smoothly for 4 seconds through your lips.',
      'Anchor one thought of gratitude or appreciation for your body and mind taking this assessment.',
      'Carry this steady awareness into the next question.',
    ],
    practicalStepToday:
      'Take a 10-minute mindful break later today without any screens to let your nervous system integrate.',
    scientificRationale:
      'Affect labeling (verbalizing feelings) activates the right ventrolateral prefrontal cortex, which dampens amygdala reactivity and optimizes cognitive flexibility for the questions ahead.',
    interactiveTool: {
      type: 'breathing_sigh',
      title: 'Resonance Breath Pacer',
      instructions: '4 seconds in, 4 seconds out. Steady, rhythmic biological coherence.',
    },
    affirmation: 'Taking time to understand my inner world is an act of deep self-care and resilience.',
    suggestedFollowUps: [
      'How can I maintain this emotional balance when stress hits?',
      'What daily habits best protect my mental clarity?',
      'How do I build stronger emotional resilience over time?',
    ],
    providerUsed: 'local',
  };
}

