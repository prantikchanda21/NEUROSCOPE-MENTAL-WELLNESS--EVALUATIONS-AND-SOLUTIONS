/**
 * Zero-touch runtime translation engine.
 *
 * Walks the rendered DOM, collects user-visible English strings, batches them to
 * /api/translate, and swaps them in place. A MutationObserver plus a low-cost
 * reconcile sweep keep newly rendered content (AI answers, modals, the results
 * dashboard) translated, and keep it translated after React re-renders.
 *
 * Per-node bookkeeping (the important part):
 *   Every text node we touch gets a record { raw, out, lang }.
 *     raw  = the ENGLISH source React rendered
 *     out  = exactly what we last wrote into the node
 *     lang = the language `out` is in
 *   On each sweep we compare the node's current value against `out`:
 *     - equal     -> we own it; re-translate from `raw` if the language changed
 *     - not equal -> React re-rendered it; treat the new value as a fresh `raw`
 *   This makes switching Kannada -> Hindi -> English fully reversible, and means
 *   the dashboard updates on every switch instead of freezing on the first one.
 *
 * Guarantees so that NO existing feature breaks:
 *  - Only Text nodes and a whitelist of attributes are ever touched.
 *  - Canvas / SVG / WebGL / audio / animation code is never inspected.
 *  - Values the user typed (input/textarea) are never modified.
 *  - Failures are never cached, so a dropped request simply retries later.
 */

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'CODE', 'PRE', 'CANVAS', 'SVG', 'PATH', 'TEXTAREA',
  'INPUT', 'NOSCRIPT', 'IFRAME', 'VIDEO', 'AUDIO', 'MATH',
]);

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

interface Rec { raw: string; out: string; lang: string; }

const textState = new WeakMap<Text, Rec>();
const attrState = new WeakMap<Element, Record<string, Rec>>();

let currentLang = 'en';
let currentLangName = 'English';
let observer: MutationObserver | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let applying = false;
let sweepTimer: ReturnType<typeof setTimeout> | null = null;
let listeners: Array<(busy: boolean) => void> = [];
let inFlight = 0;
let unavailableUntil = 0;                       // provider not configured: stop asking for a while
const inflightKeys = new Set<string>();         // lang\0source currently being fetched
const retryAfter = new Map<string, number>();   // lang\0source -> earliest retry time (failures)

/* ------------------------------------------------------------------ cache */

// v2 namespace: earlier versions could cache failed translations as English forever.
const CACHE_PREFIX = 'ns_i18n2_';
try {
  for (const k of Object.keys(localStorage)) if (k.startsWith('ns_i18n_')) localStorage.removeItem(k);
} catch { /* storage unavailable */ }

const memCache = new Map<string, Map<string, string>>(); // lang -> (source -> output)

function cacheFor(lang: string): Map<string, string> {
  let m = memCache.get(lang);
  if (m) return m;
  m = new Map();
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + lang);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const k of Object.keys(obj)) m.set(k, obj[k]);
    }
  } catch { /* storage unavailable — run memory-only */ }
  memCache.set(lang, m);
  return m;
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
function persist(lang: string) {
  if (persistTimers.has(lang)) return;
  persistTimers.set(lang, setTimeout(() => {
    persistTimers.delete(lang);
    try {
      localStorage.setItem(CACHE_PREFIX + lang, JSON.stringify(Object.fromEntries(cacheFor(lang))));
    } catch { /* quota exceeded — stay memory-only */ }
  }, 1000));
}

/* ------------------------------------------------------------- eligibility */

/** Any string with at least one letter in any script, that isn't pure data. */
function isTranslatable(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 4000) return false;
  if (!/\p{L}/u.test(t)) return false;               // digits, emoji, symbols only
  if (/^[\d\s.,:%/+\-()]+$/.test(t)) return false;   // scores and numbers
  if (/^(https?:\/\/|www\.)/i.test(t)) return false; // URLs
  return true;
}

function skipNode(node: Node): boolean {
  let el: Element | null =
    node.nodeType === 3 ? (node.parentElement as Element | null) : (node as Element);
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.hasAttribute?.('data-no-translate')) return true;
    if (el.namespaceURI === 'http://www.w3.org/2000/svg') return true;
    el = el.parentElement;
  }
  return false;
}

/* ------------------------------------------------------------------ sweep */

interface Plan {
  writes: Array<() => void>;
  needed: Map<string, number>; // source string -> priority (0 = on screen, 1 = off screen)
}

