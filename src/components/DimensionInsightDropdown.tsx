import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  ChevronDown,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Eye,
  Phone,
  RefreshCw,
} from 'lucide-react';
import { AnswerRecord, DimensionInsight, DimensionScore, NeuroScopeReading, RiskAssessment } from '../types';
import type { RetrievedPassage } from '../utils/researchKnowledge';
import {
  answersForCategory,
  buildLocalDimensionInsight,
  mergePassageLists,
  retrieveDimensionPassages,
} from '../utils/dimensionInsight';

interface DimensionInsightDropdownProps {
  dimension: DimensionScore;
  /** All answers of the run (the dropdown picks out the ones for its own dimension). */
  answers: AnswerRecord[];
  allDimensions: DimensionScore[];
  overallVerdict?: string;
  severityLevel?: string;
  customFeedback?: string;
  riskAssessment?: RiskAssessment;
  /** Research passages the browser retrieved semantically during the screening. */
  researchPassages?: RetrievedPassage[];
  /** Every PRIMARY NeuroScope DistilBERT reading from this run (optional). */
  neuroscopeReadings?: NeuroScopeReading[];
  /** Changes whenever the report is regenerated, so stale briefs are dropped. */
  cacheKey: string;
}

/** Survives re-mounts (e.g. the results view re-rendering) within one page session. */
const insightCache = new Map<string, DimensionInsight>();

type LoadState = 'idle' | 'loading' | 'ready';

const ENGINE_LABELS: Array<{ key: 'gemini' | 'groq' | 'research'; label: string }> = [
  { key: 'gemini', label: 'Gemini' },
  { key: 'groq', label: 'Groq' },
  { key: 'research', label: 'Research library' },
];

