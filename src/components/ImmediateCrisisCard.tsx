import React from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, Phone, ArrowRight, Loader2 } from 'lucide-react';
import { PRIORITY_CRISIS_HELPLINES } from '../utils/clinicalEngine';

interface ImmediateCrisisCardProps {
  onContinue: () => void;
  /** True while the next question is being prepared after the button was pressed. */
  isLoading?: boolean;
}

/**
 * Shown immediately after the safety screening question if the answer
 * indicates active self-harm or suicidal thoughts — rather than waiting
 * until the end of the assessment to surface support. Keeps the assessment
 * usable (the person can still continue), but leads with real help first.
 */
export const ImmediateCrisisCard: React.FC<ImmediateCrisisCardProps> = ({ onContinue, isLoading = false }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-3xl bg-rose-950/85 border-2 border-rose-500/70 backdrop-blur-2xl p-6 sm:p-8 shadow-2xl shadow-rose-950/60 text-rose-100 space-y-5"
    >
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-8 h-8 text-rose-400 shrink-0 animate-pulse" />
        <div>
          <h3 className="text-lg sm:text-xl font-black tracking-tight text-white">
            You don&rsquo;t have to go through this alone
          </h3>
          <p className="text-xs text-rose-300 font-medium">Free • Confidential • Available right now</p>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-rose-100/90">
        What you just shared matters, and support is available immediately. If you are in
        danger right now, please contact local emergency services. Otherwise, the people at
        these lines are trained to help and want to hear from you.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRIORITY_CRISIS_HELPLINES.map((hl, i) => (
          <div
            key={i}
            className="p-3.5 rounded-xl bg-rose-900/40 border border-rose-600/50 space-y-1"
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-300">
              {hl.region || 'Helpline'}
            </div>
            <div className="font-bold text-sm text-white">{hl.name}</div>
            <div className="text-sm font-mono font-black text-amber-200 tracking-wide flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />
              {hl.contact}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-rose-200/80 leading-relaxed">
        This assessment is a screening tool, not a diagnosis or emergency service. Reaching out
        to one of the resources above, or to a trusted person near you, is the most important
        next step you can take right now.
      </p>

      <button
        type="button"
        onClick={onContinue}
        disabled={isLoading}
        aria-busy={isLoading}
        className="w-full px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-90 disabled:cursor-wait"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            <span>Preparing next question...</span>
          </>
        ) : (
          <>
            <span>I&rsquo;ve seen this — continue when ready</span>
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </motion.div>
  );
};
