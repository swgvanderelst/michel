// Zero-dependency dev backend: static files + in-memory party store + SSE.
// Permissions and validation mirror database.rules.json exactly (see test/parity.test.js).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FUTURE_MS = 5 * 60 * 1000;
const SIZES = [1, 0.5, 0.25];
const KEY_RE = /^[-_A-Za-z0-9]{1,32}$/; // party/friend/dose ids and uids: safe to put in HTML attributes
const CODE_RE = /^[A-Za-z0-9]{10,32}$/; // long random join tokens (nobody types them)
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const STATIC_BLOCK = /^(dev-server\.mjs|package(-lock)?\.json|test|scripts|tools|node_modules|database\.rules\.json|assets\/splash-source\.[a-z]+)(\/|$)/;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isStr = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;
const isKey = v => typeof v === 'string' && KEY_RE.test(v);
const okTime = (v, now) => isNum(v) && v > 0 && v <= now + FUTURE_MS;
const okMax = v => v === null || (isNum(v) && v >= 0.25 && v <= 20 && v % 0.25 === 0);

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const deny = (msg = 'forbidden') => new HttpError(403, msg);
const bad = (msg = 'invalid') => new HttpError(400, msg);

function onlyKeys(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('body');
  for (const k of Object.keys(body)) if (!keys.includes(k)) throw bad('unknown field ' + k);
}
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * creators: array of uids allowed to create parties (mirrors the `creators` list in the rules),
 * or null = anybody (local convenience only, not what production does).
 */
export function startServer({ port = 8787, host = '127.0.0.1', persistFile = null, seed = false, creators = null, now = () => Date.now() } = {}) {
  let db = { parties: {}, codes: {}, sessions: {} };
  if (persistFile && fs.existsSync(persistFile)) {
    try { db = { sessions: {}, ...JSON.parse(fs.readFileSync(persistFile, 'utf8')) }; } catch { /* start empty */ }
  }
  const creatorSet = creators ? new Set(creators) : null;
  let saveT = null;
  const flush = () => { clearTimeout(saveT); saveT = null; if (persistFile) fs.writeFileSync(persistFile, JSON.stringify(db)); };
  const dirty = () => { if (persistFile && !saveT) saveT = setTimeout(flush, 200); };

  const watchers = new Map(); // partyId -> Set<res>
  const push = id => {
    const set = watchers.get(id);
    if (set) {
      const msg = `data: ${JSON.stringify(db.parties[id] ?? null)}\n\n`;
      for (const res of set) res.write(msg);
    }
    dirty();
  };

  if (seed) {
    // dev-only impersonation hook for testers: uid dev-admin with a fixed secret
    db.sessions['dev-admin'] = 'dev-admin-secret';
    if (creatorSet) creatorSet.add('dev-admin');
    if (!Object.values(db.parties).some(p => p.seedParty)) {
      const t = now(), id = 'p' + crypto.randomBytes(8).toString('hex');
      const friends = {};
      ['Sanne', 'Joris', 'Fem', 'Daan', 'Bart'].forEach((name, i) => { friends['seed-' + name.toLowerCase()] = { name, createdAt: t + i }; });
      const token = crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 12);
      db.parties[id] = { seedParty: true, name: 'AWAKENINGS ADE 2026', admin: 'dev-admin', createdAt: t, codes: { [token]: 0 }, friends };
      db.codes[token] = id;
    }
  }

  // ---- permission helpers (same semantics as the rules) ----
  const party = id => db.parties[id] ?? null;
  const needParty = id => { const p = party(id); if (!p) throw new HttpError(404, 'no such party'); return p; };
  const needOpen = p => { if (p.closedAt != null) throw deny('closed'); };
  const isMine = (p, uid, fid) => p.claims?.[fid] === uid;
  const needAdmin = (p, uid) => { if (p.admin !== uid) throw deny('admin only'); };
  // createdAt/addedAt are server time (like serverTimestamp()); a client value is validated but ignored
  const nameTaken = (p, name, exceptId) => Object.entries(p.friends || {}).some(([k, f]) => k !== exceptId && f.name.trim().toLowerCase() === name.trim().toLowerCase());
