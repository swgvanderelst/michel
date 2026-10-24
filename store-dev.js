// Dev adapter: talks to dev-server.mjs (fetch + Server-Sent Events). Same interface as store-firebase.js.
import { newId } from './logic.js';

const err = (code, msg) => Object.assign(new Error(msg || code), { code });

export async function createStore() {
  const q = new URLSearchParams(location.search);
  const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  let uid = null, secret = null;

  async function register(want) {
    const res = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(want ? { uid: want } : {}) });
    if (!res.ok) return null;
    return res.json();
  }
  const valid = async (u, s) => {
    try { return (await fetch('/api/codes/0000', { headers: { 'x-uid': u, 'x-secret': s } })).status !== 401; } catch { return true; }
  };

  // dev-only test hook: ?devuid=dev-admin (+ &devsecret=..., dev-admin has a fixed secret in the seed)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const forced = local ? q.get('devuid') : null; // test hook: localhost only
  if (forced) {
    uid = forced;
    secret = q.get('devsecret') || (read('michel_dev_uid') === forced ? read('michel_dev_secret') : null) || (forced === 'dev-admin' && local ? 'dev-admin-secret' : null);
    if (!secret || !(await valid(uid, secret))) { const s = await register(forced); secret = s ? s.secret : secret; }
  } else {
    uid = read('michel_dev_uid'); secret = read('michel_dev_secret');
    if (!uid || !secret || !(await valid(uid, secret))) { const s = await register(); uid = s.uid; secret = s.secret; }
  }
  write('michel_dev_uid', uid); write('michel_dev_secret', secret || '');

  async function api(method, url, body) {
    let res;
    try {
      res = await fetch('/api' + url, {
        method, headers: { 'x-uid': uid, 'x-secret': secret, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw err('network'); }
    const json = await res.json().catch(() => null);
    if (res.status === 409) throw err('taken');
    if (res.status === 403) throw err('denied');
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw err('invalid', json && json.error);
    return json;
  }

  const listeners = new Set();
  let open = 0, online = true;
  const setOnline = v => { if (v !== online) { online = v; listeners.forEach(f => f(v)); } };

  return {
    kind: 'dev',
    uid,
    now: () => Date.now(),
    onOnline(cb) { listeners.add(cb); cb(online); return () => listeners.delete(cb); },
    async resolveCode(code) {
      const r = await api('GET', '/codes/' + code);
      return r.notFound ? null : r.partyId;
    },
    async fetchParty(pid) {
      const r = await api('GET', '/parties/' + pid);
      return r.notFound ? null : r;
    },
    watch(pid, cb) {
      const es = new EventSource(`/api/parties/${pid}/events?uid=${encodeURIComponent(uid)}&secret=${encodeURIComponent(secret)}`);
      let up = false;
      es.onopen = () => { if (!up) { up = true; open++; } setOnline(true); };
      es.onerror = () => { if (up) { up = false; open--; } if (open <= 0) setOnline(false); };
      es.onmessage = e => cb(JSON.parse(e.data));
      return () => { es.close(); if (up) open--; };
    },
    createParty: ({ id, name, codes }) => api('POST', '/parties', { id, name, codes }),
    addCode: (pid, code) => api('POST', `/parties/${pid}/codes`, { code }),
    deleteCode: (pid, code) => api('DELETE', `/parties/${pid}/codes/${code}`),
    async addFriend(pid, name, max) {
      const r = await api('POST', `/parties/${pid}/friends`, { name, ...(max != null ? { max } : {}) });
      return r.id;
    },
    async addFriendAndClaim(pid, name) {
      const r = await api('POST', `/parties/${pid}/friends`, { name, claim: true });
      return r.id;
    },
    renameFriend: (pid, fid, name) => api('PATCH', `/parties/${pid}/friends/${fid}`, { name }),
    setMax: (pid, fid, max) => api('PATCH', `/parties/${pid}/friends/${fid}`, { max }),
    removeFriend: (pid, _party, fid) => api('DELETE', `/parties/${pid}/friends/${fid}`),
    newDoseId: () => newId(Math.random, 16),
    // id is chosen by the client so a replay from the outbox is the same write
    async addDose(pid, { id, friendId, size, t }) {
      const r = await api('POST', `/parties/${pid}/doses`, { id, friendId, size, t });
      return r.id;
    },
    async hasDose(pid, did) { const r = await api('GET', '/parties/' + pid); return !!(r && r.doses && r.doses[did]); },
    setDoseTime: (pid, did, t) => api('PATCH', `/parties/${pid}/doses/${did}`, { t }),
    removeDose: (pid, did) => api('DELETE', `/parties/${pid}/doses/${did}`),
    claim: (pid, fid) => api('POST', `/parties/${pid}/claims`, { friendId: fid }),
    release: (pid, fid) => api('DELETE', `/parties/${pid}/claims/${fid}`),
    closeParty: pid => api('POST', `/parties/${pid}/close`, {}),
  };
}
