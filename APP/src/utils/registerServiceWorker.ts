/**
 * Registers /sw.js (production builds only, so `npm run dev` is never cached).
 *
 * - Asks the browser for persistent storage so the downloaded AI models are not evicted.
 * - After the app has had time to start its own model loading, asks the worker to
 *   download any model/asset files it does not have yet (so the first offline visit works).
 * - Re-checks for a new version when the tab comes back to the foreground.
 */
const WARM_DELAY_MS = 10_000;

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        navigator.storage?.persist?.().catch(() => {});

        navigator.serviceWorker.ready.then((ready) => {
          window.setTimeout(() => ready.active?.postMessage({ type: 'WARM_CACHE' }), WARM_DELAY_MS);
        });

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {});
        });
      })
      .catch((err) => console.warn('[NeuroScope] service worker registration failed:', err));
  });
}
