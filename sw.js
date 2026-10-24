// Offline app shell, one generation per VERSION (bump it on every release).
// Navigations / index.html: network with a 2.5 s timeout, then the cached copy (the fetch keeps refreshing the cache).
// Same-origin js/css modules: cache-first from the generation filled at install, so index and modules never mix.
// Everything else (icons, fonts, pinned SDK): cache-first.
const VERSION = 'michel-v3';
const NAV_TIMEOUT_MS = self.MICHEL_NAV_TIMEOUT_MS || 2500; // slow network: serve the cached shell after this long
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'logic.js', 'store.js', 'store-dev.js', 'store-firebase.js', 'firebase-config.js',
  'vendor/qrcode.js', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'assets/splash.jpg'];
const SDK = 'https://www.gstatic.com/firebasejs/12.0.0/';
const PRECACHE_EXTERNAL = [SDK + 'firebase-app.js', SDK + 'firebase-auth.js', SDK + 'firebase-database.js'];
const CACHED_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
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
    const isPage = same && (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
    if (isPage) {
      const cached = await c.match(req, { ignoreSearch: true }) || await c.match('index.html');
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
      if (!cached) return net; // first visit: nothing to fall back on
      net.catch(() => {}); // a failed background refresh is fine
      const timer = new Promise(r => setTimeout(() => r(null), NAV_TIMEOUT_MS));
      const winner = await Promise.race([net.catch(() => null), timer]);
      if (winner) return winner;
      e.waitUntil(net.catch(() => {})); // timer won (or offline): serve the cache, let the fetch finish updating it
      return cached;
    }
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
