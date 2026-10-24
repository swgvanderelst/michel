// Offline app shell, one generation per VERSION (bump it on every release; test/sw-version.json guards that).
// Everything is cache-first from the generation filled at install (index.html, modules, icons, fonts, pinned SDK), so the HTML and the
// JS of one launch always belong together. A new release is picked up when the new worker installs a fresh generation; nothing is
// refreshed into the active one. A first visit (nothing cached) goes to the network and caches successful responses only.
const VERSION = 'michel-v15';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'logic.js', 'store.js', 'store-dev.js', 'store-firebase.js', 'firebase-config.js',
  'vendor/qrcode.js', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'assets/splash.jpg'];
const SDK = 'https://www.gstatic.com/firebasejs/12.0.0/';
const PRECACHE_EXTERNAL = [SDK + 'firebase-app.js', SDK + 'firebase-auth.js', SDK + 'firebase-database.js'];
const CACHED_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))); // bypass the HTTP cache; fail install on a missing shell file
    await Promise.all(PRECACHE_EXTERNAL.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const external = CACHED_HOSTS.includes(url.hostname) || req.url.startsWith(SDK);
  if (!same && !external) return; // Firebase data/auth traffic is never intercepted
  if (same && url.pathname.includes('/api/')) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req, { ignoreSearch: same }); // ?p=TOKEN must still hit the cached shell
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    } catch (err) {
      if (req.mode === 'navigate') { const shell = await c.match('index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});
