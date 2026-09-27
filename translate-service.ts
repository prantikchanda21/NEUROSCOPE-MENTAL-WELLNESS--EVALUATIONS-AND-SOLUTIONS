// Translation service used by /api/translate.
//
// Goals: fast, correct, and cheap in LLM tokens.
//  - Shared cache (memory + disk): a string is translated at most once per language,
//    for ALL users, and survives restarts.
//  - In-flight de-duplication: concurrent requests for the same string share one LLM call.
//  - Parallel chunks with a global concurrency cap (no sequential round trips).
//  - Correctness: a chunk is only accepted if the model returns exactly N strings.
//    On a count mismatch the chunk is split and retried, so a translation can never
//    be attached to the wrong source string. Provider errors are NOT split (no call storms).
//  - Failures return null (never the English source), so callers never cache a failure.
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Translates `strings` into `language`. Must return one output per input, same order.
 * `langCode` is the BCP-47 tag (e.g. "hi"); `language` is the English name (e.g. "Hindi").
 * Providers that need a code (the keyless web fallback) use `langCode`; LLM prompts use `language`.
 */
export type ModelCall = (strings: string[], language: string, langCode?: string) => Promise<string[] | null>;

const MAX_ITEMS = 30;
const MAX_CHARS = 3000;
const MAX_CONCURRENT_CALLS = 8;
const PER_LANG_LIMIT = 60000;
const CACHE_DIR =
  process.env.TRANSLATION_CACHE_DIR || path.join(os.tmpdir(), 'neuroscope-i18n-v2');

/* ------------------------------------------------------------------ cache */

const memo = new Map<string, Map<string, string>>();
const dirtyLangs = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const safeLang = (code: string) => String(code).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 16) || 'x';
const fileFor = (code: string) => path.join(CACHE_DIR, `${safeLang(code)}.json`);

function langMemo(code: string): Map<string, string> {
  const key = safeLang(code);
  let m = memo.get(key);
  if (m) return m;
  m = new Map();
  try {
    const obj = JSON.parse(fs.readFileSync(fileFor(code), 'utf8')) as Record<string, string>;
    for (const k of Object.keys(obj)) m.set(k, obj[k]);
  } catch { /* no cache yet */ }
  memo.set(key, m);
  return m;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    const langs = [...dirtyLangs];
    dirtyLangs.clear();
    try {
      await fs.promises.mkdir(CACHE_DIR, { recursive: true });
      await Promise.all(
        langs.map((l) =>
          fs.promises.writeFile(fileFor(l), JSON.stringify(Object.fromEntries(langMemo(l))))
        )
      );
    } catch { /* read-only FS: stay memory-only */ }
  }, 1500);
  (flushTimer as any).unref?.();
}

/* ------------------------------------------------------------ concurrency */

let active = 0;
const waitQueue: Array<() => void> = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_CALLS) await new Promise<void>((r) => waitQueue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waitQueue.shift()?.();
  }
}

/* ------------------------------------------------------------------- core */

const inflight = new Map<string, Promise<string | null>>();

async function translateChunk(
  strings: string[],
  language: string,
  langCode: string,
  call: ModelCall
): Promise<Array<string | null>> {
  let out: string[] | null = null;
  try {
    out = await limited(() => call(strings, language, langCode));
  } catch {
    return strings.map(() => null); // provider failure: don't split, client will retry later
  }
  if (out && out.length === strings.length) {
    return out.map((v) => (typeof v === 'string' && v.trim() ? v : null));
  }
  if (strings.length === 1) return [null];
  // Count mismatch: split so alignment is guaranteed, then retry each half.
  const mid = Math.ceil(strings.length / 2);
  const [a, b] = await Promise.all([
    translateChunk(strings.slice(0, mid), language, langCode, call),
    translateChunk(strings.slice(mid), language, langCode, call),
  ]);
  return [...a, ...b];
}

function makeChunks(items: string[]): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let chars = 0;
  for (const s of items) {
    if (cur.length && (cur.length >= MAX_ITEMS || chars + s.length > MAX_CHARS)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(s);
    chars += s.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * Translate a batch. Returns one entry per input: the translation, or null if it
 * could not be translated (caller must NOT cache nulls).
 */
export async function translateBatch(
  texts: string[],
  langCode: string,
  language: string,
  call: ModelCall
): Promise<Array<string | null>> {
  const cache = langMemo(langCode);
  const results: Array<string | null> = new Array(texts.length).fill(null);
  const want = new Map<string, number[]>(); // unique source -> output indices

  texts.forEach((t, i) => {
    const hit = cache.get(t);
    if (hit !== undefined) results[i] = hit;
    else (want.get(t) ?? want.set(t, []).get(t)!).push(i);
  });

  const pending: Promise<void>[] = [];
  const fresh: string[] = [];
  for (const [t, idxs] of want) {
    const k = langCode + '\u0000' + t;
    const shared = inflight.get(k);
    if (shared) pending.push(shared.then((v) => { idxs.forEach((i) => (results[i] = v)); }));
    else fresh.push(t);
  }

  for (const chunk of makeChunks(fresh)) {
    const chunkP = translateChunk(chunk, language, langCode, call);
    chunk.forEach((t, j) => {
      const k = langCode + '\u0000' + t;
      const sp = chunkP.then((r) => {
        const v = r[j];
        if (v && cache.size < PER_LANG_LIMIT) {
          cache.set(t, v);
          dirtyLangs.add(safeLang(langCode));
          scheduleFlush();
        }
        return v;
      });
      inflight.set(k, sp);
      void sp.finally(() => inflight.delete(k));
      pending.push(sp.then((v) => { want.get(t)!.forEach((i) => (results[i] = v)); }));
    });
  }

  await Promise.all(pending);
  return results;
}

/** Tolerant parser: accepts a bare JSON array or {"translations": [...]}. */
export function parseTranslations(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const arr = Array.isArray(parsed) ? parsed : parsed?.translations;
    return Array.isArray(arr) ? arr.map((x: any) => String(x ?? '')) : null;
  } catch {
    return null;
  }
}
