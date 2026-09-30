/**
 * transformers.js asks for a few OPTIONAL files (generation_config.json, extra chat
 * templates, ...). Online, a missing one answers 404 and is skipped. Offline, the same
 * request throws a network error instead, and that aborts the whole model load even
 * though every REQUIRED file is already in the browser cache.
 *
 * This wraps fetch so that, ONLY while the browser is offline, a failed request to the
 * Hugging Face hub looks like the 404 it would have been. Cached files never reach
 * fetch at all, so nothing else changes. Call it before importing transformers.js.
 */
const HF_HOST = /^https:\/\/([\w-]+\.)*(huggingface\.co|hf\.co)\//i;

let installed = false;

export function installOfflineFetchGuard(): typeof fetch | null {
  const g = globalThis as any;
  if (typeof g.fetch !== 'function') return null;
  if (installed) return g.fetch;
  installed = true;

  const nativeFetch: typeof fetch = g.fetch.bind(globalThis);
  const guarded: typeof fetch = async (input, init) => {
    try {
      return await nativeFetch(input, init);
    } catch (err) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline && HF_HOST.test(url)) {
        return new Response(null, { status: 404, statusText: 'Not cached (offline)' });
      }
      throw err;
    }
  };
  g.fetch = guarded;
  return guarded;
}

/** Some transformers.js builds keep their own reference to fetch on `env`. */
export function applyGuardToEnv(env: any, guarded: typeof fetch | null): void {
  if (env && guarded && 'fetch' in env) env.fetch = guarded;
}
