// Firebase adapter: Realtime Database + Anonymous Auth (modular SDK from the gstatic CDN, pinned).
// Note: RTDB on the web keeps writes in memory while offline (no disk persistence); the app adds a
// persistent outbox for doses and caches the last snapshot per party in localStorage.
const V = '12.0.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}/`;
const err = (code, msg) => Object.assign(new Error(msg || code), { code });

export async function createStore(config) {
  const [{ initializeApp }, { getAuth, signInAnonymously, onAuthStateChanged }, db] = await Promise.all([
    import(CDN + 'firebase-app.js'),
    import(CDN + 'firebase-auth.js'),
    import(CDN + 'firebase-database.js'),
  ]);
  const { getDatabase, ref, onValue, get, set, update, push, serverTimestamp } = db;
  const app = initializeApp(config);
  const auth = getAuth(app);
  const user = await new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, u => { if (u) { off(); resolve(u); } });
    signInAnonymously(auth).catch(reject);
  });
  const uid = user.uid;
  const d = getDatabase(app);
  const R = p => ref(d, p);
  const ts = () => serverTimestamp(); // createdAt/addedAt are server time: a skewed phone clock cannot break them

  // t is checked against the server clock by the rules, so shift the phone clock by the measured offset
  let offset = 0;
  onValue(R('.info/serverTimeOffset'), s => { offset = Number(s.val()) || 0; });

  // permission errors from RTDB -> 'denied'; everything else -> 'network'
  const wrap = async fn => {
    try { return await fn(); } catch (e) {
      if (/permission_denied/i.test(String(e && (e.code || e.message)))) throw err('denied');
      throw err('network', e && e.message);
    }
  };
  const multi = updates => wrap(() => update(ref(d), updates)); // ref(d) = root; ref(d, '') is an invalid path in v12

  return {
    kind: 'firebase',
    uid,
    now: () => Date.now() + offset,
    onOnline(cb) { return onValue(R('.info/connected'), s => cb(s.val() === true)); },
    resolveCode: code => wrap(async () => (await get(R('codes/' + code))).val()),
    fetchParty: pid => wrap(async () => (await get(R('parties/' + pid))).val()),
    watch(pid, cb, onErr) { return onValue(R('parties/' + pid), s => cb(s.val()), e => onErr && onErr(e)); },
    async createParty({ id, name, codes }) {
      const party = { name, admin: uid, createdAt: ts() };
      if (codes.length) party.codes = Object.fromEntries(codes.map((c, i) => [c, i])); // value = order, 0 = main code
      const u = { ['parties/' + id]: party };
      for (const c of codes) u['codes/' + c] = id;
      try { await multi(u); } catch (e) {
        if (e.code === 'denied') for (const c of codes) if (await this.resolveCode(c).catch(() => null)) throw err('taken');
        throw e; // otherwise: this phone is not an allowed creator
      }
    },
    async addCode(pid, code) {
      try { await multi({ ['codes/' + code]: pid, [`parties/${pid}/codes/${code}`]: ts() }); } catch (e) {
        if (e.code === 'denied' && await this.resolveCode(code).catch(() => null)) throw err('taken');
        throw e;
      }
    },
    // new link in ONE write: the new token in, the old ones out
    async rotateLink(pid, code, old) {
      const u = { ['codes/' + code]: pid, [`parties/${pid}/codes/${code}`]: ts() };
      for (const c of old) { u['codes/' + c] = null; u[`parties/${pid}/codes/${c}`] = null; }
      try { await multi(u); } catch (e) {
        if (e.code === 'denied' && await this.resolveCode(code).catch(() => null)) throw err('taken');
        throw e;
      }
    },
    disableLink: (pid, codes) => multi(Object.fromEntries(codes.flatMap(c => [['codes/' + c, null], [`parties/${pid}/codes/${c}`, null]]))),
    isCreator: () => get(R(`creators/${uid}`)).then(s => s.val() === true, () => false), // reads only its own entry (the rules allow nothing else)
    deleteCode: (pid, code) => multi({ ['codes/' + code]: null, [`parties/${pid}/codes/${code}`]: null }),
    async addFriend(pid, name, max) {
      const r = push(R(`parties/${pid}/friends`));
      await wrap(() => set(r, { name, createdAt: ts(), ...(max != null ? { max } : {}) }));
      return r.key;
    },
    // admin adds their own name and claims it: friend + claim + member in one atomic write
    async addFriendAndClaim(pid, name) {
      const key = push(R(`parties/${pid}/friends`)).key;
      await multi({ [`parties/${pid}/friends/${key}`]: { name, createdAt: ts() }, [`parties/${pid}/claims/${key}`]: uid, [`parties/${pid}/members/${uid}`]: key });
      return key;
    },
    renameFriend: (pid, fid, name) => wrap(() => set(R(`parties/${pid}/friends/${fid}/name`), name)),
    setMax: (pid, fid, max) => wrap(() => set(R(`parties/${pid}/friends/${fid}/max`), max)),
    async removeFriend(pid, party, fid) {
      // the rules only allow deleting claims/members that exist, so include them only for a claimed friend
      const u = { [`parties/${pid}/friends/${fid}`]: null };
      for (const x of party.doses) if (x.friendId === fid && !x.pending) u[`parties/${pid}/doses/${x.id}`] = null;
      const owner = await wrap(async () => (await get(R(`parties/${pid}/claims/${fid}`))).val()); // fresh read right before the write (the snapshot can be stale)
      if (owner) { u[`parties/${pid}/claims/${fid}`] = null; u[`parties/${pid}/members/${owner}`] = null; }
      return multi(u);
    },
    newDoseId: pid => push(R(`parties/${pid}/doses`)).key,
    // id is chosen by the client so a replay from the outbox is the same write
    async addDose(pid, { id, friendId, size, t }) {
      await wrap(() => set(R(`parties/${pid}/doses/${id}`), { friendId, size, t, addedAt: ts() }));
      return id;
    },
    hasDose: (pid, did) => wrap(async () => (await get(R(`parties/${pid}/doses/${did}`))).exists()),
    setDoseTime: (pid, did, t) => wrap(() => set(R(`parties/${pid}/doses/${did}/t`), t)),
    removeDose: (pid, did) => wrap(() => set(R(`parties/${pid}/doses/${did}`), null)),
    claim: (pid, fid) => multi({ [`parties/${pid}/claims/${fid}`]: uid, [`parties/${pid}/members/${uid}`]: fid }),
    // owner is passed by the app (it knows party.claims); admins release other people's claims
    release: (pid, fid, owner = uid) => multi({ [`parties/${pid}/claims/${fid}`]: null, [`parties/${pid}/members/${owner}`]: null }),
    // closing (optionally with the link switched off) is ONE atomic write
    closeParty(pid, disableCodes = []) {
      const u = { [`parties/${pid}/closedAt`]: ts() };
      for (const c of disableCodes) { u['codes/' + c] = null; u[`parties/${pid}/codes/${c}`] = null; }
      return multi(u);
    },
  };
}
