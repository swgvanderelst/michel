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

test('sw.js: network-first for navigations and same-origin js/css, cache fallback when offline', async () => {
  const handlers = {};
  const store = new Map([['https://x.github.io/app.js', 'OLD-JS'], ['https://x.github.io/icon-192.png', 'CACHED-ICON']]);
  const cache = {
    match: async r => { const v = store.get(typeof r === 'string' ? 'https://x.github.io/' + r : r.url); return v ? { v } : undefined; },
    put: async (r, res) => { store.set(r.url, res.v); },
  };
  let online = true;
  const ctx = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://x.github.io' }, skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => cache }, Request: class {}, Response,
    fetch: async () => { if (!online) throw new Error('offline'); return { ok: true, v: 'NEW', clone() { return this; } }; },
    URL,
  };
  vm.runInNewContext(src, ctx);
  const ask = async (url, mode = 'cors') => { let p; handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: x => { p = x; }, waitUntil() {} }); return (await p).v; };
  assert.equal(await ask('https://x.github.io/app.js'), 'NEW'); // network wins: versions never mix
  assert.equal(await ask('https://x.github.io/icon-192.png'), 'CACHED-ICON'); // static assets stay cache-first
  online = false;
  assert.equal(await ask('https://x.github.io/app.js'), 'NEW'); // fell back to what the last good load stored
  assert.match(src, /michel-v2/);
});
