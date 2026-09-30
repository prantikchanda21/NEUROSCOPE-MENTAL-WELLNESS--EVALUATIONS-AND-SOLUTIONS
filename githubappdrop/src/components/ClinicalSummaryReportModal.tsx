import React, { useState } from 'react';
import { motion } from 'motion/react';
import { AssessmentResult } from '../types';
import type { WellnessProfile } from '../utils/wellnessProfileStorage';
import { calculateWellnessBmi } from '../utils/wellnessProfileStorage';
import { Printer, Share2, Download, ShieldCheck, Sparkles, Check, Heart, Brain } from 'lucide-react';

interface ClinicalSummaryReportProps {
  result: AssessmentResult;
  onClose?: () => void;
}

export const ClinicalSummaryReportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  result: AssessmentResult;
  wellnessProfile?: WellnessProfile | null;
}> = ({ isOpen, onClose, result, wellnessProfile }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handlePrint = () => {
    // Print a standalone, A4-friendly document instead of printing the live
    // dashboard/modal. This avoids clipping caused by fixed/max-height/overflow
    // containers and ensures the browser's Save as PDF output is readable.
    const printWindow = window.open('', '_blank', 'width=900,height=1200');
    if (!printWindow) {
      window.alert('Please allow pop-ups for NeuroScope so the report can be printed.');
      return;
    }

    const esc = (value: unknown) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    const formatText = (value: unknown) => esc(value).replace(/\n/g, '<br />');
    const date = new Date(result.timestamp || Date.now());
    const bmi = wellnessProfile ? calculateWellnessBmi(wellnessProfile) : null;
    const severity = result.severityLevel.charAt(0).toUpperCase() + result.severityLevel.slice(1);

    const profileRows = wellnessProfile && wellnessProfile.useForPersonalization !== false
      ? [
          ['Age', wellnessProfile.age !== undefined ? `${wellnessProfile.age} years` : null],
          ['Height', wellnessProfile.heightCm !== undefined ? `${wellnessProfile.heightCm} cm` : null],
          ['Weight', wellnessProfile.weightKg !== undefined ? `${wellnessProfile.weightKg} kg` : null],
          ['BMI reference', bmi !== null ? `${bmi}` : null],
          ['Average sleep', wellnessProfile.sleepHours !== undefined ? `${wellnessProfile.sleepHours} h/night` : null],
          ['Exercise / movement', wellnessProfile.exerciseFrequency],
          ['Caffeine', wellnessProfile.caffeineCups !== undefined ? `${wellnessProfile.caffeineCups} cups/day` : null],
          ['Tobacco / nicotine', wellnessProfile.tobacco && wellnessProfile.tobacco !== 'prefer-not-to-say' ? wellnessProfile.tobacco : null],
          ['Alcohol', wellnessProfile.alcohol && wellnessProfile.alcohol !== 'prefer-not-to-say' ? wellnessProfile.alcohol : null],
        ].filter(([, value]) => value !== null && value !== undefined && value !== '')
      : [];

    const profileExtra = wellnessProfile && wellnessProfile.useForPersonalization !== false
      ? [
          wellnessProfile.medications ? `<div class="note-box"><strong>Recorded medications</strong><div>${formatText(wellnessProfile.medications)}</div></div>` : '',
          wellnessProfile.physicalNotes ? `<div class="note-box"><strong>Physical notes</strong><div>${formatText(wellnessProfile.physicalNotes)}</div></div>` : '',
        ].filter(Boolean).join('')
      : '';

    const scoreRows = result.dimensionalScores.map((dim) => `
      <tr>
        <td>${esc(dim.category)}</td>
        <td class="score">${esc(dim.score)}%</td>
        <td><span class="status">${esc(dim.status)}</span></td>
      </tr>`).join('');

    const solutionBlocks = result.personalizedSolutions.slice(0, 5).map((sol, idx) => `
      <section class="protocol avoid-break">
        <div class="protocol-head">
          <div><span class="protocol-index">${idx + 1}</span><strong>${esc(sol.title)}</strong></div>
          <span class="meta">${esc(sol.difficulty)}</span>
        </div>
        <div class="meta-line">${esc(sol.category)} · Target: ${esc(sol.neuroTarget || 'General wellbeing')}</div>
        <p>${formatText(sol.scientificRationale)}</p>
      </section>`).join('');

    const safetyBlock = result.safetyAlert?.isCritical ? `
      <section class="safety avoid-break">
        <h2>Immediate Support Guidance</h2>
        <p>${formatText(result.safetyAlert.guidance)}</p>
        ${result.safetyAlert.helplineNumbers?.length ? `
          <div class="helplines">
            ${result.safetyAlert.helplineNumbers.map((h) => `<div><strong>${esc(h.name)}</strong>: ${esc(h.contact)}${h.description ? ` — ${esc(h.description)}` : ''}</div>`).join('')}
          </div>` : ''}
      </section>` : '';

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NeuroScope Wellbeing Report - ${date.toLocaleDateString()}</title>
  <style>
    @page { size: A4; margin: 14mm 13mm 16mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report { max-width: 180mm; margin: 0 auto; }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid #111; }
    .brand h1 { margin: 0; font-size: 20px; line-height: 1.15; font-weight: 900; letter-spacing: -.02em; }
    .brand p { margin: 3px 0 0; font-size: 10px; font-weight: 700; color: #333; }
    .meta { font-size: 9px; font-weight: 700; color: #333; text-align: right; }
    h2 { margin: 0 0 6px; font-size: 12px; line-height: 1.25; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; }
    h3 { margin: 3px 0 5px; font-size: 18px; line-height: 1.2; font-weight: 900; }
    p { margin: 0 0 7px; }
    .section { margin-top: 13px; }
    .overview { padding: 10px 12px; border: 1px solid #b7c0ca; border-left: 5px solid #111; border-radius: 8px; }
    .overview .label { font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: .07em; margin-bottom: 3px; }
    .severity { display: inline-block; margin-top: 4px; padding: 3px 8px; border: 1px solid #111; border-radius: 999px; font-size: 9px; font-weight: 900; }
    .profile-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
    .profile-item { padding: 7px 8px; border: 1px solid #cbd5df; border-radius: 7px; background: #f7f9fb; }
    .profile-item .label { display: block; font-size: 8px; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; color: #333; margin-bottom: 2px; }
    .profile-item .value { font-size: 10px; font-weight: 800; }
    .note-box { margin-top: 7px; padding: 8px; border: 1px solid #cbd5df; border-radius: 7px; background: #fafafa; }
    .note-box strong { display: block; margin-bottom: 2px; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 6px 7px; border-bottom: 1px solid #d6dbe1; text-align: left; vertical-align: middle; }
    th { font-size: 8px; text-transform: uppercase; letter-spacing: .06em; font-weight: 900; background: #f0f3f6; }
    td { font-size: 10px; font-weight: 700; }
    th:nth-child(2), td:nth-child(2) { width: 70px; text-align: right; }
    th:nth-child(3), td:nth-child(3) { width: 105px; }
    .score { font-family: Arial, Helvetica, sans-serif; font-weight: 900; }
    .status { display: inline-block; padding: 2px 6px; border: 1px solid #bfc7cf; border-radius: 999px; font-size: 8px; font-weight: 900; }
    .protocol { margin-top: 8px; padding: 9px; border: 1px solid #cbd5df; border-radius: 8px; }
    .protocol-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .protocol-index { display: inline-flex; width: 18px; height: 18px; margin-right: 6px; align-items: center; justify-content: center; border-radius: 50%; background: #111; color: #fff; font-size: 9px; font-weight: 900; }
    .protocol-head strong { font-size: 11px; font-weight: 900; }
    .meta-line { margin-top: 4px; font-size: 8px; font-weight: 800; color: #333; }
    .protocol p { margin-top: 5px; font-size: 9px; font-weight: 600; }
    .safety { margin-top: 12px; padding: 10px; border: 2px solid #111; border-radius: 8px; }
    .helplines { margin-top: 6px; font-size: 9px; }
    .motivation { padding: 10px; border: 1px solid #111; border-radius: 8px; font-weight: 800; }
    .disclaimer { margin-top: 13px; padding-top: 8px; border-top: 1px solid #bfc7cf; color: #333; font-size: 8px; font-weight: 700; }
    .avoid-break { break-inside: avoid; page-break-inside: avoid; }
    .section-title { break-after: avoid; page-break-after: avoid; }
    .footer { margin-top: 12px; font-size: 8px; color: #555; text-align: center; }
    @media print {
      a { color: inherit; text-decoration: none; }
      .report { width: 100%; }
    }
  </style>
</head>
<body>
  <main class="report">
    <header class="brand avoid-break">
      <div>
        <h1>NeuroScope Wellbeing Evaluation</h1>
        <p>Personal screening & supportive wellness report</p>
      </div>
      <div class="meta">
        <div>Date: ${esc(date.toLocaleDateString())}</div>
        <div>Engine: ${esc(result.providerUsed)}</div>
      </div>
    </header>

    <section class="section overview avoid-break">
      <div class="label">Overview & reflection</div>
      <h3>${esc(result.overallVerdict)}</h3>
      <p>${formatText(result.verdictSummary)}</p>
      <span class="severity">Severity: ${esc(severity)}</span>
    </section>

    ${profileRows.length || profileExtra ? `
    <section class="section">
      <h2 class="section-title">Physical & Lifestyle Context</h2>
      <p>These user-provided details are shown as personalization context only. They are not used to calculate the mental-health screening score.</p>
      ${profileRows.length ? `<div class="profile-grid">${profileRows.map(([label, value]) => `<div class="profile-item"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`).join('')}</div>` : ''}
      ${profileExtra}
    </section>` : ''}

    <section class="section">
      <h2 class="section-title">Dimensional Equilibrium Scores</h2>
      <table class="avoid-break">
        <thead><tr><th>Dimension</th><th>Score</th><th>Status</th></tr></thead>
        <tbody>${scoreRows}</tbody>
      </table>
    </section>

    <section class="section">
      <h2 class="section-title">Recommended Protocols</h2>
      ${solutionBlocks || '<p>No protocol recommendations were generated for this session.</p>'}
    </section>

    ${safetyBlock}

    ${result.motivationalMessage ? `<section class="section avoid-break"><h2 class="section-title">Motivational Anchor</h2><div class="motivation">“${formatText(result.motivationalMessage)}”</div></section>` : ''}

    ${result.isCustomRevised && result.customFeedbackNote ? `<section class="section avoid-break"><h2 class="section-title">Personal Expression Integrated</h2><div class="note-box">${formatText(result.customFeedbackNote)}</div></section>` : ''}

    <div class="disclaimer">
      Disclaimer: NeuroScope is an educational and supportive self-awareness tool. It does not replace a professional diagnosis or medical advice. The report reflects the information and responses available during this session.
    </div>
    <div class="footer">NeuroScope · Generated ${esc(date.toLocaleString())}</div>
  </main>
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();

    const doPrint = () => {
      printWindow.print();
      printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true });
    };

    if (printWindow.document.readyState === 'complete') {
      setTimeout(doPrint, 250);
    } else {
      printWindow.addEventListener('load', () => setTimeout(doPrint, 150), { once: true });
    }
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
        data-report-modal
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
