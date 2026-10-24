import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../dev-server.mjs';

const NOW = 1_800_000_000_000;
let srv, base;
before(async () => { srv = await startServer({ port: 0, now: () => NOW }); base = `http://localhost:${srv.port}`; });
after(async () => { await srv.close(); });

const secrets = {};
const sec = async uid => {
  if (!secrets[uid]) {
    const r = await fetch(base + '/api/session', { method: 'POST', body: JSON.stringify({ uid }) });
    secrets[uid] = (await r.json()).secret;
  }
  return secrets[uid];
};
const call = async (uid, method, url, body) => {
  const res = await fetch(base + url, {
    method, headers: { ...(uid ? { 'x-uid': uid, 'x-secret': await sec(uid) } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
let n = 0;
async function party(codes = []) {
  const id = 'party-dev-' + String(++n).padStart(4, '0');
  const r = await call('admin-1', 'POST', '/api/parties', { id, name: 'Test', createdAt: NOW, codes });
  assert.equal(r.status, 201);
  return id;
}

test('auth required, no listing', async () => {
  assert.equal((await call(null, 'GET', '/api/codes/8209')).status, 401);
  assert.equal((await call('admin-1', 'GET', '/api/parties')).status, 404);
  assert.equal((await call('admin-1', 'GET', '/api/codes')).status, 404);
  assert.equal((await call('admin-1', 'GET', '/api/nope')).status, 404);
  assert.equal((await call('admin-1', 'GET', '/api/parties/missing-party-1')).status, 404);
});

test('codes are aliases for one party (two PINs, same party)', async () => {
  const id = await party(['8209', '7815']);
  const a = await call('bob-0001', 'GET', '/api/codes/8209');
  const b = await call('bob-0001', 'GET', '/api/codes/7815');
  assert.deepEqual(a.body, { partyId: id });
  assert.deepEqual(b.body, { partyId: id });
  assert.equal((await call('bob-0001', 'GET', '/api/codes/0000')).status, 404);
  assert.equal((await call('bob-0001', 'GET', '/api/codes/8209x')).status, 404);
  const p = await call('bob-0001', 'GET', '/api/parties/' + id);
  assert.deepEqual(Object.keys(p.body.codes), ['7815', '8209']);
});

test('a taken PIN is rejected; non-admin cannot add a PIN', async () => {
  const id = await party(['4321']);
  const dup = await call('admin-2', 'POST', '/api/parties', { id: 'party-dev-dup1', name: 'X', createdAt: NOW, codes: ['4321'] });
  assert.equal(dup.status, 409);
  assert.equal((await call('admin-1', 'GET', '/api/parties/party-dev-dup1')).status, 404); // nothing half-created
  assert.equal((await call('admin-1', 'POST', `/api/parties/${id}/codes`, { code: '4321', createdAt: NOW })).status, 409);
  assert.equal((await call('mallory-1', 'POST', `/api/parties/${id}/codes`, { code: '1357', createdAt: NOW })).status, 403);
  assert.equal((await call('admin-1', 'GET', '/api/codes/1357')).status, 404);
  assert.equal((await call('admin-1', 'POST', `/api/parties/${id}/codes`, { code: '1357', createdAt: NOW })).status, 201);
  assert.equal((await call('admin-1', 'GET', '/api/codes/1357')).body.partyId, id);
  assert.equal((await call('admin-1', 'POST', `/api/parties/${id}/codes`, { code: 'AB12', createdAt: NOW })).status, 400);
  assert.equal((await call('admin-1', 'POST', `/api/parties/${id}/codes`, { code: '12345', createdAt: NOW })).status, 400);
});

test('digits only: codes with letters are rejected at creation', async () => {
  const bad = await call('admin-1', 'POST', '/api/parties', { id: 'party-dev-bad1', name: 'X', createdAt: NOW, codes: ['abcd'] });
  assert.equal(bad.status, 400);
});

test('party creation validation', async () => {
  const ok = { id: 'party-dev-val1', name: 'N', createdAt: NOW };
  for (const patch of [{ id: 'bad id' }, { name: '' }, { name: 'x'.repeat(31) }, { createdAt: 'now' }, { createdAt: NOW + 6 * 60000 }, { extra: 1 }, { codes: 'x' }, { codes: ['1111', '1111'] }]) {
    assert.equal((await call('admin-1', 'POST', '/api/parties', { ...ok, ...patch })).status, 400, JSON.stringify(patch));
  }
  assert.equal((await call('admin-1', 'POST', '/api/parties', { ...ok, name: 'x'.repeat(30) })).status, 201);
  assert.equal((await call('other-uid', 'POST', '/api/parties', { ...ok, name: 'again' })).status, 403); // id exists
  const res = await fetch(base + '/api/parties', { method: 'POST', headers: { 'x-uid': 'admin-1' }, body: '{nope' });
  assert.equal(res.status, 400);
});

test('friends and max: admin only, validated', async () => {
  const id = await party();
  const f = `/api/parties/${id}/friends`;
  assert.equal((await call('bob-0001', 'POST', f, { name: 'Sanne', createdAt: NOW })).status, 403);
  const ok = await call('admin-1', 'POST', f, { name: 'Sanne', createdAt: NOW });
  assert.equal(ok.status, 201);
  const fid = ok.body.id;
  for (const body of [{ name: '', createdAt: NOW }, { name: 'x'.repeat(15), createdAt: NOW }, { name: 'a', createdAt: NOW, max: 0.3 }, { name: 'a', createdAt: NOW + 6 * 60000 }, { name: 'a', createdAt: NOW, zzz: 1 }]) {
    assert.equal((await call('admin-1', 'POST', f, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('bob-0001', 'PATCH', `${f}/${fid}`, { max: 1 })).status, 403);
  assert.equal((await call('admin-1', 'PATCH', `${f}/${fid}`, { max: 1.5 })).status, 200);
  assert.equal((await call('admin-1', 'PATCH', `${f}/${fid}`, { max: 0.1 })).status, 400);
  assert.equal((await call('admin-1', 'PATCH', `${f}/${fid}`, { max: 25 })).status, 400);
  assert.equal((await call('admin-1', 'PATCH', `${f}/${fid}`, { name: 'Sanne2', max: null })).status, 200);
  assert.equal((await call('admin-1', 'PATCH', `${f}/${fid}`, { name: '' })).status, 400);
  assert.equal((await call('admin-1', 'PATCH', `${f}/nope`, { max: 1 })).status, 404);
  const p = (await call('bob-0001', 'GET', '/api/parties/' + id)).body;
  assert.equal(p.friends[fid].name, 'Sanne2');
  assert.equal('max' in p.friends[fid], false);
  assert.equal((await call('bob-0001', 'DELETE', `${f}/${fid}`)).status, 403);
  assert.equal((await call('admin-1', 'DELETE', `${f}/${fid}`)).status, 200);
  assert.equal((await call('admin-1', 'DELETE', `${f}/${fid}`)).status, 404);
});

test('claims and own-doses-only', async () => {
  const id = await party();
  const b = `/api/parties/${id}`;
  const f1 = (await call('admin-1', 'POST', b + '/friends', { name: 'A', createdAt: NOW })).body.id;
  const f2 = (await call('admin-1', 'POST', b + '/friends', { name: 'B', createdAt: NOW })).body.id;
  assert.equal((await call('alice-01', 'POST', b + '/claims', { friendId: f1 })).status, 201); // claim
  assert.equal((await call('bob-0001', 'POST', b + '/claims', { friendId: f1 })).status, 403); // double claim
  assert.equal((await call('alice-01', 'POST', b + '/claims', { friendId: f2 })).status, 403); // second claim by one phone
  assert.equal((await call('alice-01', 'POST', b + '/claims', { friendId: 'nope' })).status, 400);
  // dose permissions
  assert.equal((await call('alice-01', 'POST', b + '/doses', { friendId: f1, size: 1, t: NOW, addedAt: NOW })).status, 201);
  assert.equal((await call('alice-01', 'POST', b + '/doses', { friendId: f2, size: 1, t: NOW, addedAt: NOW })).status, 403);
  const d2 = (await call('admin-1', 'POST', b + '/doses', { friendId: f2, size: 1, t: NOW, addedAt: NOW })).body.id;
  assert.equal((await call('alice-01', 'PATCH', `${b}/doses/${d2}`, { t: NOW - 1000 })).status, 403);
  assert.equal((await call('alice-01', 'DELETE', `${b}/doses/${d2}`)).status, 403);
  assert.equal((await call('admin-1', 'PATCH', `${b}/doses/${d2}`, { t: NOW - 1000 })).status, 200);
  // cannot move a dose to someone else
  assert.equal((await call('alice-01', 'PATCH', `${b}/doses/${d2}`, { friendId: f1 })).status, 403);
  // release: only owner or admin
  assert.equal((await call('bob-0001', 'DELETE', `${b}/claims/${f1}`)).status, 403);
  assert.equal((await call('alice-01', 'DELETE', `${b}/claims/${f1}`)).status, 200);
  assert.equal((await call('alice-01', 'DELETE', `${b}/claims/${f1}`)).status, 403);
  assert.equal((await call('alice-01', 'POST', b + '/claims', { friendId: f1 })).status, 201);
  assert.equal((await call('admin-1', 'DELETE', `${b}/claims/${f1}`)).status, 200); // admin override
  assert.equal((await call('alice-01', 'POST', b + '/claims', { friendId: f2 })).status, 201); // free again
  // removing a friend drops its claim
  assert.equal((await call('admin-1', 'DELETE', `${b}/friends/${f2}`)).status, 200);
  const p = (await call('admin-1', 'GET', b)).body;
  assert.equal(Object.keys(p.claims ?? {}).length, 0);
  assert.equal(Object.keys(p.members ?? {}).length, 0);
});

test('doses: validation, anyone-with-claim, cascade on friend delete', async () => {
  const id = await party();
  const b = `/api/parties/${id}`;
  const fid = (await call('admin-1', 'POST', b + '/friends', { name: 'A', createdAt: NOW })).body.id;
  const good = { friendId: fid, size: 0.5, t: NOW, addedAt: NOW };
  assert.equal((await call('mallory-1', 'POST', b + '/doses', good)).status, 403); // no claim
  for (const patch of [{ size: 0.3 }, { size: 2 }, { t: NOW + 6 * 60000 }, { t: 'x' }, { t: 0 }, { friendId: 'nope' }, { addedAt: 'x' }, { extra: 1 }]) {
    assert.equal((await call('admin-1', 'POST', b + '/doses', { ...good, ...patch })).status, 400, JSON.stringify(patch));
  }
  assert.equal((await call('admin-1', 'POST', b + '/doses', { ...good, t: NOW + 4 * 60000 })).status, 201);
  const d = (await call('admin-1', 'POST', b + '/doses', good)).body.id;
  assert.equal((await call('admin-1', 'PATCH', `${b}/doses/${d}`, { t: NOW + 6 * 60000 })).status, 400);
  assert.equal((await call('admin-1', 'PATCH', `${b}/doses/${d}`, { t: 1 })).status, 200);
  assert.equal((await call('admin-1', 'PATCH', `${b}/doses/nope`, { t: 1 })).status, 404);
  assert.equal((await call('admin-1', 'DELETE', `${b}/doses/nope`)).status, 404);
  await call('admin-1', 'DELETE', `${b}/friends/${fid}`);
  assert.equal(Object.keys((await call('admin-1', 'GET', b)).body.doses ?? {}).length, 0);
});

test('closed party is read-only for everyone', async () => {
  const id = await party(['2468']);
  const b = `/api/parties/${id}`;
  const fid = (await call('admin-1', 'POST', b + '/friends', { name: 'A', createdAt: NOW })).body.id;
  const did = (await call('admin-1', 'POST', b + '/doses', { friendId: fid, size: 1, t: NOW, addedAt: NOW })).body.id;
  assert.equal((await call('bob-0001', 'POST', b + '/close')).status, 403);
  assert.equal((await call('admin-1', 'POST', b + '/close')).status, 200);
  assert.equal((await call('admin-1', 'POST', b + '/close')).status, 403);
  for (const [who, m, u, body] of [
    ['admin-1', 'POST', '/friends', { name: 'B', createdAt: NOW }],
    ['admin-1', 'PATCH', `/friends/${fid}`, { max: 1 }],
    ['admin-1', 'DELETE', `/friends/${fid}`],
    ['admin-1', 'POST', '/doses', { friendId: fid, size: 1, t: NOW, addedAt: NOW }],
    ['admin-1', 'PATCH', `/doses/${did}`, { t: 1 }],
    ['admin-1', 'DELETE', `/doses/${did}`],
    ['admin-1', 'POST', '/codes', { code: '9999', createdAt: NOW }],
    ['bob-0001', 'POST', '/claims', { friendId: fid }],
  ]) assert.equal((await call(who, m, b + u, body)).status, 403, `${who} ${m} ${u}`);
  const p = await call('bob-0001', 'GET', b);
  assert.equal(p.status, 200);
  assert.equal(p.body.closedAt, NOW);
  assert.equal((await call('bob-0001', 'GET', '/api/codes/2468')).body.partyId, id); // still resolvable
});

function readSse(url, uid) {
  const secret = secrets[uid];
  const events = [];
  const waiters = [];
  const req = http.get(url + `?uid=${uid}&secret=${secret}`, res => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', c => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const m = /^data: (.*)$/m.exec(chunk);
        if (m) { events.push(JSON.parse(m[1])); waiters.splice(0).forEach(w => w()); }
      }
    });
  });
  const next = async n => { while (events.length < n) await new Promise(r => waiters.push(r)); return events[n - 1]; };
  return { events, next, close: () => req.destroy() };
}

test('SSE: snapshot on connect and an update after a write', async () => {
  const id = await party(['1212']);
  await sec('watcher-01');
  const s = readSse(`${base}/api/parties/${id}/events`, 'watcher-01');
  const first = await s.next(1);
  assert.equal(first.name, 'Test');
  const fid = (await call('admin-1', 'POST', `/api/parties/${id}/friends`, { name: 'Z', createdAt: NOW })).body.id;
  const second = await s.next(2);
  assert.equal(second.friends[fid].name, 'Z');
  await call('admin-1', 'POST', `/api/parties/${id}/close`);
  assert.equal((await s.next(3)).closedAt, NOW);
  s.close();
});

test('SSE needs auth and an existing party', async () => {
  assert.equal((await call(null, 'GET', '/api/parties/x/events')).status, 401);
  assert.equal((await call('watcher-01', 'GET', '/api/parties/missing-party-1/events')).status, 404);
});

test('static files: served, but not data/dev files, dotfiles or traversal', async () => {
  const idx = await fetch(base + '/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type'), /html/);
  assert.equal((await fetch(base + '/logic.js')).status, 200);
  assert.equal((await fetch(base + '/nope.txt')).status, 404);
  assert.equal((await fetch(base + '/.devdata.json')).status, 404);
  assert.equal((await fetch(base + '/.gitignore')).status, 404);
  assert.equal((await fetch(base + '/dev-server.mjs')).status, 404);
  assert.equal((await fetch(base + '/package.json')).status, 404);
  assert.equal((await fetch(base + '/test/logic.test.js')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/%2e%2e/etc/passwd')).status, 404);
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
  assert.equal((await fetch(base + '/x', { method: 'POST' })).status, 405);
});

test('persistence and seed', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'michel-')), 'data.json');
  const s1 = await startServer({ port: 0, persistFile: file, seed: true, now: () => NOW });
  const b1 = `http://localhost:${s1.port}`;
  const h = { 'x-uid': 'dev-admin', 'x-secret': 'dev-admin-secret', 'content-type': 'application/json' };
  const code = await (await fetch(b1 + '/api/codes/8209', { headers: h })).json();
  const seedId = code.partyId;
  assert.match(seedId, /^p[0-9a-f]{16}$/); // random, not guessable
  assert.equal((await (await fetch(b1 + '/api/codes/7815', { headers: h })).json()).partyId, seedId);
  const p = await (await fetch(b1 + '/api/parties/' + seedId, { headers: h })).json();
  assert.equal(p.name, 'AWAKENINGS ADE 2026');
  assert.equal(p.admin, 'dev-admin');
  assert.deepEqual(Object.values(p.friends).map(f => f.name), ['Sanne', 'Joris', 'Fem', 'Daan', 'Bart']);
  assert.equal(p.claims, undefined);
  await fetch(b1 + '/api/parties', { method: 'POST', headers: h, body: JSON.stringify({ id: 'persisted-one', name: 'P', createdAt: NOW }) });
  await s1.close();
  const s2 = await startServer({ port: 0, persistFile: file, seed: true, now: () => NOW });
  const r = await fetch(`http://localhost:${s2.port}/api/parties/persisted-one`, { headers: h });
  assert.equal(r.status, 200);
  await s2.close();
  fs.writeFileSync(file, '{broken');
  const s3 = await startServer({ port: 0, persistFile: file, now: () => NOW });
  assert.deepEqual(Object.keys(s3.db().parties), []);
  await s3.close();
});