const checkStamp = body => { if ('createdAt' in body && !okTime(body.createdAt, now())) throw bad('createdAt'); };

  function api(method, parts, uid, body) {
    if (parts[0] === 'creators' && parts[1] === 'me' && parts.length === 2 && method === 'GET') return [200, { creator: !creatorSet || creatorSet.has(uid) }]; // own entry only, like the rules
    if (parts[0] === 'codes' && parts.length === 2 && method === 'GET') {
      const pid = db.codes[parts[1]];
      if (!pid) throw new HttpError(404, 'unknown code');
      return [200, { partyId: pid }];
    }
    if (parts[0] !== 'parties') throw new HttpError(404, 'not found');
    if (parts.length === 1) {
      if (method !== 'POST') throw new HttpError(404, 'parties cannot be listed');
      if (creatorSet && !creatorSet.has(uid)) throw deny('not an allowed creator');
      onlyKeys(body, ['id', 'name', 'createdAt', 'codes']);
      if (!isKey(body.id)) throw bad('id');
      if (!isStr(body.name, 1, 30)) throw bad('name');
      checkStamp(body);
      const codes = body.codes ?? [];
      if (!Array.isArray(codes) || new Set(codes).size !== codes.length) throw bad('codes');
      for (const c of codes) if (typeof c !== 'string' || !CODE_RE.test(c)) throw bad('code');
      if (party(body.id)) throw deny('exists');
      for (const c of codes) if (db.codes[c]) throw new HttpError(409, 'code taken');
      const t = now();
      db.parties[body.id] = { name: body.name, admin: uid, createdAt: t };
      if (codes.length) {
        db.parties[body.id].codes = {};
        codes.forEach((c, i) => { db.parties[body.id].codes[c] = i; db.codes[c] = body.id; }); // value = order, 0 = main code
      }
      push(body.id);
      return [201, { id: body.id }];
    }
    const id = parts[1];
    const p = needParty(id);
    const rest = parts.slice(2);

    if (rest.length === 0 && method === 'GET') return [200, p];
    if (rest[0] === 'events' && method === 'GET') return ['sse', id];

    if (rest[0] === 'close' && method === 'POST') {
      needAdmin(p, uid); needOpen(p);
      if (body !== undefined) onlyKeys(body, ['disableLink']);
      p.closedAt = now();
      if (body && body.disableLink === true) { for (const c of Object.keys(p.codes || {})) delete db.codes[c]; delete p.codes; } // closing and switching the link off in one atomic step
      push(id);
      return [200, { ok: true }];
    }

    if (rest[0] === 'codes') {
      if (rest.length === 1 && method === 'POST') {
        needAdmin(p, uid); needOpen(p);
        onlyKeys(body, ['code', 'createdAt']);
        if (typeof body.code !== 'string' || !CODE_RE.test(body.code)) throw bad('code');
        checkStamp(body);
        if (db.codes[body.code]) throw new HttpError(409, 'code taken');
        db.codes[body.code] = id;
        (p.codes ||= {})[body.code] = now();
        push(id);
        return [201, { code: body.code }];
      }
      if (rest.length === 2 && rest[1] === 'rotate' && method === 'POST') { // new link: add the new token and delete the old ones, atomically
        needAdmin(p, uid); needOpen(p);
        onlyKeys(body, ['code', 'old']);
        if (typeof body.code !== 'string' || !CODE_RE.test(body.code)) throw bad('code');
        if (!Array.isArray(body.old) || body.old.some(c => p.codes?.[c] === undefined || db.codes[c] !== id)) throw bad('old');
        if (db.codes[body.code]) throw new HttpError(409, 'code taken');
        for (const c of body.old) { delete p.codes[c]; delete db.codes[c]; }
        db.codes[body.code] = id;
        (p.codes ||= {})[body.code] = now();
        push(id);
        return [200, { code: body.code }];
      }
      if (rest.length === 1 && method === 'DELETE') { // switch the link off (admin, also after closing)
        needAdmin(p, uid);
        if (!Object.keys(p.codes || {}).length) throw new HttpError(404, 'no codes');
        for (const c of Object.keys(p.codes || {})) delete db.codes[c];
        delete p.codes;
        push(id);
        return [200, { ok: true }];
      }
      if (rest.length === 2 && method === 'DELETE') {
        needAdmin(p, uid); // also allowed after closing
        if (p.codes?.[rest[1]] === undefined || db.codes[rest[1]] !== id) throw new HttpError(404, 'no such code');
        delete p.codes[rest[1]];
        delete db.codes[rest[1]];
        push(id);
        return [200, { ok: true }];
      }
    }

    if (rest[0] === 'claims') {
      if (rest.length === 1 && method === 'POST') {
        needOpen(p);
        onlyKeys(body, ['friendId']);
        if (typeof body.friendId !== 'string' || !p.friends?.[body.friendId]) throw bad('friendId');
        if (p.claims?.[body.friendId] || p.members?.[uid]) throw deny('already claimed');
        (p.claims ||= {})[body.friendId] = uid;
        (p.members ||= {})[uid] = body.friendId;
        push(id);
        return [201, { ok: true }];
      }
      if (rest.length === 2 && method === 'DELETE') {
        needOpen(p);
        const owner = p.claims?.[rest[1]];
        if (p.admin !== uid && owner !== uid) throw deny('not yours');
        if (!owner) throw new HttpError(404, 'no such claim');
        delete p.claims[rest[1]];
        delete p.members[owner];
        push(id);
        return [200, { ok: true }];
      }
    }

    if (rest[0] === 'friends') {
      if (rest.length === 1 && method === 'POST') {
        needOpen(p);
        onlyKeys(body, ['name', 'createdAt', 'max', 'claim']);
        if (p.admin !== uid && (body.claim !== true || body.max != null)) throw deny('members may only add themselves, without max'); // one self-added friend per phone
        if (body.claim === true && p.members?.[uid]) throw deny('already claimed'); // own name AND claim, atomically
        if (!isStr(body.name, 1, 14)) throw bad('name');
        if (nameTaken(p, body.name)) throw new HttpError(409, 'name taken');
        checkStamp(body);
        if (body.max !== undefined && !okMax(body.max)) throw bad('max');
        const fid = crypto.randomBytes(6).toString('base64url');
        const f = { name: body.name, createdAt: now() };
        if (body.max != null) f.max = body.max;
        (p.friends ||= {})[fid] = f;
        if (body.claim === true) { (p.claims ||= {})[fid] = uid; (p.members ||= {})[uid] = fid; }
        push(id);
        return [201, { id: fid }];
      }
      const f = p.friends?.[rest[1]];
      if (rest.length === 2 && (method === 'PATCH' || method === 'DELETE')) {
        needAdmin(p, uid); needOpen(p);
        if (!f) throw new HttpError(404, 'no such friend');
        if (method === 'PATCH') {
          onlyKeys(body, ['name', 'max']);
          if ('name' in body && !isStr(body.name, 1, 14)) throw bad('name');
          if ('name' in body && nameTaken(p, body.name, rest[1])) throw new HttpError(409, 'name taken');
          if ('max' in body && !okMax(body.max)) throw bad('max');
          if ('name' in body) f.name = body.name;
          if ('max' in body) { if (body.max === null) delete f.max; else f.max = body.max; }
        } else {
          delete p.friends[rest[1]];
          const owner = p.claims?.[rest[1]];
          if (p.claims) delete p.claims[rest[1]];
          if (owner && p.members) delete p.members[owner];
          for (const [did, d] of Object.entries(p.doses || {})) if (d.friendId === rest[1]) delete p.doses[did];
        }
        push(id);
        return [200, { ok: true }];
      }
    }

    if (rest[0] === 'doses') {
      if (rest.length === 1 && method === 'POST') {
        needOpen(p);
        onlyKeys(body, ['id', 'friendId', 'size', 't', 'addedAt']);
        if (typeof body.friendId !== 'string' || !p.friends?.[body.friendId]) throw bad('friendId'); // validation before permission
        if (p.admin !== uid && !isMine(p, uid, body.friendId)) throw deny('not your friend');
        if (!SIZES.includes(body.size)) throw bad('size');
        if (!okTime(body.t, now())) throw bad('t');
        if ('addedAt' in body && !okTime(body.addedAt, now())) throw bad('addedAt');
        const did = body.id ?? crypto.randomBytes(6).toString('base64url');
        if (!isKey(did)) throw bad('id');
        if (p.doses?.[did]) throw deny('exists'); // addedAt is immutable, so a re-set is not allowed
        (p.doses ||= {})[did] = { friendId: body.friendId, size: body.size, t: body.t, addedAt: now() };
        push(id);
        return [201, { id: did }];
      }
      if (rest.length === 2 && (method === 'PATCH' || method === 'DELETE')) {
        needOpen(p);
        const d = p.doses?.[rest[1]];
        if (!d) throw new HttpError(404, 'no such dose');
        if (p.admin !== uid && !isMine(p, uid, d.friendId)) throw deny('not your friend');
        if (method === 'PATCH') {
          onlyKeys(body, ['t']);
          if (!okTime(body.t, now())) throw bad('t');
          d.t = body.t;
        } else delete p.doses[rest[1]];
        push(id);
        return [200, { ok: true }];
      }
    }
    throw new HttpError(404, 'not found');
  }

  const readBody = req => new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 100000) { reject(bad('too large')); req.destroy(); } });
    req.on('end', () => {
      if (!s) return resolve(undefined);
      try { resolve(JSON.parse(s)); } catch { reject(bad('json')); }
    });
    req.on('error', reject);
  });

  const json = (res, status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  function serveStatic(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return json(res, 400, { error: 'bad path' }); }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const abs = path.resolve(ROOT, rel);
    const relOut = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (relOut.startsWith('..') || path.isAbsolute(relOut) || relOut.split('/').some(s => s.startsWith('.')) || STATIC_BLOCK.test(relOut)) {
      return json(res, 404, { error: 'not found' });
    }
    fs.readFile(abs, (err, buf) => {
      if (err) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });
        return serveStatic(req, res, url.pathname);
      }
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : undefined;
      // POST /api/session {uid?} -> {uid, secret}: the dev stand-in for anonymous auth
      if (url.pathname === '/api/session' && req.method === 'POST') {
        const want = body && body.uid;
        if (want !== undefined && !isKey(want)) throw bad('uid');
        const uid = want ?? 'u-' + crypto.randomBytes(8).toString('hex');
        if (db.sessions[uid]) throw new HttpError(409, 'uid taken');
        db.sessions[uid] = crypto.randomBytes(16).toString('hex');
        dirty();
        return json(res, 201, { uid, secret: db.sessions[uid] });
      }
      // EventSource cannot set headers, so SSE may pass uid/secret as query parameters
      const uid = req.headers['x-uid'] || url.searchParams.get('uid');
      const secret = req.headers['x-secret'] || url.searchParams.get('secret');
      if (!isKey(uid) || typeof secret !== 'string' || !db.sessions[uid] || !sameSecret(db.sessions[uid], secret)) throw new HttpError(401, 'auth required');
      const parts = url.pathname.split('/').slice(2).filter(Boolean);
      const out = api(req.method, parts, uid, body);
      if (out[0] === 'sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`retry: 1000\ndata: ${JSON.stringify(party(out[1]))}\n\n`);
        if (!watchers.has(out[1])) watchers.set(out[1], new Set());
        watchers.get(out[1]).add(res);
        req.on('close', () => watchers.get(out[1])?.delete(res));
        return;
      }
      json(res, out[0], out[1]);
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      console.error(e);
      json(res, 500, { error: 'server error' });
    }
  });

  const ping = setInterval(() => { for (const set of watchers.values()) for (const r of set) r.write(': ping\n\n'); }, 20000);
  ping.unref();

  return new Promise(resolve => {
    server.listen(port, host, () => {
      resolve({
        server,
        port: server.address().port,
        db: () => db,
        seed: (() => { const [id, p] = Object.entries(db.parties).find(([, x]) => x.seedParty) || []; return id ? { partyId: id, code: Object.keys(p.codes || {})[0] } : null; })(),
        close() {
          clearInterval(ping);
          flush();
          for (const set of watchers.values()) for (const r of set) r.end();
          return new Promise(r => { server.close(r); server.closeAllConnections(); });
        },
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const persist = process.env.DEV_PERSIST === '0' ? null : path.join(ROOT, '.devdata.json');
  const seed = process.env.MICHEL_SEED === '1';
  // MICHEL_CREATORS=uid1,uid2 enforces the creator allow-list (dev-admin is added by the seed); unset = anybody
  const list = process.env.MICHEL_CREATORS;
  const s = await startServer({ port: Number(process.env.PORT) || 8787, host: process.env.HOST || '127.0.0.1', persistFile: persist, seed, creators: list ? list.split(',').map(x => x.trim()).filter(Boolean) : null });
  console.log(`De Michel dev server: http://localhost:${s.port}/${seed ? '  (seed: AWAKENINGS ADE 2026, admin uid dev-admin, secret dev-admin-secret)\n  join link: http://localhost:${s.port}/?p=${s.seed && s.seed.code}' : ''}`);
}
