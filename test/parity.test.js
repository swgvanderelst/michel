// Differential test: the same scenario runs against dev-server.mjs (HTTP) and against
// database.rules.json (via the mini rules evaluator). Both must allow/deny identically,
// and both must match the hand-written expectation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../dev-server.mjs';
import { loadRules, checkUpdate, checkRead } from './rules-eval.js';

const NOW = 1_800_000_000_000;
const MIN = 60000;
const PID = 'party-test-0001';
const rules = loadRules();
const uidOf = who => 'uid-' + who;

// ---- rules side: op -> atomic writes ----
function toWrites(op, a, tree, who) {
  const uid = uidOf(who);
  const P = ['parties', a.pid ?? PID];
  const party = tree.parties?.[a.pid ?? PID];
  switch (op) {
    case 'createParty': {
      const codes = a.codes ?? [];
      const value = { name: a.name ?? 'Test', admin: uid, createdAt: NOW };
      if (codes.length) value.codes = Object.fromEntries(codes.map((c, i) => [c, i]));
      return [{ path: P, value }, ...codes.map(c => ({ path: ['codes', c], value: a.pid ?? PID }))];
    }
    case 'addCode': return [{ path: ['codes', a.code], value: PID }, { path: [...P, 'codes', a.code], value: NOW }];
    case 'addFriend': {
      const v = { name: a.name, createdAt: NOW };
      if (a.max !== undefined) v.max = a.max;
      return [{ path: [...P, 'friends', a.f], value: v }];
    }
    case 'setMax': return [{ path: [...P, 'friends', a.f, 'max'], value: a.max }];
    case 'addMe': return [{ path: [...P, 'friends', a.f], value: { name: a.name, createdAt: NOW } }, { path: [...P, 'claims', a.f], value: uid }, { path: [...P, 'members', uid], value: a.f }];
    case 'rotate': return [{ path: ['codes', a.code], value: a.pid ?? PID }, { path: [...P, 'codes', a.code], value: NOW }, ...a.old.flatMap(c => [{ path: ['codes', c], value: null }, { path: [...P, 'codes', c], value: null }])];
    case 'closeDisable': return [{ path: [...P, 'closedAt'], value: NOW }, ...a.codes.flatMap(c => [{ path: ['codes', c], value: null }, { path: [...P, 'codes', c], value: null }])];
    case 'disableAll': return a.codes.flatMap(c => [{ path: ['codes', c], value: null }, { path: [...P, 'codes', c], value: null }]);
    case 'removeFriend': {
      const w = [{ path: [...P, 'friends', a.f], value: null }];
      for (const [id, d] of Object.entries(party?.doses ?? {})) if (d.friendId === a.f) w.push({ path: [...P, 'doses', id], value: null });
      const owner = party?.claims?.[a.f];
      if (owner) w.push({ path: [...P, 'claims', a.f], value: null }, { path: [...P, 'members', owner], value: null });
      return w;
    }
    case 'delClaimOnly': { // what the old adapter did for an unclaimed friend
      return [{ path: [...P, 'friends', a.f], value: null }, { path: [...P, 'claims', a.f], value: null }];
    }
    case 'addDose': return [{ path: [...P, 'doses', a.d], value: { friendId: a.f, size: a.size ?? 1, t: a.t ?? NOW, addedAt: NOW } }];
    case 'setT': return [{ path: [...P, 'doses', a.d, 't'], value: a.t }];
    case 'moveDose': return [{ path: [...P, 'doses', a.d, 'friendId'], value: a.f }];
    case 'delDose': return [{ path: [...P, 'doses', a.d], value: null }];
    case 'claim': return [{ path: [...P, 'claims', a.f], value: uid }, { path: [...P, 'members', uid], value: a.f }];
    case 'release': {
      const owner = party?.claims?.[a.f] ?? uid;
      return [{ path: [...P, 'claims', a.f], value: null }, { path: [...P, 'members', owner], value: null }];
    }
    case 'close': return [{ path: [...P, 'closedAt'], value: NOW }];
    case 'rename': return [{ path: [...P, 'friends', a.f, 'name'], value: a.name }];
    case 'delCode': return [{ path: ['codes', a.code], value: null }, { path: [...P, 'codes', a.code], value: null }];
    default: throw new Error('op ' + op);
  }
}