test('sessions: secret per uid, no hijacking, wrong secret rejected', async () => {
  const a = await (await fetch(base + '/api/session', { method: 'POST', body: JSON.stringify({}) })).json();
  assert.match(a.uid, /^u-[0-9a-f]{16}$/);
  assert.ok(a.secret.length >= 16);
  assert.equal((await fetch(base + '/api/session', { method: 'POST', body: JSON.stringify({ uid: a.uid }) })).status, 409); // cannot take over
  assert.equal((await fetch(base + '/api/session', { method: 'POST', body: JSON.stringify({ uid: 'a b' }) })).status, 400);
  const get = h => fetch(base + '/api/codes/0000', { headers: h }).then(r => r.status);
  assert.equal(await get({ 'x-uid': a.uid, 'x-secret': a.secret }), 404); // authenticated (code unknown)
  assert.equal(await get({ 'x-uid': a.uid }), 401); // no secret
  assert.equal(await get({ 'x-uid': a.uid, 'x-secret': 'wrong' }), 401);
  assert.equal(await get({ 'x-uid': 'nobody-here', 'x-secret': a.secret }), 401);
  assert.equal(await get({ 'x-uid': 'a b', 'x-secret': a.secret }), 401);
  const q = await fetch(`${base}/api/codes/0000?uid=${a.uid}&secret=${a.secret}`); // SSE-style query auth
  assert.equal(q.status, 404);
});

