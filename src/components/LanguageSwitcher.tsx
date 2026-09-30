import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Search, Check, Loader2, ChevronDown } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageProvider';
import { INDIAN_LANGUAGES, INTERNATIONAL_LANGUAGES, LangDef } from '../i18n/languages';

const match = (l: LangDef, q: string) =>
  !q ||
  l.name.toLowerCase().includes(q) ||
  l.native.toLowerCase().includes(q) ||
  l.code.toLowerCase().includes(q);

export const LanguageSwitcher: React.FC = () => {
  const { lang, langDef, setLang, translating } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const q = query.trim().toLowerCase();
  const indian = useMemo(() => INDIAN_LANGUAGES.filter((l) => match(l, q)), [q]);
  const intl = useMemo(() => INTERNATIONAL_LANGUAGES.filter((l) => match(l, q)), [q]);

  const Row = ({ l }: { l: LangDef }) => (
    <button
      type="button"
      onClick={() => {
        setLang(l.code);
        setOpen(false);
        setQuery('');
      }}
      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
        lang === l.code
          ? 'bg-emerald-500/20 text-emerald-200'
          : 'text-slate-200 hover:bg-emerald-500/10'
      }`}
    >
      <span className="flex flex-col min-w-0">
        <span className="text-[13px] font-medium truncate">{l.native}</span>
        <span className="text-[10px] text-slate-400 truncate">{l.name}</span>
      </span>
      {lang === l.code && <Check className="w-3.5 h-3.5 shrink-0 text-emerald-300" />}
    </button>
  );

  return (
    <div className="relative" ref={boxRef} data-no-translate>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change language"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-900/70 border border-emerald-400/40 text-emerald-200 text-[11px] font-semibold hover:bg-emerald-500/15 transition-colors max-w-[160px]"
      >
        {translating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        ) : (
          <Globe className="w-3.5 h-3.5 shrink-0" />
        )}
        <span className="truncate">{langDef.native}</span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[290px] max-h-[65vh] overflow-hidden rounded-2xl border border-emerald-400/30 bg-slate-950/95 backdrop-blur-xl shadow-2xl shadow-emerald-950/40 z-[120] flex flex-col">
          <div className="p-2.5 border-b border-emerald-400/15">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-slate-700/60">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search 140+ languages…"
                className="bg-transparent outline-none text-[12px] text-slate-100 placeholder:text-slate-500 w-full"
              />
            </div>
          </div>

          <div className="overflow-y-auto p-2 space-y-0.5">
            {indian.length > 0 && (
              <>
                <p className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-amber-300/80 font-bold">
                  Indian languages ({indian.length})
                </p>
                {indian.map((l) => <Row key={l.code} l={l} />)}
              </>
            )}
            {intl.length > 0 && (
              <>
                <p className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-wider text-emerald-300/80 font-bold">
                  International ({intl.length})
                </p>
                {intl.map((l) => <Row key={l.code} l={l} />)}
              </>
            )}
            {!indian.length && !intl.length && (
              <p className="px-3 py-6 text-center text-[12px] text-slate-400">No language found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
