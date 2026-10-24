import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

const M = 60000;
const dose = (id, size, t, addedAt = t) => ({ id, size, t, addedAt, friendId: 'f' });

test('frac', () => {
  assert.equal(L.frac(0), '0');
  assert.equal(L.frac(0.25), '¼');
  assert.equal(L.frac(0.5), '½');
  assert.equal(L.frac(0.75), '¾');
  assert.equal(L.frac(1), '1');
  assert.equal(L.frac(1.75), '1¾');
  assert.equal(L.frac(2.5), '2½');
  assert.equal(L.frac(0.1 + 0.2 + 0.2), '½'); // float noise
});

test('dur', () => {
  assert.equal(L.dur(0), '0:00');
  assert.equal(L.dur(-5000), '0:00');
  assert.equal(L.dur(59_100), '1:00'); // ceil
  assert.equal(L.dur(65 * 60000 + 9000), '1:05:09');
  assert.equal(L.dur(5 * 60000 + 9000), '5:09');
  assert.equal(L.dur(2 * 3600000), '2:00:00');
});

test('hhmm pads', () => {
  const d = new Date(2026, 3, 1, 7, 5).getTime();
  assert.equal(L.hhmm(d), '07:05');
});

test('total', () => {
  assert.equal(L.total([]), 0);
  assert.equal(L.total([dose('a', 1, 0), dose('b', 0.25, 0)]), 1.25);
});

test('status none', () => assert.deepEqual(L.status([], null, 0), { kind: 'none', total: 0 }));

test('wait thresholds 1 -> 120, 1/2 -> 90, 1/4 -> 60', () => {
  for (const [size, min] of [[1, 120], [0.5, 90], [0.25, 60]]) {
    const t = 1_000_000_000;
    const just = L.status([dose('a', size, t)], null, t + (min - 1) * M);
    assert.equal(just.kind, 'wait');
    assert.equal(just.rem, M);
    const exact = L.status([dose('a', size, t)], null, t + min * M);
    assert.equal(exact.kind, 'due');
    assert.equal(exact.over, 0);
    const over = L.status([dose('a', size, t)], null, t + (min + 3) * M);
    assert.equal(over.over, 3 * M);
  }
});

test('wait progress p', () => {
  const st = L.status([dose('a', 1, 0)], null, 60 * M);
  assert.equal(st.p, 0.5);
});

test('latest t wins, not last inserted (backfill)', () => {
  const now = 10 * 3600000;
  const late = dose('late', 0.25, now - 10 * M, 1); // inserted first
  const back = dose('back', 1, now - 200 * M, 2); // backfilled afterwards
  const st = L.status([late, back], null, now);
  assert.equal(st.last.id, 'late');
  assert.equal(st.kind, 'wait');
  assert.equal(L.latestDose([back, late]).id, 'late');
});

test('latestDose tie goes to later addedAt; null for empty', () => {
  assert.equal(L.latestDose([]), null);
  assert.equal(L.latestDose([dose('a', 1, 5, 1), dose('b', 1, 5, 2)]).id, 'b');
  assert.equal(L.latestDose([dose('b', 1, 5, 2), dose('a', 1, 5, 1)]).id, 'b');
  assert.equal(L.latestDose([{ id: 'x', t: 5, size: 1 }, { id: 'y', t: 5, size: 1 }]).id, 'y');
});

test('backfilled dose already past threshold is due immediately', () => {
  const now = 5 * 3600000;
  assert.equal(L.status([dose('a', 1, now - 3 * 3600000)], null, now).kind, 'due');
});

test('MAX state: no countdown, no alarm', () => {
  const now = 1e9;
  const ds = [dose('a', 0.5, now - 500 * M), dose('b', 1, now - 400 * M)];
  const st = L.status(ds, 1.5, now);
  assert.equal(st.kind, 'max');
  assert.equal(st.total, 1.5);
  assert.equal(L.canAlarm(st, { now }), false);
  assert.equal(L.status(ds, 2, now).kind, 'due');
  assert.equal(L.status(ds, 3, now).kind, 'due');
});

