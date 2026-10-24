import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('sw.js: every precached shell file exists, cache is versioned, SDK version matches the adapter', () => {
  const shell = JSON.parse(/const SHELL = (\[[\s\S]*?\]);/.exec(src)[1].replace(/'/g, '"'));
  for (const f of shell) {
    const rel = f === './' ? 'index.html' : f;
    assert.ok(fs.existsSync(new URL('../' + rel, import.meta.url)), f);
  }
  assert.match(src, /const VERSION = 'michel-v\d+'/);
  const v = /const V = '([\d.]+)'/.exec(fs.readFileSync(new URL('../store-firebase.js', import.meta.url), 'utf8'))[1];
  assert.ok(src.includes(`firebasejs/${v}/`), 'sw.js must pre-cache the pinned SDK version');
});

test('sw.js: parses, cleans old caches, never touches API or Firebase traffic', async () => {
  const handlers = {};
  const ctx = { self: { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://x.github.io' }, skipWaiting() {}, clients: { claim() {} } }, caches: { open: async () => ({ match: async () => new Response('x'), put() {} }) }, Response, URL, Request: class {}, fetch: () => Promise.resolve({ ok: false }) };
  vm.runInNewContext(src, ctx);
  assert.deepEqual(Object.keys(handlers).sort(), ['activate', 'fetch', 'install']);
  let responded = false;
  const ev = u => ({ request: { method: 'GET', url: u, mode: 'cors' }, respondWith() { responded = true; }, waitUntil() {} });
  handlers.fetch(ev('https://michel-a29e3-default-rtdb.europe-west1.firebasedatabase.app/.lp'));
  handlers.fetch(ev('https://x.github.io/api/parties'));
  handlers.fetch({ ...ev('https://x.github.io/app.js'), request: { method: 'POST', url: 'https://x.github.io/app.js' } });
  assert.equal(responded, false);
  handlers.fetch(ev('https://x.github.io/app.js'));
  assert.equal(responded, true);
  await new Promise(r => setTimeout(r, 20));
});

function swHarness({ timeoutMs = 40 } = {}) {
  const handlers = {};
  const store = new Map([['https://x.github.io/app.js', 'OLD-JS'], ['https://x.github.io/index.html', 'OLD-INDEX'], ['https://x.github.io/icon-192.png', 'CACHED-ICON']]);
  const keyOf = r => (typeof r === 'string' ? 'https://x.github.io/' + r : r.url.replace(/\?.*$/, ''));
  const cache = { match: async r => { const v = store.get(keyOf(r)); return v ? { v } : undefined; }, put: async (r, res) => { store.set(keyOf(r), res.v); } };
  const h = { fetchImpl: async () => ({ ok: true, v: 'NEW', clone() { return this; } }) };
  const ctx = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://x.github.io' }, skipWaiting() {}, clients: { claim() {} }, MICHEL_NAV_TIMEOUT_MS: timeoutMs },
    caches: { open: async () => cache }, Request: class {}, Response, URL, setTimeout, fetch: (...a) => h.fetchImpl(...a),
  };
  vm.runInNewContext(src, ctx);
  const waits = [];
  const ask = async (url, mode = 'cors') => { let p; handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: x => { p = x; }, waitUntil: w => waits.push(w) }); return (await p).v; };
  return { h, ask, store, waits };
}

test('sw.js: a fast network gives the fresh page and updates the cache', async () => {
  const { ask, store } = swHarness();
  assert.equal(await ask('https://x.github.io/', 'navigate'), 'NEW');
  assert.equal(store.get('https://x.github.io/'), 'NEW');
});

test('sw.js: a slow network times out to the cached page, and the fetch still refreshes the cache', async () => {
  const { h, ask, store, waits } = swHarness({ timeoutMs: 30 });
  h.fetchImpl = () => new Promise(r => setTimeout(() => r({ ok: true, v: 'LATE', clone() { return this; } }), 150));
  const t0 = Date.now();
  assert.equal(await ask('https://x.github.io/index.html', 'navigate'), 'OLD-INDEX'); // served from the cache
  assert.ok(Date.now() - t0 < 120, 'must not wait for the slow network');
  assert.equal(waits.length, 1); // the fetch is kept alive via waitUntil
  await Promise.all(waits);
  assert.equal(store.get('https://x.github.io/index.html'), 'LATE'); // cache updated for the next start
});

test('sw.js: offline serves the cached page; first visit offline fails; modules come cache-first from the same generation', async () => {
  const { h, ask } = swHarness();
  h.fetchImpl = async () => { throw new Error('offline'); };
  assert.equal(await ask('https://x.github.io/', 'navigate'), 'OLD-INDEX');
  assert.equal(await ask('https://x.github.io/app.js'), 'OLD-JS'); // never touches the network: index and modules stay one generation
  assert.equal(await ask('https://x.github.io/icon-192.png'), 'CACHED-ICON');
  h.fetchImpl = async () => ({ ok: true, v: 'NEW-JS', clone() { return this; } });
  assert.equal(await ask('https://x.github.io/app.js'), 'OLD-JS'); // even online: cache-first, updates arrive with the VERSION bump
  assert.equal(await ask('https://x.github.io/logic.js'), 'NEW-JS'); // a module missing from the cache is fetched
  assert.match(src, /michel-v7/);
});

test('sw.js: VERSION is bumped whenever a precached shell file changes', async () => {
  const { shellHash } = await import('../scripts/sw-hash.mjs');
  const now = shellHash();
  const saved = JSON.parse(fs.readFileSync(new URL('./sw-version.json', import.meta.url), 'utf8'));
  assert.equal(now.hash, saved.hash, 'A shell file changed: bump VERSION in sw.js, then run "node scripts/sw-hash.mjs" to update test/sw-version.json.');
  assert.equal(now.version, saved.version, 'VERSION and test/sw-version.json disagree: run "node scripts/sw-hash.mjs".');
});

test('sw.js: a 5xx page response does not beat the cached shell; without a cache it is passed on', async () => {
  const { h, ask, store } = swHarness();
  h.fetchImpl = async () => ({ ok: false, status: 503, v: 'ERR-503', clone() { return this; } });
  assert.equal(await ask('https://x.github.io/', 'navigate'), 'OLD-INDEX');
  assert.equal(store.get('https://x.github.io/'), undefined); // the error page is not cached
  store.delete('https://x.github.io/index.html');
  assert.equal(await ask('https://x.github.io/', 'navigate'), 'ERR-503'); // first visit: nothing better to show
});
