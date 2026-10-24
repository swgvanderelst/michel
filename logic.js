// Pure helpers shared by the app, the dev server and the tests.
export const SIZES = [1, 0.5, 0.25];
export const WAIT_MIN = { 1: 120, 0.5: 90, 0.25: 60 };
export const SIZE_NAME = { 1: 'Hele', 0.5: 'Halve', 0.25: 'Kwart' };
export const WAIT_LABEL = { 1: '2 uur', 0.5: '1,5 uur', 0.25: '1 uur' };
export const SNOOZE_MS = 10 * 60000;
export const MAX_FUTURE_MS = 5 * 60000;
export const CODE_RE = /^[A-Za-z0-9]{10,32}$/; // join token: nobody types it, it travels in the link / QR
export const ID_RE = /^[-_A-Za-z0-9]{1,32}$/;
export const isValidId = v => typeof v === 'string' && ID_RE.test(v);
// key that identifies one alarm-worthy state of a friend: the latest dose and its time
export const doseKey = d => d.id + ':' + d.t;

const pad = n => String(n).padStart(2, '0');

// 1.75 -> "1¾", 0.5 -> "½", 0 -> "0"
export function frac(n) {
  const w = Math.floor(n + 1e-9);
  const f = ['', '¼', '½', '¾'][Math.round((n - w) * 4)];
  return (w || !f ? String(w) : '') + f;
}

// ms -> "1:05:09" or "5:09"
export function dur(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function hhmm(t) {
  const d = new Date(t);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export const total = doses => doses.reduce((a, d) => a + d.size, 0);

// The dose with the LATEST t (not the last inserted); ties go to the later addedAt.
export function latestDose(doses) {
  let best = null;
  for (const d of doses) {
    if (!best || d.t > best.t || (d.t === best.t && (d.addedAt || 0) >= (best.addedAt || 0))) best = d;
  }
  return best;
}

export const atMax = (tot, max) => max != null && tot >= max - 1e-9;
export const exceedsMax = (tot, size, max) => max != null && tot + size > max + 1e-9;

// status of one friend: none | max | wait | due
export function status(doses, max, now = Date.now()) {
  const last = latestDose(doses);
  if (!last) return { kind: 'none', total: 0 };
  const tot = total(doses);
  if (atMax(tot, max)) return { kind: 'max', last, total: tot };
  const span = WAIT_MIN[last.size] * 60000, rem = last.t + span - now;
  return rem > 0
    ? { kind: 'wait', last, total: tot, rem, p: 1 - rem / span }
    : { kind: 'due', last, total: tot, over: Math.max(0, -rem) };
}

// should an alarm fire? seenId = dose already acknowledged, snoozeUntil = ms timestamp
export function canAlarm(st, { closed = false, seenId = null, snoozeUntil = 0, now = Date.now() } = {}) {
  return !closed && st.kind === 'due' && seenId !== doseKey(st.last) && !(snoozeUntil > now);
}

// ranking by total desc; tie: who reached it earlier (t of their latest dose); then name
export function ranking(friends, doses) {
  return friends.map(f => {
    const ds = doses.filter(d => d.friendId === f.id);
    const last = latestDose(ds);
    return { friend: f, total: total(ds), reachedAt: last ? last.t : Infinity };
  }).sort((a, b) => b.total - a.total || a.reachedAt - b.reachedAt || a.friend.name.localeCompare(b.friend.name));
}

// ---- join tokens: 12 random [A-Za-z0-9] chars in the link / QR ----
export const normalizeCode = s => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
export const isValidCode = c => typeof c === 'string' && CODE_RE.test(c);
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// rand(n) -> n random bytes; rejection sampling keeps the 62 characters unbiased
export function newToken(len = 12, rand = n => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  let out = '';
  while (out.length < len) for (const b of rand(len * 2)) { if (b < 248 && out.length < len) out += TOKEN_CHARS[b % 62]; }
  return out;
}
// token from a pasted link ("...?p=TOKEN") or a bare token; '' when there is none
export function tokenFromLink(text, app = null) {
  let u;
  try { u = new URL(String(text ?? '').trim()); } catch { return ''; } // only full links count, never a bare token
  if (app) { // the link must belong to this app (same origin and path)
    const path = x => x.replace(/index\.html$/, '');
    if (u.origin !== app.origin || path(u.pathname) !== path(app.pathname)) return '';
  }
  const p = u.searchParams.get('p') || '';
  return isValidCode(p) ? p : '';
}
// small icon for a friend in 'wait': stable per dose, same on every phone (rocket, disco ball, sunglasses, big eyes)
export const ICONS = ['rocket', 'disco', 'shades', 'eyes'];
export function iconFor(doseId) {
  let h = 5381;
  for (const ch of String(doseId)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return ICONS[h % 4];
}
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newId(rand = null, len = 12) {
  let s = '';
  if (rand) { for (let i = 0; i < len; i++) s += ID_CHARS[Math.floor(rand() * ID_CHARS.length)]; return s; }
  while (s.length < len) for (const b of globalThis.crypto.getRandomValues(new Uint8Array(len * 2))) if (b < 252 && s.length < len) s += ID_CHARS[b % 36]; // 252 = 7 * 36: unbiased
  return s;
}

// "HH:MM" -> timestamp today; a time later than now means yesterday
export function parseBackfillTime(str, now = Date.now()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str).trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  const d = new Date(now);
  d.setHours(h, mi, 0, 0);
  let t = d.getTime();
  if (t > now) { d.setDate(d.getDate() - 1); t = d.getTime(); }
  return t;
}
export const minutesAgo = (min, now = Date.now()) => now - min * 60000;

// raw RTDB/dev party -> arrays; doses of unknown friends are dropped
export function normalizeParty(id, raw) {
  if (!raw) return null;
  const list = o => Object.entries(o || {}).map(([k, v]) => ({ id: k, ...v }));
  const friends = list(raw.friends).map(f => ({ ...f, max: f.max ?? null })).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const ids = new Set(friends.map(f => f.id));
  const doses = list(raw.doses).filter(d => ids.has(d.friendId));
  const codes = Object.entries(raw.codes || {}).sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0])).map(e => e[0]);
  return { id, name: raw.name, admin: raw.admin, createdAt: raw.createdAt, closedAt: raw.closedAt ?? null, closed: raw.closedAt != null, codes, friends, doses, claims: raw.claims || {} };
}

