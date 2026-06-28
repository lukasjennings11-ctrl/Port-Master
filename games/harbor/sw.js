/* PortMaster — game-scoped service worker.
   Scope: /games/harbor/. Precaches the full game shell + runtime assets so
   PortMaster installs as a standalone app and runs entirely offline.
   Network-first: always try the live file (so new builds show up immediately),
   fall back to cache when offline. Bump CACHE on every asset/version change. */
const CACHE = 'portmaster-v2';
const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'style.css',
  '../../icon-192.png',
  '../../icon-512.png',
  '../../shared/juice.js?v=1',
  '../../shared/retention.js?v=1',
  '../../shared/portal.js?v=1',
  '../../shared/progression.js?v=1',
  '../../shared/stage.js?v=1',
  'gl.js?v=36',
  'gltf.js?v=36',
  'biomes.js?v=36',
  'assets.js?v=36',
  'models.js?v=36',
  'sim.js?v=36',
  'game.js?v=36',
  'fonts/Fredoka-400.woff2',
  'fonts/Fredoka-600.woff2',
  'fonts/Fredoka-700.woff2',
  'fonts/LilitaOne-400.woff2',
  'assets/building_A.glb',
  'assets/building_B.glb',
  'assets/building_C.glb',
  'assets/building_D.glb',
  'assets/building_E.glb',
  'assets/building_F.glb',
  'assets/building_G.glb',
];

self.addEventListener('install', e => {
  // Cache best-effort: a single missing asset must not abort the whole install.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(PRECACHE.map(u => c.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request).then(m => m || caches.match('index.html')))
  );
});