function inView(el: Element | null): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < (window.innerHeight || 800) && r.width > 0;
}

/**
 * Resolve one tracked slot (a text node or an attribute). Returns the updated
 * record, and queues either a write (translation cached) or a fetch (not yet).
 */
function planSlot(
  cur: string,
  rec: Rec | undefined,
  lang: string,
  plan: Plan,
  el: Element | null,
  write: (value: string, raw: string, out: string, outLang: string) => void
): Rec | undefined {
  // If React overwrote what we last wrote, treat the new value as fresh source.
  const owned = !!rec && rec.out === cur;
  const raw = owned ? rec!.raw : cur;

  if (!isTranslatable(raw)) return rec;

  // Back to English: restore the original if we changed it; otherwise nothing to track.
  if (lang === 'en') {
    if (owned && cur !== raw) {
      plan.writes.push(() => write(raw, raw, raw, 'en'));
      return { raw, out: raw, lang: 'en' };
    }
    return owned ? rec : undefined;
  }

  // Already showing the correct language.
  if (owned && rec!.lang === lang) return rec;

  const key = raw.trim();
  const val = cacheFor(lang).get(key);
  if (val === undefined) {
    const prio = plan.needed.get(key);
    if (prio !== 0) plan.needed.set(key, inView(el) ? 0 : 1);
    return rec;
  }

  // Function replacer: translations containing "$&", "$1" etc. must stay literal.
  const next = raw.replace(key, () => val);
  if (next !== cur) plan.writes.push(() => write(next, raw, next, lang));
  return { raw, out: next, lang };
}

const ATTR_SELECTOR = ATTRS.map((a) => `[${a}]`).join(',');

function buildPlan(root: Node, lang: string): Plan {
  const plan: Plan = { writes: [], needed: new Map() };
  if (!(root instanceof Element) && root.nodeType !== 9) return plan;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    const cur = tn.nodeValue || '';
    const rec = textState.get(tn);
    if (rec && rec.out === cur && rec.lang === lang) continue; // fast path: already correct
    if (!cur.trim() || skipNode(tn)) continue;
    const next = planSlot(cur, rec, lang, plan, tn.parentElement, (value, raw, out, outLang) => {
      tn.nodeValue = value;
      textState.set(tn, { raw, out, lang: outLang });
    });
    if (next) textState.set(tn, next);
  }

  // Only elements that actually carry a translatable attribute (not every element).
  const els = (root as Element).querySelectorAll?.(ATTR_SELECTOR);
  if (els) {
    els.forEach((el) => {
      if (el.closest?.('[data-no-translate]')) return;
      const store = attrState.get(el) || {};
      let touched = false;
      for (const a of ATTRS) {
        const cur = el.getAttribute(a);
        if (!cur) continue;
        const prev = store[a];
        if (prev && prev.out === cur && prev.lang === lang) continue;
        const next = planSlot(cur, prev, lang, plan, el, (value, raw, out, outLang) => {
          el.setAttribute(a, value);
          const s = attrState.get(el) || {};
          s[a] = { raw, out, lang: outLang };
          attrState.set(el, s);
        });
        if (next) { store[a] = next; touched = true; }
      }
      if (touched) attrState.set(el, store);
    });
  }
  return plan;
}

function runPlan(plan: Plan) {
  if (!plan.writes.length) return;
  applying = true;
  try {
    plan.writes.forEach((f) => f());
  } finally {
    // Release on the next task so our own mutation records are ignored.
    setTimeout(() => { applying = false; }, 0);
  }
}

/* -------------------------------------------------------------- transport */

function notify() { listeners.forEach((fn) => fn(inFlight > 0)); }

const MAX_PARALLEL = 6;     // browsers run ~6 requests per host at once; more would queue in waves
const MAX_ITEMS = 30;       // hard caps per request (server splits anything larger)
const MAX_CHARS = 2800;
const RETRY_MS = 6000;

/**
 * Split into a few EVEN batches (balanced by text length, since output time scales with it)
 * so that all parallel requests finish at about the same moment. Keeps priority order.
 */
