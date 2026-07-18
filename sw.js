// Ankiportable service worker: cache-first for the app shell so it opens
// offline after the first visit. Bump CACHE version to force clients to
// pull fresh assets after a deploy.
const CACHE = 'ankiportable-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon.svg',
  './js/app.js',
  './js/parser.js',
  './js/renderer.js',
  './js/scheduler.js',
  './js/storage.js',
  './vendor/jszip.min.js',
  './vendor/fzstd.js',
  './vendor/sql-wasm.js',
  './vendor/sql-wasm-inline.js',
  './vendor/sql-wasm.wasm',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const resp = await fetch(e.request);
      if (resp.ok && e.request.method === 'GET') {
        const cache = await caches.open(CACHE);
        cache.put(e.request, resp.clone());
      }
      return resp;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});