// ---- dev side: op -> HTTP ----
function toHttp(op, a, ids) {
  const base = `/api/parties/${a.pid ?? PID}`;
  const fid = n => ids.get('f:' + n) ?? 'unknown';
  const did = n => ids.get('d:' + n) ?? 'unknown';
  switch (op) {
    case 'createParty': return ['POST', '/api/parties', { id: a.pid ?? PID, name: a.name ?? 'Test', createdAt: NOW, codes: a.codes ?? [] }];
    case 'addCode': return ['POST', `${base}/codes`, { code: a.code, createdAt: NOW }];
    case 'addFriend': return ['POST', `${base}/friends`, { name: a.name, createdAt: NOW, ...(a.max !== undefined ? { max: a.max } : {}) }, 'f:' + a.f];
    case 'setMax': return ['PATCH', `${base}/friends/${fid(a.f)}`, { max: a.max }];
    case 'addMe': return ['POST', `${base}/friends`, { name: a.name, claim: true }, 'f:' + a.f];
    case 'rotate': return ['POST', `${base}/codes/rotate`, { code: a.code, old: a.old }];
    case 'closeDisable': return ['POST', `${base}/close`, { disableLink: true }];
    case 'disableAll': return ['DELETE', `${base}/codes`];
    case 'removeFriend': return ['DELETE', `${base}/friends/${fid(a.f)}`];
    case 'addDose': return ['POST', `${base}/doses`, { id: a.d, friendId: fid(a.f), size: a.size ?? 1, t: a.t ?? NOW, addedAt: NOW }, 'd:' + a.d];
    case 'setT': return ['PATCH', `${base}/doses/${did(a.d)}`, { t: a.t }];
    case 'moveDose': return ['PATCH', `${base}/doses/${did(a.d)}`, { friendId: fid(a.f) }];
    case 'delDose': return ['DELETE', `${base}/doses/${did(a.d)}`];
    case 'claim': return ['POST', `${base}/claims`, { friendId: fid(a.f) }];
    case 'release': return ['DELETE', `${base}/claims/${fid(a.f)}`];
    case 'delClaimOnly': return ['DELETE', `${base}/claims/${fid(a.f)}`]; // a claim that does not exist cannot be deleted
    case 'close': return ['POST', `${base}/close`, {}];
    case 'rename': return ['PATCH', `${base}/friends/${fid(a.f)}`, { name: a.name }];
    case 'delCode': return ['DELETE', `${base}/codes/${a.code}`];
    default: throw new Error('op ' + op);
  }
}

const mkSession = async (srv, uid) => (await (await fetch(`http://localhost:${srv.port}/api/session`, { method: 'POST', body: JSON.stringify({ uid }) })).json()).secret;

