import React, { useState } from 'react';
import { motion } from 'motion/react';
import { AssessmentResult } from '../types';
import { Printer, Share2, Download, ShieldCheck, Sparkles, Check, Heart, Brain } from 'lucide-react';

interface ClinicalSummaryReportProps {
  result: AssessmentResult;
  onClose?: () => void;
}

export const ClinicalSummaryReportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  result: AssessmentResult;
}> = ({ isOpen, onClose, result }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleCopyTextSummary = () => {
    const text = `NEUROSCOPE WELLBEING REPORT
Date: ${new Date(result.timestamp).toLocaleString()}
Overall Verdict: ${result.overallVerdict}
Severity Level: ${result.severityLevel.toUpperCase()}

DIMENSIONAL SCORES:
${result.dimensionalScores.map((d) => `- ${d.category}: ${d.score}% (${d.status})`).join('\n')}

SUMMARY:
${result.verdictSummary}

KEY ACTIONABLE PROTOCOLS:
${result.personalizedSolutions.slice(0, 3).map((s, i) => `${i + 1}. ${s.title} (${s.category}) - Target: ${s.neuroTarget || 'N/A'}`).join('\n')}

MOTIVATIONAL ANCHOR:
"${result.motivationalMessage}"
`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl bg-slate-900 border border-slate-700 p-6 sm:p-8 text-slate-100 shadow-2xl space-y-6 print:m-0 print:p-4 print:border-none print:bg-white print:text-black"
      >
        {/* Actions bar (Hidden in Print) */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 print:hidden">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-300">
              <Printer className="w-5 h-5 text-cyan-400" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-white">Summary & Export</h2>
              <p className="text-xs text-slate-400">Formatted summary you can save, print, or share.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyTextSummary}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Text'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Print / Save PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Printable Report Document */}
        <div className="space-y-5 p-6 rounded-2xl bg-slate-950/80 border border-slate-800 text-slate-100 print:bg-white print:text-black print:p-0 print:border-none">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 print:border-slate-300">
            <div>
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-cyan-400 print:text-blue-600" />
                <span className="font-extrabold text-lg tracking-tight">NeuroScope Wellbeing Evaluation</span>
              </div>
              <p className="text-xs text-slate-400 print:text-slate-600">Personal Screening Report</p>
            </div>
            <div className="text-right text-xs text-slate-400 font-mono print:text-slate-600">
              <div>Date: {new Date(result.timestamp).toLocaleDateString()}</div>
              <div>Engine: {result.providerUsed}</div>
            </div>
          </div>

          {/* Verdict Overview */}
          <div className="space-y-1">
            <div className="text-xs font-bold uppercase tracking-wider text-cyan-400 print:text-blue-600">
              Overview & Reflection
            </div>
            <h3 className="text-xl font-black text-white print:text-black">{result.overallVerdict}</h3>
            <p className="text-xs sm:text-sm text-slate-300 print:text-slate-700 leading-relaxed pt-1">
              {result.verdictSummary}
            </p>
          </div>

          {/* Scores Table */}
          <div className="space-y-2 pt-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 print:text-slate-800">
              Dimensional Equilibrium Scores
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {result.dimensionalScores.map((dim, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-900 border border-slate-800 print:bg-slate-50 print:border-slate-300 flex items-center justify-between"
                >
                  <span className="font-medium text-slate-200 print:text-slate-900">{dim.category}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-cyan-300 print:text-blue-700">{dim.score}%</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 print:bg-slate-200 print:text-slate-800 font-semibold">
                      {dim.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Protocols */}
          <div className="space-y-2 pt-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 print:text-slate-800">
              Recommended Somatic & Mind-Body Protocols
            </div>
            <div className="space-y-2">
              {result.personalizedSolutions.slice(0, 3).map((sol, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 print:bg-slate-50 print:border-slate-300 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white print:text-black">{sol.title}</span>
                    <span className="text-[10px] font-mono text-cyan-300 print:text-blue-600">{sol.difficulty}</span>
                  </div>
                  <p className="text-slate-400 print:text-slate-600 text-[11px]">{sol.scientificRationale}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="text-[10px] text-slate-500 border-t border-slate-800 pt-3 flex items-center gap-1.5 print:text-slate-500 print:border-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>
              Disclaimer: NeuroScope is an educational and supportive self-awareness tool. It does not replace a professional diagnosis or medical advice.
            </span>
          </div>
        </div>

        <div className="flex justify-end print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-colors cursor-pointer"
          >
            Close Report
          </button>
        </div>
      </motion.div>
    </div>
  );
};
