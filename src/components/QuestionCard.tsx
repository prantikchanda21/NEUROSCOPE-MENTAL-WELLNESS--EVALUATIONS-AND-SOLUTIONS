import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
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
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Set to true only when the user explicitly clicks "stop" (or an
  // unrecoverable error occurs). Otherwise onend triggers a silent
  // auto-restart — see the comment on startRecognition below.
  const manualStopRef = useRef(false);
  // The desktop Web Speech API calls out to a cloud recognition service for
  // every dictation session, so a transient blip (flaky wifi, a momentary
  // DNS hiccup) surfaces as a 'network' error even though nothing is wrong
  // with the app. Retry a couple of times with a short backoff before
  // treating it as a real failure, instead of giving up on the first one.
  const networkRetryCountRef = useRef(0);
  // True while a delayed network-error retry (above) is scheduled, so
  // onend's own immediate auto-restart doesn't also fire and race it.
  const networkRetryPendingRef = useRef(false);
  // Text already in the box when dictation started, so live/final
  // transcripts get appended to it rather than replacing it.
  const baseTextRef = useRef('');
  // Desktop Chrome/Edge's continuous speech recognition has a well-known
  // failure mode that mobile rarely hits: after roughly 10-20s the session
  // silently stalls — the mic stays "on" and no error/onend ever fires, but
  // no more results are delivered, so dictation just goes dead. The restart
  // in onend below only helps once the browser actually *ends* the session,
  // which doesn't happen in the stall case. This timer proactively cycles
  // the session on a fixed interval so it can never sit stalled for long;
  // baseTextRef preserves everything already transcribed across the cycle,
  // so the user sees at most a brief gap, not lost text.
  const keepAliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clearKeepAlive = () => {
    if (keepAliveTimerRef.current) {
      clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }
  };

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

  // Check speech recognition support. The constructor can exist on an
  // insecure origin (non-HTTPS, non-localhost) even though it will always
  // fail there, so we also check isSecureContext up front and surface a
  // clear reason instead of a confusing silent failure.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        setSpeechSupported(true);
        if (window.isSecureContext === false) {
          setSpeechError(
            'Voice dictation needs a secure connection (HTTPS) or localhost. This page is loaded over an insecure connection, so the browser blocks microphone access.'
          );
        }
      }
    }
  }, []);

  // isRestart = true means this is an automatic continuation of the same
  // dictation session (see onend below), so it must NOT reset baseTextRef —
  // that would drop everything already committed.
  const startRecognition = (lang: string, isRetry = false, isRestart = false) => {
    const SpeechRecognition =
      typeof window !== 'undefined' &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    if (!SpeechRecognition) return;

    if (!isRestart) {
      manualStopRef.current = false;
      baseTextRef.current = text.trim();
      networkRetryCountRef.current = 0;
    }

    const recognition = new SpeechRecognition();
    // continuous=true + an auto-restart on unexpected `onend` (below) is the
    // actual fix here: with continuous=false, Chrome/Edge on desktop end
    // recognition the moment they detect the first short pause in speech —
    // which happens constantly in normal talking — so dictation appeared to
    // "stop working" after a couple of words every time.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = lang;

    let finalTranscript = '';

    recognition.onstart = () => {
      setIsListening(true);
      setSpeechError(null);
      // Cycle this session proactively (see comment on keepAliveTimerRef)
      // instead of waiting to detect a stall that may never announce itself.
      clearKeepAlive();
      keepAliveTimerRef.current = setInterval(() => {
        if (manualStopRef.current || recognitionRef.current !== recognition) {
          clearKeepAlive();
          return;
        }
        try {
          recognition.stop();
        } catch {
          // safe — onend will still fire and the restart logic takes it from there
        }
      }, 12000);
    };

    recognition.onresult = (event: any) => {
      // Getting any result at all means the connection to the speech
      // service is healthy, so the network-error retry budget can reset.
      networkRetryCountRef.current = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += `${chunk} `;
        } else {
          interim += chunk;
        }
      }
      // Live preview: show what's been said so far, including the
      // still-being-recognized interim chunk, instead of leaving the box
      // untouched until the mic stops — that silence is what made it look
      // broken while actively speaking.
      const preview = [baseTextRef.current, finalTranscript.trim(), interim.trim()]
        .filter(Boolean)
        .join(' ')
        .trim();
      setText(preview);
    };

    recognition.onerror = (event: any) => {
      // A safe language falls back automatically instead of surfacing a
      // confusing error the user can't act on.
      if (event.error === 'language-not-supported' && !isRetry && lang !== 'en-US') {
        recognitionRef.current = null;
        startRecognition('en-US', true, isRestart);
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        manualStopRef.current = true;
        setSpeechError(
          'Microphone access is blocked. Click the lock/site-info icon in the address bar, allow the microphone, then try again.'
        );
      } else if (event.error === 'audio-capture') {
        manualStopRef.current = true;
        setSpeechError('No microphone was found. Please connect a microphone and try again.');
      } else if (event.error === 'no-speech') {
        // Common during a normal pause with continuous mode on — let onend
        // below silently restart instead of surfacing this as an error.
      } else if (event.error === 'network') {
        // Retry a few times first — see the comment on networkRetryCountRef.
        // Only give up and surface an error once retries are exhausted, so
        // we don't let onend auto-restart into the same failure forever.
        if (networkRetryCountRef.current < 2) {
          networkRetryCountRef.current += 1;
          networkRetryPendingRef.current = true;
          recognitionRef.current = null;
          setTimeout(() => {
            networkRetryPendingRef.current = false;
            if (!manualStopRef.current) startRecognition(lang, false, true);
          }, 1200);
        } else {
          manualStopRef.current = true;
          setSpeechError('Network error occurred with the speech engine. Please check your connection or type your answer.');
        }
      } else if (event.error === 'aborted') {
        // User- or app-initiated stop; nothing to show.
      } else {
        manualStopRef.current = true;
        setSpeechError(`Speech error: ${event.error || 'please check your microphone'}.`);
      }
    };

    recognition.onend = () => {
      clearKeepAlive();
      recognitionRef.current = null;
      const combinedFinal = finalTranscript.trim();
      if (combinedFinal) {
        const updated = [baseTextRef.current, combinedFinal].filter(Boolean).join(' ').trim();
        baseTextRef.current = updated;
        setText(updated);
        onSaveAnswer(updated);
        onTypingBurst?.();
        setShowEmptyWarning(false);
      }

      if (manualStopRef.current) {
        setIsListening(false);
      } else if (!networkRetryPendingRef.current) {
        // Recognition ended on its own (e.g. the browser's built-in silence
        // timeout) but the user never clicked stop — resume automatically so
        // one pause in speech doesn't end the whole dictation. If a network
        // error just scheduled its own delayed retry above, skip this
        // immediate one so the two don't race and open two sessions at once.
        startRecognition(lang, false, true);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err: any) {
      // InvalidStateError fires if a previous instance is still winding down
      // (e.g. a fast double-click); one retry on the next tick resolves it.
      if (err?.name === 'InvalidStateError') {
        setTimeout(() => {
          try {
            recognition.start();
          } catch {
            manualStopRef.current = true;
            setIsListening(false);
            recognitionRef.current = null;
            setSpeechError('Could not start voice recognition. Please try again.');
          }
        }, 250);
      } else {
        manualStopRef.current = true;
        setIsListening(false);
        recognitionRef.current = null;
        setSpeechError('Could not start voice recognition. Please ensure microphone permissions are granted.');
      }
    }
  };

  const toggleListening = () => {
    setSpeechError(null);
    const SpeechRecognition =
      typeof window !== 'undefined' &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

    if (!SpeechRecognition) {
      setSpeechError('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isListening && recognitionRef.current) {
      manualStopRef.current = true;
      clearKeepAlive();
      try {
        recognitionRef.current.stop();
      } catch {
        // safe — onend will still fire and reset state
      }
      return;
    }

    // Recognition itself owns the microphone permission prompt; requesting it
    // separately via getUserMedia first was redundant and, on some browsers,
    // released/reacquired the device fast enough to make recognition.start()
    // fail right after with no useful error. Letting recognition handle its
    // own permission flow is both simpler and more reliable.
    startRecognition(navigator.language || 'en-US');
  };

  // Stop any in-flight recognition if the component unmounts mid-listen
  // (e.g. the user navigates to the next question while still speaking).
  useEffect(() => {
    return () => {
      // Mark as a manual stop first so the auto-restart-on-unexpected-end
      // logic in onend doesn't keep the mic alive after the component (and
      // its handlers' closures) are gone.
      manualStopRef.current = true;
      clearKeepAlive();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // safe
        }
      }
    };
  }, []);


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
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
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
              {/* Always rendered, even when unsupported — hiding it entirely
                  on browsers without SpeechRecognition (e.g. desktop Firefox)
                  just made the feature look missing/broken instead of telling
                  the user why it isn't available. toggleListening() itself
                  surfaces a clear message when the API doesn't exist. */}
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
                title={
                  speechSupported
                    ? 'Speak your reflection'
                    : 'Voice dictation isn\u2019t supported in this browser — click for details'
                }
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
