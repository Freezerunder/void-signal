// Bumped to v2 when './' stopped being Void Signal and became the launcher —
// the activate handler below deletes every cache that isn't the current name,
// so an already-installed PWA drops its cached copy of the old index.html
// instead of serving the game at the launcher's URL when offline.
const CACHE_NAME = 'void-arcade-v2';
// Deliberately does NOT precache './' or any of the game pages — this is a
// fast-iterating solo project shipped straight to a live site; precaching them
// risks pinning a visitor to a stale build if install happens to land during a
// network hiccup. The network-first fetch handler below populates those cache
// entries after the first successful online load, so offline play still works
// after that.
const PRECACHE = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first so a live deploy is picked up immediately when online;
// fall back to cache so the game still opens offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((cached) =>
          cached || caches.match('./').then((root) => root || caches.match('./index.html'))
        )
      )
  );
});
