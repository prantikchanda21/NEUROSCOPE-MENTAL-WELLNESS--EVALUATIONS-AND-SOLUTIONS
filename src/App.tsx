import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QUESTION_POOL, ASSESSMENT_MODES, DEFAULT_ASSESSMENT_LENGTH } from './data/questions';
import {
  AnswerRecord,
  AssessmentResult,
  Question,
  AdaptiveSelectionMeta,
  AssessmentLength,
  RiskAssessment,
  SemanticAnalysis,
  SentimentResult,
} from './types';
import {
  selectNextQuestion,
  selectNextQuestionAsync,
  AdaptiveSelectionResult,
  warmQuestionEmbeddings,
  getOpeningQuestion,
  analyzeAnswerSentiment,
  analyzeAnswerSentimentAsync,
  analyzeAnswerSemantics,
  shouldTriggerExercise,
} from './utils/adaptiveEngine';
import {
  createSessionRiskTracker,
  resetSessionRiskTracker,
  assessAnswerRisk,
  shouldRaiseImmediateSupport,
  deniesSafetyConcern,
} from './utils/riskEngine';
import {
  aggregateNeuroScope,
  NeuroScopeAggregate,
} from './utils/clinicalEngine';
import type { NeuroScopeReading } from './types';
import { retrievePassages, retrievePassagesLexical, warmResearchEmbeddings } from './utils/researchRetrieval';
import { retrievePsycheExamples } from './utils/psycheRetrieval';
import { RetrievedPassage } from './utils/researchKnowledge';
import { warmSemanticEngine } from './utils/semanticEngine';
import { QuestionCard } from './components/QuestionCard';
import { DynamicSolutionCard } from './components/DynamicSolutionCard';
import { ImmediateCrisisCard } from './components/ImmediateCrisisCard';
// The results dashboard (charts, simulators, history/report modals, confetti) is by
// far the heaviest part of the UI and is only needed at the very end, so it loads as
// its own chunk instead of slowing down the first paint. It is fetched in the
// background as soon as a check-in starts, so it is normally ready before it's needed.
const loadResultsView = () => import('./components/AssessmentResultsView');
const AssessmentResultsView = lazy(() =>
  loadResultsView().then((m) => ({ default: m.AssessmentResultsView }))
);
import { HeaderNav } from './components/HeaderNav';
import { neuralAudio } from './utils/audio';
import { analyzeAnswersLocally, checkImmediateRisk, normalizeAssessmentResult } from './utils/clinicalEngine';
import { saveAssessmentToHistory } from './utils/historyStorage';
import {
  generateDynamicFeelingSolution,
  fetchDynamicFeelingSolution,
  DynamicFeelingSolution,
  SolutionEvidence,
} from './utils/dynamicFeelingSolutions';
import { RealisticGreeneryLandscape } from './components/RealisticGreeneryLandscape';
import { LandingPage } from './components/LandingPage';
import { LoginPage } from './components/LoginPage';
import { getCurrentUser, getLoginStreak, recordDailyLogin, signOut, PublicUser } from './utils/authStorage';
import { Brain, ShieldCheck, ArrowRight, Rotate3d } from 'lucide-react';