async function run(steps) {
  const CREATORS = ['uid-admin', 'uid-bob'];
  const srv = await startServer({ port: 0, creators: CREATORS, now: () => NOW });
  const tree = { creators: Object.fromEntries(CREATORS.map(c => [c, true])) };
  const secrets = {};
  const ids = new Map();
  try {
    for (const [who, op, args, expected] of steps) {
      const writes = toWrites(op, args, tree, who);
      const rulesOk = checkUpdate(rules, tree, writes, { uid: uidOf(who) }, NOW);
      const [method, url, body, save] = toHttp(op, args, ids);
      const res = await fetch(`http://localhost:${srv.port}${url}`, {
        method, headers: { 'x-uid': uidOf(who), 'x-secret': secrets[who] ??= await mkSession(srv, uidOf(who)), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      const j = await res.json().catch(() => ({}));
      const devOk = res.status < 300;
      if (devOk && save && j.id) ids.set(save, j.id);
      const label = `${who} ${op} ${JSON.stringify(args)}`;
      assert.equal(devOk, expected === 'ok', `dev server: ${label} -> ${res.status}`);
      assert.equal(rulesOk, expected === 'ok', `rules: ${label}`);
    }
  } finally { await srv.close(); }
}

const longName = 'x'.repeat(15);

test('parity: party creation, codes, friends, max', async () => {
  await run([
    ['admin', 'createParty', { codes: ['Tok8209Alpha'] }, 'ok'],
    ['alice', 'createParty', { codes: [] }, 'deny'], // same id exists
    ['bob', 'createParty', { pid: 'party-test-0002', codes: ['Tok8209Alpha'] }, 'deny'], // taken PIN
    ['bob', 'createParty', { pid: 'party-test-0003', codes: ['12'] }, 'deny'], // not 4 digits
    ['bob', 'createParty', { pid: 'party-test-0004', codes: ['abcd'] }, 'deny'],
    ['bob', 'createParty', { pid: 'party-test-0005', name: '' }, 'deny'],
    ['bob', 'createParty', { pid: 'party-test-0006', name: 'y'.repeat(31) }, 'deny'],
    ['bob', 'createParty', { pid: 'party-test-0007', name: 'y'.repeat(30), codes: ['Tok1111Alpha'] }, 'ok'],
    ['alice', 'addFriend', { f: 'f1', name: 'Sanne' }, 'deny'],
    ['admin', 'addFriend', { f: 'f1', name: 'Sanne' }, 'ok'],
    ['admin', 'addFriend', { f: 'f2', name: longName }, 'deny'],
    ['admin', 'addFriend', { f: 'f2', name: '' }, 'deny'],
    ['admin', 'addFriend', { f: 'f2', name: 'x'.repeat(14), max: 0.3 }, 'deny'],
    ['admin', 'addFriend', { f: 'f2', name: 'Joris', max: 1.5 }, 'ok'],
    ['alice', 'setMax', { f: 'f1', max: 2 }, 'deny'],
    ['admin', 'setMax', { f: 'f1', max: 1.25 }, 'ok'],
    ['admin', 'setMax', { f: 'f1', max: 21 }, 'deny'],
    ['admin', 'setMax', { f: 'f1', max: 0.1 }, 'deny'],
    ['admin', 'setMax', { f: 'f1', max: null }, 'ok'],
    ['bob', 'addCode', { code: 'Tok7815Alpha' }, 'deny'], // non-admin adds a PIN
    ['admin', 'addCode', { code: 'Tok7815Alpha' }, 'ok'],
    ['admin', 'addCode', { code: 'Tok8209Alpha' }, 'deny'], // taken
    ['admin', 'addCode', { code: 'Tok1111Alpha' }, 'deny'], // taken by another party
    ['admin', 'addCode', { code: 'abcd' }, 'deny'],
    ['admin', 'addCode', { code: '123' }, 'deny'],
    ['alice', 'rename', { f: 'f1', name: 'Hacked' }, 'deny'],
    ['admin', 'rename', { f: 'f1', name: 'Sanne2' }, 'ok'],
    ['admin', 'rename', { f: 'f1', name: '' }, 'deny'],
    ['admin', 'rename', { f: 'f1', name: longName }, 'deny'],
    ['bob', 'delCode', { code: 'Tok7815Alpha' }, 'deny'],
    ['admin', 'delCode', { code: 'Tok7815Alpha' }, 'ok'],
    ['admin', 'delCode', { code: 'Tok7815Alpha' }, 'deny'], // already gone
    ['admin', 'addCode', { code: 'Tok7815Alpha' }, 'ok'], // free again
    ['alice', 'close', {}, 'deny'],
    ['admin', 'close', {}, 'ok'],
    ['admin', 'close', {}, 'deny'],
    ['admin', 'addFriend', { f: 'f3', name: 'Daan' }, 'deny'],
    ['admin', 'setMax', { f: 'f1', max: 3 }, 'deny'],
    ['admin', 'addCode', { code: 'Tok5555Alpha' }, 'deny'],
    ['admin', 'delCode', { code: 'Tok7815Alpha' }, 'ok'], // deleting codes stays allowed after closing
    ['admin', 'rename', { f: 'f1', name: 'Late' }, 'deny'],
    ['admin', 'removeFriend', { f: 'f1' }, 'deny'],
    ['admin', 'addDose', { d: 'd1', f: 'f1' }, 'deny'],
    ['admin', 'claim', { f: 'f1' }, 'deny'],
  ]);
});

test('parity: doses, validation, own-friend only, claims', async () => {
  await run([
    ['admin', 'createParty', { codes: ['Tok8209Alpha'] }, 'ok'],
    ['admin', 'addFriend', { f: 'f1', name: 'Sanne' }, 'ok'],
    ['admin', 'addFriend', { f: 'f2', name: 'Joris' }, 'ok'],
    ['alice', 'addDose', { d: 'd0', f: 'f1' }, 'deny'], // no claim yet
    ['admin', 'addDose', { d: 'd1', f: 'f1', size: 1 }, 'ok'],
    ['admin', 'addDose', { d: 'dx', f: 'f1', size: 0.3 }, 'deny'],
    ['admin', 'addDose', { d: 'dx', f: 'f1', size: 2 }, 'deny'],
    ['admin', 'addDose', { d: 'dx', f: 'f1', t: NOW + 6 * MIN }, 'deny'],
    ['admin', 'addDose', { d: 'd2', f: 'f1', t: NOW + 4 * MIN, size: 0.25 }, 'ok'],
    ['admin', 'addDose', { d: 'dx', f: 'nope' }, 'deny'],
    ['admin', 'setT', { d: 'd1', t: NOW - 100 * MIN }, 'ok'],
    ['admin', 'setT', { d: 'd1', t: NOW + 6 * MIN }, 'deny'],
    ['admin', 'delDose', { d: 'd2' }, 'ok'],
    // claims
    ['alice', 'claim', { f: 'f1' }, 'ok'],
    ['bob', 'claim', { f: 'f1' }, 'deny'], // double claim of one friend
    ['alice', 'claim', { f: 'f2' }, 'deny'], // two claims by one uid
    ['bob', 'claim', { f: 'f2' }, 'ok'],
    ['bob', 'release', { f: 'f1' }, 'deny'], // not the owner
    // own vs other friend
    ['alice', 'addDose', { d: 'd3', f: 'f1', size: 0.5 }, 'ok'],
    ['alice', 'addDose', { d: 'dx', f: 'f2' }, 'deny'],
    ['alice', 'setT', { d: 'd1', t: NOW - 50 * MIN }, 'ok'],
    ['admin', 'addDose', { d: 'd4', f: 'f2' }, 'ok'],
    ['alice', 'setT', { d: 'd4', t: NOW - 5 * MIN }, 'deny'],
    ['alice', 'delDose', { d: 'd4' }, 'deny'],
    ['alice', 'moveDose', { d: 'd3', f: 'f2' }, 'deny'], // moving a dose to someone else
    ['alice', 'moveDose', { d: 'd4', f: 'f1' }, 'deny'], // pulling someone else's dose to me
    ['bob', 'delDose', { d: 'd4' }, 'ok'],
    ['alice', 'delDose', { d: 'd3' }, 'ok'],
    ['admin', 'moveDose', { d: 'd1', f: 'f2' }, 'deny'], // friendId is immutable for everyone
    // release
    ['alice', 'release', { f: 'f1' }, 'ok'],
    ['alice', 'addDose', { d: 'd5', f: 'f1' }, 'deny'], // claim gone
    ['alice', 'claim', { f: 'f2' }, 'deny'], // bob still owns f2
    ['alice', 'claim', { f: 'f1' }, 'ok'],
    ['bob', 'claim', { f: 'f1' }, 'deny'],
    ['alice', 'release', { f: 'f2' }, 'deny'],
    ['admin', 'release', { f: 'f1' }, 'ok'], // admin override
    ['alice', 'addDose', { d: 'd6', f: 'f1' }, 'deny'],
    ['bob', 'claim', { f: 'f1' }, 'deny'], // bob still has f2
    ['bob', 'release', { f: 'f2' }, 'ok'],
    ['bob', 'claim', { f: 'f1' }, 'ok'],
    ['bob', 'addDose', { d: 'd7', f: 'f1' }, 'ok'],
    // friend removal cascades and drops the claim
    ['alice', 'removeFriend', { f: 'f1' }, 'deny'],
    ['bob', 'removeFriend', { f: 'f1' }, 'deny'],
    ['admin', 'removeFriend', { f: 'f1' }, 'ok'], // claimed friend: friend + claim + member + doses in one go
    ['admin', 'addFriend', { f: 'f3', name: 'Daan' }, 'ok'],
    ['admin', 'delClaimOnly', { f: 'f3' }, 'deny'], // deleting a claim that does not exist is rejected by both
    ['admin', 'removeFriend', { f: 'f3' }, 'ok'], // unclaimed friend: only the friend path
    ['alice', 'addMe', { f: 'f8', name: 'Hack' }, 'deny'], // non-admin cannot add a friend, claim or not
    ['admin', 'addMe', { f: 'f9', name: 'Michel' }, 'ok'], // admin: own name + claim + member in one atomic write
    ['admin', 'addMe', { f: 'f10', name: 'Twee' }, 'deny'], // the admin already has a claim in this party
    ['admin', 'addDose', { d: 'dm', f: 'f9' }, 'ok'],
    ['admin', 'release', { f: 'f9' }, 'ok'],
    ['admin', 'addMe', { f: 'f11', name: 'Weer' }, 'ok'], // free again after releasing
    ['bob', 'addDose', { d: 'd8', f: 'f1' }, 'deny'],
    ['admin', 'addDose', { d: 'd9', f: 'f1' }, 'deny'],
    ['bob', 'claim', { f: 'f2' }, 'ok'], // bob is free again
    // closed = read-only for everybody
    ['admin', 'close', {}, 'ok'],
    ['bob', 'addDose', { d: 'd10', f: 'f2' }, 'deny'],
    ['admin', 'addDose', { d: 'd10', f: 'f2' }, 'deny'],
    ['bob', 'setT', { d: 'd4', t: NOW }, 'deny'],
    ['admin', 'delDose', { d: 'd1' }, 'deny'],
    ['bob', 'release', { f: 'f2' }, 'deny'],
    ['admin', 'release', { f: 'f2' }, 'deny'],
  ]);
});

test('rules: reads — party/code by direct get, no listing', () => {
  const tree = {};
  const a = { uid: 'x' };
  assert.equal(checkRead(rules, tree, ['parties'], a), false);
  assert.equal(checkRead(rules, tree, ['codes'], a), false);
  assert.equal(checkRead(rules, tree, [], a), false);
  assert.equal(checkRead(rules, tree, ['parties', PID], a), true);
  assert.equal(checkRead(rules, tree, ['codes', 'Tok8209Alpha'], a), true);
  assert.equal(checkRead(rules, tree, ['parties', PID], null), false);
  assert.equal(checkRead(rules, tree, ['codes', 'Tok8209Alpha'], null), false);
});

test('rules: unauthenticated writes are denied; admin cannot be spoofed', () => {
  const tree = { creators: { a: true } };
  assert.equal(checkUpdate(rules, tree, [{ path: ['parties', PID], value: { name: 'x', admin: 'a', createdAt: NOW } }], null, NOW), false);
  assert.equal(checkUpdate(rules, tree, [{ path: ['parties', PID], value: { name: 'x', admin: 'someone-else', createdAt: NOW } }], { uid: 'a' }, NOW), false);
  assert.equal(checkUpdate(rules, tree, [{ path: ['parties', PID], value: { name: 'x', admin: 'a', createdAt: NOW } }], { uid: 'a' }, NOW), true);
  // changing admin afterwards is not possible, not even for the admin
  assert.equal(checkUpdate(rules, tree, [{ path: ['parties', PID, 'admin'], value: 'b' }], { uid: 'a' }, NOW), false);
  // codes are never overwritten or deleted by anyone
  assert.equal(checkUpdate(rules, tree, [{ path: ['codes', 'Tok8209Alpha'], value: PID }, { path: ['parties', PID, 'codes', 'Tok8209Alpha'], value: NOW }], { uid: 'a' }, NOW), true);
  assert.equal(checkUpdate(rules, tree, [{ path: ['codes', 'Tok8209Alpha'], value: null }], { uid: 'a' }, NOW), false);
  assert.equal(checkUpdate(rules, tree, [{ path: ['codes', 'Tok8209Alpha'], value: PID }], { uid: 'a' }, NOW), false);
  // a stranger cannot attach a code to someone else's party
  assert.equal(checkUpdate(rules, tree, [{ path: ['codes', 'Tok4444Alpha'], value: PID }], { uid: 'mallory' }, NOW), false);
});

test('parity: new link and switching the link off are atomic and admin-only', async () => {
  await run([
    ['admin', 'createParty', { codes: ['TokPar1AAAAa', 'TokPar2BBBBb'] }, 'ok'],
    ['bob', 'rotate', { code: 'TokParNewAAAA', old: ['TokPar1AAAAa'] }, 'deny'], // not the admin
    ['admin', 'rotate', { code: 'TokPar2BBBBb', old: ['TokPar1AAAAa'] }, 'deny'], // new token already taken
    ['admin', 'rotate', { code: 'TokParNewAAAA', old: ['TokParNOPEAAA'] }, 'deny'], // old token is not this party's
    ['admin', 'rotate', { code: 'short', old: ['TokPar1AAAAa'] }, 'deny'], // invalid token
    ['admin', 'rotate', { code: 'TokParNewAAAA', old: ['TokPar1AAAAa', 'TokPar2BBBBb'] }, 'ok'], // one write: in + both out
    ['admin', 'rotate', { code: 'TokParNew2AAA', old: ['TokParNewAAAA'] }, 'ok'],
    ['bob', 'closeDisable', { codes: ['TokParNew2AAA'] }, 'deny'],
    ['admin', 'closeDisable', { codes: ['TokParNew2AAA'] }, 'ok'], // closedAt + delete in one write
    ['admin', 'rotate', { code: 'TokParLateAAA', old: [] }, 'deny'], // closed: no new links
    ['admin', 'closeDisable', { codes: [] }, 'deny'], // already closed
    ['admin', 'createParty', { pid: 'party-test-0002', codes: ['TokPar3CCCCc'] }, 'ok'],
  ]);
  await run([
    ['admin', 'createParty', { codes: ['TokPar4DDDDd'] }, 'ok'],
    ['admin', 'close', {}, 'ok'], // closed with the link still on
    ['bob', 'disableAll', { codes: ['TokPar4DDDDd'] }, 'deny'],
    ['admin', 'disableAll', { codes: ['TokPar4DDDDd'] }, 'ok'], // the admin can still switch it off after closing
    ['admin', 'disableAll', { codes: ['TokPar4DDDDd'] }, 'deny'], // nothing left to delete
  ]);
});
