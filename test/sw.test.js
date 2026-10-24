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

function swHarness() {
  const handlers = {};
  const store = new Map([['https://x.github.io/app.js', 'OLD-JS'], ['https://x.github.io/index.html', 'OLD-INDEX'], ['https://x.github.io/', 'OLD-INDEX'], ['https://x.github.io/icon-192.png', 'CACHED-ICON']]);
  const keyOf = r => (typeof r === 'string' ? 'https://x.github.io/' + r : r.url.replace(/[?].*$/, ''));
  const cache = { match: async r => { const v = store.get(keyOf(r)); return v ? { v } : undefined; }, put: async (r, res) => { store.set(keyOf(r), res.v); } };
  const h = { calls: 0, fetchImpl: async () => ({ ok: true, v: 'NEW', clone() { return this; } }) };
  const ctx = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://x.github.io' }, skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => cache }, Request: class {}, Response, URL, setTimeout, fetch: (...a) => { h.calls++; return h.fetchImpl(...a); },
  };
  vm.runInNewContext(src, ctx);
  const ask = async (url, mode = 'cors') => { let p; handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: x => { p = x; }, waitUntil() {} }); return (await p).v; };
  return { h, ask, store };
}

test('sw.js: the page and the modules come from the same cache generation, without touching the network', async () => {
  const { h, ask } = swHarness();
  assert.equal(await ask('https://x.github.io/', 'navigate'), 'OLD-INDEX');
  assert.equal(await ask('https://x.github.io/?p=AbCdEf123456', 'navigate'), 'OLD-INDEX'); // the link query still hits the shell
  assert.equal(await ask('https://x.github.io/app.js'), 'OLD-JS');
  assert.equal(await ask('https://x.github.io/icon-192.png'), 'CACHED-ICON');
  assert.equal(h.calls, 0, 'nothing may be refreshed into the active generation (that would mix new HTML with old JS)');
  assert.match(src, /michel-v16/);
});

test('sw.js: first visit goes to the network and caches only successful responses; offline first visit fails', async () => {
  const { h, ask, store } = swHarness();
  store.clear();
  assert.equal(await ask('https://x.github.io/logic.js'), 'NEW');
  assert.equal(store.get('https://x.github.io/logic.js'), 'NEW');
  h.fetchImpl = async () => ({ ok: false, status: 503, v: 'ERR-503', clone() { return this; } });
  assert.equal(await ask('https://x.github.io/', 'navigate'), 'ERR-503'); // nothing better to show
  assert.equal(store.get('https://x.github.io/'), undefined); // the error page is not cached
  h.fetchImpl = async () => { throw new Error('offline'); };
  await assert.rejects(ask('https://x.github.io/store.js'));
});

test('sw.js: VERSION is bumped whenever a precached shell file changes', async () => {
  const { shellHash } = await import('../scripts/sw-hash.mjs');
  const now = shellHash();
  const saved = JSON.parse(fs.readFileSync(new URL('./sw-version.json', import.meta.url), 'utf8'));
  assert.equal(now.hash, saved.hash, 'A shell file changed: bump VERSION in sw.js, then run "node scripts/sw-hash.mjs" to update test/sw-version.json.');
  assert.equal(now.version, saved.version, 'VERSION and test/sw-version.json disagree: run "node scripts/sw-hash.mjs".');
});

