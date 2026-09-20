/* Here — service worker: يخزّن الواجهة والصور، ويمرّر الـ API مباشرة للشبكة. */
const VERSION = 'here-v1';
const CORE = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'img/logo.svg', 'img/hero.jpg', 'icons/icon-192.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.includes('/api/')) {
    // القائمة: شبكة أولًا مع نسخة احتياطية للعمل بلا اتصال
    if (url.pathname.endsWith('/api/menu')) {
      e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
    }
    return;
  }
  if (url.origin !== location.origin) {
    // الخطوط والمكتبات: مخبأ ثم شبكة
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; }).catch(() => hit)));
    return;
  }
  const isAsset = /\/(img|icons)\//.test(url.pathname);
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return r; }).catch(() => hit || caches.match('index.html'));
      return isAsset && hit ? hit : (hit ? Promise.race([net, new Promise((res) => setTimeout(() => res(hit), 1500))]) : net);
    })
  );
});
