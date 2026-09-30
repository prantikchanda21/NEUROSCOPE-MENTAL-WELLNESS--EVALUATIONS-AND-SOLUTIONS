import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DynamicFeelingSolution } from '../utils/dynamicFeelingSolutions';
import { generateDynamicFollowUpReply } from '../utils/dynamicFollowUpResponses';
import { generateLocalChatReply, getLocalLlmState, waitForLocalLlm } from '../utils/localLlm';
import { hasImminentRiskLanguage } from '../utils/riskEngine';
import { SemanticAnalysis } from '../types';
import { RetrievedPassage } from '../utils/researchKnowledge';
import type { ExportChatMessage } from '../utils/chatExport';
import type { WellnessProfile } from '../utils/wellnessProfileStorage';
import { buildWellnessProfileContext } from '../utils/wellnessProfileStorage';
import { HelixWaveEffect } from './HelixWaveEffect';
import {
  Sparkles,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  Heart,
  Activity,
  Wind,
  Brain,
  Send,
  Loader2,
  Lightbulb,
  Clock,
  Calendar,
  MessageSquareQuote,
  Flame,
  HelpCircle,
  Phone,
  ShieldAlert,
  BookOpen,
} from 'lucide-react';

interface FollowUpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestedAction?: string;
}

interface DynamicSolutionCardProps {
  solution: DynamicFeelingSolution;
  userAnswer: string;
  questionNumber: number;
  totalQuestions: number;
  categoryTitle: string;
  questionText?: string;
  onContinue: () => void;
  onEditResponse: () => void;
  isLastQuestion: boolean;
  /** True while the next question (or the final synthesis) is being prepared. */
  isContinuing?: boolean;
  /** On-device semantic read for this answer (NeuroScope DistilBERT tone,
   * falling back to RoBERTa sentiment while NeuroScope loads, + 7-class
   * emotions + crisis-language similarity), forwarded to the follow-up chat. */
  semanticProfile?: SemanticAnalysis | null;
  /** Research passages retrieved for this answer, forwarded to the follow-up
   * chat so replies stay grounded in the same sources as the solution. */
  researchPassages?: RetrievedPassage[];
  /** Emits each follow-up chat turn to the parent so the complete assessment
   * conversation can be exported after the final synthesis. */
  onChatMessage?: (message: ExportChatMessage) => void;
  wellnessProfile?: WellnessProfile | null;
}


const ON_DEVICE_NOTE = '\n\n(Written on your device by the offline AI.)';
const OFFLINE_AI_FAILED_NOTE = '\n\n(Built-in guidance. The Offline AI on this device did not start - open the "Offline AI" menu in the header to see why.)';
const OFFLINE_NOTE = '\n\n(The AI service could not be reached, so this is built-in guidance and may be less personalised. Please try again in a moment.)';

