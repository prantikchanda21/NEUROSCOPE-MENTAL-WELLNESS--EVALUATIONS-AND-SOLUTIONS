/* NeuroScope service worker (plain JS, no build step of its own).
 *
 * `vite.config.ts` (plugin "neuroscope-sw") copies this file to /sw.js at build
 * time and fills in the three constants right below with real data:
 *   BUILD_ID    hash of the precache list (changes every deploy)
 *   MODELS_REV  hash of public/models/** (changes only when a model changes)
 *   MANIFEST    { precache: [...], warm: [...] }
 *
 * Strategy
 *  - precache  : app shell (index.html, JS/CSS, icons, small assets). Blocks install.
 *  - warm      : big files (on-device model, big chunks). Downloaded in the background
 *                after the page asks for it, so install stays fast.
 *  - /assets/* : hashed, so cache-first.
 *  - /models/* : cache-first in a separate cache that survives app updates.
 *  - navigation: network-first (3 s), falls back to cached index.html when offline.
 *  - /api/*    : never touched; the app already has its own offline fallbacks.
 *  - Hugging Face hub / Phi-3 / Llama files: never touched; transformers.js keeps those
 *    in its own Cache API store ("transformers-cache").
 */
const BUILD_ID = '__BUILD_ID__';
const MODELS_REV = '__MODELS_REV__';
const MANIFEST = __MANIFEST__;

const PRECACHE = `neuroscope-precache-${BUILD_ID}`;
const MODELS = `neuroscope-models-${MODELS_REV}`;
const RUNTIME = 'neuroscope-runtime-v1';
const FONTS = 'neuroscope-fonts-v1';
const OWNED = [PRECACHE, MODELS, RUNTIME, FONTS];

const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // Not cache.addAll(): one missing file must not abort the whole install.
      await Promise.all(
        MANIFEST.precache.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (res.ok) await cache.put(url, res);
          } catch {
            /* best effort; runtime caching fills the gap */
          }
        }),
      );
      // "/" and "/index.html" are the same document.
      const index = await cache.match('/index.html');
      if (index) await cache.put('/', index.clone());
    })(),
  );
  // No skipWaiting(): a new version waits until old tabs close, so a running page
  // never has its cached files swapped underneath it.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('neuroscope-') && !OWNED.includes(k))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim(); // first visit: control the page that registered us
    })(),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'WARM_CACHE') event.waitUntil(warmCache());
});

/** Background-download large files (model, big chunks) so first offline use just works. */
async function warmCache() {
  if (self.navigator && self.navigator.connection && self.navigator.connection.saveData) return;
  for (const url of MANIFEST.warm) {
    try {
      const cacheName = url.startsWith('/models/') ? MODELS : PRECACHE;
      if (await caches.match(url)) continue; // already stored (here or by transformers.js)
      const res = await fetch(url);
      if (res.ok && res.status === 200) {
        const cache = await caches.open(cacheName);
        await cache.put(url, res);
      }
    } catch {
      /* offline or interrupted: retried on the next visit */
    }
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return; // Cache API cannot serve partial content

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const p = url.pathname;
    if (p.startsWith('/api/') || p === '/sw.js') return; // network only

    if (req.mode === 'navigate') {
      event.respondWith(handleNavigation(req));
    } else if (p.startsWith('/models/')) {
      event.respondWith(modelFile(req, event));
    } else if (p.startsWith('/assets/')) {
      event.respondWith(cacheFirst(req, PRECACHE, event));
    } else {
      event.respondWith(precachedThenNetwork(req, event));
    }
    return;
  }

  // Cross-origin: only the few hosts the app really needs.
  if (url.hostname === 'cdn.jsdelivr.net') {
    // onnxruntime-web wasm/js pulled by transformers.js; versioned URLs, safe to keep.
    event.respondWith(cacheFirst(req, RUNTIME, event));
  } else if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(req, FONTS, event));
  } else if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONTS, event));
  }
  // Everything else (huggingface.co, Google sign-in, ...) goes straight to the network.
});

function cacheable(res) {
  // Opaque (no-cors) responses are accepted only for fonts, which pass through here.
  return res && (res.status === 200 || res.type === 'opaque');
}

async function handleNavigation(req) {
  const cache = await caches.open(PRECACHE);
  try {
    const fresh = await withTimeout(fetch(req), NAV_TIMEOUT_MS);
    if (fresh && fresh.ok) {
      // Keep the shell current for the next offline visit.
      cache.put('/index.html', fresh.clone()).catch(() => {});
      cache.put('/', fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = (await cache.match('/index.html')) || (await cache.match('/'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>NeuroScope offline</title><body style="font-family:system-ui;background:#060a17;color:#e2e8f0;padding:2rem">' +
        '<h1>You are offline</h1><p>Open NeuroScope once while online so it can save itself to this device.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

async function cacheFirst(req, cacheName, event) {
  // Search every cache: this also finds files transformers.js already stored itself.
  const hit = (await caches.match(req)) || (await caches.match(req.url));
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) {
    const copy = res.clone();
    event.waitUntil(caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {}));
  }
  return res;
}

/** Like the server would: an uncached model file that cannot be fetched offline is a plain 404,
 * so transformers.js can skip optional/probe files instead of aborting with a network error. */
async function modelFile(req, event) {
  try {
    return await cacheFirst(req, MODELS, event);
  } catch {
    return new Response(null, { status: 404, statusText: 'Not cached (offline)' });
  }
}

async function precachedThenNetwork(req, event) {
  const cache = await caches.open(PRECACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200) {
      const copy = res.clone();
      event.waitUntil(caches.open(RUNTIME).then((c) => c.put(req, copy)).catch(() => {}));
    }
    return res;
  } catch (err) {
    const fallback = await caches.match(req);
    if (fallback) return fallback;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName, event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (cacheable(res)) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  return (await network) || Response.error();
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
