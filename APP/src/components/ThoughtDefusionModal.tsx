import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Trash2, CheckCircle2, RotateCcw, ArrowRight, ShieldCheck } from 'lucide-react';

interface ThoughtDefusionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ThoughtDefusionModal: React.FC<ThoughtDefusionModalProps> = ({ isOpen, onClose }) => {
  const [thoughtText, setThoughtText] = useState('');
  const [isDissolving, setIsDissolving] = useState(false);
  const [isDissolved, setIsDissolved] = useState(false);
  const [reframeText, setReframeText] = useState('');

  if (!isOpen) return null;

  const handleDissolve = () => {
    if (!thoughtText.trim()) return;
    setIsDissolving(true);
    setTimeout(() => {
      setIsDissolving(false);
      setIsDissolved(true);
    }, 2000);
  };

  const handleReset = () => {
    setThoughtText('');
    setIsDissolving(false);
    setIsDissolved(false);
    setReframeText('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-700 p-6 sm:p-8 text-slate-100 shadow-2xl space-y-5"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-purple-500/15 border border-purple-500/40 text-purple-300">
              <Sparkles className="w-5 h-5 text-purple-400" />
            </span>
            <div>
              <h3 className="text-lg font-bold text-white">Cognitive Defusion & Dissolver</h3>
              <p className="text-xs text-slate-400">Detangle from intrusive or ruminative thought loops.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {!isDissolved ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              In Acceptance & Commitment Therapy (ACT), thoughts are not facts—they are transient mental events. Externalize the thought by typing it below, then release it:
            </p>

            <div className="relative">
              <textarea
                rows={3}
                value={thoughtText}
                onChange={(e) => setThoughtText(e.target.value)}
                disabled={isDissolving}
                placeholder='e.g., "I will never catch up with everything" or "Everyone is judging my output"'
                className={`w-full rounded-xl bg-slate-950/90 border p-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-400 transition-all resize-none ${
                  isDissolving
                    ? 'border-purple-500 blur-sm opacity-20 scale-95 transition-all duration-2000'
                    : 'border-slate-800'
                }`}
              />
            </div>

            <div className="flex justify-between items-center pt-2">
              <span className="text-[11px] text-slate-500 italic">
                {isDissolving ? 'Watching thought dissolve into empty space...' : 'Observe without judgment.'}
              </span>

              <button
                type="button"
                onClick={handleDissolve}
                disabled={!thoughtText.trim() || isDissolving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-600/30 disabled:opacity-40 transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDissolving ? 'Dissolving...' : 'Dissolve & Release'}</span>
              </button>
            </div>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4 text-center py-4"
          >
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h4 className="text-base font-bold text-white">Thought Externalized and Released</h4>
              <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                You observed the thought rather than becoming it. You have created cognitive space between stimulus and response.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-left space-y-2">
              <label className="text-xs font-semibold text-cyan-300">
                Anchor an alternative grounded perspective (Optional):
              </label>
              <input
                type="text"
                value={reframeText}
                onChange={(e) => setReframeText(e.target.value)}
                placeholder='e.g., "I am simply experiencing stress right now, and I can take this one step at a time."'
                className="w-full rounded-lg bg-slate-900 border border-slate-700 p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Defuse Another Thought</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all cursor-pointer"
              >
                Return Grounded
              </button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};