function makeChunks(keys: string[]): string[][] {
  if (!keys.length) return [];
  const total = keys.reduce((n, k) => n + k.length, 0);
  const n = Math.max(
    Math.ceil(keys.length / MAX_ITEMS),
    Math.ceil(total / MAX_CHARS),
    Math.min(MAX_PARALLEL, Math.ceil(keys.length / 4))
  );
  const target = total / n;
  const chunks: string[][] = [];
  let cur: string[] = [];
  let chars = 0;
  for (const k of keys) {
    const full = cur.length >= MAX_ITEMS || chars + k.length > MAX_CHARS;
    const balanced = chars >= target && chunks.length < n - 1;
    if (cur.length && (full || balanced)) { chunks.push(cur); cur = []; chars = 0; }
    cur.push(k); chars += k.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function sendChunk(chunk: string[], lang: string, langName: string) {
  const ids = chunk.map((k) => lang + '\u0000' + k);
  ids.forEach((id) => inflightKeys.add(id));
  inFlight++; notify();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: chunk, targetLang: lang, targetLanguage: langName }),
      signal: ctl.signal,
    });
    const data = await res.json();
    if (data?.unavailable) unavailableUntil = Date.now() + 60000;
    const out: unknown[] = Array.isArray(data?.translations) ? data.translations : [];
    const cache = cacheFor(lang);
    let stored = false;
    chunk.forEach((src, i) => {
      const v = out[i];
      if (typeof v === 'string' && v.trim()) { cache.set(src, v); stored = true; }
      else retryAfter.set(ids[i], Date.now() + RETRY_MS); // failure: never cache, retry later
    });
    if (stored) persist(lang);
  } catch {
    ids.forEach((id) => retryAfter.set(id, Date.now() + RETRY_MS));
  } finally {
    clearTimeout(timer);
    ids.forEach((id) => inflightKeys.delete(id));
    inFlight--; notify();
    if (inFlight === 0) schedulePaint(); // last batch is back: swap the whole page at once
  }
}

/** Fire all needed chunks in parallel. */
function fetchMissing(keys: string[], lang: string, langName: string) {
  const now = Date.now();
  if (now < unavailableUntil) return;
  const cache = cacheFor(lang);
  const todo = keys.filter((k) => {
    const id = lang + '\u0000' + k;
    return !cache.has(k) && !inflightKeys.has(id) && (retryAfter.get(id) || 0) <= now;
  });
  makeChunks(todo).forEach((c) => { void sendChunk(c, lang, langName); });
}

/* ------------------------------------------------------------- scheduling */

const MAX_HOLD_MS = 4000; // never leave the page untranslated longer than this
let holdSince = 0;

/**
 * One synchronous pass. While strings are still being fetched the swap is HELD, so the
 * page changes language in a single go (no half-translated state). It is released when
 * the last request returns, when nothing is pending (failure / backoff / no provider),
 * or after MAX_HOLD_MS as a safety limit.
 */
function sweep() {
  const lang = currentLang;
  const plan = buildPlan(document.body, lang);
  if (lang === 'en' || !plan.needed.size) { holdSince = 0; runPlan(plan); return; }

  const keys = [...plan.needed.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  fetchMissing(keys, lang, currentLangName);

  if (!holdSince) holdSince = Date.now();
  if (inFlight === 0 || Date.now() - holdSince > MAX_HOLD_MS) {
    holdSince = 0;
    runPlan(plan);
  }
}

/** Throttled (not debounced): continuous animation can never starve translation. */
function scheduleSweep(delay = 50) {
  if (sweepTimer) return;
  sweepTimer = setTimeout(() => { sweepTimer = null; sweep(); }, delay);
}

let paintQueued = false;
function schedulePaint() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => { paintQueued = false; sweep(); });
}

/* ------------------------------------------------------------------- API */

export function onTranslationBusy(fn: (busy: boolean) => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

/** Force a quick re-check — useful right after async content renders. */
export function refreshTranslations() { if (currentLang !== 'en') scheduleSweep(30); }

export function setTranslationLanguage(lang: string, langName: string, rtl = false) {
  currentLang = lang;
  currentLangName = langName;

  document.documentElement.lang = lang;
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';

  observer?.disconnect();
  observer = null;
  if (ticker) { clearInterval(ticker); ticker = null; }

  // Runs for English too, so switching back restores every original string.
  // Cached languages repaint synchronously — this is the instant path.
  sweep();
  scheduleSweep(400); // second pass for content that animates in

  if (lang === 'en') return;

  observer = new MutationObserver((records) => {
    if (applying) return;
    for (const r of records) {
      if (r.type === 'characterData' || r.type === 'attributes' || r.addedNodes.length) {
        scheduleSweep();
        return;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });

  // Safety net for React re-renders that happened during our own writes. The sweep's
  // fast path skips already-correct nodes, so this is cheap.
  ticker = setInterval(() => { if (!document.hidden) sweep(); }, 2000);
}