test('only allow-listed creators can create parties', async () => {
  const s = await startServer({ port: 0, creators: ['allowed-1'], seed: true, now: () => NOW });
  const b = `http://localhost:${s.port}`;
  const session = async uid => (await (await fetch(b + '/api/session', { method: 'POST', body: JSON.stringify({ uid }) })).json()).secret;
  const create = async (uid, secret, id, codes) => (await fetch(b + '/api/parties', { method: 'POST', headers: { 'x-uid': uid, 'x-secret': secret }, body: JSON.stringify({ id, name: 'N', codes }) })).status;
  assert.equal(await create('stranger-1', await session('stranger-1'), 'party-allow-1', ['1111']), 403);
  assert.equal(await create('allowed-1', await session('allowed-1'), 'party-allow-1', ['1111']), 201);
  assert.equal(await create('dev-admin', 'dev-admin-secret', 'party-allow-2', ['2222']), 201); // seed adds dev-admin
  assert.equal(Object.keys(s.db().parties).length, 3); // seed party + 2
  await s.close();
});

test('admin can delete a code; others cannot; the code stops resolving', async () => {
  const id = await party(['3131', '3232']);
  const url = c => `/api/parties/${id}/codes/${c}`;
  assert.equal((await call('mallory-1', 'DELETE', url('3131'))).status, 403);
  assert.equal((await call('admin-1', 'DELETE', url('9999'))).status, 404);
  assert.equal((await call('admin-1', 'DELETE', url('3131'))).status, 200);
  assert.equal((await call('bob-0001', 'GET', '/api/codes/3131')).status, 404);
  assert.equal((await call('bob-0001', 'GET', '/api/codes/3232')).body.partyId, id);
  assert.deepEqual(Object.keys((await call('bob-0001', 'GET', '/api/parties/' + id)).body.codes), ['3232']);
  assert.equal((await call('admin-1', 'POST', `/api/parties/${id}/codes`, { code: '3131', createdAt: NOW })).status, 201); // free again
  await call('admin-1', 'POST', `/api/parties/${id}/close`);
  assert.equal((await call('admin-1', 'DELETE', url('3232'))).status, 403); // closed = read-only
});

