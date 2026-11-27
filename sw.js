/* SchoolFight — 海星國小 大亂鬥 PWA Service Worker (v3 Auto-Update)
 * Strategy:
 * - HTML / CSS / JS / cloud_manifest.json: Network-First (always pulls latest online update immediately)
 * - Sprite Assets (assets/*.webp, *.png): Stale-While-Revalidate (instant TV boot + automatic background update)
 */
const CACHE_NAME = 'schoolfight-pwa-v3';
const CORE_SHELL = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isManifest = url.pathname.endsWith('cloud_manifest.json');
  const isAsset = url.pathname.includes('/assets/') && !isManifest;

  if (isAsset) {
    // Stale-While-Revalidate: instant boot + silent background refresh so updated sprites always sync!
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          const networkPromise = fetch(req, { cache: 'no-cache' })
            .then((resp) => {
              if (resp && resp.status === 200) {
                cache.put(req, resp.clone());
              }
              return resp;
            })
            .catch(() => cached);
          return cached || networkPromise;
        })
      )
    );
    return;
  }

  // Network-First for index.html, style.css, game.js & cloud_manifest.json so online updates apply immediately!
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return resp;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
