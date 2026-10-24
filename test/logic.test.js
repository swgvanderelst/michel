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

test('tokenFromLink: only full links of this app', () => {
  const app = { origin: 'https://x.github.io', pathname: '/michel/' };
  assert.equal(L.tokenFromLink('https://x.github.io/michel/?p=AbCdEf123456', app), 'AbCdEf123456');
  assert.equal(L.tokenFromLink('  https://x.github.io/michel/?foo=1&p=AbCdEf123456#x ', app), 'AbCdEf123456');
  assert.equal(L.tokenFromLink('https://x.github.io/michel/index.html?p=AbCdEf123456', app), 'AbCdEf123456');
  assert.equal(L.tokenFromLink('https://evil.example/michel/?p=AbCdEf123456', app), ''); // other origin
  assert.equal(L.tokenFromLink('https://x.github.io/other/?p=AbCdEf123456', app), ''); // other path
  assert.equal(L.tokenFromLink('AbCdEf123456', app), ''); // a bare token is not accepted
  assert.equal(L.tokenFromLink('michel/?p=AbCdEf123456', app), ''); // not a full URL
  assert.equal(L.tokenFromLink('https://anything.example/x?p=AbCdEf123456'), 'AbCdEf123456'); // no app given: any link (tools)
  assert.equal(L.tokenFromLink('https://x.github.io/michel/?p=8209', app), ''); // old 4-digit pin
  for (const bad of ['', null, 'hello world', 'https://x.github.io/michel/']) assert.equal(L.tokenFromLink(bad, app), '');
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
  assert.match(L.newId(), /^[a-z0-9]{12}$/); // crypto-backed by default
  assert.notEqual(L.newId(), L.newId());
  assert.equal(L.newId(null, 5).length, 5);
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
  // original today 09:00, new time 18:00 is after now (12:00): rejected, not silently moved to yesterday
  const today = new Date(2026, 9, 24, 9, 0).getTime();
  assert.equal(L.retime('18:00', today, now), -1);
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
  assert.equal(L.retime('23:50', orig, new Date(2026, 9, 24, 23, 40).getTime()), -1); // same-day time in the future: rejected, no jump of -24 h
  assert.equal(L.retime('23:55', new Date(2026, 9, 25, 0, 10).getTime(), now), new Date(2026, 9, 24, 23, 55).getTime()); // just before midnight is still fine
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

test('shareText: the link with ?p=<token> is INSIDE the text', () => {
  const url = L.shareUrl('https://x.github.io', '/michel/', 'AbCdEf123456');
  const text = L.shareText('AWAKENINGS ADE 2026', url);
  assert.ok(text.includes('?p=AbCdEf123456'));
  assert.ok(text.includes('AWAKENINGS ADE 2026'));
  assert.equal(L.tokenFromLink(text.slice(text.indexOf('http'))), 'AbCdEf123456'); // a recipient can pull the link back out of the text
});

test('planSchedule: no doses starts at the entry time and respects the waits', () => {
  const t0 = 1_800_000_000_000, H = 3600000;
  const r = L.planSchedule({ doses: [], max: 1.5, size: 0.5, start: t0, cutoff: t0 + 20 * H, now: t0 - H });
  assert.deepEqual(r.map(x => [x.t, x.size]), [[t0, 0.5], [t0 + 90 * M, 0.5], [t0 + 180 * M, 0.5]]); // stops at max, waits 90 min after each half
});

test('planSchedule: starts from the own real doses (latest t, that dose wait), never before now', () => {
  const t0 = 1_800_000_000_000;
  const doses = [{ id: 'a', t: t0 - 300 * M, size: 1 }, { id: 'b', t: t0, size: 0.25 }]; // latest by t is the 1/4: wait 60
  const r = L.planSchedule({ doses, max: 2, size: 0.5, start: t0 - 999 * M, cutoff: t0 + 600 * M, now: t0 });
  assert.equal(r[0].t, t0 + 60 * M);
  assert.equal(r[0].size, 0.5);
  assert.equal(r[1].t, t0 + 60 * M + 90 * M);
  assert.equal(L.total(doses) + L.total(r), 2); // exactly max, never above
  // late: the plan shifts, nothing lies before now
  const late = L.planSchedule({ doses, max: 2, size: 0.5, start: 0, cutoff: t0 + 600 * M, now: t0 + 200 * M });
  assert.equal(late[0].t, t0 + 200 * M);
  // a whole dose waits 120
  const whole = L.planSchedule({ doses: [{ id: 'w', t: t0, size: 1 }], max: 3, size: 1, start: 0, cutoff: t0 + 900 * M, now: t0 });
  assert.deepEqual(whole.map(x => x.t), [t0 + 120 * M, t0 + 240 * M]);
});

test('planSchedule: rounding at max uses the room only when it is a valid size', () => {
  const t0 = 1_800_000_000_000, o = { start: t0, cutoff: t0 + 99999 * M, now: t0 };
  const a = L.planSchedule({ ...o, doses: [], max: 1.25, size: 0.5 });
  assert.deepEqual(a.map(x => x.size), [0.5, 0.5, 0.25]); // the last bit is a 1/4
  const b = L.planSchedule({ ...o, doses: [], max: 1.75, size: 1 });
  assert.deepEqual(b.map(x => x.size), [1]); // 3/4 left is not a valid size: stop
  const c = L.planSchedule({ ...o, doses: [], max: 1.5, size: 1 });
  assert.deepEqual(c.map(x => x.size), [1, 0.5]); // room 1/2 is valid
  const d = L.planSchedule({ ...o, doses: [], max: 0.25, size: 1 });
  assert.deepEqual(d.map(x => x.size), [0.25]);
  const e = L.planSchedule({ ...o, doses: [], max: 0.1, size: 0.5 });
  assert.deepEqual(e, []); // less than a quarter of room
});

test('planSchedule: max reached, no max, bad size, cutoff', () => {
  const t0 = 1_800_000_000_000;
  assert.deepEqual(L.planSchedule({ doses: [{ id: 'a', t: t0, size: 1 }, { id: 'b', t: t0, size: 0.5 }], max: 1.5, size: 0.5, start: t0, cutoff: t0 + 9e9, now: t0 }), []); // already at max
  assert.deepEqual(L.planSchedule({ doses: [{ id: 'a', t: t0, size: 2 }], max: 1.5, size: 0.5, start: t0, cutoff: t0 + 9e9, now: t0 }), []); // above max
  assert.deepEqual(L.planSchedule({ doses: [], max: null, size: 0.5, start: t0, cutoff: t0 + 9e9, now: t0 }), []); // no max, no plan
  assert.deepEqual(L.planSchedule({ doses: [], max: undefined, size: 0.5, start: t0, cutoff: t0 + 9e9, now: t0 }), []);
  assert.deepEqual(L.planSchedule({ doses: [], max: 2, size: 0.3, start: t0, cutoff: t0 + 9e9, now: t0 }), []); // invalid size
  const cut = L.planSchedule({ doses: [], max: 5, size: 0.5, start: t0, cutoff: t0 + 100 * M, now: t0 }); // 0 and 90 fit, 180 does not
  assert.deepEqual(cut.map(x => x.t), [t0, t0 + 90 * M]);
  assert.deepEqual(L.planSchedule({ doses: [], max: 2, size: 0.5, start: t0, cutoff: t0 - 1, now: t0 }), []); // cutoff already passed
});

test('planWindow: entry/end across midnight, a past entry time, cutoff before the end, invalid input', () => {
  const now = new Date(2026, 8, 10, 23, 0).getTime(); // 23:00
  const w = L.planWindow({ entry: '22:00', end: '03:00', beforeH: 2, now });
  assert.equal(w.start, new Date(2026, 8, 10, 22, 0).getTime()); // a past entry time (an hour ago)
  assert.equal(w.end, new Date(2026, 8, 11, 3, 0).getTime()); // across midnight
  assert.equal(w.cutoff, new Date(2026, 8, 11, 1, 0).getTime()); // 2 h before the end
  // the plan stops after the cutoff across midnight
  const r = L.planSchedule({ doses: [], max: 9, size: 0.5, start: w.start, cutoff: w.cutoff, now });
  assert.ok(r.length > 0 && r.every(x => x.t >= now && x.t <= w.cutoff));
  assert.ok(r.at(-1).t > new Date(2026, 8, 11, 0, 0).getTime()); // reaches past midnight
  // an entry far in the future means last evening; far in the past means tonight
  const morning = new Date(2026, 8, 11, 3, 0).getTime();
  assert.equal(L.planWindow({ entry: '20:00', end: '05:00', now: morning }).start, new Date(2026, 8, 10, 20, 0).getTime());
  const noon = new Date(2026, 8, 10, 12, 0).getTime();
  assert.equal(L.planWindow({ entry: '23:30', end: '06:00', now: noon }).start, new Date(2026, 8, 10, 23, 30).getTime()); // 11.5 h ahead: today
  assert.equal(L.planWindow({ entry: '00:10', end: '04:00', now: new Date(2026, 8, 10, 19, 0).getTime() }).start, new Date(2026, 8, 11, 0, 10).getTime()); // a long time ago: tonight after midnight
  assert.equal(L.planWindow({ entry: '10:00', end: '10:00', now: noon }).end, new Date(2026, 8, 11, 10, 0).getTime()); // equal times: next day
  assert.equal(L.planWindow({ entry: 'x', end: '03:00', now }), null);
  assert.equal(L.planWindow({ entry: '22:00', end: '25:00', now }), null);
  assert.equal(L.planWindow({ entry: null, end: '03:00', now }), null);
  assert.equal(L.planWindow({ entry: '22:00', end: '03:00', now }).cutoff, w.cutoff); // default beforeH is 2
});

test('compareCrew: due (longest overdue first), wait (least left first), none A-Z, max A-Z', () => {
  const mk = (name, st) => ({ name, st });
  const list = [
    mk('Max2', { kind: 'max' }), mk('Zoe', { kind: 'none' }), mk('W-long', { kind: 'wait', rem: 50 * M }), mk('Due-short', { kind: 'due', over: 1 * M }),
    mk('Anna', { kind: 'none' }), mk('W-short', { kind: 'wait', rem: 5 * M }), mk('Due-long', { kind: 'due', over: 30 * M }), mk('Max1', { kind: 'max' }),
  ];
  assert.deepEqual(list.slice().sort(L.compareCrew).map(x => x.name), ['Due-long', 'Due-short', 'W-short', 'W-long', 'Anna', 'Zoe', 'Max1', 'Max2']);
  // ties fall back to the name
  assert.deepEqual([mk('B', { kind: 'due', over: 5 }), mk('A', { kind: 'due', over: 5 })].sort(L.compareCrew).map(x => x.name), ['A', 'B']);
  assert.deepEqual([mk('B', { kind: 'wait', rem: 5 }), mk('A', { kind: 'wait', rem: 5 })].sort(L.compareCrew).map(x => x.name), ['A', 'B']);
  assert.equal(L.compareCrew(mk('A', { kind: 'none' }), mk('A', { kind: 'none' })), 0);
});

test('planWindow: an afternoon party planned in the night, on a normal night and on the DST night (Europe/Amsterdam)', () => {
  const tz = process.env.TZ; process.env.TZ = 'Europe/Amsterdam';
  try {
    // 13:00 -> 07:00 planned at 01:30 on Oct 31: the party began yesterday afternoon and ends this morning
    const now = new Date(2026, 9, 31, 1, 30).getTime();
    const w = L.planWindow({ entry: '13:00', end: '07:00', beforeH: 2, now });
    assert.equal(w.start, new Date(2026, 9, 30, 13, 0).getTime());
    assert.equal(w.end, new Date(2026, 9, 31, 7, 0).getTime());
    assert.equal(w.cutoff, new Date(2026, 9, 31, 5, 0).getTime());
    const r = L.planSchedule({ doses: [], max: 9, size: 0.5, start: w.start, cutoff: w.cutoff, now });
    assert.ok(r.length && r.every(x => x.t <= w.cutoff), 'no moments after the cutoff'); // the old rule suggested 06:00-10:30 here
    // the DST night: Oct 25 has 25 hours, 01:30 happens twice; end 07:00 is CET
    const dst = new Date(2026, 9, 25, 1, 30).getTime();
    const wd = L.planWindow({ entry: '13:00', end: '07:00', beforeH: 2, now: dst });
    assert.equal(wd.start, new Date(2026, 9, 24, 13, 0).getTime());
    assert.equal(wd.end, new Date(2026, 9, 25, 7, 0).getTime());
    assert.equal(wd.cutoff, wd.end - 2 * 3600000); // 2 h before the end in elapsed time
    assert.ok(wd.end - wd.start <= 24 * 3600000 && wd.cutoff >= wd.start);
    const rd = L.planSchedule({ doses: [], max: 9, size: 0.5, start: wd.start, cutoff: wd.cutoff, now: dst });
    assert.ok(rd.every(x => x.t <= wd.cutoff));
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
});

test('planWindow: planning in the morning for a 22:00 entry gives the upcoming window; own doses fix the start; guards', () => {
  const morning = new Date(2026, 8, 10, 9, 0).getTime();
  const w = L.planWindow({ entry: '22:00', end: '04:00', beforeH: 2, now: morning });
  assert.equal(w.start, new Date(2026, 8, 10, 22, 0).getTime()); // tonight, not last night
  assert.equal(w.cutoff, new Date(2026, 8, 11, 2, 0).getTime());
  const r = L.planSchedule({ doses: [], max: 2, size: 0.5, start: w.start, cutoff: w.cutoff, now: morning });
  assert.ok(r.length > 0 && r[0].t === w.start, 'a plan, not "laatste moment voorbij"');
  // with own doses the start is the entry occurrence on/before the FIRST dose, whatever time it is now
  const first = new Date(2026, 8, 10, 14, 0).getTime();
  const wd = L.planWindow({ entry: '13:00', end: '07:00', beforeH: 2, now: new Date(2026, 8, 11, 6, 30).getTime(), firstDose: first });
  assert.equal(wd.start, new Date(2026, 8, 10, 13, 0).getTime());
  assert.equal(wd.end, new Date(2026, 8, 11, 7, 0).getTime());
  // a party that is over and has doses stays over (nothing is shifted to tomorrow)
  const over = L.planWindow({ entry: '13:00', end: '07:00', beforeH: 2, now: new Date(2026, 8, 11, 12, 0).getTime(), firstDose: first });
  assert.equal(over.end, new Date(2026, 8, 11, 7, 0).getTime());
  // guard: the cutoff may not lie before the start
  assert.equal(L.planWindow({ entry: '10:00', end: '11:00', beforeH: 3, now: new Date(2026, 8, 10, 10, 30).getTime() }), null);
});