test('adversarial ids and keys are rejected (stored XSS)', async () => {
  for (const id of ['"><img src=x onerror=alert(1)>', "a'b", 'a b', 'x'.repeat(33), '', 'a/b', '<b>']) {
    const r = await call('admin-1', 'POST', '/api/parties', { id, name: 'X', createdAt: NOW });
    assert.equal(r.status, 400, JSON.stringify(id));
  }
  assert.equal((await call('admin-1', 'POST', '/api/parties', { id: 'x'.repeat(32), name: 'X', createdAt: NOW })).status, 201);
  const id = await party();
  const fid = (await call('admin-1', 'POST', `/api/parties/${id}/friends`, { name: 'A', createdAt: NOW })).body.id;
  assert.match(fid, /^[-_A-Za-z0-9]+$/); // server-made ids are safe too
  for (const bad of ['"><svg onload=1>', "x'y", 'a b', 'x'.repeat(33)]) {
    assert.equal((await call('admin-1', 'POST', `/api/parties/${id}/doses`, { id: bad, friendId: fid, size: 1, t: NOW })).status, 400, bad);
  }
  assert.equal((await fetch(base + '/api/session', { method: 'POST', body: JSON.stringify({ uid: '"><x>' }) })).status, 400);
});

test('createdAt/addedAt are server time; a skewed client clock cannot set them', async () => {
  const id = await party();
  const b = `/api/parties/${id}`;
  const fid = (await call('admin-1', 'POST', b + '/friends', { name: 'A', createdAt: NOW - 999999 })).body.id;
  await call('admin-1', 'POST', b + '/doses', { friendId: fid, size: 1, t: NOW - 1000, addedAt: NOW - 5000 });
  const p = (await call('admin-1', 'GET', b)).body;
  assert.equal(p.friends[fid].createdAt, NOW);
  assert.equal(Object.values(p.doses)[0].addedAt, NOW);
  assert.equal(p.createdAt, NOW);
});

