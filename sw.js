// ADR-0007：壳资源 cache-first；同源非壳 network-first 回退缓存；字体 SWR
// §3.5：data/packs/ 版本化文件 = cache-first 唯一持久层，不入 SHELL（防 addAll 原子失败）；
//       message 'prefetch-pack' 预下载通道（#7 票接按钮）
const CACHE = 'helian-v0.0.3-dev4';
const SHELL = ['/', '/index.html', '/css/styles.css', '/js/app.js', '/js/courses.js', '/js/data.js', '/js/flypy.js', '/js/parsers.js', '/js/schemes.js', '/js/packs.js', '/js/store.js', '/js/sound.js', '/js/share.js', '/js/zhuyin.js', '/manifest.webmanifest', '/icon.svg', '/og-image.svg', '/licenses.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// 预下载通道：仅接受 /data/packs/ 内同源路径；逐条 fetch → cache.put，经 port 回报
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'prefetch-pack') return;
  const urls = (Array.isArray(d.urls) ? d.urls : [d.url]).filter((u) => {
    if (typeof u !== 'string') return false;
    try {
      const p = new URL(u, location.href);
      return p.origin === location.origin && p.pathname.startsWith('/data/packs/');
    } catch { return false; }
  });
  const port = e.ports && e.ports[0];
  const reply = (msg) => { if (port) port.postMessage(msg); else if (e.source) e.source.postMessage(msg); };
  if (!urls.length) { reply({ type: 'prefetch-pack-done', ok: false, error: '无有效地址' }); return; }
  Promise.all(urls.map(async (u) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`${u} HTTP ${res.status}`);
    (await caches.open(CACHE)).put(u, res);
  })).then(() => reply({ type: 'prefetch-pack-done', ok: true, urls }))
    .catch((err) => reply({ type: 'prefetch-pack-done', ok: false, error: String(err) }));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(e.request).then(hit => {
      const fetched = fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => hit);
      return hit || fetched;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  // data pack：版本化文件名 → cache-first 为唯一持久层（命中即离线可用；未命中联网一次即入缓存）
  if (url.pathname.startsWith('/data/packs/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then(hit => hit || caches.match('/index.html'))));
});
