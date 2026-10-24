// Rules-only attacks (no dev-server equivalent: the dev API cannot even express them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRules, checkUpdate, checkRead } from './rules-eval.js';

const NOW = 1_800_000_000_000;
const PID = 'party-test-0001';
const rules = loadRules();

function world() {
  const tree = { creators: { adm: true } };
  const A = { uid: 'adm' }, U = { uid: 'usr' };
  const ok = (writes, auth = A) => checkUpdate(rules, tree, writes, auth, NOW);
  const P = ['parties', PID];
  assert.ok(ok([{ path: P, value: { name: 'N', admin: 'adm', createdAt: NOW, codes: { 8209: NOW } } }, { path: ['codes', '8209'], value: PID }]));
  assert.ok(ok([{ path: [...P, 'friends', 'f1'], value: { name: 'Sanne', createdAt: NOW } }, { path: [...P, 'friends', 'f2'], value: { name: 'Joris', createdAt: NOW } }]));
  assert.ok(ok([{ path: [...P, 'claims', 'f1'], value: 'usr' }, { path: [...P, 'members', 'usr'], value: 'f1' }], U));
  assert.ok(ok([{ path: [...P, 'doses', 'd1'], value: { friendId: 'f1', size: 1, t: NOW, addedAt: NOW } }], U));
  return { tree, A, U, P, ok };
}

test('rules: keys and values must be HTML-safe', () => {
  const { A, U, P, ok } = world();
  const evil = '"><img src=x onerror=alert(1)>';
  assert.equal(ok([{ path: ['parties', evil], value: { name: 'N', admin: 'adm', createdAt: NOW } }]), false);
  assert.equal(ok([{ path: ['parties', 'x'.repeat(33)], value: { name: 'N', admin: 'adm', createdAt: NOW } }]), false);
  assert.equal(ok([{ path: [...P, 'friends', evil], value: { name: 'X', createdAt: NOW } }]), false);
  assert.equal(ok([{ path: [...P, 'friends', 'a b'], value: { name: 'X', createdAt: NOW } }]), false);
  assert.equal(ok([{ path: [...P, 'doses', evil], value: { friendId: 'f1', size: 1, t: NOW, addedAt: NOW } }], U), false);
  assert.equal(ok([{ path: [...P, 'doses', "x'y"], value: { friendId: 'f1', size: 1, t: NOW, addedAt: NOW } }], A), false);
  assert.equal(ok([{ path: ['codes', '1234'], value: evil }, { path: [...P, 'codes', '1234'], value: NOW }]), false);
  assert.equal(ok([{ path: [...P, 'members', evil], value: 'f2' }], { uid: evil }), false);
  assert.equal(ok([{ path: [...P, 'friends', 'f9'], value: { name: 'X', createdAt: NOW, photo: 'x' } }]), false); // unknown field
  assert.equal(ok([{ path: [...P, 'friends', 'f9'], value: { name: 'X', createdAt: NOW } }]), true); // sanity: normal ids still work
});

test('rules: only allow-listed creators; the creators list is not accessible', () => {
  const { tree, ok } = world();
  assert.equal(ok([{ path: ['parties', 'other-party'], value: { name: 'N', admin: 'nobody', createdAt: NOW } }], { uid: 'nobody' }), false);
  assert.equal(ok([{ path: ['creators', 'nobody'], value: true }], { uid: 'nobody' }), false);
  assert.equal(ok([{ path: ['creators', 'adm'], value: null }], { uid: 'adm' }), false);
  assert.equal(checkRead(rules, tree, ['creators'], { uid: 'adm' }), false);
  assert.equal(checkRead(rules, tree, ['creators', 'adm'], { uid: 'adm' }), false);
  assert.equal(ok([{ path: ['parties', 'other-party'], value: { name: 'N', admin: 'adm', createdAt: NOW } }]), true);
});

