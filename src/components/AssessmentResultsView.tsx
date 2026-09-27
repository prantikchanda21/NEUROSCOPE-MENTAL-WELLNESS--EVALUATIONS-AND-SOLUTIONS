import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AssessmentResult, AIProvider, AnswerRecord, NeuroScopeReading, RiskAssessment, SolutionItem } from '../types';
import type { RetrievedPassage } from '../utils/researchKnowledge';
import { DimensionInsightDropdown } from './DimensionInsightDropdown';
import { DEFAULT_HELPLINES, getAlternateProtocols } from '../utils/clinicalEngine';
import { InteractiveNeuroTool } from './InteractiveNeuroTool';
import { NeurochemicalSimulatorModal } from './NeurochemicalSimulatorModal';
import { LongitudinalHistoryModal } from './LongitudinalHistoryModal';
import { ClinicalSummaryReportModal } from './ClinicalSummaryReportModal';
import { ThoughtDefusionModal } from './ThoughtDefusionModal';
import { DailyProtocolTracker } from './DailyProtocolTracker';
import { HelixWaveEffect } from './HelixWaveEffect';
import {
  Brain,
  Heart,
  Sparkles,
  ShieldAlert,
  ChevronRight,
  RotateCcw,
  Volume2,
  VolumeX,
  Send,
  AlertCircle,
  Lightbulb,
  Award,
  BookOpen,
  Phone,
  MessageSquare,
  Globe,
  ExternalLink,
  CheckCircle2,
  Activity,
  Clock,
  RefreshCw,
  Sliders,
  History,
  Download,
  Share2
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface AssessmentResultsViewProps {
  result: AssessmentResult;
  onRetake: () => void;
  onReassess: (customFeedback: string) => Promise<void>;
  isReassessing: boolean;
  provider: AIProvider;
  /** The run's answers — used by the per-dimension "Detailed insight" dropdowns. */
  answers?: AnswerRecord[];
  /** Live dynamic-risk reading captured during the run. */
  riskAssessment?: RiskAssessment;
  /** Research passages retrieved semantically during the run. */
  researchPassages?: RetrievedPassage[];
  /** Every PRIMARY NeuroScope DistilBERT reading from this run — forwarded to
   * the per-dimension insight briefs so the trained model's picture informs
   * each area's Gemini/Groq writing. */
  neuroscopeReadings?: NeuroScopeReading[];
}

export const AssessmentResultsView: React.FC<AssessmentResultsViewProps> = ({
  result,
  onRetake,
  onReassess,
  isReassessing,
  provider,
  answers = [],
  riskAssessment,
  researchPassages,
  neuroscopeReadings,
}) => {
  const [customFeedback, setCustomFeedback] = useState('');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [displayedSolutions, setDisplayedSolutions] = useState<SolutionItem[]>(
    result.personalizedSolutions
  );
  const [expandedSolutionId, setExpandedSolutionId] = useState<string | null>(
    result.personalizedSolutions[0]?.id || null
  );
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [showCrisisDirectory, setShowCrisisDirectory] = useState(false);
  const [showSimulatorModal, setShowSimulatorModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showDefusionModal, setShowDefusionModal] = useState(false);
  const [helixKey, setHelixKey] = useState(0);

  // Sync displayed solutions when result updates
  useEffect(() => {
    setDisplayedSolutions(result.personalizedSolutions);
    setExpandedSolutionId(result.personalizedSolutions[0]?.id || null);
    setActiveToolId(null);
    setHelixKey((prev) => prev + 1);
  }, [result]);

  // Trigger celebration confetti if resilient or completing assessment
  React.useEffect(() => {
    try {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#06b6d4', '#a855f7', '#ec4899', '#38bdf8'],
      });
    } catch {
      // safe fallback
    }
  }, []);

  const handleSpeakMotivation = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    if (isPlayingAudio) {
      window.speechSynthesis.cancel();
      setIsPlayingAudio(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(result.motivationalMessage);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.onend = () => setIsPlayingAudio(false);
    utterance.onerror = () => setIsPlayingAudio(false);

    setIsPlayingAudio(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFeedback.trim() || isReassessing) return;
    setHelixKey((prev) => prev + 1);
    await onReassess(customFeedback.trim());
    setCustomFeedback('');
  };

  const handleExploreAlternates = () => {
    const currentIds = displayedSolutions.map((s) => s.id);
    const alternates = getAlternateProtocols(
      currentIds,
      [],
      result.dimensionalScores,
      result.customFeedbackNote
    );
    if (alternates.length > 0) {
      const nextProto = alternates[0];
      setHelixKey((prev) => prev + 1);
      setDisplayedSolutions((prev) => [nextProto, ...prev]);
      setExpandedSolutionId(nextProto.id);
      setActiveToolId(null);
    }
  };

  const getSeverityBadge = () => {
    switch (result.severityLevel) {
      case 'optimal':
        return { text: 'Optimal Resilience', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
      case 'mild':
        return { text: 'Mild Situational Stress', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' };
      case 'moderate':
        return { text: 'Moderate Psychological Burden', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
      case 'high':
        return { text: 'Substantial Emotional Fatigue', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' };
      case 'critical':
        return { text: 'Priority Care & Support Recommended', color: 'bg-rose-500/25 text-rose-300 border-rose-500/50' };
      default:
        return { text: 'Screening Completed', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' };
    }
  };

  const severityBadge = getSeverityBadge();

  return (
    <motion.div
      key={`dashboard-helix-${helixKey}`}
      initial={{ opacity: 0, scaleY: 0.35, scaleX: 0.9, rotateX: -45, rotateZ: -6, filter: 'blur(8px)' }}
      animate={{ opacity: 1, scaleY: 1, scaleX: 1, rotateX: 0, rotateZ: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full max-w-[1780px] mx-auto space-y-8 pb-16 origin-center [perspective:1200px]"
    >
      {/* Luminous Double Helix Bloom when dashboard changes */}
      <HelixWaveEffect key={`helix-${helixKey}`} variant="fullscreen" duration={1200} />

      {/* Critical Safety Notice if self-harm or acute distress detected */}
      {result.safetyAlert && (
        <div className="p-6 md:p-8 rounded-2xl bg-rose-950/80 border-2 border-rose-500/70 backdrop-blur-xl shadow-2xl shadow-rose-950/60 text-rose-100 space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-8 h-8 text-rose-400 shrink-0 animate-pulse" />
              <div>
                <h3 className="text-xl md:text-2xl font-black tracking-tight text-white">
                  Immediate 24/7 Crisis Care & Safety Support
                </h3>
                <p className="text-xs text-rose-300 font-medium">Free • Confidential • Available Right Now</p>
              </div>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/30 text-white border border-rose-400/50">
              Priority Safety Action
            </span>
          </div>

          <p className="text-sm md:text-base leading-relaxed text-rose-100/90 font-medium">
            {result.safetyAlert.guidance}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-2">
            {result.safetyAlert.helplineNumbers.map((hl, i) => (
              <div
                key={i}
                className="p-4 rounded-xl bg-rose-900/40 border border-rose-600/50 hover:border-rose-400/70 transition-all flex flex-col justify-between space-y-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-rose-300">
                      {hl.region || 'Helpline'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-rose-950/80 text-rose-200 border border-rose-700/60">
                      {hl.type || 'Support'}
                    </span>
                  </div>
                  <h4 className="font-bold text-sm text-white">{hl.name}</h4>
                  <div className="text-base font-mono font-black text-amber-200 tracking-wide">
                    {hl.contact}
                  </div>
                  <p className="text-xs text-rose-200/80 leading-relaxed">{hl.description}</p>
                </div>

                <div className="pt-2 border-t border-rose-700/40 flex items-center gap-2">
                  {hl.contact.includes('14416') || hl.contact.includes('1800') || hl.contact.includes('+91-9820466726') || hl.contact.includes('988') ? (
                    <a
                      href={`tel:${hl.contact.match(/\+?\d[\d\- ]+/)?.[0]?.replace(/[\- ]/g, '') || ''}`}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call Now</span>
                    </a>
                  ) : null}

                  {hl.contact.includes('WhatsApp') || hl.contact.includes('+91 9999 666 555') ? (
                    <a
                      href="https://wa.me/919999666555?text=Hello%20I%20need%20mental%20health%20support"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>WhatsApp Chat</span>
                    </a>
                  ) : null}

                  {hl.contact.includes('741741') ? (
                    <a
                      href="sms:741741?&body=HOME"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all shadow-md"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Text HOME</span>
                    </a>
                  ) : null}

                  {hl.contact.includes('http') ? (
                    <a
                      href={hl.contact}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Visit Directory</span>
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Persistent Crisis & Helpline Resource Access Bar (Always Available) */}
      <div className="rounded-2xl bg-slate-900/60 p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300">
            <Heart className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">24/7 Suicide Prevention & Crisis Helplines (India & Global)</h4>
            <p className="text-xs text-slate-400">
              Immediate confidential support is available toll-free in India (Tele-MANAS <span className="text-amber-300 font-mono font-semibold">14416</span>, Vandrevala WhatsApp <span className="text-amber-300 font-mono font-semibold">+91 9999 666 555</span>, KIRAN <span className="text-amber-300 font-mono font-semibold">1800-599-0019</span>) & worldwide.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCrisisDirectory(!showCrisisDirectory)}
          className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40 transition-all flex items-center gap-1.5"
        >
          <span>{showCrisisDirectory ? 'Hide Crisis Lines' : 'View All Crisis Lines & Text Lines'}</span>
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showCrisisDirectory ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {/* Expandable Crisis Directory for India & Global */}
      <AnimatePresence>
        {showCrisisDirectory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-6 rounded-2xl bg-slate-900/90 border border-slate-700/80 shadow-2xl space-y-4 overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Official Crisis Helplines & Text Lines</h3>
              </div>
              <span className="text-xs text-slate-400">Toll-Free & 24/7</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {DEFAULT_HELPLINES.map((hl, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/70 space-y-2.5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-cyan-300 font-mono font-bold mb-1">
                      <span>{hl.region}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 text-[10px]">{hl.type}</span>
                    </div>
                    <h5 className="font-bold text-sm text-white">{hl.name}</h5>
                    <div className="text-base font-mono font-bold text-amber-300 mt-1">{hl.contact}</div>
                    <p className="text-xs text-slate-300/80 mt-1 leading-relaxed">{hl.description}</p>
                  </div>

                  <div className="pt-2 border-t border-slate-700/50 flex gap-2">
                    {hl.contact.includes('14416') || hl.contact.includes('1800') || hl.contact.includes('+91-9820466726') || hl.contact.includes('988') ? (
                      <a
                        href={`tel:${hl.contact.match(/\+?\d[\d\- ]+/)?.[0]?.replace(/[\- ]/g, '') || ''}`}
                        className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>Call</span>
                      </a>
                    ) : null}

                    {hl.contact.includes('WhatsApp') || hl.contact.includes('+91 9999 666 555') ? (
                      <a
                        href="https://wa.me/919999666555?text=Hello%20I%20need%20mental%20health%20support"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>WhatsApp</span>
                      </a>
                    ) : null}

                    {hl.contact.includes('741741') ? (
                      <a
                        href="sms:741741?&body=HOME"
                        className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Text HOME</span>
                      </a>
                    ) : null}

                    {hl.contact.includes('http') ? (
                      <a
                        href={hl.contact}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold transition-all"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Online</span>
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Full-Width Verdict & Clinical Summary Header */}
      <div className="relative rounded-3xl bg-slate-900/85 backdrop-blur-2xl p-6 md:p-10 shadow-xl overflow-hidden glass-panel">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border ${severityBadge.color}`}>
                {severityBadge.text}
              </span>
              {result.isCustomRevised && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  Custom Recalibrated
                </span>
              )}
            </div>

            {/* Quick Interactive Tool Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowSimulatorModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
              >
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>Neuro Simulator</span>
              </button>

              <button
                type="button"
                onClick={() => setShowHistoryModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-xs font-semibold transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
              >
                <History className="w-3.5 h-3.5 text-purple-400" />
                <span>History & Delta</span>
              </button>

              <button
                type="button"
                onClick={() => setShowReportModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-all cursor-pointer shadow-sm"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Full Report</span>
              </button>
            </div>
          </div>

          {result.isCustomRevised && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-4 rounded-2xl bg-gradient-to-r from-purple-900/50 via-indigo-900/35 to-purple-900/50 border border-purple-400/50 shadow-lg shadow-purple-950/40 space-y-1"
            >
              <div className="flex items-center gap-2 text-purple-300 text-xs font-bold uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span>Personal Expression Integrated • Updated Report & Insights</span>
              </div>
              {result.customFeedbackNote && (
                <p className="text-xs md:text-sm text-purple-100/90 italic font-medium">
                  "{result.customFeedbackNote}"
                </p>
              )}
            </motion.div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 space-y-3">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">
                {result.overallVerdict}
              </h1>
              <p className="text-sm sm:text-base md:text-lg text-slate-200/90 leading-relaxed">
                {result.verdictSummary}
              </p>
            </div>

            {/* Motivational Message Block */}
            <div className="lg:col-span-4 relative p-5 md:p-6 rounded-2xl bg-gradient-to-br from-purple-950/50 via-slate-900/70 to-cyan-950/50 border border-cyan-500/30 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 text-cyan-300 text-[11px] font-bold uppercase tracking-wider">
                    <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>Motivational Audio</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSpeakMotivation}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-xs text-cyan-300 border border-slate-700 transition-colors"
                    title="Listen to motivational audio"
                  >
                    {isPlayingAudio ? (
                      <>
                        <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                        <span>Mute</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Listen</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs md:text-sm text-white font-medium italic leading-relaxed">
                  "{result.motivationalMessage}"
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2-Column Wide Dashboard Grid Filling the Screen */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column (5 cols): 5-Dimensional Mental Health Breakdown */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-3xl bg-slate-900/80 backdrop-blur-2xl p-6 md:p-8 space-y-5 shadow-xl glass-panel">
            <div className="flex items-center gap-3">
              <Brain className="w-6 h-6 text-cyan-400" />
              <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                Biopsychosocial Breakdown
              </h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Equilibrium scores measured across all 20 wellbeing dimensions:
            </p>

            <div className="space-y-4">
              {result.dimensionalScores.map((dim, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-2xl bg-slate-950/50 space-y-2.5 transition-all"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-slate-100">{dim.category}</h4>
                    <span
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                        dim.score >= 75
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : dim.score >= 50
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-rose-500/15 text-rose-300'
                      }`}
                    >
                      {dim.status}
                    </span>
                  </div>

                  {/* Progress Track */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-400 font-mono">
                      <span>Equilibrium Index</span>
                      <span className="text-cyan-300 font-bold">{dim.score}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${dim.score}%` }}
                        transition={{ duration: 0.8, delay: idx * 0.1 }}
                        className={`h-full rounded-full ${
                          dim.score >= 75
                            ? 'bg-gradient-to-r from-teal-500 to-emerald-400'
                            : dim.score >= 50
                            ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                            : 'bg-gradient-to-r from-rose-500 to-pink-500'
                        }`}
                      />
                    </div>
                  </div>

                  <p className="text-xs text-slate-300/85 leading-relaxed">
                    {dim.summary}
                  </p>

                  {/* Detailed, per-area brief: Gemini + Groq + research papers/books combined */}
                  <DimensionInsightDropdown
                    dimension={dim}
                    answers={answers}
                    allDimensions={result.dimensionalScores}
                    overallVerdict={result.overallVerdict}
                    severityLevel={result.severityLevel}
                    customFeedback={result.customFeedbackNote}
                    riskAssessment={riskAssessment ?? result.riskAssessment}
                    researchPassages={researchPassages}
                    neuroscopeReadings={neuroscopeReadings}
                    cacheKey={`${result.timestamp}|${dim.category}|${dim.score}|${dim.summary}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Daily Protocol Habits, Streaks & Gamified Micro-Interventions */}
          <DailyProtocolTracker
            onOpenDefusion={() => setShowDefusionModal(true)}
            onOpenSimulator={() => setShowSimulatorModal(true)}
          />
        </div>

        {/* Right Column (7 cols): Actionable Solutions & Custom Expression Form */}
        <div className="lg:col-span-7 space-y-6">
          {/* Personalized Actionable Solutions */}
          <div className="rounded-3xl bg-slate-900/80 backdrop-blur-2xl p-6 md:p-8 space-y-5 shadow-xl glass-panel">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <Lightbulb className="w-6 h-6 text-amber-400" />
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                    Actionable Neuro-Calibrated Solutions
                  </h2>
                  <p className="text-xs text-slate-400">
                    Evidence-grounded interventions dynamically tailored to your screening inputs.
                  </p>
                </div>
              </div>

              {result.isCustomRevised && (
                <div className="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[11px] font-semibold flex items-center gap-1.5 shadow-sm">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span>Dynamically Recalibrated to Your Expression</span>
                </div>
              )}
            </div>

            <div className="space-y-3.5">
              {displayedSolutions.map((sol) => {
                const isExpanded = expandedSolutionId === sol.id;
                return (
                  <div
                    key={sol.id}
                    className="rounded-2xl bg-slate-950/60 border border-slate-800/80 overflow-hidden transition-all shadow-sm hover:border-slate-700"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedSolutionId(isExpanded ? null : sol.id);
                        if (isExpanded) setActiveToolId(null);
                      }}
                      className="w-full p-4 sm:p-5 flex items-start justify-between gap-4 text-left hover:bg-slate-900/40 transition-colors"
                    >
                      <div className="space-y-2 flex-1 min-w-0">
                        {/* Matched Trigger Badge */}
                        {sol.matchedTrigger && (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-950/50 border border-cyan-500/30 text-[10px] sm:text-[11px] text-cyan-300 font-medium">
                            <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                            <span className="truncate">{sol.matchedTrigger}</span>
                          </div>
                        )}

                        {/* Title */}
                        <h3 className="text-sm sm:text-base font-bold text-white leading-snug">
                          {sol.title}
                        </h3>

                        {/* Metadata Pills */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                            {sol.category}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {sol.difficulty}
                          </span>
                          {sol.timeEstimate && (
                            <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {sol.timeEstimate}
                            </span>
                          )}
                          {sol.interactiveToolType && (
                            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                              Live {sol.interactiveToolType} Tool
                            </span>
                          )}
                        </div>
                      </div>

                      <ChevronRight
                        className={`w-5 h-5 text-slate-400 transition-transform shrink-0 mt-1 ${
                          isExpanded ? 'rotate-90 text-cyan-400' : ''
                        }`}
                      />
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="px-5 pb-5 pt-1 space-y-4 border-t border-slate-800/60"
                        >
                          {/* Neuro-biological target */}
                          {sol.neuroTarget && (
                            <div className="flex items-center gap-2 p-3 rounded-xl bg-indigo-950/25 border border-indigo-500/20 text-xs">
                              <Activity className="w-4 h-4 text-indigo-400 shrink-0" />
                              <div>
                                <span className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                                  Neuro-Target:{' '}
                                </span>
                                <span className="text-slate-200 font-medium">{sol.neuroTarget}</span>
                              </div>
                            </div>
                          )}

                          {/* Step-by-Step Action Items */}
                          <div>
                            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                              Step-by-Step Execution:
                            </h4>
                            <ul className="space-y-2">
                              {sol.actionSteps.map((step, sIdx) => (
                                <li key={sIdx} className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-200">
                                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 font-bold text-[10px] shrink-0 mt-0.5">
                                    {sIdx + 1}
                                  </span>
                                  <span className="leading-relaxed">{step}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Scientific Rationale */}
                          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 space-y-1">
                            <div className="font-semibold text-cyan-400 flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5" />
                              Scientific Rationale
                            </div>
                            <p className="text-slate-300/90 leading-relaxed">
                              {sol.scientificRationale}
                            </p>
                          </div>

                          {/* Interactive Real-Time Tool Integration */}
                          {sol.interactiveToolType && (
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveToolId(activeToolId === sol.id ? null : sol.id)
                                }
                                className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                                  activeToolId === sol.id
                                    ? 'bg-slate-800 text-cyan-300 border border-cyan-500/30 shadow-sm'
                                    : 'bg-gradient-to-r from-cyan-500/15 via-sky-500/15 to-indigo-500/15 text-cyan-200 border border-cyan-500/30 hover:border-cyan-400/60 hover:from-cyan-500/25 hover:to-indigo-500/25'
                                }`}
                              >
                                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                                <span>
                                  {activeToolId === sol.id
                                    ? 'Minimize Interactive Protocol Tool'
                                    : `Launch Interactive ${sol.interactiveToolType.toUpperCase()} Practice`}
                                </span>
                              </button>

                              {activeToolId === sol.id && (
                                <InteractiveNeuroTool
                                  toolType={sol.interactiveToolType}
                                  toolTitle={sol.title}
                                />
                              )}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            {/* Dynamic Protocol Discovery / Shuffle */}
            <button
              type="button"
              onClick={handleExploreAlternates}
              className="w-full py-3 px-4 rounded-2xl bg-slate-950/60 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all group"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-400 group-hover:rotate-180 transition-transform duration-500" />
              <span>Explore Alternate Calibrated Interventions for Your Profile</span>
            </button>
          </div>

          {/* User Re-Expression / Not Satisfied Feature */}
          <div className="rounded-3xl bg-gradient-to-br from-slate-900/90 via-slate-900/80 to-purple-950/40 backdrop-blur-2xl border border-purple-500/30 p-6 md:p-8 space-y-4 shadow-xl glass-panel">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                <Heart className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-bold text-white tracking-tight">
                  Don't Feel Satisfied or Want to Express More?
                </h3>
                <p className="text-xs md:text-sm text-slate-300/90 leading-relaxed mt-1">
                  Standard screening cannot capture every nuance of your lived experience. If you feel anything was missed, misunderstood, or you wish to share deeper personal context, write it below for an instant custom re-calibrated assessment.
                </p>
              </div>
            </div>

            <form onSubmit={handleCustomSubmit} className="space-y-3 pt-2">
              <textarea
                rows={3}
                value={customFeedback}
                onChange={(e) => setCustomFeedback(e.target.value)}
                disabled={isReassessing}
                placeholder="Type your personal thoughts, missed feelings, or what feels unaddressed here..."
                className="w-full rounded-xl bg-slate-950/80 border border-purple-500/30 p-4 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all resize-none disabled:opacity-50"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] text-slate-400">
                  Your feedback is processed with empathy and updates your personalized insights instantly.
                </span>
                <button
                  type="submit"
                  disabled={!customFeedback.trim() || isReassessing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 active:scale-98 text-white text-xs md:text-sm font-semibold shadow-lg shadow-purple-600/20 disabled:opacity-40 transition-all cursor-pointer"
                >
                  {isReassessing ? (
                    <>
                      <Brain className="w-4 h-4 animate-spin" />
                      <span>Recalibrating Assessment...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Submit Custom Expression</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Footer Actions: Retake Assessment */}
      <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={onRetake}
          className="flex items-center gap-2 px-6 py-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 text-xs md:text-sm font-semibold transition-colors cursor-pointer"
        >
          <RotateCcw className="w-4 h-4 text-cyan-400" />
          Retake Assessment
        </button>

        <div className="text-xs text-slate-400 font-mono">
          NeuroScope Mental Health Screening Complete
        </div>
      </div>

      {/* 1. Neurochemical Simulator Modal */}
      <NeurochemicalSimulatorModal
        isOpen={showSimulatorModal}
        onClose={() => setShowSimulatorModal(false)}
      />

      {/* 2. Longitudinal Assessment History & Delta Modal */}
      <LongitudinalHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        currentResult={result}
      />

      {/* 3. Exportable Clinical Report & Consultation PDF Modal */}
      <ClinicalSummaryReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        result={result}
      />

      {/* 4. Thought Defusion & Cognitive Dissolver Modal */}
      <ThoughtDefusionModal
        isOpen={showDefusionModal}
        onClose={() => setShowDefusionModal(false)}
      />
    </motion.div>
  );
};