test('atMax / exceedsMax with quarter steps', () => {
  assert.equal(L.atMax(1.5, null), false);
  assert.equal(L.atMax(1.25, 1.5), false);
  assert.equal(L.atMax(1.5, 1.5), true);
  assert.equal(L.atMax(2, 1.5), true);
  assert.equal(L.exceedsMax(1, 0.5, 1.5), false);
  assert.equal(L.exceedsMax(1.25, 0.5, 1.5), true);
  assert.equal(L.exceedsMax(5, 1, null), false);
});

test('canAlarm', () => {
  const due = L.status([dose('a', 1, 0)], null, 200 * M);
  const wait = L.status([dose('a', 1, 0)], null, 10 * M);
  const now = 200 * M;
  assert.equal(L.canAlarm(due, { now }), true);
  assert.equal(L.canAlarm(wait, { now }), false);
  assert.equal(L.canAlarm({ kind: 'none' }, { now }), false);
  assert.equal(L.canAlarm(due, { now, closed: true }), false);
  assert.equal(L.canAlarm(due, { now, seenId: 'a:0' }), false);
  assert.equal(L.canAlarm(due, { now, seenId: 'a:5' }), true); // time of the same dose was edited: alarm again
  assert.equal(L.canAlarm(due, { now, seenId: 'other' }), true);
  assert.equal(L.canAlarm(due, { now, snoozeUntil: now + 1 }), false);
  assert.equal(L.canAlarm(due, { now, snoozeUntil: now }), true);
  assert.equal(L.canAlarm(due), true); // defaults do not throw
});

