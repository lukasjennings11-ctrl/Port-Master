const CACHE = 'prismplay-v26';
const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'games/harbor/index.html',
  'games/polis/index.html',
  'games/prism/index.html',
  'games/fuse/index.html',
  'games/stack/index.html',
  'games/orbit/index.html',
  'games/match3/index.html',
  'games/bubble/index.html',
  'games/idle/index.html',
  'games/io/index.html',
  'games/runner/index.html',
  'games/equate/index.html',
  'games/td/index.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: always try the live file (so updated builds show immediately),
// fall back to cache when offline. Keeps the app installable + offline-capable
// without trapping players on a stale build.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(cached =>
        cached || (e.request.mode === 'navigate' ? caches.match('index.html') : Promise.reject('offline'))
      )
    )
  );
});
