import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { HistoryEntry, getAssessmentHistory, clearAssessmentHistory } from '../utils/historyStorage';
import { AssessmentResult } from '../types';
import { 
  TrendingUp, 
  History, 
  Calendar, 
  ArrowUpRight, 
  ArrowDownRight, 
  Trash2, 
  CheckCircle2, 
  Brain,
  ShieldCheck,
  RotateCcw
} from 'lucide-react';

interface LongitudinalHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentResult?: AssessmentResult;
}

export const LongitudinalHistoryModal: React.FC<LongitudinalHistoryModalProps> = ({
  isOpen,
  onClose,
  currentResult,
}) => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (isOpen) {
      setHistory(getAssessmentHistory());
    }
  }, [isOpen]);

  const handleClear = () => {
    if (confirm('Clear all local assessment history records?')) {
      clearAssessmentHistory();
      setHistory([]);
    }
  };

  if (!isOpen) return null;

  // Comparison logic if there are at least 2 entries
  const latest = history[0];
  const previous = history[1];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl bg-slate-900 border border-slate-700 p-5 sm:p-7 md:p-8 text-slate-100 shadow-2xl space-y-6"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-purple-500/15 border border-purple-500/40 text-purple-300">
                <History className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
                  <span>Longitudinal Assessment History & Progress Delta</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-400">
                  Track how your mental health equilibrium and resilience evolve across screening check-ins.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Delta Progress Comparison Banner (if multiple evaluations) */}
          {latest && previous && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-950/40 via-indigo-950/40 to-slate-900 border border-purple-500/30 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-purple-300">
                <span className="flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                  <span>Progress Comparison Delta (Latest vs. Prior Check-In)</span>
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {new Date(latest.timestamp).toLocaleDateString()} vs {new Date(previous.timestamp).toLocaleDateString()}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {latest.dimensionalScores.map((dim, idx) => {
                  const prevScore = previous.dimensionalScores.find((p) => p.category === dim.category)?.score || 50;
                  const delta = dim.score - prevScore;
                  const isPositive = delta >= 0;

                  return (
                    <div key={idx} className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                      <div className="text-[11px] text-slate-400 truncate">{dim.category}</div>
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono font-bold text-white text-sm">{dim.score}%</span>
                        <span className={`text-[11px] font-mono flex items-center font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isPositive ? '+' : ''}{delta}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timeline List of Saved Assessments */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>Saved Historical Check-Ins ({history.length})</span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-rose-400 hover:text-rose-300 text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear History</span>
                </button>
              )}
            </h3>

            {history.length === 0 ? (
              <div className="text-center py-10 rounded-2xl bg-slate-950/50 border border-slate-800/80 space-y-2 text-slate-400">
                <Brain className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-sm font-medium">No previous assessments saved yet.</p>
                <p className="text-xs text-slate-500">
                  Each completed assessment or custom recalibration is automatically saved here locally in your browser.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                {history.map((entry, idx) => (
                  <div
                    key={entry.id || idx}
                    className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/90 hover:border-slate-700 transition-all flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
                          <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                          {new Date(entry.timestamp).toLocaleDateString()} {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                          entry.severityLevel === 'optimal'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : entry.severityLevel === 'mild'
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                            : entry.severityLevel === 'moderate'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        }`}>
                          {entry.severityLevel}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-white">{entry.verdict}</h4>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex gap-1.5">
                        {entry.dimensionalScores.map((d, sIdx) => (
                          <div
                            key={sIdx}
                            title={`${d.category}: ${d.score}%`}
                            className="w-5 h-8 rounded bg-slate-800 relative overflow-hidden"
                          >
                            <div
                              className="absolute bottom-0 inset-x-0 bg-cyan-400"
                              style={{ height: `${d.score}%` }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs text-slate-400">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <span>100% Private • Stored strictly on your device</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors cursor-pointer"
            >
              Close History
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