test('ranking: total desc, tie -> earlier t of final dose', () => {
  const fr = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bas' }, { id: 'c', name: 'Cor' }, { id: 'd', name: 'Dirk' }];
  const ds = [
    { id: '1', friendId: 'a', size: 1, t: 100 },
    { id: '2', friendId: 'b', size: 0.5, t: 50 }, { id: '3', friendId: 'b', size: 0.5, t: 200 },
    { id: '4', friendId: 'c', size: 1, t: 90 },
  ];
  const r = L.ranking(fr, ds);
  assert.deepEqual(r.map(x => x.friend.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(r.map(x => x.total), [1, 1, 1, 0]);
  assert.equal(r[3].reachedAt, Infinity);
});

test('ranking: total beats time; backfill changes tiebreak; name last', () => {
  const fr = [{ id: 'a', name: 'Zed' }, { id: 'b', name: 'Amy' }, { id: 'c', name: 'Big' }];
  const ds = [
    { id: '1', friendId: 'a', size: 1, t: 10 }, { id: '2', friendId: 'b', size: 1, t: 10 },
    { id: '3', friendId: 'c', size: 1, t: 99 }, { id: '4', friendId: 'c', size: 0.25, t: 99 },
  ];
  assert.deepEqual(L.ranking(fr, ds).map(x => x.friend.name), ['Big', 'Amy', 'Zed']);
  ds[0].t = 5;
  assert.deepEqual(L.ranking(fr, ds).map(x => x.friend.name), ['Big', 'Zed', 'Amy']);
});

test('join tokens: 10-32 alphanumerics', () => {
  assert.equal(L.normalizeCode(' ab-C1_2 '), 'abC12');
  assert.equal(L.normalizeCode('x'.repeat(40)).length, 32);
  assert.equal(L.normalizeCode(null), '');
  assert.ok(L.isValidCode('AbCdEf123456'));
  assert.ok(L.isValidCode('x'.repeat(32)));
  for (const bad of ['8209', 'abc123', 'x'.repeat(33), 'AbCdEf12345!', '', null, 1234567890123]) assert.equal(L.isValidCode(bad), false);
});

test('newToken: 12 chars from [A-Za-z0-9], unbiased, injectable randomness', () => {
  assert.match(L.newToken(), /^[A-Za-z0-9]{12}$/);
  assert.notEqual(L.newToken(), L.newToken());
  assert.equal(L.newToken(5, n => new Uint8Array(n).fill(0)), 'AAAAA');
  assert.equal(L.newToken(3, n => Uint8Array.from({ length: n }, (_, i) => (i % 2 ? 61 : 255))), '999'); // bytes >= 248 are rejected
  assert.equal(L.newToken(2, n => new Uint8Array(n).fill(62)), 'AA'); // 62 % 62
  const seen = new Set(); for (let i = 0; i < 200; i++) for (const ch of L.newToken(32)) seen.add(ch);
  assert.ok(seen.size > 55);
});

test('tokenFromLink: link, bare token, junk', () => {
  assert.equal(L.tokenFromLink('https://x.github.io/michel/?p=AbCdEf123456'), 'AbCdEf123456');
  assert.equal(L.tokenFromLink('  https://x.github.io/michel/?foo=1&p=AbCdEf123456#x '), 'AbCdEf123456');
  assert.equal(L.tokenFromLink('michel/?p=AbCdEf123456'), 'AbCdEf123456'); // not a full URL
  assert.equal(L.tokenFromLink('AbCdEf123456'), 'AbCdEf123456');
  assert.equal(L.tokenFromLink('https://x.github.io/michel/?p=8209'), ''); // old 4-digit pin
  for (const bad of ['', null, 'hello world', 'https://x.github.io/michel/']) assert.equal(L.tokenFromLink(bad), '');
});

test('iconFor: stable per dose id, covers all four icons', () => {
  assert.equal(L.iconFor('dose-1'), L.iconFor('dose-1'));
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(L.iconFor('d' + i));
  assert.deepEqual([...seen].sort(), ['disco', 'eyes', 'rocket', 'shades']);
  assert.ok(L.ICONS.includes(L.iconFor('')));
  assert.equal(L.iconFor(12345), L.iconFor('12345'));
});

test('newId', () => {
  assert.match(L.newId(), /^[a-z0-9]{12}$/);
  assert.equal(L.newId(() => 0, 4), 'aaaa');
});

test('parseBackfillTime: today, and yesterday across midnight', () => {
  const now = new Date(2026, 9, 24, 0, 30, 20).getTime();
  const same = L.parseBackfillTime('00:10', now);
  assert.equal(L.hhmm(same), '00:10');
  assert.equal(new Date(same).getDate(), 24);
  const yday = L.parseBackfillTime('23:50', now);
  assert.equal(new Date(yday).getDate(), 23);
  assert.equal(L.hhmm(yday), '23:50');
  assert.equal(new Date(L.parseBackfillTime('00:30', now)).getDate(), 24); // not in the future
  assert.equal(L.parseBackfillTime('7:05', new Date(2026, 9, 24, 12, 0).getTime()), new Date(2026, 9, 24, 7, 5).getTime());
  assert.equal(L.parseBackfillTime('25:00', now), null);
  assert.equal(L.parseBackfillTime('12:60', now), null);
  assert.equal(L.parseBackfillTime('', now), null);
  assert.equal(L.parseBackfillTime('abc', now), null);
  assert.ok(L.parseBackfillTime('12:00') <= Date.now());
});

test('minutesAgo', () => {
  assert.equal(L.minutesAgo(15, 1000000), 1000000 - 900000);
  assert.ok(L.minutesAgo(0) <= Date.now());
});

test('normalizeParty', () => {
  assert.equal(L.normalizeParty('x', null), null);
  const p = L.normalizeParty('pid', {
    name: 'N', admin: 'u', createdAt: 1,
    codes: { 7815: 5, 8209: 2 },
    friends: { b: { name: 'B', createdAt: 2 }, a: { name: 'A', createdAt: 1, max: 1.5 } },
    doses: { d1: { friendId: 'a', size: 1, t: 1 }, d2: { friendId: 'gone', size: 1, t: 1 } },
  });
  assert.deepEqual(p.codes, ['8209', '7815']);
  assert.deepEqual(p.friends.map(f => [f.id, f.max]), [['a', 1.5], ['b', null]]);
  assert.deepEqual(p.doses.map(d => d.id), ['d1']);
  assert.equal(p.closed, false);
  const q = L.normalizeParty('p', { name: 'N', admin: 'u', createdAt: 1, closedAt: 9 });
  assert.equal(q.closed, true);
  assert.deepEqual(q.friends, []);
  assert.deepEqual(q.codes, []);
});

test('sortDosesDesc', () => {
  const r = L.sortDosesDesc([dose('a', 1, 1), dose('b', 1, 3), dose('c', 1, 3, 99), dose('d', 1, 2)]);
  assert.deepEqual(r.map(d => d.id), ['c', 'b', 'd', 'a']);
  assert.equal(L.sortDosesDesc([{ id: 'x', t: 1 }, { id: 'y', t: 1 }]).length, 2);
});

test('claims: normalizeParty keeps them, myFriendId finds mine', () => {
  const p = L.normalizeParty('p', { name: 'N', admin: 'u', createdAt: 1, friends: { a: { name: 'A', createdAt: 1 }, b: { name: 'B', createdAt: 2 } }, claims: { a: 'me', gone: 'x' } });
  assert.deepEqual(p.claims, { a: 'me', gone: 'x' });
  assert.equal(L.myFriendId(p, 'me'), 'a');
  assert.equal(L.myFriendId(p, 'other'), null);
  assert.equal(L.myFriendId(p, 'x'), null); // claim on a removed friend does not count
  assert.equal(L.myFriendId(null, 'me'), null);
  assert.deepEqual(L.normalizeParty('p', { name: 'N', admin: 'u', createdAt: 1 }).claims, {});
});

test('doseKey / isValidId', () => {
  assert.equal(L.doseKey({ id: 'x', t: 5 }), 'x:5');
  for (const ok of ['a', '-Nabc_123', 'x'.repeat(32)]) assert.equal(L.isValidId(ok), true);
  for (const bad of ['', 'x'.repeat(33), '"><img src=x>', 'a b', "a'b", 'a/b', null, 5]) assert.equal(L.isValidId(bad), false);
});

test('retime keeps the original date, only HH:MM changes', () => {
  const now = new Date(2026, 9, 24, 12, 0).getTime();
  const orig = new Date(2026, 9, 20, 23, 50).getTime(); // 4 days ago
  const r = L.retime('23:10', orig, now);
  assert.equal(new Date(r).getDate(), 20);
  assert.equal(L.hhmm(r), '23:10');
  // original today, new time later than now -> not in the future, goes to yesterday
  const today = new Date(2026, 9, 24, 9, 0).getTime();
  const f = L.retime('18:00', today, now);
  assert.equal(new Date(f).getDate(), 23);
  assert.equal(L.hhmm(f), '18:00');
  assert.equal(L.retime('25:00', orig, now), null);
  assert.equal(L.retime('x', orig, now), null);
  assert.ok(L.retime('00:00', Date.now()) <= Date.now());
});

test('mergePending marks and adds outbox doses', () => {
  const p = L.normalizeParty('P', { name: 'N', admin: 'u', createdAt: 1, friends: { a: { name: 'A', createdAt: 1 } }, doses: { d1: { friendId: 'a', size: 1, t: 1, addedAt: 1 } } });
  assert.equal(L.mergePending(p, []), p);
  assert.equal(L.mergePending(p, [{ pid: 'other', id: 'x', friendId: 'a', size: 1, t: 2 }]), p);
  assert.equal(L.mergePending(null, [{}]), null);
  const m = L.mergePending(p, [{ pid: 'P', id: 'd1', friendId: 'a', size: 1, t: 1 }, { pid: 'P', id: 'd2', friendId: 'a', size: 0.5, t: 2, addedAt: 2 }, { pid: 'P', id: 'd3', friendId: 'gone', size: 1, t: 3 }]);
  assert.deepEqual(m.doses.map(d => [d.id, !!d.pending]), [['d1', true], ['d2', true]]);
  assert.equal(p.doses[0].pending, undefined); // original untouched
});

test('snooze with a fake clock: silent until the exact expiry, then fires on the next tick', () => {
  const t0 = 1_000_000_000_000;
  const doses = [dose('d1', 1, t0 - 200 * M)];
  const st = L.status(doses, null, t0);
  assert.equal(st.kind, 'due');
  const snoozeUntil = t0 + L.SNOOZE_MS;
  const fires = now => L.canAlarm(L.status(doses, null, now), { snoozeUntil, now });
  assert.equal(fires(t0 + 1000), false);
  assert.equal(fires(snoozeUntil - 1), false);
  assert.equal(fires(snoozeUntil), true); // >= : no off-by-one at the boundary
  assert.equal(fires(snoozeUntil + 1800), true);
  // acknowledging ('done') the same dose at the same time keeps it silent; editing the time re-arms it
  const key = L.doseKey(L.latestDose(doses));
  assert.equal(L.canAlarm(st, { seenId: key, now: t0 }), false);
  const edited = [{ ...doses[0], t: doses[0].t - M }];
  assert.equal(L.canAlarm(L.status(edited, null, t0), { seenId: key, now: t0 }), true);
  // a newer dose after a 'gone' alarm is a different key: not swallowed
  const newer = [...doses, dose('d2', 0.25, t0 - 90 * M)];
  assert.equal(L.canAlarm(L.status(newer, null, t0), { seenId: key, now: t0 }), true);
});

test('shareUrl, nameTaken, needsInstall, outbox', () => {
  assert.equal(L.shareUrl('https://x.github.io', '/michel/', '8209'), 'https://x.github.io/michel/?p=8209');
  const fr = [{ id: 'a', name: 'Sanne' }, { id: 'b', name: 'Joris' }];
  assert.equal(L.nameTaken(fr, ' sanne '), true);
  assert.equal(L.nameTaken(fr, 'SANNE', 'a'), false);
  assert.equal(L.nameTaken(fr, 'Daan'), false);
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
  assert.equal(L.needsInstall({ ua: iphone, standalone: false }), true);
  assert.equal(L.needsInstall({ ua: iphone, standalone: true }), false);
  assert.equal(L.needsInstall({ ua: iphone, standalone: false, mediaStandalone: true }), false);
  assert.equal(L.needsInstall({ ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome', standalone: undefined }), false);
  assert.equal(L.needsInstall({ ua: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', touchPoints: 5, standalone: false }), true); // iPadOS
  assert.equal(L.needsInstall({ ua: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', touchPoints: 0 }), false);
  assert.equal(L.needsInstall(), false);
  let o = L.outboxAdd([], { pid: 'p', id: 'd1' });
  o = L.outboxAdd(o, { pid: 'p', id: 'd1' });
  assert.equal(o.length, 1); // idempotent
  o = L.outboxAdd(o, { pid: 'p', id: 'd2' });
  assert.deepEqual(L.outboxRemove(o, 'p', 'd1').map(x => x.id), ['d2']);
  assert.equal(L.outboxRemove(o, 'q', 'd1').length, 2);
});

test('alarm tempo: starts at 138, +6 per bar, capped at 200', () => {
  assert.equal(L.bpmAt(0), 138);
  assert.equal(L.bpmAt(16), 144);
  assert.equal(L.bpmAt(8), 141); // smooth inside a bar
  assert.equal(L.bpmAt(L.CAP_STEP), 200);
  assert.equal(L.bpmAt(L.CAP_STEP + 1000), 200);
  assert.ok(L.bpmAt(L.CAP_STEP - 1) < 200);
  assert.equal(L.CAP_STEP, 166);
});

test('retime across midnight: 23:50 on the 24th edited to 00:10 at 00:30 becomes the 25th 00:10', () => {
  const orig = new Date(2026, 9, 24, 23, 50).getTime();
  const now = new Date(2026, 9, 25, 0, 30).getTime();
  const r = L.retime('00:10', orig, now);
  assert.equal(r, new Date(2026, 9, 25, 0, 10).getTime());
  // and the other way: 00:10 on the 25th edited back to 23:55 stays on the 24th
  assert.equal(L.retime('23:55', new Date(2026, 9, 25, 0, 10).getTime(), now), new Date(2026, 9, 24, 23, 55).getTime());
  assert.equal(L.retime('23:50', orig, new Date(2026, 9, 24, 23, 40).getTime()), new Date(2026, 9, 23, 23, 50).getTime()); // never in the future
});

test('alarmGate: live snapshot, or cache when offline / after 5 s without a snapshot', () => {
  assert.equal(L.alarmGate({ live: true, hasCache: false, online: true, uptimeMs: 0 }), true);
  assert.equal(L.alarmGate({ live: false, hasCache: true, online: true, uptimeMs: 1000 }), false); // fresh start, wait for the server
  assert.equal(L.alarmGate({ live: false, hasCache: true, online: false, uptimeMs: 1000 }), true); // offline cold start
  assert.equal(L.alarmGate({ live: false, hasCache: true, online: true, uptimeMs: 5001 }), true); // no snapshot after 5 s
  assert.equal(L.alarmGate({ live: false, hasCache: false, online: false, uptimeMs: 99999 }), false); // nothing to alarm on
});

test('normalizeParty orders codes by the stored order (0 = main), not alphabetically', () => {
  const p = L.normalizeParty('p', { name: 'N', admin: 'u', createdAt: 1, codes: { 7815: 1, 8209: 0 } });
  assert.deepEqual(p.codes, ['8209', '7815']);
});
