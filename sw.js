// ============================================================
//   نقود الأفراح — Service Worker
//   Caches all app files for offline use
// ============================================================

const CACHE_NAME = 'afrah-v6';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

// Install: skip waiting immediately
self.addEventListener('install', e => {
  self.skipWaiting();
});

// Activate: delete all caches to clear corrupt states
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for index and scripts, fallback only if offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co')) return;

  // For app scripts and HTML, try network first. Only use cache if network fails.
  const isWebAsset = e.request.url.includes('app.js') || 
                     e.request.url.includes('index.html') || 
                     e.request.url.includes('manifest.json') ||
                     e.request.destination === 'document';

  if (isWebAsset) {
    e.respondWith(
      fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open('afrah-v7').then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        return caches.match(e.request);
      })
    );
  } else {
    // Normal cache-first for static fonts and library assets
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open('afrah-v7').then(cache => cache.put(e.request, clone));
          }
          return response;
        });
      })
    );
  }
});