test('rules: creation cannot seed claims, members, doses or closedAt', () => {
  const base = { name: 'N', admin: 'adm', createdAt: NOW };
  const A = { uid: 'adm' };
  const friends = { f1: { name: 'A', createdAt: NOW } };
  for (const extra of [{ claims: { f1: 'adm' } }, { members: { adm: 'f1' } }, { doses: { d1: { friendId: 'f1', size: 1, t: NOW, addedAt: NOW } } }, { closedAt: NOW }]) {
    assert.equal(checkUpdate(rules, { creators: { adm: true } }, [{ path: ['parties', 'new-party'], value: { ...base, friends, ...extra } }], A, NOW), false, JSON.stringify(Object.keys(extra)));
  }
  assert.equal(checkUpdate(rules, { creators: { adm: true } }, [{ path: ['parties', 'new-party'], value: { ...base, friends } }], A, NOW), true);
});

test('rules: party codes and root codes always pair', () => {
  const { P, ok } = world();
  assert.equal(ok([{ path: [...P, 'codes', '1111'], value: NOW }]), false); // party entry without root entry
  assert.equal(ok([{ path: ['codes', '2222'], value: PID }]), false); // root entry without party entry
  assert.equal(ok([{ path: ['codes', '3333'], value: PID }, { path: [...P, 'codes', '3333'], value: NOW }]), true);
  assert.equal(ok([{ path: ['codes', '3333'], value: null }]), false); // only the root half
  assert.equal(ok([{ path: ['codes', '3333'], value: null }, { path: [...P, 'codes', '3333'], value: null }]), true);
  assert.equal(ok([{ path: ['codes', '8209'], value: null }, { path: [...P, 'codes', '8209'], value: null }], { uid: 'usr' }), false); // not admin
});

test('rules: claims and members stay paired; nobody can half-delete', () => {
  const { A, U, P, ok } = world();
  assert.equal(ok([{ path: [...P, 'members', 'usr'], value: null }], A), false); // members only
  assert.equal(ok([{ path: [...P, 'claims', 'f1'], value: null }], A), false); // claim only
  assert.equal(ok([{ path: [...P, 'members', 'usr'], value: null }], U), false); // owner: members only
  assert.equal(ok([{ path: [...P, 'claims', 'f2'], value: 'usr' }], U), false); // claim without members entry
  assert.equal(ok([{ path: [...P, 'members', 'usr'], value: 'f2' }], U), false); // members without claim
  assert.equal(ok([{ path: [...P, 'claims', 'f1'], value: null }, { path: [...P, 'members', 'usr'], value: null }], A), true);
});

test('rules: friend rename is admin-only and validated; dose fields cannot be deleted one by one', () => {
  const { A, U, P, ok } = world();
  assert.equal(ok([{ path: [...P, 'friends', 'f1', 'name'], value: 'Mine' }], U), false); // not even the claim owner
  assert.equal(ok([{ path: [...P, 'friends', 'f1', 'name'], value: '' }], A), false);
  assert.equal(ok([{ path: [...P, 'friends', 'f1', 'name'], value: 'x'.repeat(15) }], A), false);
  assert.equal(ok([{ path: [...P, 'friends', 'f1', 'name'], value: null }], A), false);
  assert.equal(ok([{ path: [...P, 'friends', 'f1', 'name'], value: 'Renamed' }], A), true);
  for (const f of ['size', 'friendId', 't', 'addedAt']) {
    assert.equal(ok([{ path: [...P, 'doses', 'd1', f], value: null }], U), false, 'member deletes ' + f);
    assert.equal(ok([{ path: [...P, 'doses', 'd1', f], value: null }], A), false, 'admin deletes ' + f);
  }
  assert.equal(ok([{ path: [...P, 'doses', 'd1', 't'], value: NOW - 60000 }], U), true); // editing is fine
  assert.equal(ok([{ path: [...P, 'doses', 'd1'], value: null }], U), true); // deleting the whole dose too
});
