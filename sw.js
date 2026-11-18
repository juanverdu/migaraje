// Al Día — service worker: funciona sin conexión y se actualiza solo.
const CACHE = 'aldia-1.0.0';
const FILES = ['./', './index.html', './app.js', './styles.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Primero la red (para ver siempre la última versión); si no hay conexión o tarda, la copia guardada.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) cache.put(req, r.clone()); return r; });
    const timeout = new Promise(res => setTimeout(res, 3500));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
    } catch { }
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || net;
  })());
});