export const DynamicSolutionCard: React.FC<DynamicSolutionCardProps> = ({
  solution,
  userAnswer,
  questionNumber,
  totalQuestions,
  categoryTitle,
  questionText = '',
  onContinue,
  onEditResponse,
  isLastQuestion,
  isContinuing = false,
  semanticProfile,
  researchPassages,
  onChatMessage,
  wellnessProfile,
}) => {
  const [breathPhase, setBreathPhase] = useState<'inhale1' | 'inhale2' | 'exhale'>('inhale1');
  const [completedMicroExercise, setCompletedMicroExercise] = useState(false);

  // Interactive Follow-up Chat State
  const [followUpInput, setFollowUpInput] = useState('');
  const [isFollowUpLoading, setIsFollowUpLoading] = useState(false);
  const [followUpMessages, setFollowUpMessages] = useState<FollowUpMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Breathing pacer loop if breathing tool is active
  useEffect(() => {
    if (solution.interactiveTool?.type === 'breathing_sigh') {
      const interval = setInterval(() => {
        setBreathPhase((prev) => {
          if (prev === 'inhale1') return 'inhale2';
          if (prev === 'inhale2') return 'exhale';
          return 'inhale1';
        });
      }, 3500);

      return () => clearInterval(interval);
    }
  }, [solution]);

  useEffect(() => {
    if (followUpMessages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [followUpMessages, isFollowUpLoading]);

  // Handle asking a follow up (from suggested pill or typed input)
  const handleSendFollowUp = async (questionToSend?: string) => {
    const query = (questionToSend || followUpInput).trim();
    if (!query || isFollowUpLoading) return;

    const userMsg: FollowUpMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
    };

    setFollowUpMessages((prev) => [...prev, userMsg]);
    onChatMessage?.({
      role: 'user',
      content: query,
      questionNumber,
      questionText,
    });
    setFollowUpInput('');
    setIsFollowUpLoading(true);

    const template = () =>
      generateDynamicFollowUpReply(query, {
        questionText,
        userAnswer,
        solutionTitle: solution.immediateSolutionTitle,
        emotionalStateLabel: solution.emotionalStateLabel,
        neurobiology: solution.detailedAnalysis || solution.neurobiologyInsight,
        dominantEmotion:
          semanticProfile?.emotions?.source === 'transformer' ? semanticProfile.emotions.top?.label : undefined,
        riskBand: solution.riskLevel || semanticProfile?.neuroscope?.band,
      });

    // The on-device model never handles high-risk conversations: those keep the
    // built-in crisis-aware replies. Same rule the tone ensemble uses.
    const onDeviceAllowed = async () => {
      const band = String(solution.riskLevel || semanticProfile?.neuroscope?.band || '').toLowerCase();
      if (band.includes('high') || band.includes('critical') || band.includes('severe')) return false;
      if (hasImminentRiskLanguage(query) || hasImminentRiskLanguage(userAnswer || '')) return false;
      // The model may still be loading from the browser cache: wait for it (up to 60 s).
      return waitForLocalLlm(60000);
    };

    // When no answer could be written on-device, say so if the model is installed but not running.
    const fallbackNote = () => {
      const st = getLocalLlmState();
      return st.status === 'error' || (st.installed && st.status !== 'ready') ? OFFLINE_AI_FAILED_NOTE : OFFLINE_NOTE;
    };

    let replyText = '';
    let suggestedAction: string | undefined;
    try {
      let data: any = null;
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          const res = await fetch('/api/solution-followup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              questionText: questionText || `Mental Health Screening Question #${questionNumber}`,
              userAnswer: userAnswer || 'User described symptoms',
              solutionContext: {
                title: solution.immediateSolutionTitle,
                emotionalState: solution.emotionalStateLabel,
                neurobiology: solution.detailedAnalysis || solution.neurobiologyInsight,
              },
              userFollowUp: query,
              // Recent turns so replies build on the conversation instead of starting over.
              history: followUpMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
              semanticProfile: semanticProfile ?? undefined,
              researchPassages: researchPassages?.length ? researchPassages : undefined,
              riskAssessment: solution.riskLevel ? { level: solution.riskLevel } : undefined,
              wellnessProfile: wellnessProfile?.useForPersonalization === false ? undefined : wellnessProfile ?? undefined,
            }),
          });
          clearTimeout(timeoutId);
          if (res.ok) data = await res.json();
        } catch {
          data = null; // offline, timeout or server error: handled below
        }
      }

      if (data?.reply && data.providerUsed !== 'local') {
        // A real cloud answer always wins.
        replyText = data.reply;
        suggestedAction = data.suggestedAction;
      } else {
        // No cloud answer (offline, no keys, server fell back to its templates):
        // try the downloaded on-device model before the built-in template bank.
        const onDevice = (await onDeviceAllowed())
          ? await generateLocalChatReply(query, {
              questionText,
              userAnswer,
              solutionTitle: solution.immediateSolutionTitle,
              emotionalStateLabel: solution.emotionalStateLabel,
              history: followUpMessages.slice(-4).map((m) => ({ role: m.role, content: m.content })),
              wellnessProfileContext: buildWellnessProfileContext(wellnessProfile),
            })
          : null;
        if (onDevice) {
          replyText = onDevice + ON_DEVICE_NOTE;
          suggestedAction = data?.suggestedAction || template().suggestedAction;
        } else if (data?.reply) {
          replyText = data.reply + fallbackNote();
          suggestedAction = data.suggestedAction;
        } else {
          const local = template();
          replyText = local.reply + fallbackNote();
          suggestedAction = local.suggestedAction;
        }
      }
    } catch {
      const local = template();
      replyText = local.reply + fallbackNote();
      suggestedAction = local.suggestedAction;
    }

    const assistantMsg: ExportChatMessage = {
      role: 'assistant',
      content: replyText,
      suggestedAction,
      questionNumber,
      questionText,
    };
    setFollowUpMessages((prev) => [
      ...prev,
      { id: `ai-${Date.now()}`, role: 'assistant', content: replyText, suggestedAction },
    ]);
    onChatMessage?.(assistantMsg);
    setIsFollowUpLoading(false);
  };

  // Provider label
  const providerLabel =
    solution.providerUsed === 'gemini'
      ? 'Gemini 3.6 Flash'
      : solution.providerUsed === 'groq'
      ? 'GPT-OSS-120B'
      : solution.providerUsed === 'on-device'
      ? 'Offline AI (on your device)'
      : 'Neural Intelligence Engine';

  const grounding = solution.evidenceSources?.filter(Boolean) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, scaleY: 0.2, scaleX: 0.8, rotateX: -60, rotateZ: -12, filter: 'blur(8px)' }}
      animate={{ opacity: 1, scaleY: 1, scaleX: 1, rotateX: 0, rotateZ: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scaleY: 0.6, scaleX: 0.9, rotateX: 30, filter: 'blur(4px)' }}
      transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full max-w-2xl mx-auto space-y-6 origin-center [perspective:1000px]"
    >
      {/* Luminous Double-Helix DNA Wave Bloom Animation */}
      <HelixWaveEffect variant="card" duration={1100} />

      {/* Top Header Badge Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/20 border border-emerald-500/30 text-emerald-300">
            {categoryTitle}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
          <span>Question {questionNumber} of {totalQuestions} Solved</span>
          <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" />
        </div>
      </div>

      {/* Main Solution Panel - Framed with soft depth */}
      <div className="relative rounded-3xl bg-slate-950/85 backdrop-blur-2xl border border-emerald-500/25 p-6 sm:p-8 space-y-6 shadow-2xl shadow-emerald-950/40 glass-panel">
        {/* Solution Title & Brain State */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-cyan-400 uppercase tracking-wider">
            <Brain className="w-4 h-4 text-cyan-400" />
            <span>{solution.emotionalStateLabel}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            {solution.immediateSolutionTitle}
          </h2>
          {solution.personalizing && (
            <div className="text-[11px] text-emerald-300 flex items-center gap-1.5" aria-live="polite">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Personalising this on your device…</span>
            </div>
          )}
          {solution.providerUsed === 'on-device' && (
            <div className="text-[11px] text-emerald-300/90">Written on your device by the offline AI.</div>
          )}
          {solution.neuralRegion && (
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-purple-400" />
              <span>Target Neural Circuit: <span className="text-purple-300 font-medium">{solution.neuralRegion}</span></span>
            </div>
          )}
        </div>

        {/* User's Feeling Reflected (Quote Box) */}
        {userAnswer && (
          <div className="p-4 rounded-2xl bg-slate-950/80 space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <MessageSquareQuote className="w-3.5 h-3.5 text-cyan-400" />
              <span>What You Shared:</span>
            </div>
            <p className="text-sm text-slate-100 italic leading-relaxed">
              "{userAnswer}"
            </p>
          </div>
        )}

        {grounding.length > 0 && (
          <div className="flex items-start gap-1.5 text-[11px] text-slate-400 leading-relaxed px-1">
            <BookOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              <span className="font-semibold text-slate-300">Grounded in: </span>
              {grounding.join(' · ')}
            </span>
          </div>
        )}

        {/* Conversational Empathy (LLM Clinical Experience) */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-950/25 via-slate-950/60 to-slate-900/80 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-purple-300 uppercase tracking-wider">
            <Heart className="w-4 h-4 text-rose-400" />
            <span>Empathetic Assessment & Reflection</span>
          </div>
          <div className="text-sm text-slate-200 leading-relaxed space-y-3 whitespace-pre-line">
            {solution.conversationalEmpathy || solution.userQuoteAnalysis || solution.neurobiologyInsight}
          </div>
        </div>

        {/* Detailed Neurobiological Analysis & Perspective Shift */}
        <div className="grid grid-cols-1 gap-4">
          {solution.detailedAnalysis && (
            <div className="p-4 rounded-2xl bg-slate-950/70 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Brain className="w-4 h-4 text-cyan-400" />
                <span>What Is Happening In Your Nervous System:</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {solution.detailedAnalysis}
              </p>
            </div>
          )}

          {solution.perspectiveShift && (
            <div className="p-4 rounded-2xl bg-cyan-950/25 space-y-1.5">
              <div className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4 text-cyan-400" />
                <span>Cognitive Perspective Shift:</span>
              </div>
              <p className="text-xs sm:text-sm text-cyan-100/90 leading-relaxed font-medium">
                {solution.perspectiveShift.length > 90
                  ? solution.perspectiveShift
                  : `"${solution.perspectiveShift}"`}
              </p>
            </div>
          )}
        </div>

        {/* Immediate Action & Step-by-Step Blueprint */}
        <div className="p-5 sm:p-6 rounded-2xl bg-cyan-950/30 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <span>
                {solution.isAppreciation
                  ? 'Keep It Up'
                  : solution.toneLevel === 'neutral'
                  ? 'Ways To Add More Positivity'
                  : 'What You Can Do Right Now'}
              </span>
            </div>
            {solution.immediateActionRightNow && (
              <span className="text-[11px] font-bold text-amber-300 bg-amber-500/15 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <Clock className="w-3 h-3" /> Right Now
              </span>
            )}
          </div>

          {solution.immediateActionRightNow && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 text-amber-100 text-xs sm:text-sm font-medium leading-relaxed">
              <span className="font-bold text-amber-300 block mb-1">Immediate First Move:</span>
              {solution.immediateActionRightNow}
            </div>
          )}

          {/* Steps */}
          <div className="space-y-2.5">
            {solution.immediateSolutionSteps.map((step, idx) => (
              <div key={idx} className="flex items-start gap-3 text-sm text-slate-200">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-bold shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </div>
            ))}
          </div>

          {/* Practical Next Step Today */}
          {solution.practicalStepToday && (
            <div className="pt-3 border-t border-cyan-500/20 flex items-start gap-2.5 text-xs text-slate-300">
              <Calendar className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-cyan-200">Later Today: </span>
                <span>{solution.practicalStepToday}</span>
              </div>
            </div>
          )}

          {/* Support Helplines — shown for "severe" (urgent) and, more
              softly, for a meaningfully negative "distressed" tone. Copy
              and color intensity adapt to which one it is. */}
          {solution.helplines && solution.helplines.length > 0 && (
            <div
              className={`pt-3 mt-1 border-t space-y-3 ${
                solution.toneLevel === 'severe' ? 'border-rose-500/30' : 'border-cyan-500/25'
              }`}
            >
              <div
                className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${
                  solution.toneLevel === 'severe' ? 'text-rose-300' : 'text-cyan-300'
                }`}
              >
                <ShieldAlert className={`w-4 h-4 ${solution.toneLevel === 'severe' ? 'text-rose-400' : 'text-cyan-400'}`} />
                <span>{solution.toneLevel === 'severe' ? 'Please Consider Reaching Out' : 'If It Ever Helps To Talk'}</span>
              </div>
              <p className={`text-xs leading-relaxed ${solution.toneLevel === 'severe' ? 'text-rose-100/90' : 'text-slate-300'}`}>
                {solution.toneLevel === 'severe'
                  ? 'If things feel unsafe or like too much right now, these lines are free, confidential, and available — the people there want to hear from you.'
                  : 'You don\u2019t have to be in crisis to reach out. These lines (India and international) are free, confidential, and there any time you just want to talk something through.'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {solution.helplines.map((hl, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-xl border space-y-1 ${
                      solution.toneLevel === 'severe'
                        ? 'bg-rose-950/40 border-rose-600/40'
                        : 'bg-cyan-950/25 border-cyan-600/30'
                    }`}
                  >
                    {hl.region && (
                      <div
                        className={`text-[10px] font-bold uppercase tracking-wider ${
                          solution.toneLevel === 'severe' ? 'text-rose-300' : 'text-cyan-300'
                        }`}
                      >
                        {hl.region}
                      </div>
                    )}
                    <div className="font-bold text-xs text-white">{hl.name}</div>
                    <div className="text-xs font-mono font-bold text-amber-200 tracking-wide flex items-center gap-1.5">
                      <Phone className="w-3 h-3" />
                      {hl.contact}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interactive Breathing Guide for Anxiety / Stress */}
          {solution.interactiveTool?.type === 'breathing_sigh' && (
            <div className="mt-4 pt-4 border-t border-cyan-500/20 flex flex-col items-center justify-center space-y-3">
              <div className="text-xs font-medium text-cyan-200 text-center">
                {solution.interactiveTool.instructions}
              </div>
              <div className="relative flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28">
                <motion.div
                  animate={{
                    scale: breathPhase === 'inhale1' ? 1.25 : breathPhase === 'inhale2' ? 1.45 : 0.9,
                    opacity: breathPhase === 'exhale' ? 0.45 : 0.9,
                  }}
                  transition={{ duration: 1.8, ease: 'easeInOut' }}
                  className="absolute inset-0 rounded-full bg-cyan-500/30 blur-md"
                />
                <motion.div
                  animate={{
                    scale: breathPhase === 'inhale1' ? 1.2 : breathPhase === 'inhale2' ? 1.35 : 0.95,
                  }}
                  transition={{ duration: 1.8, ease: 'easeInOut' }}
                  className="w-20 h-20 sm:w-22 sm:h-22 rounded-full bg-gradient-to-br from-cyan-500/40 to-blue-600/40 flex flex-col items-center justify-center text-center p-2"
                >
                  <Wind className="w-5 h-5 text-cyan-300 mb-1 animate-pulse" />
                  <span className="text-[11px] font-bold text-white uppercase tracking-wider">
                    {breathPhase === 'inhale1' && 'Inhale'}
                    {breathPhase === 'inhale2' && 'Inhale +'}
                    {breathPhase === 'exhale' && 'Exhale'}
                  </span>
                </motion.div>
              </div>
            </div>
          )}

          {/* Somatic Check-In Button */}
          {!completedMicroExercise ? (
            <button
              type="button"
              onClick={() => setCompletedMicroExercise(true)}
              className="mt-2 w-full py-2 px-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>I completed this micro-exercise (Check In)</span>
            </button>
          ) : (
            <div className="mt-2 py-1.5 px-3 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Nervous system acknowledged & soothed</span>
            </div>
          )}
        </div>

        {/* Scientific Rationale & Affirmation */}
        <div className="space-y-3 text-xs">
          <div className="text-slate-400 leading-relaxed italic">
            <span className="font-semibold text-slate-300 not-italic">Why This Helps: </span>
            {solution.scientificRationale}
          </div>

          <div className="flex items-center gap-2 p-3 rounded-xl bg-purple-950/30 text-purple-200">
            <Heart className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-medium italic">"{solution.affirmation}"</span>
          </div>
        </div>

        {/* LIVE INTERACTIVE LLM CHAT / FOLLOW-UP SECTION */}
        <div className="pt-4 border-t border-slate-800/80 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-400 uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>Chat with AI About This Feeling</span>
            </div>
            <span className="text-[11px] text-slate-400">Real-Time Dialogue</span>
          </div>

          {/* Suggested Follow-up Prompt Pills */}
          {solution.suggestedFollowUps && solution.suggestedFollowUps.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <HelpCircle className="w-3 h-3 text-slate-400" />
                <span>Suggested questions to ask:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {solution.suggestedFollowUps.map((question, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendFollowUp(question)}
                    disabled={isFollowUpLoading}
                    className="text-xs px-3 py-1.5 rounded-full bg-slate-800/80 hover:bg-cyan-950/50 hover:text-cyan-300 text-slate-300 transition-colors text-left cursor-pointer border border-slate-700/60 disabled:opacity-50"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat Messages Thread */}
          {followUpMessages.length > 0 && (
            <div className="p-4 rounded-2xl bg-slate-950/90 space-y-3 max-h-80 overflow-y-auto">
              {followUpMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col space-y-1 ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                    {msg.role === 'user' ? 'You' : 'AI Mental Health Partner'}
                  </div>
                  <div
                    className={`p-3 rounded-2xl text-xs sm:text-sm leading-relaxed max-w-[90%] whitespace-pre-line ${
                      msg.role === 'user'
                        ? 'bg-cyan-600/30 text-cyan-100 rounded-tr-none'
                        : 'bg-slate-900 text-slate-200 rounded-tl-none border border-slate-800'
                    }`}
                  >
                    {msg.content}
                    {msg.suggestedAction && (
                      <div className="mt-2 pt-2 border-t border-slate-800 text-xs font-semibold text-cyan-300">
                        Action: {msg.suggestedAction}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isFollowUpLoading && (
                <div className="flex items-center gap-2 text-xs text-cyan-400 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Thinking this through...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Follow-up input box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendFollowUp();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={followUpInput}
              onChange={(e) => setFollowUpInput(e.target.value)}
              placeholder="Ask anything (e.g. 'What if I can't calm down?', 'Why is this worse at night?')"
              disabled={isFollowUpLoading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
            />
            <button
              type="submit"
              disabled={!followUpInput.trim() || isFollowUpLoading}
              className="px-4 py-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 disabled:opacity-40 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              {isFollowUpLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Ask AI</span>
            </button>
          </form>
        </div>

        {/* Action Controls: Move to Next Question */}
        <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-800/80">
          <button
            type="button"
            onClick={onEditResponse}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-slate-400 hover:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Edit My Response</span>
          </button>

          <button
            type="button"
            onClick={onContinue}
            disabled={isContinuing}
            aria-busy={isContinuing}
            className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-xl shadow-cyan-500/30 active:scale-98 transition-all cursor-pointer disabled:opacity-90 disabled:cursor-wait"
          >
            {isContinuing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>{isLastQuestion ? 'Preparing Your Synthesis...' : 'Preparing Next Question...'}</span>
              </>
            ) : (
              <>
                <span>
                  {isLastQuestion ? 'Complete Full Mental Health Synthesis' : 'Move to Next Question'}
                </span>
                <ArrowRight className="w-4.5 h-4.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
};
