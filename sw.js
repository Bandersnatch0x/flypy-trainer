const CACHE = 'helian-v3';
const SHELL = ['/', '/index.html', '/css/styles.css', '/js/app.js', '/js/data.js', '/js/flypy.js', '/js/parsers.js', '/js/schemes.js', '/js/store.js', '/js/sound.js', '/js/share.js', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin && !url.hostname.endsWith('gstatic.com')) return;
  if (SHELL.includes(url.pathname) || url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('/index.html'))));
  } else {
    e.respondWith(caches.match(e.request).then(hit => {
      const fetched = fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => hit);
      return hit || fetched;
    }));
  }
});
