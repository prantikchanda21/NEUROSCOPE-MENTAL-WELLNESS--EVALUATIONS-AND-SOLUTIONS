import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ExternalLink, Download, Terminal, Globe, Key, Check } from 'lucide-react';

interface NetlifyGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadZip: () => void;
}

export const NetlifyGuideModal: React.FC<NetlifyGuideModalProps> = ({
  isOpen,
  onClose,
  onDownloadZip,
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-slate-900 border border-slate-700/80 p-6 md:p-8 text-slate-100 shadow-2xl space-y-6"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                <Globe className="w-5 h-5 text-cyan-400" />
                Execution & Netlify Hosting Guide
              </h2>
              <p className="text-xs md:text-sm text-slate-400">
                Turnkey instructions to execute locally and publish to Netlify for your hackathon.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick ZIP Download CTA */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-950/40 via-blue-950/40 to-slate-900 border border-cyan-500/30 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-white">Download Complete Source Code</h4>
              <p className="text-xs text-slate-300">
                Ready-to-run repository with full TypeScript setup and configuration.
              </p>
            </div>
            <button
              type="button"
              onClick={onDownloadZip}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 transition-all"
            >
              <Download className="w-4 h-4" />
              Download .ZIP
            </button>
          </div>

          {/* Steps section */}
          <div className="space-y-5 text-xs md:text-sm">
            {/* Step 1: Local Execution */}
            <div className="space-y-2">
              <h3 className="font-bold text-white flex items-center gap-2 text-sm md:text-base">
                <Terminal className="w-4 h-4 text-cyan-400" />
                1. Local Execution Steps
              </h3>
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-cyan-300 space-y-1">
                <div># 1. Unzip the downloaded file</div>
                <div>unzip neuroscope-mental-health-evaluator.zip</div>
                <div>cd neuroscope-mental-health-evaluator</div>
                <div className="pt-1 text-slate-400"># 2. Install all dependencies</div>
                <div className="text-cyan-300">npm install</div>
                <div className="pt-1 text-slate-400"># 3. Add your Gemini / Groq API key</div>
                <div className="text-cyan-300">cp .env.example .env</div>
                <div className="pt-1 text-slate-400"># 4. Launch development server on port 3000</div>
                <div className="text-cyan-300">npm run dev</div>
              </div>
            </div>

            {/* Step 2: Netlify Deployment */}
            <div className="space-y-2">
              <h3 className="font-bold text-white flex items-center gap-2 text-sm md:text-base">
                <Globe className="w-4 h-4 text-purple-400" />
                2. Hosting on Netlify
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <h4 className="font-bold text-cyan-300 text-xs uppercase tracking-wider">
                    Method A: Drag & Drop (Fastest)
                  </h4>
                  <ol className="list-decimal list-inside space-y-1 text-slate-300 text-xs">
                    <li>Run <code className="text-cyan-300">npm run build</code></li>
                    <li>Go to <a href="https://app.netlify.com/drop" target="_blank" rel="noreferrer" className="text-cyan-400 underline">app.netlify.com/drop</a></li>
                    <li>Drag the generated <code className="text-white">dist</code> folder into the browser.</li>
                    <li>Your site is instantly live with zero configuration!</li>
                  </ol>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <h4 className="font-bold text-purple-300 text-xs uppercase tracking-wider">
                    Method B: Git Continuous Deployment
                  </h4>
                  <ol className="list-decimal list-inside space-y-1 text-slate-300 text-xs">
                    <li>Push code to GitHub or GitLab.</li>
                    <li>Import repository in Netlify.</li>
                    <li>Netlify auto-reads <code className="text-cyan-300">netlify.toml</code>.</li>
                    <li>Build command: <code className="text-white">npm run build</code></li>
                    <li>Publish directory: <code className="text-white">dist</code></li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Step 3: Environment Variables */}
            <div className="space-y-2">
              <h3 className="font-bold text-white flex items-center gap-2 text-sm md:text-base">
                <Key className="w-4 h-4 text-amber-400" />
                3. API Keys Configuration
              </h3>
              <p className="text-xs text-slate-300">
                In Netlify Dashboard, navigate to <strong>Site Configuration &gt; Environment Variables</strong> and add:
              </p>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono space-y-1">
                <div><span className="text-emerald-400">GEMINI_API_KEY</span> = <span className="text-slate-400">"your-gemini-api-key"</span> (shared fallback, optional)</div>
                <div><span className="text-purple-400">GROQ_API_KEY</span> = <span className="text-slate-400">"your-groq-api-key"</span> (tone pool, optional)</div>
                <div><span className="text-purple-400">GROQ_API_KEY_2</span> = <span className="text-slate-400">"your-2nd-groq-key"</span> (tone pool fallback, optional)</div>
                <div><span className="text-purple-400">GROQ_API_KEY_3</span> = <span className="text-slate-400">"your-3rd-groq-key"</span> (communication pool, optional)</div>
                <div><span className="text-purple-400">GROQ_API_KEY_4</span> = <span className="text-slate-400">"your-4th-groq-key"</span> (communication pool fallback, optional)</div>
              </div>
              <p className="text-[11px] text-slate-400 italic">
                * GROQ_API_KEY / GROQ_API_KEY_2 power the live tone/emotion read (assessment); GROQ_API_KEY_3 / GROQ_API_KEY_4 power the empathetic write-up (communication) — two independent key pools so one never starves the other's rate limit. NeuroScope includes a built-in mental wellness evaluation engine that automatically works offline even without any API keys!
              </p>
            </div>

            {/* Step 4: Why this matters on Netlify specifically */}
            <div className="space-y-2">
              <h3 className="font-bold text-white flex items-center gap-2 text-sm md:text-base">
                <Terminal className="w-4 h-4 text-rose-400" />
                4. Why Gemini / Groq need a Netlify Function
              </h3>
              <p className="text-xs text-slate-300">
                Netlify's static hosting only serves the built <code className="text-white">dist</code> files — it never runs
                <code className="text-white"> node dist/server.cjs</code>. The <code className="text-cyan-300">/api/*</code> calls
                are handled by <code className="text-white">netlify/functions/api.ts</code> (a Netlify Function), which
                <code className="text-white"> netlify.toml</code> routes <code className="text-cyan-300">/api/*</code> requests to.
                Both the Cloud Run server and this Function share the exact same routes from
                <code className="text-white"> server-app.ts</code>, so no logic is duplicated.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs md:text-sm transition-colors"
            >
              Got It
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
