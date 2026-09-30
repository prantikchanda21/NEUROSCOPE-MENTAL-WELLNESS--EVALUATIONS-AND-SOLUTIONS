import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';
import { Question, AdaptiveSelectionMeta, EmotionClassification, NeuroScopeReading, SentimentResult } from '../types';
import { analyzeAnswerSentiment, analyzeAnswerSentimentAsync, applySymptomFloor, readDirectAnswer } from '../utils/adaptiveEngine';
import { checkImmediateRisk } from '../utils/clinicalEngine';
import {
  classifyEmotions,
  classifyWithNeuroScope,
  getCachedSemantics,
  isModelReady,
  subscribeSemanticState,
} from '../utils/semanticEngine';
import { Sparkles, ArrowRight, ArrowLeft, MessageSquareText, Mic, MicOff, AlertCircle, Loader2 } from 'lucide-react';

interface QuestionCardProps {
  question: Question;
  currentIndex: number;
  totalQuestions: number;
  currentAnswer: string;
  onSaveAnswer: (answer: string) => void;
  onNext: (answerText?: string) => void;
  onPrev: () => void;
  isThinking: boolean;
  categoryTitle: string;
  onTypingBurst?: () => void;
  /** Metadata from the adaptive engine explaining why this question was
   * chosen — omitted for the very first question, which has no prior answer. */
  adaptiveInfo?: AdaptiveSelectionMeta | null;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  currentIndex,
  totalQuestions,
  currentAnswer,
  onSaveAnswer,
  onNext,
  onPrev,
  isThinking,
  categoryTitle,
  onTypingBurst,
  adaptiveInfo,
}) => {
  const [text, setText] = useState(currentAnswer);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [showEmptyWarning, setShowEmptyWarning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Text already in the box when native dictation starts. Partial speech
  // results replace only the spoken portion so they do not duplicate.
  const baseTextRef = useRef('');

  const isAnswerEmpty = text.trim().length === 0;

  // Live tone + emotion read on the answer as the user types.
  // Two layers, so the chip is never stale and never too slow:
  //  1. an immediate offline read, question-aware so a bare "yes"/"no" reads
  //     correctly against what this specific question is asking;
  //  2. a debounced pass that supersedes it once a transformer answers —
  //     NeuroScope DistilBERT (this project's own fine-tuned primary model,
  //     which loads first) when ready, else the supporting RoBERTa model —
  //     giving the fine-tuned reading plus the 7-class emotion distribution.
  //     If no model is warm yet the offline read stands.
  const [liveSentiment, setLiveSentiment] = useState<SentimentResult | null>(null);
  const [liveEmotion, setLiveEmotion] = useState<EmotionClassification | null>(null);
  /** PRIMARY classifier reading (project's own DistilBERT dual-head), shown
   * as its own chip once the model is warm. Independent of the tone chip so a
   * still-downloading primary model never blocks the supporting reads. */
  const [liveNeuroScope, setLiveNeuroScope] = useState<NeuroScopeReading | null>(null);
  const liveTextRef = useRef(text);
  const transformerReadRef = useRef('');
  const liveSeqRef = useRef(0);

  const runTransformerRead = (clean: string) => {
    if (clean.length < 2 || transformerReadRef.current === clean) return;
    transformerReadRef.current = clean;
    void (async () => {
      // Run the tone pass as soon as EITHER a transformer is ready — NeuroScope
      // DistilBERT (primary, loads first) or the supporting RoBERTa model —
      // rather than waiting specifically on RoBERTa, which used to leave the
      // chip on RoBERTa (or stuck on the offline read) even after our own
      // fine-tuned model had already finished loading.
      const tone =
        isModelReady('neuroscope') || isModelReady('sentiment')
          ? await analyzeAnswerSentimentAsync(question, clean)
          : null;
      // The tone pass above runs (and caches) the full semantic reading, so the
      // emotion distribution is normally already available — no second round of
      // model inference for the same text. It is also what the submit step reuses.
      let emotions: EmotionClassification | null = getCachedSemantics(clean)?.emotions ?? null;
      if (!emotions && isModelReady('emotion')) emotions = await classifyEmotions(clean);
      // PRIMARY read: served from the same cached semantics when available.
      let neuroscope: NeuroScopeReading | null = getCachedSemantics(clean)?.neuroscope ?? null;
      if (!neuroscope && isModelReady('neuroscope')) {
        neuroscope = await classifyWithNeuroScope(clean);
      }
      // Discard a slow read for text the user has already moved past.
      if (liveTextRef.current.trim() !== clean) return;
      // analyzeAnswerSentimentAsync always returns a well-formed, best-
      // available reading (direct-answer override, crisis phrase, transformer,
      // or lexicon fallback) — accept whatever it returns rather than
      // filtering by source, which previously discarded legitimate
      // deterministic overrides.
      if (tone) setLiveSentiment(tone);
      if (emotions) setLiveEmotion(emotions);
      if (neuroscope) setLiveNeuroScope(neuroscope);
    })();
  };

  useEffect(() => {
    liveTextRef.current = text;
    const clean = text.trim();
    const seq = ++liveSeqRef.current;

    if (clean.length < 2) {
      setLiveSentiment(null);
      setLiveEmotion(null);
      setLiveNeuroScope(null);
      return;
    }

    // On the mandatory safety screener, a deterministic keyword check
    // (the same one that gates the synchronous crisis interrupt on submit
    // in App.tsx) always wins over the lexicon/transformer/NeuroScope
    // reading. Those models can miss indirect, passive phrasing ("wish to
    // go to sleep and not wake up") that doesn't contain a blunt word like
    // "die" or "suicide" - and even though the submit-time check still
    // correctly escalates, showing a "calm"/"neutral" badge next to the
    // person's own answer to THIS question while they are still typing it
    // is misleading and can read as dismissive. Never let it happen here.
    if (question?.mandatory && checkImmediateRisk(clean)) {
      setLiveSentiment({ score: -1, label: 'severe', magnitude: 1, source: 'lexicon+question' });
      setLiveEmotion(null);
      setLiveNeuroScope(null);
      return;
    }

    // A short, direct yes/no/frequency answer against a question with known
    // yes/no polarity is fully deterministic (see analyzeAnswerSentiment) —
    // and, most importantly, it is the ONLY thing standing between the
    // mandatory safety screener and a correct severe reading on a bare
    // "yes". It must never be superseded by the semantic cache below: that
    // cache is keyed on the raw text alone with NO question context, so a
    // benign "yes" cached earlier from a completely different question
    // (or from a previous answer submission) would otherwise silently
    // overwrite this question's own correct verdict. A lone "yes"/"no" also
    // carries no context for NeuroScope or RoBERTa to read, so there is
    // nothing to gain from running them here — resolve locally and stop.
    const direct = readDirectAnswer(clean);
    if (direct.matched && typeof question?.yesMeansConcern === 'boolean') {
      setLiveSentiment(analyzeAnswerSentiment(question, clean));
      setLiveEmotion(null);
      setLiveNeuroScope(null);
      return;
    }

    setLiveSentiment(analyzeAnswerSentiment(question, clean));

    const cached = getCachedSemantics(clean);
    if (cached) {
      // cached.sentiment is the raw model/ensemble reading; route it through
      // the same symptom-phrase floor as every other path so a cache hit
      // can't silently skip the correction (see applySymptomFloor above).
      setLiveSentiment(applySymptomFloor(clean, cached.sentiment));
      setLiveEmotion(cached.emotions);
      if (cached.neuroscope) setLiveNeuroScope(cached.neuroscope);
      return;
    }

    if (!isModelReady('sentiment') && !isModelReady('emotion') && !isModelReady('neuroscope')) {
      setLiveEmotion(null);
      return;
    }

    const timer = setTimeout(() => {
      if (seq === liveSeqRef.current) runTransformerRead(clean);
    }, 420);

    return () => clearTimeout(timer);
  }, [text, question]);

  // Upgrade an answer typed while the transformer stack was still downloading:
  // as soon as a model finishes warming, re-read the text that is on screen.
  useEffect(
    () =>
      subscribeSemanticState(() => {
        if (!isModelReady('sentiment') && !isModelReady('emotion') && !isModelReady('neuroscope')) return;
        const clean = liveTextRef.current.trim();
        if (clean.length < 2) return;
        // Same rule as above: never let a model-ready upgrade override the
        // deterministic safety-screener keyword check or a direct-answer
        // reading — most importantly the mandatory safety screener's severe
        // override on a bare "yes" or on passive/indirect risk language.
        if (question?.mandatory && checkImmediateRisk(clean)) return;
        const direct = readDirectAnswer(clean);
        if (direct.matched && typeof question?.yesMeansConcern === 'boolean') return;
        const cached = getCachedSemantics(clean);
        if (cached) {
          setLiveSentiment(applySymptomFloor(clean, cached.sentiment));
          setLiveEmotion(cached.emotions);
          return;
        }
        runTransformerRead(clean);
      }),
    [question]
  );

  // Native Android speech recognition.
  // This app is packaged for Android with Capacitor, so use the native
  // speech-recognition plugin instead of the browser Web Speech API.
  useEffect(() => {
    let partialListener: { remove: () => Promise<void> } | null = null;
    let segmentListener: { remove: () => Promise<void> } | null = null;
    let stateListener: { remove: () => Promise<void> } | null = null;
    let active = true;

    const setupSpeech = async () => {
      try {
        const { available } = await SpeechRecognition.available();
        if (!active) return;
        setSpeechSupported(available);

        partialListener = await SpeechRecognition.addListener(
          'partialResults',
          ({ matches }) => {
            if (!active) return;
            const spoken = matches?.[0]?.trim() ?? '';
            if (!spoken) return;

            const updated = [baseTextRef.current, spoken]
              .filter(Boolean)
              .join(' ')
              .trim();

            setText(updated);
            onSaveAnswer(updated);
            onTypingBurst?.();
            setShowEmptyWarning(false);
          }
        );

        try {
          segmentListener = await SpeechRecognition.addListener('segmentResults', ({ matches }) => {
            if (!active) return;
            applySpeechMatches(matches);
          });
        } catch {
          // Older plugin builds may not expose segmented sessions.
        }

        stateListener = await SpeechRecognition.addListener(
          'listeningState',
          ({ status }) => {
            if (!active) return;
            setIsListening(status === 'started');
          }
        );
      } catch (error) {
        console.error('Native speech recognition setup failed:', error);
        if (active) {
          setSpeechSupported(false);
          setSpeechError('Voice dictation is unavailable on this device.');
        }
      }
    };

    void setupSpeech();

    return () => {
      active = false;
      void partialListener?.remove();
      void segmentListener?.remove();
      void stateListener?.remove();
      void SpeechRecognition.stop().catch(() => undefined);
    };
  }, [onSaveAnswer, onTypingBurst]);

  // Keep the speech base text in sync with the text that existed before a
  // native recognition session started. During recognition, partial results
  // replace only the spoken portion so they don't duplicate on every event.
  const applySpeechMatches = (matches?: string[]) => {
    const spoken = matches?.[0]?.trim() ?? '';
    if (!spoken) return;
    const updated = [baseTextRef.current, spoken].filter(Boolean).join(' ').trim();
    setText(updated);
    onSaveAnswer(updated);
    onTypingBurst?.();
    setShowEmptyWarning(false);
  };

  const startNativeRecognition = async () => {
    setSpeechError(null);
    baseTextRef.current = text.trim();

    try {
      const permission = await SpeechRecognition.requestPermissions();

      if (permission.speechRecognition !== 'granted') {
        setSpeechError('Microphone permission is required for voice dictation.');
        return;
      }

      const { available } = await SpeechRecognition.available();
      if (!available) {
        setSpeechSupported(false);
        setSpeechError('Speech recognition is not available on this Android device.');
        return;
      }

      setSpeechSupported(true);
      setIsListening(true);

      const response = await SpeechRecognition.start({
        language: navigator.language || 'en-US',
        maxResults: 3,
        partialResults: true,
        popup: false,
        allowForSilence: 1200,
      } as any);

      // Some Android recognition services return the final match directly.
      applySpeechMatches(response?.matches);
    } catch (error: any) {
      console.error('Native speech recognition start failed:', error);
      setIsListening(false);
      setSpeechError(
        error?.message || 'Could not start voice dictation. Please allow microphone access and try again.'
      );
    }
  };

  const stopNativeRecognition = async () => {
    try {
      await SpeechRecognition.stop();
    } catch (error) {
      console.error('Native speech recognition stop failed:', error);
    } finally {
      setIsListening(false);
    }
  };

  const toggleListening = async () => {
    setSpeechError(null);

    if (isListening) {
      await stopNativeRecognition();
      return;
    }

    await startNativeRecognition();
  };

  // Stop recognition when leaving the question or unmounting the component.
  useEffect(() => {
    return () => {
      void SpeechRecognition.stop().catch(() => undefined);
    };
  }, [question.id]);

  // Sync state with prop if question changes
  useEffect(() => {
    setText(currentAnswer);
    setShowEmptyWarning(false);
  }, [currentAnswer, question.id]);

  // Focus textarea when question changes
  useEffect(() => {
    if (!isThinking) {
      textareaRef.current?.focus();
    }
  }, [question.id, isThinking]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    onSaveAnswer(val);
    onTypingBurst?.();
    if (val.trim().length > 0) {
      setShowEmptyWarning(false);
    }
  };

  const handleChipClick = (prompt: string) => {
    const updated = text.trim() ? `${text.trim()} — ${prompt}` : prompt;
    setText(updated);
    onSaveAnswer(updated);
    onTypingBurst?.();
    setShowEmptyWarning(false);
    textareaRef.current?.focus();
  };

  const handleSubmit = () => {
    if (isThinking) return;
    if (text.trim().length === 0) {
      setShowEmptyWarning(true);
      textareaRef.current?.focus();
      return;
    }
    onSaveAnswer(text);
    onNext(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const progressPercent = Math.round(((currentIndex + 1) / totalQuestions) * 100);

  return (
    <motion.div
      key={question.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="w-full max-w-2xl mx-auto"
    >
      <div className="relative rounded-3xl bg-slate-950/85 backdrop-blur-2xl border border-emerald-500/25 p-6 sm:p-8 md:p-9 shadow-2xl shadow-emerald-950/40 glass-panel">
        {/* Progress & Category Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2">
            <span className="px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
              {categoryTitle}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
            <span>Question {currentIndex + 1} of {totalQuestions}</span>
            <span className="text-amber-400 font-bold">({progressPercent}%)</span>
          </div>
        </div>

        {/* Question Title */}
        <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-white tracking-tight leading-snug mb-3">
          {question.question}
        </h2>

        {/* Clinical intent context */}
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 mb-3 text-xs text-slate-300">
          <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span className="italic leading-relaxed">{question.rationale}</span>
        </div>

        {/* User Input Section */}
        <div className="space-y-4 mb-6">
          <div className="flex items-center justify-between">
            <label
              htmlFor={`answer-${question.id}`}
              className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5"
            >
              <MessageSquareText className="w-3.5 h-3.5 text-cyan-400" />
              <span>Your Personal Answer</span>
              <span className="text-rose-400 normal-case tracking-normal font-bold">*</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleListening}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  isListening
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse'
                    : speechSupported
                    ? 'bg-slate-800/80 hover:bg-slate-700 text-cyan-300 border border-slate-700'
                    : 'bg-slate-900/60 hover:bg-slate-800/80 text-slate-500 border border-slate-800'
                }`}
                title={speechSupported ? 'Speak your reflection' : 'Voice dictation is unavailable on this device'}
              >
                {isListening ? (
                  <>
                    <MicOff className="w-3.5 h-3.5 text-rose-400 animate-bounce" />
                    <span className="text-[11px] font-bold">Listening... (Speak)</span>
                  </>
                ) : (
                  <>
                    <Mic className={`w-3.5 h-3.5 ${speechSupported ? 'text-cyan-400' : 'text-slate-500'}`} />
                    <span className="text-[11px]">Voice Dictate</span>
                  </>
                )}
              </button>
              <span className="text-[11px] text-slate-500 hidden sm:inline">
                Type or speak freely
              </span>
            </div>
          </div>

          <div className="relative">
            <textarea
              id={`answer-${question.id}`}
              ref={textareaRef}
              rows={4}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              disabled={isThinking}
              placeholder={question.placeholder}
              aria-required="true"
              aria-invalid={showEmptyWarning}
              className={`w-full rounded-2xl bg-slate-950/70 border p-4 text-sm text-slate-100 placeholder-slate-500 transition-all resize-none outline-none leading-relaxed disabled:opacity-50 ${
                showEmptyWarning
                  ? 'border-rose-500/80 focus:border-rose-400 focus:ring-1 focus:ring-rose-400'
                  : 'border-slate-700/80 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400'
              }`}
            />
          </div>

          {showEmptyWarning && (
            <div className="flex items-center gap-2 text-rose-300 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Please share a response before continuing to the next question.</span>
            </div>
          )}

          {speechError && (
            <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs flex items-center justify-between gap-2">
              <span>{speechError}</span>
              <button
                type="button"
                onClick={() => setSpeechError(null)}
                className="text-amber-400 hover:text-white text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Quick Prompts / Sentiment Starters */}
          <div className="space-y-1.5 pt-1">
            <span className="text-[11px] font-medium text-slate-400">
              Quick reflections (click to insert or elaborate):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {question.quickPrompts.map((prompt, pIdx) => (
                <button
                  key={pIdx}
                  type="button"
                  onClick={() => handleChipClick(prompt)}
                  disabled={isThinking}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-700/80 active:bg-cyan-900/30 border border-slate-700 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-200 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
          <button
            type="button"
            onClick={onPrev}
            disabled={currentIndex === 0 || isThinking}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700/70 text-slate-300 hover:text-white hover:bg-slate-800/60 disabled:opacity-30 disabled:pointer-events-none text-xs md:text-sm font-medium transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Previous
          </button>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-block text-[11px] text-slate-500 font-mono">
              Press ⌘/Ctrl + Enter
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isThinking || isAnswerEmpty}
              title={isAnswerEmpty ? 'Enter a response to continue' : undefined}
              aria-busy={isThinking}
              className={`relative group overflow-hidden flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 active:scale-98 text-slate-950 font-bold text-xs md:text-sm shadow-lg shadow-cyan-500/25 transition-all disabled:hover:from-cyan-500 disabled:hover:to-blue-600 cursor-pointer ${
                isThinking ? 'disabled:opacity-90 disabled:cursor-wait' : 'disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {isThinking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" aria-hidden="true" />
                  <span>Synthesizing Dynamic Solution...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-slate-950" />
                  <span>{currentIndex === totalQuestions - 1 ? 'Get Solution & Synthesize' : 'Get Dynamic Solution & Next'}</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