export const sortDosesDesc = doses => doses.slice().sort((a, b) => b.t - a.t || (b.addedAt || 0) - (a.addedAt || 0));

// friend id this uid has claimed in the party (or null)
export const myFriendId = (party, uid) => (party && Object.keys(party.claims).find(f => party.claims[f] === uid && party.friends.some(x => x.id === f))) || null;

// change only HH:MM of an existing dose time, keeping its original date. null = invalid time, -1 = time lies in the future
export function retime(str, origT, now = Date.now()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  // HH:MM on the day before, of and after the original date; the one that is not in the future and closest to the original wins
  const cands = [-1, 0, 1].map(k => { const d = new Date(origT); d.setDate(d.getDate() + k); d.setHours(+m[1], +m[2], 0, 0); return d.getTime(); }).filter(t => t <= now);
  if (!cands.length) return -1;
  const best = cands.reduce((x, y) => (Math.abs(y - origT) < Math.abs(x - origT) ? y : x));
  return Math.abs(best - origT) > 12 * 3600000 ? -1 : best; // -1: that time is in the future (it would jump about -24 h)
}

// show not-yet-acknowledged doses (the outbox) as if they were saved; mark them pending
export function mergePending(party, outbox) {
  if (!party || !outbox || !outbox.length) return party;
  const mine = outbox.filter(e => e.pid === party.id);
  if (!mine.length) return party;
  const ids = new Set(mine.map(e => e.id)), have = new Set(party.doses.map(d => d.id));
  const doses = party.doses.map(d => (ids.has(d.id) ? { ...d, pending: true } : d));
  for (const e of mine) {
    if (!have.has(e.id) && party.friends.some(f => f.id === e.friendId)) doses.push({ id: e.id, friendId: e.friendId, size: e.size, t: e.t, addedAt: e.addedAt, pending: true });
  }
  return { ...party, doses };
}

// text that goes into the share sheet: the URL INSIDE the text (several iOS targets such as WhatsApp drop a separate url field)
export const shareText = (name, url) => `Doe mee met ${name} in De Michel: ${url}`;

// link that joins a party: origin + path (no query) + ?p=PIN
export const shareUrl = (origin, pathname, code) => `${origin}${pathname}?p=${code}`;

// friend names are unique per party, ignoring case and surrounding spaces
export const nameTaken = (friends, name, exceptId = null) => {
  const n = String(name).trim().toLowerCase();
  return friends.some(f => f.id !== exceptId && f.name.trim().toLowerCase() === n);
};

// iOS Safari tab (not the installed home-screen app): storage there is separate from the app's
export function needsInstall({ ua = '', platform = '', touchPoints = 0, standalone, mediaStandalone = false } = {}) {
  const ios = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  return ios && standalone !== true && !mediaStandalone;
}

// outbox of unacknowledged dose writes: pure list helpers (the app persists the list in localStorage)
export const outboxAdd = (list, e) => (list.some(x => x.pid === e.pid && x.id === e.id) ? list : [...list, e]);
export const outboxRemove = (list, pid, id) => list.filter(x => !(x.pid === pid && x.id === id));

// alarm music tempo: 138 BPM, +6 per bar (16 sixteenths), capped at 200; CAP_STEP = first sixteenth at the cap
export const BPM0 = 138, BPM_MAX = 200, BPM_STEP_PER_BAR = 6;
export const CAP_STEP = Math.ceil((BPM_MAX - BPM0) / BPM_STEP_PER_BAR * 16);
export const bpmAt = step => Math.min(BPM_MAX, BPM0 + BPM_STEP_PER_BAR * step / 16);

// may a party raise alarms? live snapshot, or the cache when offline / when no snapshot arrived after 5 s
// (a stale cache can at worst cause a false alarm, which drops itself without writing 'seen')
export const alarmGate = ({ live, hasCache, online, uptimeMs }) => !!live || (!!hasCache && (!online || uptimeMs > 5000));