export const DimensionInsightDropdown: React.FC<DimensionInsightDropdownProps> = ({
  dimension,
  answers,
  allDimensions,
  overallVerdict,
  severityLevel,
  customFeedback,
  riskAssessment,
  researchPassages,
  neuroscopeReadings,
  cacheKey,
}) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>(() => (insightCache.has(cacheKey) ? 'ready' : 'idle'));
  const [insight, setInsight] = useState<DimensionInsight | null>(() => insightCache.get(cacheKey) ?? null);

  // Guards against a slow response landing after the report was regenerated.
  const activeKeyRef = useRef(cacheKey);
  useEffect(() => {
    activeKeyRef.current = cacheKey;
    const cached = insightCache.get(cacheKey) ?? null;
    setInsight(cached);
    setState(cached ? 'ready' : 'idle');
  }, [cacheKey]);

  const load = useCallback(async () => {
    const key = cacheKey;
    setState('loading');

    const dimAnswers = answersForCategory(answers, dimension.category);
    const riskLevel = riskAssessment?.level;

    // Research ingredient: rank the papers + books for this dimension,
    // boosted by whatever the browser already retrieved semantically.
    const passages = mergePassageLists(
      retrieveDimensionPassages({
        category: dimension.category,
        answers: dimAnswers,
        score: dimension.score,
        riskLevel,
        candidates: researchPassages,
        limit: 6,
      }),
      [],
      6
    );

    let result: DimensionInsight | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 32000);
    try {
      const res = await fetch('/api/dimension-insight', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dimension,
          answers,
          otherDimensions: allDimensions,
          overallVerdict,
          severityLevel,
          customFeedback,
          riskAssessment,
          researchPassages: passages,
          neuroscopeReadings:
            neuroscopeReadings && neuroscopeReadings.length ? neuroscopeReadings : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.insight?.conditionSummary) result = data.insight as DimensionInsight;
      }
    } catch {
      // Falls through to the local research-based brief below.
    } finally {
      clearTimeout(timer);
    }

    if (!result) {
      result = buildLocalDimensionInsight({ dimension, answers: dimAnswers, passages, riskLevel });
    }

    if (activeKeyRef.current !== key) return; // report changed while we were waiting
    if (result.mode !== 'research-local') insightCache.set(key, result);
    setInsight(result);
    setState('ready');
  }, [
    cacheKey,
    answers,
    dimension,
    allDimensions,
    overallVerdict,
    severityLevel,
    customFeedback,
    riskAssessment,
    researchPassages,
    neuroscopeReadings,
  ]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state === 'idle') void load();
  };

  const tone =
    dimension.score >= 75
      ? { chip: 'text-emerald-300', border: 'border-emerald-500/25', bg: 'bg-emerald-500/10 hover:bg-emerald-500/15' }
      : dimension.score >= 50
      ? { chip: 'text-amber-300', border: 'border-amber-500/25', bg: 'bg-amber-500/10 hover:bg-amber-500/15' }
      : { chip: 'text-rose-300', border: 'border-rose-500/25', bg: 'bg-rose-500/10 hover:bg-rose-500/15' };

  const needsSupportCallout = dimension.score < 50 || dimension.status === 'Severe Strain';

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${tone.bg} ${tone.border} ${tone.chip}`}
      >
        <span className="flex items-center gap-2 text-left">
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span>{open ? 'Hide detailed insight' : 'Detailed insight for this area'}</span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-2xl bg-slate-900/70 border border-slate-800/80 p-4 space-y-4">
              {state === 'loading' && <LoadingBlock />}

              {state === 'ready' && insight && (
                <>
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                      In depth · {dimension.category}
                    </div>
                    <h5 className="text-sm font-bold text-white leading-snug">{insight.headline}</h5>
                    <p className="text-xs text-slate-200/90 leading-relaxed">{insight.conditionSummary}</p>
                  </div>

                  {insight.keyObservations.length > 0 && (
                    <Section icon={<Eye className="w-3.5 h-3.5" />} title="What stood out in your answers" accent="text-cyan-300">
                      <ul className="space-y-1.5">
                        {insight.keyObservations.map((item, i) => (
                          <li key={i} className="flex gap-2 text-xs text-slate-200/90 leading-relaxed">
                            <span className="mt-1.5 w-1 h-1 rounded-full bg-cyan-400 shrink-0" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {insight.strengths.length > 0 && (
                      <Section
                        icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        title="What is working"
                        accent="text-emerald-300"
                      >
                        <ul className="space-y-1.5">
                          {insight.strengths.map((item, i) => (
                            <li key={i} className="flex gap-2 text-xs text-slate-200/90 leading-relaxed">
                              <span className="mt-1.5 w-1 h-1 rounded-full bg-emerald-400 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}
                    {insight.watchPoints.length > 0 && (
                      <Section
                        icon={<AlertCircle className="w-3.5 h-3.5" />}
                        title="Worth keeping an eye on"
                        accent="text-amber-300"
                      >
                        <ul className="space-y-1.5">
                          {insight.watchPoints.map((item, i) => (
                            <li key={i} className="flex gap-2 text-xs text-slate-200/90 leading-relaxed">
                              <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-400 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}
                  </div>

                  {insight.researchInsight && (
                    <Section icon={<BookOpen className="w-3.5 h-3.5" />} title="What the research says" accent="text-purple-300">
                      <p className="text-xs text-slate-200/90 leading-relaxed">{insight.researchInsight}</p>
                      {insight.sources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {insight.sources.map((s) => (
                            <span
                              key={s.label}
                              title={s.full}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700 text-[10px] text-slate-300 font-mono"
                            >
                              <span className="text-purple-300">{s.kind === 'book' ? 'BOOK' : 'PAPER'}</span>
                              {s.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </Section>
                  )}

                  {insight.nextSteps.length > 0 && (
                    <Section icon={<Lightbulb className="w-3.5 h-3.5" />} title="Small steps to try this week" accent="text-amber-300">
                      <ol className="space-y-2">
                        {insight.nextSteps.map((item, i) => (
                          <li key={i} className="flex gap-2.5 text-xs text-slate-200/90 leading-relaxed">
                            <span className="w-5 h-5 shrink-0 rounded-full bg-cyan-500/15 text-cyan-300 text-[10px] font-bold flex items-center justify-center">
                              {i + 1}
                            </span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ol>
                    </Section>
                  )}

                  {insight.whenToSeekSupport && (
                    <div
                      className={`rounded-xl p-3 border text-xs leading-relaxed flex gap-2.5 ${
                        needsSupportCallout
                          ? 'bg-rose-950/40 border-rose-500/40 text-rose-100'
                          : 'bg-slate-950/50 border-slate-800 text-slate-200/90'
                      }`}
                    >
                      <Phone className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${needsSupportCallout ? 'text-rose-300' : 'text-cyan-300'}`} />
                      <div>
                        <div
                          className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${
                            needsSupportCallout ? 'text-rose-300' : 'text-cyan-300'
                          }`}
                        >
                          When to reach out for support
                        </div>
                        {insight.whenToSeekSupport}
                      </div>
                    </div>
                  )}

                  {/* Provenance footer: which of the three ingredients contributed */}
                  <div className="pt-2 border-t border-slate-800/80 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mr-1">
                        Built from
                      </span>
                      {ENGINE_LABELS.map(({ key, label }) => {
                        const active = insight.engines[key];
                        return (
                          <span
                            key={key}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              active
                                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                                : 'bg-slate-800/50 border-slate-700 text-slate-500 line-through'
                            }`}
                          >
                            {active && <CheckCircle2 className="w-3 h-3" />}
                            {label}
                          </span>
                        );
                      })}
                      {insight.synthesized && (
                        <span className="text-[10px] text-slate-400 italic ml-1">cross-checked &amp; reconciled</span>
                      )}
                    </div>

                    {insight.mode === 'research-local' && (
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-[11px] text-slate-400 leading-snug">
                          The AI models could not be reached, so this brief comes from your answers and the research
                          library only.
                        </p>
                        <button
                          type="button"
                          onClick={() => void load()}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-cyan-300 transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Try AI again
                        </button>
                      </div>
                    )}

                    <p className="text-[10px] text-slate-500 leading-snug">
                      A screening insight to support reflection — not a diagnosis or a substitute for professional care.
                    </p>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  accent: string;
  children: React.ReactNode;
}> = ({ icon, title, accent, children }) => (
  <div className="space-y-1.5">
    <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${accent}`}>
      {icon}
      <span>{title}</span>
    </div>
    {children}
  </div>
);

const LoadingBlock: React.FC = () => (
  <div className="space-y-3" role="status" aria-live="polite">
    <div className="flex items-center gap-2 text-xs text-cyan-300 font-semibold">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      <span>Combining Gemini, Groq and the research library…</span>
    </div>
    <div className="flex flex-wrap gap-1.5">
      {ENGINE_LABELS.map(({ key, label }) => (
        <span
          key={key}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-800/60 border-slate-700 text-slate-300"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          {label}
        </span>
      ))}
    </div>
    <div className="space-y-2 animate-pulse">
      <div className="h-2.5 rounded bg-slate-800 w-11/12" />
      <div className="h-2.5 rounded bg-slate-800 w-full" />
      <div className="h-2.5 rounded bg-slate-800 w-9/12" />
      <div className="h-2.5 rounded bg-slate-800 w-10/12 mt-3" />
      <div className="h-2.5 rounded bg-slate-800 w-7/12" />
    </div>
  </div>
);
