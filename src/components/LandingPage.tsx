import React from 'react';
import {
  Brain,
  ShieldCheck,
  MessageSquareText,
  Globe2,
  Sparkles,
  LineChart,
  Waves,
  FlaskConical,
  ClipboardList,
  FileText,
  ArrowRight,
  Lock,
  HeartPulse,
} from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
}

const FEATURES: Array<{
  icon: React.ElementType;
  title: string;
  description: string;
  accent: string;
  steps?: string[];
}> = [
  {
    icon: Brain,
    title: 'Adaptive Clinical Screening',
    description:
      'A 50-question research-grounded pool that adapts in real time to your answers, choosing 5, 10, or 20-question runs tailored to how you respond.',
    accent: 'from-cyan-400/30 to-cyan-400/5 text-cyan-300 border-cyan-400/40',
  },
  {
    icon: MessageSquareText,
    title: 'How Questions & Answers Work',
    description:
      'No multiple-choice boxes — you answer in your own words, and each answer shapes what happens next.',
    steps: [
      'Answer freely in a sentence or two, or tap a quick prompt. Even a short yes or no is read in the context of that question.',
      'Your answer is analysed for tone and meaning, and the next question is chosen from the pool to follow up on what matters most to you.',
      'You get a response matched to how you sounded — encouragement, ways to shift perspective, or support lines when needed.',
    ],
    accent: 'from-emerald-400/30 to-emerald-400/5 text-emerald-300 border-emerald-400/40',
  },
  {
    icon: Sparkles,
    title: 'Per-Answer AI Insight + Research Validation',
    description:
      'Every response gets three freshly composed sections — Empathetic Reflection, Nervous System Insight, and a Cognitive Perspective Shift — each grounded in research passages retrieved for that exact answer.',
    accent: 'from-purple-400/30 to-purple-400/5 text-purple-300 border-purple-400/40',
  },
  {
    icon: LineChart,
    title: 'Biopsychosocial Dashboard',
    description:
      'A full results dashboard breaking your profile down across neural dimensions, with a "Detailed insight" dropdown for each area.',
    accent: 'from-rose-400/30 to-rose-400/5 text-rose-300 border-rose-400/40',
  },
  {
    icon: FlaskConical,
    title: 'Neurochemical Simulator',
    description:
      'An interactive tool modeling dopamine, cortisol, GABA, serotonin and more — see how daily habits shape your neurochemistry.',
    accent: 'from-amber-400/30 to-amber-400/5 text-amber-300 border-amber-400/40',
  },
  {
    icon: Waves,
    title: 'Cognitive Defusion Tools',
    description:
      'Guided thought-dissolving exercises and interactive neuro tools to help regulate in the moment, not just after the report.',
    accent: 'from-sky-400/30 to-sky-400/5 text-sky-300 border-sky-400/40',
  },
  {
    icon: ClipboardList,
    title: 'Daily Protocol Tracker',
    description:
      'Concrete, science-backed daily practices — morning sunlight, physiological sighs, optic-flow walks — tracked day to day.',
    accent: 'from-teal-400/30 to-teal-400/5 text-teal-300 border-teal-400/40',
  },
  {
    icon: FileText,
    title: 'Longitudinal History & Reports',
    description:
      'Track how your profile changes over time and export a clinical summary report you can save, print, or share.',
    accent: 'from-indigo-400/30 to-indigo-400/5 text-indigo-300 border-indigo-400/40',
  },
  {
    icon: Globe2,
    title: '140-Language Support',
    description:
      'Full multilingual interface — 40 Indian languages and 100 international languages, translated live including AI-generated content.',
    accent: 'from-fuchsia-400/30 to-fuchsia-400/5 text-fuchsia-300 border-fuchsia-400/40',
  },
];

const TRUST_POINTS = [
  { icon: ShieldCheck, label: 'Support surfaced the moment it matters' },
  { icon: Lock, label: 'Your data, your device — private by design' },
  { icon: HeartPulse, label: 'Grounded in peer-reviewed research' },
];

export const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted }) => {
  return (
    <div className="w-full max-w-6xl mx-auto py-6 md:py-10">
      {/* Hero */}
      <div
        className="flex flex-col items-center text-center max-w-3xl mx-auto mb-12 md:mb-16 glass-panel rounded-3xl border border-white/10 bg-slate-950/70 backdrop-blur-2xl px-5 py-8 sm:px-10 sm:py-12 shadow-2xl"
      >
        <img
          src="/brand/neuroscope-logo.png"
          alt="NeuroScope logo"
          className="w-24 h-24 sm:w-28 sm:h-28 object-contain drop-shadow-[0_0_22px_rgba(45,212,191,0.55)] mb-5"
        />

        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-xs font-semibold mb-6">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
          Research-grounded • AI-powered • Private
        </div>

        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-white via-emerald-100 to-amber-300 bg-clip-text text-transparent mb-4">
          Understand your mind,
          <br className="hidden sm:block" /> one honest answer at a time
        </h1>
        <p className="text-sm md:text-base text-slate-300 max-w-2xl mx-auto mb-8">
          NeuroScope is an adaptive mental health screening platform that pairs clinical-depth
          questions with real-time AI insight, neuroscience-based tools, and a dashboard that
          actually explains what's going on — grounded in research, not guesswork.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:scale-[1.02] active:scale-[0.99] transition-all"
          >
            <span>Get Started</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
          <div className="text-[11px] text-slate-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Free to start • No commitment • Takes a few minutes</span>
          </div>
        </div>
      </div>

      {/* Feature grid */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 mb-12"
      >
        {FEATURES.map((feature, i) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="glass-panel rounded-2xl p-5 bg-slate-900/70 backdrop-blur-xl border border-white/10 hover:border-white/20 transition-colors"
            >
              <div
                className={`inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr border mb-3 ${feature.accent}`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1.5">{feature.title}</h3>
              <p className="text-xs text-slate-300 leading-relaxed">{feature.description}</p>
              {feature.steps && (
                <ol className="mt-3 space-y-2">
                  {feature.steps.map((step, n) => (
                    <li key={n} className="flex items-start gap-2 text-xs text-slate-300 leading-relaxed">
                      <span className="mt-0.5 inline-flex items-center justify-center w-4 h-4 shrink-0 rounded-full bg-emerald-400/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold">
                        {n + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>

      {/* Trust strip */}
      <div
        className="glass-panel rounded-2xl bg-slate-900/70 backdrop-blur-xl border border-white/10 px-5 py-5 md:px-8 md:py-6 flex flex-col md:flex-row items-center justify-between gap-5"
      >
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {TRUST_POINTS.map((point) => {
            const Icon = point.icon;
            return (
              <div key={point.label} className="flex items-center gap-2 text-xs text-slate-200">
                <Icon className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{point.label}</span>
              </div>
            );
          })}
        </div>
        <button
          onClick={onGetStarted}
          className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white font-semibold text-xs transition-colors"
        >
          <span>Sign in / Create account</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-center text-[11px] text-slate-300 mt-6 max-w-xl mx-auto glass-panel rounded-xl border border-white/10 bg-slate-950/70 backdrop-blur-xl px-4 py-3">
        NeuroScope is a screening and reflection tool, not a diagnostic instrument. If you're in
        crisis or in immediate danger, please contact local emergency services or a crisis line.
      </p>
    </div>
  );
};