test('dose ids are client chosen; the same id cannot be set twice', async () => {
  const id = await party();
  const b = `/api/parties/${id}`;
  const fid = (await call('admin-1', 'POST', b + '/friends', { name: 'A', createdAt: NOW })).body.id;
  const r = await call('admin-1', 'POST', b + '/doses', { id: 'dose-client-1', friendId: fid, size: 1, t: NOW });
  assert.deepEqual(r.body, { id: 'dose-client-1' });
  assert.equal((await call('admin-1', 'POST', b + '/doses', { id: 'dose-client-1', friendId: fid, size: 1, t: NOW })).status, 403);
  assert.equal(Object.keys((await call('admin-1', 'GET', b)).body.doses).length, 1);
});

test('friend names are unique per party (case-insensitive, trimmed)', async () => {
  const id = await party();
  const f = `/api/parties/${id}/friends`;
  const a = await call('admin-1', 'POST', f, { name: 'Sanne', createdAt: NOW });
  assert.equal(a.status, 201);
  assert.equal((await call('admin-1', 'POST', f, { name: 'sanne', createdAt: NOW })).status, 409);
  assert.equal((await call('admin-1', 'POST', f, { name: ' SANNE ', createdAt: NOW })).status, 409);
  const j = await call('admin-1', 'POST', f, { name: 'Joris', createdAt: NOW });
  assert.equal((await call('admin-1', 'PATCH', `${f}/${j.body.id}`, { name: 'sanne' })).status, 409); // rename too
  assert.equal((await call('admin-1', 'PATCH', `${f}/${a.body.id}`, { name: 'SANNE' })).status, 200); // own name is fine
  const other = await party();
  assert.equal((await call('admin-1', 'POST', `/api/parties/${other}/friends`, { name: 'Sanne', createdAt: NOW })).status, 201); // other party
});
