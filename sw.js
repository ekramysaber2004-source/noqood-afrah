// ============================================================
//   نقود الأفراح — Service Worker
//   Caches all app files for offline use
// ============================================================

const CACHE_NAME = 'afrah-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap',
];

// Install: cache all assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(() => {
        return cache.addAll(ASSETS.filter(a => !a.includes('googleapis')));
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first, fallback to cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(response => {
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(e.request).then(cached => {
        if (cached) return cached;
        if (e.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
