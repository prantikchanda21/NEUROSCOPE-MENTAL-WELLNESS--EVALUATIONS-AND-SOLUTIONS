import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, ChevronDown, Download, HardDriveDownload, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import {
  LOCAL_LLM_APPROX_BYTES,
  LOCAL_LLM_LABEL,
  downloadLocalLlm,
  getLocalLlmState,
  initLocalLlm,
  removeLocalLlm,
  subscribeLocalLlm,
} from '../utils/localLlm';

const gb = (bytes: number) => (bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1);

/**
 * Header dropdown: download Phi-3 mini once, then it runs on the user's own
 * device (also offline) as the fallback reader in the tone ensemble.
 */
export const OfflineModelMenu: React.FC = () => {
  const s = useSyncExternalStore(subscribeLocalLlm, getLocalLlmState, getLocalLlmState);
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initLocalLlm();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setConfirmRemove(false);
  }, [open]);

  const busy = s.status === 'downloading' || s.status === 'loading';
  const pct = Math.round(s.progress * 100);

  const badge =
    s.status === 'ready' ? (
      <span className="h-2 w-2 rounded-full bg-emerald-400" />
    ) : busy ? (
      <Loader2 className="w-3 h-3 animate-spin text-amber-300" />
    ) : s.status === 'error' ? (
      <span className="h-2 w-2 rounded-full bg-rose-400" />
    ) : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Offline AI model"
        title="Offline AI model"
        className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-2 text-slate-600 shadow-sm transition-colors hover:border-emerald-300 hover:text-emerald-700 cursor-pointer"
      >
        <HardDriveDownload className="w-3.5 h-3.5" />
        <span className="hidden md:inline text-[11px] font-semibold">Offline AI</span>
        {badge}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Offline AI model"
          className="absolute right-0 mt-2 w-[min(21rem,calc(100vw-1.5rem))] z-50 rounded-3xl border border-slate-200 bg-white/98 backdrop-blur-xl shadow-2xl shadow-slate-900/10 p-4 text-left"
        >
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-[13px] font-extrabold text-slate-900">{LOCAL_LLM_LABEL} — works offline</p>
              <p className="text-[11px] leading-relaxed text-slate-500 mt-1">
                Download once and a small language model runs on your own device. It helps read the tone of your
                answers when the online AI can&apos;t be reached. What you type is not sent anywhere for it.
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] leading-relaxed text-slate-600">
            NeuroScope and RoBERTa still make the safety decisions. This model can only add a supporting reading, and
            it can never lower a high-risk result.
          </div>

          {/* Status area */}
          <div className="mt-3" aria-live="polite">
            {s.status === 'checking' && (
              <p className="flex items-center gap-2 text-[11px] text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking this device…
              </p>
            )}

            {s.status === 'unsupported' && (
              <p className="flex items-start gap-2 text-[11px] text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Not available on this device. {s.message}</span>
              </p>
            )}

            {s.status === 'idle' && (
              <>
                <button
                  type="button"
                  onClick={() => void downloadLocalLlm()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-800 text-[12px] font-semibold transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download (about {gb(LOCAL_LLM_APPROX_BYTES)} GB)
                </button>
                <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                  Best on Wi-Fi. Needs a recent browser with WebGPU and enough free storage/memory. Some phones may not support the
                  local model yet. You can remove it any time. You can remove it any time.
                </p>
              </>
            )}

            {s.status === 'downloading' && (
              <div>
                <div className="flex justify-between text-[11px] text-slate-600 mb-1.5">
                  <span>Downloading…</span>
                  <span className="font-mono">
                    {pct}% · {gb(s.loadedBytes)} / {gb(LOCAL_LLM_APPROX_BYTES)} GB
                  </span>
                </div>
                <div
                  className="h-1.5 rounded-full bg-slate-800 overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                >
                  <div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[10px] text-slate-500 mt-2">Keep this tab open until it finishes.</p>
              </div>
            )}

            {s.status === 'loading' && (
              <p className="flex items-center gap-2 text-[11px] text-slate-600">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading from this device…
              </p>
            )}

            {s.status === 'ready' && (
              <p className="flex items-center gap-2 text-[11px] text-emerald-700 font-semibold">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Ready — works without internet
              </p>
            )}

            {s.status === 'error' && (
              <div>
                <p className="flex items-start gap-2 text-[11px] text-rose-700">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{s.message || 'Something went wrong.'}</span>
                </p>
                <button
                  type="button"
                  onClick={() => void downloadLocalLlm()}
                  className="mt-2 w-full px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[12px] font-semibold cursor-pointer"
                >
                  Try again
                </button>
              </div>
            )}
          </div>

          {(s.installed || s.status === 'ready' || s.status === 'error') && !busy && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              {!confirmRemove ? (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-rose-300 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove from this device
                </button>
              ) : (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-600">Remove and free the space?</span>
                  <button
                    type="button"
                    onClick={() => {
                      void removeLocalLlm();
                      setConfirmRemove(false);
                    }}
                    className="px-2 py-1 rounded-lg bg-rose-500/20 border border-rose-400/40 text-rose-700 font-semibold cursor-pointer"
                  >
                    Remove
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(false)} className="px-2 py-1 text-slate-400 cursor-pointer">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