export default function App() {
  // Lifted here (rather than kept local to RealisticGreeneryLandscape) so the
  // dashboard's glass panels can theme themselves in sync with day/night —
  // see the [data-landscape-mode] rules in index.css.
  const [isMoonlightMode, setIsMoonlightMode] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(() => getCurrentUser());
  // Shows the marketing/feature landing page before the sign-in form for
  // anyone who isn't authenticated yet. Once they click through (or once
  // they're signed in) this stays out of the way for the rest of the visit.
  const [showAuthPage, setShowAuthPage] = useState<boolean>(false);
  const [loginStreak, setLoginStreak] = useState<number>(() => {
    const user = getCurrentUser();
    return user ? getLoginStreak(user.id).currentStreak : 0;
  });
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  // Dynamic, adaptively-built question path (replaces the old fixed order).
  const [sequence, setSequence] = useState<Question[]>(() => [getOpeningQuestion(QUESTION_POOL)]);
  const [adaptiveMeta, setAdaptiveMeta] = useState<AdaptiveSelectionMeta | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [activeSurge, setActiveSurge] = useState<boolean>(false);
  const [assessmentResult, setAssessmentResult] = useState<AssessmentResult | null>(null);
  const [isAssessing, setIsAssessing] = useState<boolean>(false);
  const [isReassessing, setIsReassessing] = useState<boolean>(false);
  const [typingBurst, setTypingBurst] = useState<number>(0);
  const [hasStarted, setHasStarted] = useState<boolean>(false);
  const [activeDynamicSolution, setActiveDynamicSolution] = useState<DynamicFeelingSolution | null>(null);
  // How many questions this run will ask (5 = Quick, 10 = Balanced, 20 = Full).
  // Chosen once on the intro screen; every screening length uses the same
  // 50-question pool and the same adaptive/clinical scoring engine.
  const [assessmentLength, setAssessmentLength] = useState<AssessmentLength>(DEFAULT_ASSESSMENT_LENGTH);
  // Shown immediately (mid-assessment) if the mandatory safety question's
  // answer indicates active self-harm/suicidal risk, instead of waiting
  // until the final report to surface crisis resources.
  const [showImmediateCrisis, setShowImmediateCrisis] = useState<boolean>(false);

  // --- Dynamic risk tracking + semantic evidence ---------------------------
  // The rolling risk tracker is the app's replacement for the old fixed
  // "35% / -0.35" safety thresholds: it re-scores after every answer from
  // high-risk markers, crisis-language similarity, the transformer tone
  // reading, and — critically — the *rate of change* across answers, which
  // only the client can see. Its latest reading travels with every request
  // so the server (and the prompts it builds) always see this run's risk.
  const riskTrackerRef = useRef(createSessionRiskTracker());
  const [currentRisk, setCurrentRisk] = useState<RiskAssessment | null>(null);
  // Semantic readings for the answer just given (transformer tone + 7-way
  // emotion distribution + crisis-language similarity); null while the local
  // models are still warming or unavailable.
  const [lastSemantics, setLastSemantics] = useState<SemanticAnalysis | null>(null);
  // Research-corpus passages retrieved for the answer just given, so the
  // solution (and the final report) are grounded in the papers/books.
  const [lastPassages, setLastPassages] = useState<RetrievedPassage[]>([]);
  // Same evidence, held in a ref so the final report and the recalibration
  // requests read the newest values even when they fire in the same tick as
  // the answer that produced them (React state would still be one render behind).
  const evidenceRef = useRef<{
    risk: RiskAssessment | null;
    semantics: SemanticAnalysis | null;
    tone: SentimentResult | null;
    passages: RetrievedPassage[];
    psycheExamples: import('./types').PsycheExample[];
    /** Every PRIMARY NeuroScope reading this run produced — folded into an
     * aggregate for the final report and sent to the server with each request. */
    neuroscopeReadings: NeuroScopeReading[];
  }>({
    risk: null,
    semantics: null,
    tone: null,
    passages: [],
    psycheExamples: [],
    neuroscopeReadings: [],
  });

  // Guards against double-clicks while a submit / continue is in flight (state
  // alone is one render behind, so a fast second click could slip through).
  const busyRef = useRef<boolean>(false);
  // The next adaptive question is worked out in the background while the person
  // reads the solution card, so "Next" is instant. Keyed by the answer it was
  // computed from, so editing the answer discards it.
  const nextPickRef = useRef<{ key: string; promise: Promise<AdaptiveSelectionResult> } | null>(null);

  const rememberEvidence = (evidence: SolutionEvidence) => {
    const merged = [...evidenceRef.current.passages];
    for (const passage of evidence.passages || []) {
      if (!merged.some((existing) => existing.id === passage.id)) merged.push(passage);
    }
    evidenceRef.current = {
      risk: evidence.risk ?? evidenceRef.current.risk,
      semantics: evidence.semantics ?? evidenceRef.current.semantics,
      tone: evidence.tone ?? evidenceRef.current.tone,
      // Keep the strongest passages of the whole run for the final report.
      passages: merged.slice(0, 8),
      psycheExamples: (() => {
        const examples = [...evidenceRef.current.psycheExamples];
        for (const example of evidence.psycheExamples || []) {
          if (!examples.some((existing) => existing.id === example.id)) examples.push(example);
        }
        return examples.slice(0, 8);
      })(),
      // Record every PRIMARY reading this run produced (reference-deduped:
      // cached semantics hand back the same object for the same answer text),
      // so the final aggregate reflects the whole run, not the last answer.
      neuroscopeReadings: (() => {
        const reading = evidence.semantics?.neuroscope;
        const previous = evidenceRef.current.neuroscopeReadings;
        if (!reading || previous.includes(reading)) return previous;
        return [...previous, reading].slice(-24);
      })(),
    };
  };

  const resetRiskState = () => {
    resetSessionRiskTracker(riskTrackerRef.current);
    evidenceRef.current = { risk: null, semantics: null, tone: null, passages: [], psycheExamples: [], neuroscopeReadings: [] };
    setCurrentRisk(null);
    setLastSemantics(null);
    setLastPassages([]);
  };

  // Keeps the daily login streak accurate for returning users. Signing in
  // through the login form already records that day's login (see
  // authStorage.ts), but a returning visitor whose session simply persisted
  // from a previous day never goes through that form again — without this,
  // their streak would silently stop advancing the moment they stopped
  // actively logging in, which is exactly the "day streak isn't working"
  // symptom. Recording is idempotent for repeat calls on the same calendar
  // day, so this is safe to run every time the signed-in user is known.
  useEffect(() => {
    if (currentUser) {
      const updated = recordDailyLogin(currentUser.id);
      setLoginStreak(updated.currentStreak);
    }
  }, [currentUser?.id]);

  // Loads the models and then pre-computes the vectors that every answer is compared
  // against (the question pool for adaptive selection, the research corpus for
  // grounding) — once, in the background, instead of during the first submit.
  // Safe to call repeatedly: every step is idempotent.
  const warmEverything = () => {
    void loadResultsView();
    void warmSemanticEngine().then(() => {
      void warmQuestionEmbeddings(QUESTION_POOL);
      void warmResearchEmbeddings();
    });
  };

  // Returning visitors already have the model weights in the browser cache, so
  // loading them costs no download: start while they are still on the intro
  // screen. First-time visitors (nothing cached) only start once they press Begin,
  // so nobody pays a ~200MB download for merely opening the page.
  useEffect(() => {
    if (!currentUser || hasStarted) return;
    let cancelled = false;
    const start = async () => {
      try {
        if (typeof caches === 'undefined' || !(await caches.has('transformers-cache'))) return;
      } catch {
        return;
      }
      if (!cancelled) warmEverything();
    };
    const idle: (cb: () => void) => any =
      (window as any).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 600));
    const handle = idle(() => void start());
    return () => {
      cancelled = true;
      try {
        (window as any).cancelIdleCallback?.(handle);
      } catch {
        // ignore
      }
    };
  }, [currentUser?.id, hasStarted]);

  const currentQuestion = sequence[currentIndex];
  const currentCategory = currentQuestion.category;

  const handleSaveAnswer = (answer: string) => {
    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: answer,
    }));
  };

  // Immediate dynamic solution generation for user's feeling response
  const handleRequestSolution = async (explicitAnswerText?: string, evidence?: SolutionEvidence) => {
    const userAnswer = (explicitAnswerText !== undefined ? explicitAnswerText : answers[currentQuestion.id]) || '';

    // Immediately persist answer state so nothing is lost
    if (userAnswer) {
      setAnswers((prev) => ({ ...prev, [currentQuestion.id]: userAnswer }));
    }

    // Trigger audio chime & heartbeat
    neuralAudio.playThinkingChime();
    neuralAudio.playHeartbeatPulse();

    // Trigger dynamic nerve action-potential pulse across brain
    setActiveSurge(true);
    setTypingBurst((v) => v + 24);
    setIsThinking(true);

    try {
      const sol = await fetchDynamicFeelingSolution(
        currentQuestion,
        userAnswer,
        currentIndex + 1,
        assessmentLength,
        evidence
      );
      setActiveDynamicSolution(sol);
      neuralAudio.playThinkingChime();
    } catch (err) {
      console.warn('Fallback to local dynamic feeling synthesis:', err);
      const fallbackSol = generateDynamicFeelingSolution(
        currentQuestion,
        userAnswer,
        currentIndex + 1,
        evidence
      );
      setActiveDynamicSolution(fallbackSol);
    } finally {
      setIsThinking(false);
      setActiveSurge(false);
    }
  };

  // Adaptive selection of the next question (semantic vector search with the
  // TF-weighted scorer as the offline fallback). Shared by the background prefetch
  // and by the on-demand path so both behave identically.
  const pickNextQuestion = (lastAnswer: string, tone?: SentimentResult): Promise<AdaptiveSelectionResult> => {
    const riskLevel = riskTrackerRef.current.lastAssessment?.level || 'low';
    const seq = sequence;
    const cur = currentQuestion;
    const cat = currentCategory;
    const total = assessmentLength;
    return selectNextQuestionAsync(
      QUESTION_POOL,
      seq,
      lastAnswer,
      cat,
      total,
      cur,
      riskLevel,
      tone ? { precomputedSentiment: tone } : undefined
    ).catch((err) => {
      console.warn('Semantic selection unavailable, falling back to TF-weighted scoring:', err);
      return selectNextQuestion(QUESTION_POOL, seq, lastAnswer, cat, total, cur, riskLevel);
    });
  };

  const nextPickKey = (answer: string) => `${sequence.length}|${currentQuestion.id}|${answer}`;

  // Advances the question sequence itself (shared by: skipping the exercise
  // entirely, and finishing the exercise card when one was shown).
  //
  // Every state change that swaps the screen happens together at the end, so the
  // person goes straight from the card they pressed a button on to the next
  // question — the old question no longer flashes back in between.
  const advanceToNextQuestion = async () => {
    if (currentIndex < sequence.length - 1) {
      // Already-built next step exists (e.g. user went Prev then Next again).
      setActiveDynamicSolution(null);
      setShowImmediateCrisis(false);
      setCurrentIndex((prev) => prev + 1);
      return;
    }

    if (sequence.length < assessmentLength) {
      // Adaptively select the next question with semantic vector search: the
      // answer just given and every remaining question are compared in
      // embedding space, so a question can be chosen because it is *about the
      // same thing* even when the wording shares no keywords. The mandatory
      // safety screener is pulled forward automatically as this run's dynamic
      // risk level rises.
      const lastAnswer = answers[currentQuestion.id] || '';
      const prefetched = nextPickRef.current;
      nextPickRef.current = null;
      const { question: nextQuestion, meta } =
        prefetched && prefetched.key === nextPickKey(lastAnswer)
          ? await prefetched.promise
          : await pickNextQuestion(lastAnswer);
      setAdaptiveMeta(meta);
      setSequence((prev) => [...prev, nextQuestion]);
      setActiveDynamicSolution(null);
      setShowImmediateCrisis(false);
      setCurrentIndex((prev) => prev + 1);
      return;
    }

    // All adaptively-selected questions for this run are complete -> final assessment
    setActiveDynamicSolution(null);
    setShowImmediateCrisis(false);
    await handleCompleteAssessment();
  };

  /**
   * Decides what happens right after an answer is submitted:
   *  - Active self-harm/risk language on the mandatory safety question ->
   *    show crisis resources immediately, before anything else.
   *  - The dynamic risk engine having crossed into critical/high-and-worsening
   *    territory -> raise the same support card, even off the safety question.
   *  - The safety question in general, or a clearly distressed-sounding
   *    answer -> show the supportive micro-intervention/exercise card.
   *  - Otherwise -> skip the exercise and move straight to the next
   *    question, so the flow doesn't interrupt someone who is doing fine
   *    with an exercise after every single answer.
   *
   * Every answer additionally runs the transformer pass (NeuroScope DistilBERT
   * tone, falling back to RoBERTa while it loads, + 7-way emotion
   * classification + crisis-language similarity), feeds
   * the dynamic risk tracker, and retrieves the research-corpus passages that
   * match this answer — that evidence then travels with the solution request
   * and the final report so both are grounded in the project's papers/books.
   *
   * Speed: the button goes into its loading state on the very first line (the
   * evidence work used to run silently before any feedback), the semantic pass and
   * the research retrieval run concurrently and are capped by a time budget, and
   * the next question is chosen in the background while the solution loads.
   */
  const handleAnswerSubmitted = async (explicitAnswerText?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsThinking(true);

    try {
      const userAnswer = (explicitAnswerText !== undefined ? explicitAnswerText : answers[currentQuestion.id]) || '';
      if (userAnswer) {
        setAnswers((prev) => ({ ...prev, [currentQuestion.id]: userAnswer }));
      }

      // 1. Deterministic, synchronous crisis interrupt on the safety screener.
      // This deliberately runs before any model work: an in-the-moment safety
      // response must never wait on a download or an inference pass.
      if (currentQuestion.mandatory && checkImmediateRisk(userAnswer)) {
        const risk = assessAnswerRisk(riskTrackerRef.current, {
          question: currentQuestion,
          answerText: userAnswer,
          tone: analyzeAnswerSentiment(currentQuestion, userAnswer),
          questionIndex: currentIndex,
          isSafetyQuestion: true,
          affirmsConcern: true,
        });
        rememberEvidence({ risk });
        setCurrentRisk(risk);
        setShowImmediateCrisis(true);
        return;
      }

      // 2 + 4. Transformer pass for this answer AND research grounding for it,
      // side by side. Both are normally answered from caches that the live tone
      // chip and the background warm-up already filled while the person was
      // typing. A time budget keeps a slow or cold model from ever holding the
      // click: past it, the lexicon reading / lexical retrieval stand in (both
      // are the same fallbacks the engine already used when models were unavailable).
      const withBudget = <T,>(work: Promise<T>, ms: number, fallback: () => T): Promise<T> =>
        Promise.race([
          work.catch(() => fallback()),
          new Promise<T>((resolve) => setTimeout(() => resolve(fallback()), ms)),
        ]);

      const [semantics, passages, psycheExamples] = await Promise.all([
        withBudget(analyzeAnswerSemantics(currentQuestion, userAnswer, { timeoutMs: 3000 }), 3500, () => null),
        withBudget(
          retrievePassages(userAnswer, { category: currentQuestion.category, timeoutMs: 3000 }),
          3500,
          () => retrievePassagesLexical(userAnswer, undefined)
        ),
        withBudget(
          retrievePsycheExamples({
            query: userAnswer,
            category: currentQuestion.category,
            timeoutMs: 2200,
          }),
          2800,
          () => []
        ),
      ]);

      // Same cached analysis as above, merged with the question-aware lexicon reading.
      // The tone field of the profile is the question-aware reading (a bare
      // "yes" to a symptom question is only interpretable against its question),
      // while emotions / crisis similarity come straight from the dense models.
      const tone = await withBudget(
        analyzeAnswerSentimentAsync(currentQuestion, userAnswer, { timeoutMs: 3000 }),
        3500,
        () => analyzeAnswerSentiment(currentQuestion, userAnswer)
      );
      const profile: SemanticAnalysis | null = semantics ? { ...semantics, sentiment: tone } : null;

      // 3. Dynamic risk re-score — high-risk markers, crisis-language similarity,
      // the transformer tone, and the *rate of change* across this session.
      // This replaces the old fixed 35% / -0.35 thresholds; at rest it matches
      // the old behaviour, and it only tightens once real signals accrue.
      const risk = assessAnswerRisk(riskTrackerRef.current, {
        question: currentQuestion,
        answerText: userAnswer,
        tone,
        questionIndex: currentIndex,
        semantics,
        isSafetyQuestion: !!currentQuestion.mandatory,
        deniesConcern: !!currentQuestion.mandatory && deniesSafetyConcern(userAnswer),
      });
      setCurrentRisk(risk);

      setLastSemantics(profile);
      setLastPassages(passages);

      const evidence: SolutionEvidence = {
        tone,
        risk,
        semantics: profile,
        passages,
        psycheExamples,
        neuroscopeReadings: evidenceRef.current.neuroscopeReadings,
      };
      rememberEvidence(evidence);

      // 5. A deterioration pattern (critical level, or high/sustained negative
      // trend) raises in-flow support even when this particular answer never
      // used crisis language — the safety net no longer depends on one keyword.
      if (shouldRaiseImmediateSupport(risk, riskTrackerRef.current)) {
        setShowImmediateCrisis(true);
        return;
      }

      // Start choosing the next question NOW (it only needs this answer, the tone
      // and the risk level, all known at this point) so it is ready by the time the
      // solution is on screen and "Next" is pressed.
      if (currentIndex === sequence.length - 1 && sequence.length < assessmentLength) {
        nextPickRef.current = { key: nextPickKey(userAnswer), promise: pickNextQuestion(userAnswer, tone) };
      }

      const showExercise = shouldTriggerExercise(tone, currentQuestion.mandatory);

      if (showExercise) {
        await handleRequestSolution(userAnswer, evidence);
      } else {
        await advanceToNextQuestion();
      }
    } finally {
      busyRef.current = false;
      setIsThinking(false);
    }
  };

  // Continue past the exercise/solution card to the next question. The card stays
  // on screen with its button in a loading state until the next question is ready.
  const handleContinueFromSolution = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsThinking(true);
    neuralAudio.playHeartbeatPulse();
    setActiveSurge(true);
    setTimeout(() => setActiveSurge(false), 400);
    try {
      await advanceToNextQuestion();
    } finally {
      busyRef.current = false;
      setIsThinking(false);
    }
  };

  // Continue past the immediate crisis resources card to the next question.
  const handleContinueFromCrisisCard = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsThinking(true);
    try {
      await advanceToNextQuestion();
    } finally {
      busyRef.current = false;
      setIsThinking(false);
    }
  };

  // Return to editing current response
  const handleEditResponse = () => {
    setActiveDynamicSolution(null);
  };

  const handlePrev = () => {
    if (currentIndex > 0 && !isThinking) {
      setActiveDynamicSolution(null);
      setShowImmediateCrisis(false);
      setCurrentIndex((prev) => prev - 1);
    }
  };

  // Final Biopsychosocial Assessment synthesis
  const handleCompleteAssessment = async () => {
    setIsAssessing(true);
    neuralAudio.playThinkingChime();

    const formattedAnswers: AnswerRecord[] = sequence.map((q) => ({
      questionId: q.id,
      category: q.category,
      questionText: q.question,
      answer: answers[q.id] || 'Not answered',
    }));

    try {
      // Never leave the person on the "synthesizing" screen indefinitely: past this
      // the built-in clinical engine (same fallback used when the server is down)
      // produces the report.
      const assessController = new AbortController();
      const assessTimeout = setTimeout(() => assessController.abort(), 24000);
      const res = await fetch('/api/assess', {
        method: 'POST',
        signal: assessController.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answers: formattedAnswers,
          preferredProvider: 'auto',
          riskAssessment: evidenceRef.current.risk ?? undefined,
          semanticProfile: evidenceRef.current.semantics ?? undefined,
          neuroscopeReadings: evidenceRef.current.neuroscopeReadings.length
            ? evidenceRef.current.neuroscopeReadings
            : undefined,
          researchPassages: evidenceRef.current.passages.length
            ? evidenceRef.current.passages
            : undefined,
          psycheExamples: evidenceRef.current.psycheExamples.length
            ? evidenceRef.current.psycheExamples
            : undefined,
        }),
      });

      clearTimeout(assessTimeout);

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      const assessmentObj = data.assessment || (data.overallVerdict ? data : null);
      if (assessmentObj) {
        const normalized = normalizeAssessmentResult(assessmentObj);
        setAssessmentResult(normalized);
        saveAssessmentToHistory(normalized);
        neuralAudio.playThinkingChime();
      } else {
        throw new Error('Invalid assessment response format');
      }
    } catch (err) {
      console.warn('Backend assessment API fallback to local clinical engine:', err);
      const localResult = analyzeAnswersLocally(
        formattedAnswers,
        undefined,
        evidenceRef.current.risk,
        aggregateNeuroScope(evidenceRef.current.neuroscopeReadings)
      );
      setAssessmentResult(localResult);
      saveAssessmentToHistory(localResult);
      neuralAudio.playThinkingChime();
    } finally {
      setIsAssessing(false);
    }
  };

  const handleCustomReassess = async (customPrompt: string) => {
    setIsReassessing(true);
    neuralAudio.playThinkingChime();
    setActiveSurge(true);
    setTypingBurst((v) => v + 20);

    const formattedAnswers: AnswerRecord[] = sequence.map((q) => ({
      questionId: q.id,
      category: q.category,
      questionText: q.question,
      answer: answers[q.id] || 'Not answered',
    }));

    // Fast instant recalibration via local clinical engine
    const instantLocalResult = analyzeAnswersLocally(
      formattedAnswers,
      customPrompt,
      evidenceRef.current.risk,
      aggregateNeuroScope(evidenceRef.current.neuroscopeReadings)
    );
    setAssessmentResult({
      ...instantLocalResult,
      isCustomRevised: true,
      customFeedbackNote: customPrompt,
    });

    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Release button loading quickly for snappy UX
    setTimeout(() => {
      setIsReassessing(false);
      setActiveSurge(false);
    }, 350);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch('/api/reassess', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          answers: formattedAnswers,
          customFeedback: customPrompt,
          previousVerdict: assessmentResult?.overallVerdict,
          riskAssessment: evidenceRef.current.risk ?? undefined,
          semanticProfile: evidenceRef.current.semantics ?? undefined,
          neuroscopeReadings: evidenceRef.current.neuroscopeReadings.length
            ? evidenceRef.current.neuroscopeReadings
            : undefined,
          researchPassages: evidenceRef.current.passages.length
            ? evidenceRef.current.passages
            : undefined,
          psycheExamples: evidenceRef.current.psycheExamples.length
            ? evidenceRef.current.psycheExamples
            : undefined,
        }),
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.overallVerdict || data.assessment) {
          const revised = data.assessment || data;
          setAssessmentResult(normalizeAssessmentResult({
            ...instantLocalResult,
            ...revised,
            isCustomRevised: true,
            customFeedbackNote: customPrompt,
            safetyAlert: revised.safetyAlert || instantLocalResult.safetyAlert,
          }));
        }
      }
    } catch (err) {
      // Instant clinical engine result is already active
    }
  };

  const handleAuthenticated = (user: PublicUser) => {
    setCurrentUser(user);
    // The daily-login-streak effect above (keyed on currentUser.id) picks
    // this up automatically once currentUser updates, so the streak stays
    // in sync here too without recording the login twice.
  };

  const handleSignOut = () => {
    signOut();
    setCurrentUser(null);
    setShowAuthPage(false);
    // Reset the in-progress assessment state so the next person to sign in
    // on this device doesn't inherit someone else's half-finished session.
    setAnswers({});
    setCurrentIndex(0);
    setSequence([getOpeningQuestion(QUESTION_POOL)]);
    setAdaptiveMeta(null);
    setAssessmentResult(null);
    setHasStarted(false);
    setActiveDynamicSolution(null);
    setShowImmediateCrisis(false);
    setAssessmentLength(DEFAULT_ASSESSMENT_LENGTH);
    resetRiskState();
  };

  const handleRetake = () => {
    setAnswers({});
    setCurrentIndex(0);
    setSequence([getOpeningQuestion(QUESTION_POOL)]);
    setAdaptiveMeta(null);
    setAssessmentResult(null);
    setHasStarted(false);
    setActiveDynamicSolution(null);
    setShowImmediateCrisis(false);
    resetRiskState();
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div
      className="relative min-h-screen flex flex-col font-sans text-slate-100 overflow-x-hidden"
      data-landscape-mode={isMoonlightMode ? 'night' : 'day'}
    >
      {/* Photorealistic Greenery Landscape with Continuous Shining Sun & Volumetric God Rays */}
      <RealisticGreeneryLandscape
        isMoonlightMode={isMoonlightMode}
        onModeChange={setIsMoonlightMode}
      />

      {/* Top Header Navigation spanning full viewport width */}
      <HeaderNav user={currentUser} loginStreak={loginStreak} onSignOut={handleSignOut} />

      {/* Main Full-Screen Layout */}
      <main className="relative z-10 flex-1 flex flex-col justify-center w-full px-4 sm:px-6 md:px-10 lg:px-12 xl:px-16 py-4 md:py-8">
        {!currentUser ? (
          <div className="w-full flex items-center justify-center min-h-[calc(100vh-140px)]">
            {showAuthPage ? (
              <LoginPage onAuthenticated={handleAuthenticated} />
            ) : (
              <LandingPage onGetStarted={() => setShowAuthPage(true)} />
            )}
          </div>
        ) : (
        <AnimatePresence mode="wait">
          {/* Active Screening or Welcome View: Immersive 2-Column Desktop View with Brain Tree filling right side */}
          {!assessmentResult && (
            <div className="w-full max-w-[900px] mx-auto flex items-center min-h-[calc(100vh-140px)]">
              {/* Interactive Cards */}
              <div className="w-full flex flex-col justify-center">
                {!hasStarted && !isAssessing && (
                  <motion.div
                    key="intro-screen"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.4 }}
                    className="w-full"
                  >
                    <div className="relative rounded-3xl bg-slate-900/85 backdrop-blur-2xl p-6 sm:p-8 md:p-10 shadow-xl space-y-6 glass-panel">
                      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold uppercase tracking-wider w-fit">
                        <Brain className="w-4 h-4 text-cyan-400" />
                        <span>Adaptive Mental Wellness Screening</span>
                      </div>

                      <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">
                        Understand Your Inner Neural & Emotional State
                      </h1>

                      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                        NeuroScope adaptively selects from a 50-question research-grounded bank across five
                        dimensions of well-being. Choose how much time you have below — every length uses the
                        same scoring, and a supportive micro-intervention only appears when your answers
                        suggest you're actually feeling stressed, not after every single question.
                      </p>

                      <div className="grid grid-cols-2 gap-2.5 text-left pt-1">
                        <div className="p-3 rounded-xl bg-slate-950/70 text-xs space-y-0.5">
                          <div className="font-semibold text-cyan-400">1. Mood & Emotions</div>
                          <div className="text-slate-400 text-[11px]">Regulation & anhedonia</div>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950/70 text-xs space-y-0.5">
                          <div className="font-semibold text-emerald-400">2. Daily Functioning</div>
                          <div className="text-slate-400 text-[11px]">Sleep, appetite & focus</div>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950/70 text-xs space-y-0.5">
                          <div className="font-semibold text-purple-400">3. Thought Patterns</div>
                          <div className="text-slate-400 text-[11px]">Reality testing & loops</div>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950/70 text-xs space-y-0.5">
                          <div className="font-semibold text-rose-400">4. Stress & Coping</div>
                          <div className="text-slate-400 text-[11px]">Resilience & impulse</div>
                        </div>
                      </div>

                      <div className="pt-2 space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-0.5">
                          Choose your check-in length
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          {ASSESSMENT_MODES.map((mode) => {
                            const isSelected = mode.length === assessmentLength;
                            return (
                              <button
                                key={mode.length}
                                type="button"
                                onClick={() => setAssessmentLength(mode.length)}
                                className={`text-left p-3.5 rounded-xl border transition-all space-y-1 cursor-pointer ${
                                  isSelected
                                    ? 'bg-cyan-500/15 border-cyan-400/70 shadow-md shadow-cyan-500/10'
                                    : 'bg-slate-950/70 border-slate-700/60 hover:border-slate-500/70'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={`font-bold text-sm ${isSelected ? 'text-cyan-300' : 'text-white'}`}>
                                    {mode.label}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-400">{mode.estimatedMinutes}</span>
                                </div>
                                <div className="text-[11px] text-slate-400 leading-snug">{mode.description}</div>
                                <div className="text-[10px] font-semibold text-slate-500">{mode.length} questions</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setHasStarted(true);
                            setActiveSurge(true);
                            neuralAudio.playThinkingChime();
                            setTimeout(() => setActiveSurge(false), 800);
                            // Warm the transformer runtime while the first
                            // question is being read, so the first answer
                            // already gets NeuroScope DistilBERT-backed
                            // tone/emotion reads instead of the lexicon
                            // fallback.
                            warmEverything();
                          }}
                          className="w-full px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-extrabold text-sm md:text-base shadow-xl shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 group cursor-pointer"
                        >
                          <span>Begin {ASSESSMENT_MODES.find((m) => m.length === assessmentLength)?.label || 'Assessment'}</span>
                          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </button>
                      </div>

                      <div className="text-[11px] text-slate-400 flex items-center justify-center gap-2 pt-1">
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>Support Shown When It Helps • In-Depth Screening • Real-Time Feedback</span>
                      </div>
                    </div>
                  </motion.div>
                )}

                {hasStarted && !isAssessing && (
                  <motion.div
                    key={
                      showImmediateCrisis
                        ? `crisis-${currentIndex}`
                        : activeDynamicSolution
                        ? `solution-${currentIndex}`
                        : `question-${currentQuestion.id}`
                    }
                    initial={
                      activeDynamicSolution || showImmediateCrisis
                        ? { opacity: 0, y: 18, scale: 0.98 }
                        : { opacity: 0, x: -20 }
                    }
                    animate={
                      activeDynamicSolution || showImmediateCrisis
                        ? { opacity: 1, y: 0, scale: 1 }
                        : { opacity: 1, x: 0 }
                    }
                    exit={
                      activeDynamicSolution || showImmediateCrisis
                        ? { opacity: 0, y: -10, scale: 0.99 }
                        : { opacity: 0, x: -20 }
                    }
                    transition={{
                      duration: activeDynamicSolution || showImmediateCrisis ? 0.35 : 0.25,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="w-full"
                  >
                    {showImmediateCrisis ? (
                      <ImmediateCrisisCard onContinue={handleContinueFromCrisisCard} isLoading={isThinking} />
                    ) : activeDynamicSolution ? (
                      <DynamicSolutionCard
                        solution={activeDynamicSolution}
                        userAnswer={answers[currentQuestion.id] || ''}
                        questionNumber={currentIndex + 1}
                        totalQuestions={assessmentLength}
                        categoryTitle={currentCategory}
                        questionText={currentQuestion.question}
                        onContinue={handleContinueFromSolution}
                        onEditResponse={handleEditResponse}
                        isLastQuestion={currentIndex === assessmentLength - 1}
                        isContinuing={isThinking}
                        semanticProfile={lastSemantics}
                        researchPassages={lastPassages}
                      />
                    ) : (
                      <QuestionCard
                        key={currentQuestion.id}
                        question={currentQuestion}
                        currentIndex={currentIndex}
                        totalQuestions={assessmentLength}
                        currentAnswer={answers[currentQuestion.id] || ''}
                        onSaveAnswer={handleSaveAnswer}
                        onNext={handleAnswerSubmitted}
                        onPrev={handlePrev}
                        isThinking={isThinking}
                        categoryTitle={currentCategory}
                        onTypingBurst={() => setTypingBurst((v) => v + 1)}
                        adaptiveInfo={currentIndex > 0 ? adaptiveMeta : null}
                      />
                    )}
                  </motion.div>
                )}

                {isAssessing && (
                  <motion.div
                    key="assessing-state"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="w-full text-center p-8 rounded-3xl bg-slate-900/90 backdrop-blur-2xl shadow-xl space-y-5 glass-panel"
                  >
                    <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-cyan-500/20 text-cyan-300 mx-auto border border-cyan-400/50">
                      <Brain className="w-8 h-8 animate-pulse text-cyan-400" />
                      <span className="absolute -top-1 -right-1 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
                      </span>
                    </div>
                    <h3 className="text-xl font-bold text-white">Synthesizing Biopsychosocial Profile</h3>
                    <p className="text-xs md:text-sm text-slate-300">
                      Analyzing responses across neural dimensions and calculating resilience balance...
                    </p>
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: '100%' }}
                        transition={{ duration: 2.2, ease: 'easeInOut' }}
                        className="h-full bg-gradient-to-r from-cyan-400 via-purple-500 to-rose-400"
                      />
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          )}

          {/* Results & Solutions View: Full-Screen Executive Clinical Dashboard */}
          {assessmentResult && (
            <motion.div
              key="results-view"
              initial={{ opacity: 0, scaleY: 0.25, scaleX: 0.85, rotateX: -55, rotateZ: -8, filter: 'blur(8px)' }}
              animate={{ opacity: 1, scaleY: 1, scaleX: 1, rotateX: 0, rotateZ: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
              className="w-full origin-center [perspective:1200px]"
            >
              <Suspense
                fallback={
                  <div className="w-full flex items-center justify-center py-24 text-cyan-300">
                    <Brain className="w-8 h-8 animate-pulse" aria-hidden="true" />
                  </div>
                }
              >
                <AssessmentResultsView
                  result={assessmentResult}
                  onRetake={handleRetake}
                  onReassess={handleCustomReassess}
                  isReassessing={isReassessing}
                  provider="auto"
                  answers={sequence.map((q) => ({
                    questionId: q.id,
                    category: q.category,
                    questionText: q.question,
                    answer: answers[q.id] || 'Not answered',
                  }))}
                  riskAssessment={evidenceRef.current.risk ?? currentRisk ?? undefined}
                  researchPassages={evidenceRef.current.passages}
                  neuroscopeReadings={
                    evidenceRef.current.neuroscopeReadings.length
                      ? evidenceRef.current.neuroscopeReadings
                      : undefined
                  }
                />
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>
        )}
      </main>
    </div>
  );
}
