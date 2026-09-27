import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { DEFAULT_LANG, findLanguage, LangDef } from './languages';
import { setTranslationLanguage, onTranslationBusy, refreshTranslations } from './autoTranslate';

interface Ctx {
  lang: string;
  langDef: LangDef;
  setLang: (code: string) => void;
  translating: boolean;
}

const LanguageContext = createContext<Ctx>({
  lang: DEFAULT_LANG,
  langDef: findLanguage(DEFAULT_LANG),
  setLang: () => {},
  translating: false,
});

export const useLanguage = () => useContext(LanguageContext);

const STORAGE_KEY = 'ns_lang';

/**
 * Patch window.fetch ONCE so that whenever any /api/* call resolves, a
 * translation sweep is kicked off. AI answers render asynchronously (results
 * dashboard, per-question solutions, follow-up chat) and this guarantees they
 * are picked up the instant they hit the DOM.
 *
 * NOTE: the language is deliberately NOT forwarded to the AI endpoints. The
 * models always answer in English, which gives every string one stable source
 * of truth. That is what makes switching Kannada -> Hindi -> English work on
 * already-rendered results: the engine always re-translates from the English
 * original instead of trying to translate a translation.
 */
let patched = false;
function patchFetch() {
  if (patched || typeof window === 'undefined') return;
  patched = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    try {
      const url = typeof input === 'string' ? input : (input as Request).url || String(input);
      if (url.includes('/api/') && !url.includes('/api/translate')) {
        // Let React commit the response to the DOM first.
        setTimeout(refreshTranslations, 80);
        setTimeout(refreshTranslations, 600);
      }
    } catch { /* never interfere with the request itself */ }
    return res;
  };
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
    } catch {
      return DEFAULT_LANG;
    }
  });
  const [translating, setTranslating] = useState(false);

  const langDef = findLanguage(lang);

  useEffect(() => { patchFetch(); }, []);
  useEffect(() => onTranslationBusy(setTranslating), []);

  useEffect(() => {
    const d = findLanguage(lang);
    setTranslationLanguage(d.code, d.name, !!d.rtl);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch { /* ignore */ }
  }, [lang]);

  const setLang = useCallback((code: string) => setLangState(code), []);

  return (
    <LanguageContext.Provider value={{ lang, langDef, setLang, translating }}>
      {children}
    </LanguageContext.Provider>
  );
};
