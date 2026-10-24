// De Michel UI. All text is Dutch. Backend access goes through store.js only.
// "De Michel" is what the UI calls the admin; identifiers in code stay "admin".
import * as L from './logic.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const frac = L.frac, dur = L.dur, hhmm = L.hhmm;
const DEFAULT_NAME = 'AWAKENINGS ADE 2026';

// ---------- splash: min 3 s, until first data (max 5 s), 200 ms fade; cold open only ----------
const splash = { ready: false, done: false };
function hideSplash(force) {
  if (splash.done) return;
  const t = performance.now();
  if (!force && !(t >= 3000 && splash.ready) && t < 5000) return;
  splash.done = true;
  const el = $('#splash');
  if (!el) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), 250);
}
setTimeout(() => hideSplash(), 3000);
setTimeout(() => hideSplash(true), 5000);
const dataReady = () => { splash.ready = true; hideSplash(); };

if (/[?&]safe\b/.test(location.search)) document.documentElement.classList.add('sim');

// ---------- local storage helpers ----------
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------- icons ----------
const svg = (body, sw = 2.4) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  crew: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M17.5 14.6c2.3.3 3.7 2 4.2 4.6"/>'),
  top: svg('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/><path d="M12 14v4M8 20h8"/>'),
  log: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  settings: svg('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', 2.2),
  share: svg('<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H17"/>', 2.6),
  plus: svg('<path d="M12 4v16M4 12h16"/>', 3.4),
  chev: svg('<path d="M5 9l7 7 7-7"/>', 4),
  right: svg('<path d="M9 5l7 7-7 7"/>', 3),
  back: svg('<path d="M15 5l-7 7 7 7"/>', 3),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>', 2.6),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>', 2.6),
  minus: svg('<path d="M5 12h14"/>', 3.6),
  add: svg('<path d="M12 5v14M5 12h14"/>', 3.6),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 2.6),
};
// small wait-state icons, picked per dose (iconFor): rocket, disco ball, sunglasses, big eyes
const ICONSVG = {
  rocket: '<svg class="ic" viewBox="0 0 64 64"><g class="rk"><path class="a" d="M32 3c10 8 13 21 11 36H21C19 24 22 11 32 3z"/><circle class="b" cx="32" cy="23" r="5.5"/><rect class="b" x="21" y="34" width="22" height="3.5"/><path class="a" d="M21 28L9 46l12-4zM43 28l12 18-12-4z"/><path class="a" d="M25 42h14l-7 19z"/></g></svg>',
  disco: '<svg class="ic" viewBox="0 0 64 64"><rect class="a" x="30" y="2" width="4" height="13"/><circle class="a" cx="32" cy="37" r="22"/><g class="dg"><path class="s" d="M10 37h44M32 15v44M15 24c11 6 23 6 34 0M15 50c11-6 23-6 34 0M23 17c-6 13-6 25 0 40M41 17c6 13 6 25 0 40"/></g></svg>',
  shades: '<svg class="ic" viewBox="0 0 64 64"><circle class="a" cx="32" cy="33" r="27"/><rect class="b" x="8" y="23" width="21" height="15" rx="6"/><rect class="b" x="35" y="23" width="21" height="15" rx="6"/><rect class="b" x="28" y="26" width="8" height="3.5"/><path class="s" d="M19 47c7 7 19 7 26 0"/></svg>',
  eyes: '<svg class="ic" viewBox="0 0 64 64"><circle class="a" cx="32" cy="33" r="27"/><g class="bl"><circle class="s" cx="21" cy="28" r="10"/><circle class="s" cx="43" cy="28" r="10"/><circle class="b" cx="23" cy="29" r="4.5"/><circle class="b" cx="41" cy="29" r="4.5"/></g><ellipse class="b" cx="32" cy="50" rx="5" ry="4"/></svg>',
};
const waitIcon = (doseId, cls = '') => `<span class="wi ${cls}" aria-hidden="true">${ICONSVG[L.iconFor(doseId)]}</span>`;

// admin-only marker: small yellow "M" badge (grey when this phone is not allowed)
const mb = (on = true) => `<span class="mb ${on ? '' : 'grey'}" aria-label="Alleen De Michel">M</span>`;

// ---------- environment ----------
const nav = navigator;
const INSTALL = L.needsInstall({
  ua: nav.userAgent, platform: nav.platform, touchPoints: nav.maxTouchPoints,
  standalone: nav.standalone, mediaStandalone: !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches),
});
// iOS home-screen apps open the page that was added; without a manifest iOS uses the current URL (incl. ?p=PIN)
if (/iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) {
  const m = document.querySelector('link[rel="manifest"]');
  if (m) m.remove();
}
// the service worker only runs on real origins, never on the local dev server
if ('serviceWorker' in nav && location.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  nav.serviceWorker.register('sw.js').catch(() => { /* offline shell is a bonus */ });
}

// Android/desktop Chrome: storage is shared with the installed app, so no blocking screen, just an offer
let installEvent = null;
const standaloneNow = !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || nav.standalone === true;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  if (standaloneNow || ls.get('michel_install_hidden', false)) return;
  installEvent = e;
  if (typeof render === 'function' && store) render();
});
window.addEventListener('appinstalled', () => { ls.set('michel_install_hidden', true); installEvent = null; if (store) render(); });

let store = null;
if (!INSTALL) {
  try { ({ store } = await import('./store.js')); } catch (e) {
    console.error(e);
    $('#fatal').classList.add('on');
    setTimeout(() => hideSplash(true), Math.max(0, 3000 - performance.now())); // the 3 s minimum holds here too
    throw e;
  }
}
const uid = store ? store.uid : null;

// ---------- state ----------
let parties = ls.get('michel_parties', []); // [{id, name}]
let current = ls.get('michel_current', null);
if (!parties.some(p => p.id === current)) current = parties[0] ? parties[0].id : null;
const raw = new Map(); // partyId -> normalized party (server data, possibly from cache)
const live = new Set(); // partyIds that received a live snapshot this session
const unsubs = new Map();
let online = true;
let tab = 'crew';
const skippedClaim = new Set(); // non-admin "later" this session
const settings = {
  sound: ls.get('michel_sound', true),
  calm: ls.get('michel_calm', false),
  allAlarms: ls.get('michel_all_alarms', true),
};
const saveSettings = () => { ls.set('michel_sound', settings.sound); ls.set('michel_calm', settings.calm); ls.set('michel_all_alarms', settings.allAlarms); };

// outbox: dose writes not yet acknowledged by the server (persisted, replayed on start/reconnect)
let outbox = ls.get('michel_outbox', []);
const setOutbox = list => { outbox = list; ls.set('michel_outbox', list); };

const view = pid => L.mergePending(raw.get(pid) || null, outbox);
const P = () => (current ? view(current) : null);
const isAdmin = p => !!p && p.admin === uid;
const meOf = p => L.myFriendId(p, uid);
const canAdd = (p, fid) => !!p && !p.closed && (isAdmin(p) || meOf(p) === fid);
const dosesOf = (p, fid) => p.doses.filter(d => d.friendId === fid);
const friendOf = (p, fid) => p.friends.find(f => f.id === fid);
const linkFor = (p, code) => L.shareUrl(location.origin, location.pathname, code || p.codes[0] || '');
const nowMs = () => (store && store.now ? store.now() : Date.now());

function persistParties() { ls.set('michel_parties', parties); ls.set('michel_current', current); }

function subscribe(pid) {
  if (unsubs.has(pid)) return;
  const cached = ls.get('michel_cache_' + pid, null);
  if (cached) raw.set(pid, L.normalizeParty(pid, cached));
  unsubs.set(pid, store.watch(pid, snap => {
    const first = !live.has(pid);
    live.add(pid);
    if (snap) {
      // doses the server already has are confirmed: drop them from the outbox (unless a send is still in flight)
      const drop = outbox.filter(e => e.pid === pid && snap.doses && snap.doses[e.id] && !inflight.has(pid + ':' + e.id));
      if (drop.length) setOutbox(outbox.filter(e => !drop.includes(e)));
      raw.set(pid, L.normalizeParty(pid, snap));
      ls.set('michel_cache_' + pid, snap);
      const e = parties.find(x => x.id === pid);
      if (e && e.name !== snap.name) { e.name = snap.name; persistParties(); }
    } else raw.delete(pid);
    if (pid === current) dataReady();
    render();
    tick();
    if (first) replayOutbox();
  }, () => { if (pid === current) dataReady(); }));
}

function addParty(id, name) {
  if (!parties.some(p => p.id === id)) parties.push({ id, name });
  current = id;
  persistParties();
  subscribe(id);
}

function leaveParty(pid) {
  const u = unsubs.get(pid); if (u) u(); unsubs.delete(pid);
  raw.delete(pid); live.delete(pid);
  parties = parties.filter(p => p.id !== pid);
  setOutbox(outbox.filter(e => e.pid !== pid));
  try { localStorage.removeItem('michel_cache_' + pid); } catch { /* ignore */ }
  if (current === pid) current = parties[0] ? parties[0].id : null;
  persistParties();
  tab = 'crew';
  clearStack();
  render();
}

// ---------- helpers ----------
function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = `<span>${msg}</span>${undo ? '<button data-a="undo">Oeps</button>' : ''}`;
  toast.undo = undo || null;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 5000);
}
const failMsg = e => (e && e.code === 'denied' ? 'Dat mag niet' : e && e.code === 'network' ? 'Geen verbinding' : 'Oeps, dat is mislukt');
const fail = e => toast(failMsg(e));
// resolves {v} when the write is done within `ms`, {pending:true} otherwise; a late failure still shows an error toast
function quick(pr, ms = 1500) {
  let late = false;
  pr.catch(e => { if (late) fail(e); });
  return Promise.race([pr.then(v => ({ v })), new Promise(r => setTimeout(() => { late = true; r({ pending: true }); }, ms))]);
}
const adminOnly = () => toast('Alleen De Michel kan dit');
const shake = el => { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
const nameLines = name => {
  const w = name.trim().split(/\s+/);
  return w.length > 1 ? [w[0], w.slice(1).join(' ')] : [name];
};
const copyText = async text => {
  try { await nav.clipboard.writeText(text); return true; } catch { return false; }
};

// ---------- pushed screens ----------
const screens = []; // {key, el, build, label, live, noBack}
function pushScreen(key, label, build, opts = {}) {
  const ex = screens.find(s => s.key === key);
  if (ex) { renderScreen(ex); return ex; }
  const el = document.createElement('div');
  el.className = 'screen';
  el.innerHTML = (opts.noBack ? '' : `<div class="navbar"><button class="back" data-a="back">${ICON.back}${esc(label)}</button></div>`)
    + `<div class="scr ${opts.noBack ? 'nonav' : ''}"></div>`;
  $('#stack').appendChild(el);
  const s = { key, el, build, label, live: !!opts.live, noBack: !!opts.noBack };
  screens.push(s);
  renderScreen(s);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  return s;
}
function renderScreen(s) {
  const sc = $('.scr', s.el), top = sc.scrollTop;
  const html = s.build();
  if (html === null) { popScreen(s); return; }
  sc.innerHTML = html;
  sc.scrollTop = top;
}
function popScreen(s = screens[screens.length - 1]) {
  if (!s) return;
  screens.splice(screens.indexOf(s), 1);
  s.el.classList.remove('in');
  setTimeout(() => s.el.remove(), 320);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
function clearStack() { while (screens.length) popScreen(); }
function refreshStack() { for (const s of screens.slice()) if (s.live) renderScreen(s); }

// edge swipe back
(() => {
  let x0 = null, y0 = 0;
  const st = $('#stack');
  st.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX < 28 ? t.clientX : null; y0 = t.clientY; }, { passive: true });
  st.addEventListener('touchend', e => {
    if (x0 == null) return;
    const t = e.changedTouches[0], top = screens[screens.length - 1];
    if (t.clientX - x0 > 80 && Math.abs(t.clientY - y0) < 80 && top && !top.noBack && $('.back', top.el)) popScreen();
    x0 = null;
  }, { passive: true });
})();

// ---------- sheets ----------
let sheetCtx = null;
function sheet(html, ctx = null) {
  const sh = $('#sheet');
  sh.innerHTML = '<div class="grab"></div>' + html;
  sh.scrollTop = 0; sh.style.transform = '';
  sheetCtx = ctx;
  sh.classList.add('on'); $('#bd').classList.add('on');
  document.body.classList.add('sheetopen'); // toast moves to the top so it never covers sheet buttons
}
function closeSheet() {
  $('#sheet').classList.remove('on'); $('#bd').classList.remove('on');
  document.body.classList.remove('sheetopen');
  sheetCtx = null;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
(() => {
  const sh = $('#sheet'); let y0 = null, dy = 0;
  sh.addEventListener('touchstart', e => { if (sh.scrollTop <= 0 && !e.target.closest('input')) { y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none'; } }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); if (dy > 0) sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sh.addEventListener('touchend', () => { if (y0 == null) return; sh.style.transition = ''; sh.style.transform = ''; if (dy > 110) closeSheet(); y0 = null; });
})();

function confirmSheet({ title, text, ok, onOk, danger = true }) {
  sheet(`<div class="sh-name">${esc(title)}</div><div class="sh-sub">${esc(text)}</div>
    <button class="big ${danger ? 'danger' : ''}" data-a="confirm-ok" style="margin-top:6px">${esc(ok)}</button>
    <button class="big ghost" data-a="close" style="height:66px;font-size:24px">Annuleren</button>`, { onOk });
}

// ---------- views ----------
const TITLES = { top: 'Top', log: 'Log', settings: 'Opties' };
function barState() {
  const p = P();
  $('#sync').classList.toggle('off', !online);
  $('#sync').classList.toggle('dot', tab === 'settings');
  $('#sync span').textContent = online ? 'LIVE' : 'OFFLINE';
  $('#ctitle').textContent = tab === 'crew' ? (p ? p.name : '') : TITLES[tab];
  $('.shr').style.display = p && !p.closed ? '' : 'none'; // no party, or a closed one: nothing to share
}

function titleBlock(p) {
  if (tab === 'crew') {
    const lines = nameLines(p.name);
    const n = Math.max(...lines.map(l => l.length));
    const px = Math.max(40, Math.min(75, Math.floor(330 / (n * 0.47))));
    return `<div class="lt"><div class="t pt" data-a="parties"><small>De Michel${p.closed ? ' · afgesloten' : ''}</small><b style="font-size:${px}px">${lines.map(esc).join('<br>')}${ICON.chev}</b></div></div>`;
  }
  if (tab === 'top') return `<div class="lt"><div class="t sec"><b style="font-size:64px;line-height:.92;padding-bottom:8px">Wie gaat<br>het hardst</b></div></div>`;
  return `<div class="lt"><div class="t sec"><b>${TITLES[tab]}</b></div></div>`;
}

function cardHtml(f, p, now) {
  const st = L.status(dosesOf(p, f.id), f.max, now);
  const mine = meOf(p) === f.id;
  const can = canAdd(p, f.id);
  const hasMax = f.max != null;
  const tot = st.total
    ? `<div class="tot"><small>${hasMax ? 'Totaal / max' : 'Totaal'}</small>${frac(st.total)}${hasMax ? ` <span class="of">/ ${frac(f.max)}</span>` : ''}</div>`
    : (hasMax ? `<div class="tot"><small>Max</small><span class="of">${frac(f.max)}</span></div>` : '');
  const pend = st.last && st.last.pending ? ' <span class="pend">wordt verstuurd</span>' : '';
  const last = st.last ? `<div class="meta">Laatste: <b>${frac(st.last.size)}</b> om <b>${hhmm(st.last.t)}</b>${pend}</div>` : '';
  let body;
  if (st.kind === 'none') body = `<div class="lbl">Nog niks genomen</div><div class="meta">${can ? 'Tik om een snoepje toe te voegen' : 'Nog niks'}</div>`;
  else if (st.kind === 'wait') body = `<div class="lbl">Bijpakken over</div><div class="cdrow"><div class="cd" data-r="cd">${dur(st.rem)}</div>${waitIcon(st.last.id)}</div><div class="bar"><i data-r="bar" style="width:${(st.p * 100).toFixed(1)}%"></i></div>${last}`;
  else if (st.kind === 'due') body = `<div class="alarmtxt">Inkakken is bijpakken!</div><div class="over">+<span data-r="cd">${dur(st.over)}</span></div>${last}`;
  else body = `<div class="maxlbl">${ICON.check}Max bereikt</div>${last}`;
  const tag = mine ? `<span class="you">${isAdmin(p) ? 'DE MICHEL' : 'JIJ'}</span>` : '';
  return `<div class="card ${st.kind}" data-f="${esc(f.id)}" data-k="${st.kind}"><div class="row"><div class="name">${esc(f.name)}${tag}</div>${tot}</div>${body}</div>`;
}

function crewView(p) {
  if (!p.friends.length) {
    const msg = isAdmin(p) ? 'Tik op de grote plus om je eerste vriend toe te voegen.' : 'Vraag De Michel om vrienden toe te voegen.';
    return `<div class="empty"><h2>Nog geen crew</h2><p>${msg}</p></div>`;
  }
  const me = meOf(p), now = nowMs();
  const order = p.friends.slice().sort((a, b) => (b.id === me) - (a.id === me));
  return `<div class="pad">${installBanner()}${order.map(f => cardHtml(f, p, now)).join('')}</div>`;
}
const installBanner = () => (installEvent ? `<div class="ibanner"><b>Installeer De Michel</b><button data-a="doinstall">Installeer</button><button class="x" data-a="hideinstall" aria-label="Sluiten">✕</button></div>` : '');

function topView(p) {
  const r = L.ranking(p.friends, p.doses);
  const all = L.total(p.doses);
  if (!all) return `<div class="pad"><div class="empty"><h2>Nog niks</h2><p>Zodra er iets genomen is, zie je hier wie aan kop ligt.</p></div></div>`;
  const first = r[0], max = first.total, now = nowMs();
  const ico = (x, cls) => { const st = L.status(dosesOf(p, x.friend.id), x.friend.max, now); return st.kind === 'wait' ? waitIcon(st.last.id, cls) : ''; };
  const rows = r.slice(1).map((x, i) => x.total
    ? `<div class="rank"><div class="r1"><span class="rk">${i + 2}</span><span class="nm">${esc(x.friend.name)}${ico(x, 'sm')}</span><span class="tt">${frac(x.total)}</span></div><div class="bar"><i style="width:${(x.total / max * 100).toFixed(1)}%"></i></div></div>`
    : `<div class="rank zero"><div class="r1"><span class="rk">${i + 2}</span><span class="nm">${esc(x.friend.name)}</span><span class="tt">0</span></div></div>`).join('');
  return `<div class="pad"><div class="nightline"><span>Totaal vanavond</span><b>${frac(all)}</b></div>
    <div class="first"><div class="rk">1</div><div class="nm"><small>Aan kop</small>${esc(first.friend.name)}${ico(r[0], 'sm inv')}</div><div class="tt">${frac(first.total)}</div></div>${rows}</div>`;
}

function logView(p) {
  const ds = L.sortDosesDesc(p.doses);
  if (!ds.length) return `<div class="pad"><div class="empty"><h2>Nog niks</h2><p>Hier zie je wie wat wanneer nam.</p></div></div>`;
  const name = id => (friendOf(p, id) || { name: '?' }).name;
  return `<div class="pad"><div class="nightline"><span>Totaal vanavond</span><b>${frac(L.total(ds))}</b></div>
    <ul class="log" style="margin-top:-4px">${ds.map(d => `<li ${canAdd(p, d.friendId) ? `data-did="${esc(d.id)}"` : ''}><span class="t">${hhmm(d.t)}</span><span class="n">${esc(name(d.friendId))}${d.pending ? ' <span class="pend">wordt verstuurd</span>' : ''}</span><span class="s">${frac(d.size)}</span></li>`).join('')}</ul></div>`;
}

const sw = (a, on, dis) => `<button class="sw ${on ? 'on' : ''}" data-a="${a}" ${dis ? 'disabled' : ''} aria-pressed="${on}"></button>`;
function settingsView(p) {
  const admin = isAdmin(p), me = meOf(p), meF = me && friendOf(p, me), open = !p.closed;
  const claimed = p.friends.filter(f => p.claims[f.id]);
  const claims = claimed.length
    ? claimed.map(f => `<div class="pill"><span>${esc(f.name)}</span><button data-a="release" data-fid="${esc(f.id)}" ${admin && open ? '' : 'disabled'}>Vrijgeven</button></div>`).join('')
    : '<p class="note">Nog niemand heeft een naam gekozen.</p>';
  return `<div class="pad">
    <div class="set"><div><b>Geluid bij alarm</b><small>Speelt ook met de stille modus aan (iPhone, Safari 16.4+)</small></div>${sw('sound', settings.sound)}</div>
    <div class="set"><div><b>Rustig knipperen</b><small class="warn">Snel flitsen kan epileptische aanvallen uitlokken. Zet dit aan bij twijfel.</small></div>${sw('calm', settings.calm)}</div>
    <div class="set"><div><b>Alarm voor iedereen ${mb(admin)}</b><small>${admin ? 'Uit = alleen het alarm voor je eigen naam' : 'Alleen De Michel. Jij krijgt het alarm voor je eigen naam.'}</small></div>${sw('allalarms', admin && settings.allAlarms, !admin)}</div>
    <div class="h3">Wie ben jij?</div>
    ${meF ? `<p class="note" style="margin-top:0">Jij bent <b>${esc(meF.name)}</b>.</p><button class="big ghost" data-a="notme" style="height:66px;font-size:24px" ${open ? '' : 'disabled'}>Ik ben iemand anders</button>`
      : `<button class="big ghost" data-a="whoami" style="height:66px;font-size:24px" ${open ? '' : 'disabled'}>${admin ? 'Kies mijn naam' : 'Wie ben jij?'}</button>`}
    <div class="h3">Uitnodigingslink ${mb(admin)}</div>
    <div class="lrow" style="margin-top:6px">${mb(admin)}<button class="big outline ${admin && open && !linkBusy ? '' : 'off'}" style="margin-top:0;height:66px;font-size:24px" data-a="newlink" ${linkBusy ? 'disabled' : ''}>Nieuwe link maken</button></div>
    <p class="note" style="margin-top:8px">De oude link en QR werken daarna niet meer.</p>
    ${admin && !open && p.codes.length ? `<div class="lrow" style="margin-top:10px">${mb()}<button class="big danger" style="margin-top:0;height:66px;font-size:24px" data-a="disablelink">Link uitschakelen</button></div>` : ''}
    <div class="h3">Gekozen namen ${mb(admin)}</div>${claims}
    <div class="h3">Feestje ${mb(admin)}</div>
    <div class="lrow" style="margin-top:6px">${mb(admin)}<button class="big danger ${admin && open ? '' : 'off'}" style="margin-top:0" data-a="closeparty">Feestje afsluiten</button></div>
    <p class="note" style="margin-top:8px">Een afgesloten feestje is alleen-lezen: geen alarm en geen nieuwe snoepjes.</p>
    <button class="big" data-a="rules" style="height:66px;font-size:24px;margin-top:18px">Spelregels</button>
    <button class="big ghost" data-a="leave" style="margin-top:20px;height:66px;font-size:24px">Feestje verlaten</button>
    <div class="h3">Jouw telefoon-ID</div>
    <div class="pill"><span class="uid">${esc(uid)}</span><button data-a="copyid">Kopieer</button></div>
    <p class="note">Stuur dit ID naar De Michel als je feestjes wilt kunnen maken.</p>
    <button class="big ghost" data-a="test" style="margin-top:12px;height:54px;font-size:20px;background:none;color:var(--mut)">Test het alarm</button>
  </div>`;
}

function renderView() {
  const p = P();
  const v = $('#view');
  if (!p) { v.innerHTML = ''; return; }
  const body = { crew: crewView, top: topView, log: logView, settings: settingsView }[tab](p);
  v.innerHTML = titleBlock(p) + body;
}

function render() {
  document.body.classList.toggle('nop', !P() && !parties.length);
  document.querySelectorAll('#tabs .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  barState();
  const p = P();
  if (p) renderView();
  else if (parties.length) $('#view').innerHTML = '<div class="empty"><h2>Laden…</h2></div>';
  refreshStack();
  ensureClaimScreen();
}

// ---------- claim ("Wie ben jij?") ----------
function claimBuild() {
  const p = P(); if (!p) return null;
  const admin = isAdmin(p), me = meOf(p);
  if (me || p.closed) return null; // done: closes the screen
  const btns = p.friends.map(f => p.claims[f.id]
    ? `<button class="off" data-a="noop"><span>${esc(f.name)}</span><small>Bezet</small></button>`
    : `<button data-a="claim" data-fid="${esc(f.id)}"><span>${esc(f.name)}</span></button>`).join('');
  return `<h1 style="font-size:84px">Wie ben<br>jij?</h1>
    <p class="lead">${admin ? 'Optioneel: ben jij zelf ook een van de vrienden?' : 'Kies je naam. Dan kun jij zelf snoepjes invoeren en krijg je alarm voor jezelf.'}</p>
    <div class="who2 pagewho" style="margin-top:16px">${btns}</div>
    ${p.friends.length ? '' : '<p class="note">Er zijn nog geen vrienden toegevoegd.</p>'}
    ${admin && !me ? `<div class="lrow" style="margin-top:12px">${mb()}<button class="big outline" style="margin-top:0" data-a="addme">+ Mijn naam toevoegen</button></div>` : ''}
    <p class="note">Staat je naam er niet tussen? Vraag De Michel.</p>
    <button class="big ghost" data-a="claimskip" style="margin-top:22px;height:62px;font-size:24px">${admin ? 'Sla over' : 'Later'}</button>`;
}
function openAddMe() {
  sheet(`<div class="sh-name">Mijn naam</div><div class="sh-sub">Je wordt aan de crew toegevoegd en kiest meteen jezelf.</div>
    <form id="addme"><input class="field" id="me-nm" maxlength="14" placeholder="Naam" autocomplete="off" autocapitalize="words" enterkeyhint="done">
    <button class="big" type="submit">Toevoegen</button></form>`);
  $('#me-nm').focus();
}
function openRename(fid) {
  const p = P(), f = p && friendOf(p, fid); if (!f) return;
  if (!isAdmin(p)) return adminOnly();
  if (p.closed) return toast('Dit feestje is afgesloten');
  sheet(`<div class="sh-name">Naam wijzigen</div>
    <form id="renamef" data-fid="${esc(fid)}"><input class="field" id="rn-nm" maxlength="14" autocomplete="off" autocapitalize="words" enterkeyhint="done" value="${esc(f.name)}">
    <button class="big" type="submit">Opslaan</button></form>`);
  const i = $('#rn-nm'); i.focus(); i.select();
}
function openClaim() { pushScreen('claim', '', claimBuild, { live: true, noBack: true }); }
function ensureClaimScreen() {
  const p = P();
  if (!p || p.closed || meOf(p) || screens.some(s => s.key === 'claim')) return;
  if (screens.length) return; // do not interrupt another screen
  if (isAdmin(p)) { if (!p.friends.length || ls.get('michel_skipclaim_' + p.id, false)) return; } else if (skippedClaim.has(p.id)) return;
  openClaim();
}

// ---------- sheets: parties / who / friend / dose ----------
function openParties() {
  const rows = parties.map(pp => {
    const d = raw.get(pp.id);
    const sub = d ? (d.closed ? 'Afgesloten' : `Live · ${d.friends.length} ${d.friends.length === 1 ? 'vriend' : 'vrienden'}`) : '…';
    return `<div class="prow ${pp.id === current ? 'on' : ''} ${d && d.closed ? 'closed' : ''}" data-a="switch" data-pid="${esc(pp.id)}"><div class="pn">${esc(pp.name)}</div><div class="ps"><span>${sub}</span>${d && d.admin === uid ? mb() : ''}</div></div>`;
  }).join('');
  sheet(`<div class="sh-name">Feestjes</div>${rows}
    <button class="big outline" data-a="newparty" style="margin-top:14px">+ Nieuw feestje</button>
    <button class="big ghost" data-a="pastelink" style="height:66px;font-size:24px">Plak link</button>`);
}

function openWho() {
  const p = P(); if (!p) return;
  const admin = isAdmin(p);
  if (!p.friends.length) {
    if (admin) return openNewFriend();
    sheet(`<div class="sh-name">Voor wie?</div><div class="sh-sub">Nog geen vrienden. Vraag De Michel om vrienden toe te voegen.</div>`);
    return;
  }
  const now = nowMs();
  const btns = p.friends.map(f => {
    const st = L.status(dosesOf(p, f.id), f.max, now);
    return `<button class="${st.kind === 'max' ? 'off' : ''}" data-a="pick" data-fid="${esc(f.id)}">${st.kind === 'wait' ? waitIcon(st.last.id, 'sm') : ''}<span>${esc(f.name)}</span>${st.kind === 'max' ? '<small>Max</small>' : ''}</button>`;
  }).join('');
  sheet(`<div class="sh-name">Voor wie?</div><div class="sh-sub">Tik op een naam</div><div class="who2">${btns}</div>
    ${admin ? `<div class="lrow" style="margin-top:12px">${mb()}<button class="big outline" style="margin-top:0" data-a="newfriend">+ Nieuwe vriend</button></div>` : ''}`);
}

function openNewFriend() {
  sheet(`<div class="sh-name">Nieuwe vriend</div>
    <form id="addf"><input class="field" id="nm" maxlength="14" placeholder="Naam" autocomplete="off" autocapitalize="words" enterkeyhint="done">
    <button class="big" type="submit">Toevoegen</button></form>`);
  $('#nm').focus();
}

function onPlus() {
  const p = P(); if (!p) return;
  if (p.closed) return toast('Dit feestje is afgesloten');
  if (isAdmin(p)) return openWho();
  const me = meOf(p);
  if (me) return openDose(me);
  if (!p.friends.length) return openWho();
  toast('Kies eerst wie je bent');
  openClaim();
}

let linkBusy = false;
// admin link actions are one atomic write and need a live connection: offline they are refused up front (RTDB would queue them silently)
const requireOnline = () => { if (!online || navigator.onLine === false) { toast('Geen verbinding: dit kan alleen online'); return false; } return true; };
async function linkWrite(fn, okMsg, failMsg) {
  if (!requireOnline() || linkBusy) return;
  linkBusy = true; render(); // the button is disabled while the write is in flight
  const p = Promise.resolve().then(fn);
  let slow = false;
  try {
    const r = await Promise.race([p.then(() => 'ok'), new Promise(res => setTimeout(() => res('slow'), 10000))]);
    if (r === 'slow') { slow = true; toast('Nog niet bevestigd, controleer straks bij Delen'); } else toast(okMsg);
  } catch (err) { toast(failMsg); } finally { linkBusy = false; render(); }
  if (slow) p.then(() => render(), () => {}); // it may still complete later: render normally then
}
const doseState = { min: 0, custom: '' };
function openDose(fid) {
  const p = P(), f = p && friendOf(p, fid); if (!f) return;
  if (!canAdd(p, fid)) return;
  doseState.min = 0; doseState.custom = '';
  const st = L.status(dosesOf(p, fid), f.max, nowMs());
  const sub = st.kind === 'none' ? 'Nog niks genomen' : st.kind === 'wait' ? `Bijpakken over ${dur(st.rem)}` : st.kind === 'due' ? 'Inkakken is bijpakken!' : 'Max bereikt';
  const tot = st.total ? ` · totaal ${frac(st.total)}${f.max != null ? ` / ${frac(f.max)}` : ''}` : '';
  sheet(`<div class="sh-head"><div class="sh-name">${esc(f.name)}</div><button data-a="detail" data-fid="${esc(fid)}">Details</button></div>
    <div class="sh-sub">${sub}${tot}</div>
    <div class="dose">${L.SIZES.map(s => `<button data-a="dose" data-size="${s}"><b>${frac(s)}</b><span>${L.SIZE_NAME[s]}</span><small>alarm na ${L.WAIT_LABEL[s]}</small></button>`).join('')}</div>
    <div class="h3">Wanneer?</div>
    <div class="chips">${[[0, 'NU'], [15, '−15'], [30, '−30'], [60, '−60']].map(([m, l]) => `<button class="chip ${m === 0 ? 'on' : ''}" data-a="chip" data-min="${m}">${l}</button>`).join('')}
      <label class="chip wide" id="chipc">${ICON.clock}<span id="chiplbl">Andere tijd</span><input type="time" id="t-custom"></label></div>`, { fid });
}

function doseTime() {
  const now = nowMs();
  if (doseState.custom) { const t = L.parseBackfillTime(doseState.custom, now); if (t) return t; }
  return L.minutesAgo(doseState.min, now);
}

// ---- outbox: send one entry; resolves 'ok' | 'pending' | 'failed' ----
const inflight = new Set();
function sendEntry(e, quickMs = 1500) {
  const key = e.pid + ':' + e.id;
  if (inflight.has(key)) return Promise.resolve('pending');
  inflight.add(key);
  // persist 'sent' BEFORE the write goes out (unless the device is certainly offline): if the response is lost the server may have the dose, so it is never re-posted
  if (!e.sent && navigator.onLine !== false && online) { e = { ...e, sent: true }; setOutbox(outbox.map(x => (x.pid === e.pid && x.id === e.id ? e : x))); }
  const done = store.addDose(e.pid, e).then(() => 'ok', err => {
    if (err && err.code === 'network') return 'pending';
    const pd = raw.get(e.pid);
    const stored = pd && pd.doses.some(d => d.id === e.id);
    if (!stored) fail(err); // a denied replay of an already stored dose is silent
    return stored ? 'ok' : 'failed';
  }).then(r => {
    inflight.delete(key);
    if (r !== 'pending') { setOutbox(L.outboxRemove(outbox, e.pid, e.id)); render(); }
    return r;
  });
  return Promise.race([done, new Promise(r => setTimeout(() => r('pending'), quickMs))]);
}
// replay only after the first live snapshot of that party, and never recreate a dose the server already has (or had and lost)
async function replayOutbox() {
  if (!store) return;
  for (const e of outbox.slice()) {
    if (!parties.some(p => p.id === e.pid)) { setOutbox(L.outboxRemove(outbox, e.pid, e.id)); continue; }
    if (!live.has(e.pid) || inflight.has(e.pid + ':' + e.id)) continue;
    let exists;
    try { exists = await store.hasDose(e.pid, e.id); } catch { continue; } // offline: try again later
    if (exists) { setOutbox(L.outboxRemove(outbox, e.pid, e.id)); render(); continue; }
    if (e.sent) { // it may have reached the server and been deleted since: never recreate it (no zombie doses)
      setOutbox(L.outboxRemove(outbox, e.pid, e.id)); render();
      toast('Een snoepje is mogelijk niet opgeslagen, check je LOG');
      continue;
    }
    sendEntry(e, 0);
  }
}

async function addDose(fid, size, t, force) {
  const p = P(), f = p && friendOf(p, fid);
  if (!f || !canAdd(p, fid)) return;
  const tot = L.total(dosesOf(p, fid));
  if (!force && L.exceedsMax(tot, size, f.max)) {
    const msg = L.atMax(tot, f.max) ? `${f.name} zit al op max (${frac(f.max)}). Toch toevoegen?` : `${f.name} komt hiermee boven de max (${frac(f.max)}) uit. Toch toevoegen?`;
    confirmSheet({ title: 'Max bereikt', text: msg, ok: 'Toch toevoegen', danger: false, onOk: () => addDose(fid, size, t, true) });
    return;
  }
  const e = { pid: current, id: store.newDoseId(current), friendId: fid, size, t, addedAt: nowMs() };
  setOutbox(L.outboxAdd(outbox, e));
  closeSheet();
  tab = 'crew'; render();
  const r = await sendEntry(e);
  const label = `${frac(size)} voor ${esc(f.name)} om ${hhmm(t)}`;
  if (r === 'ok') toast(label, () => store.removeDose(e.pid, e.id).catch(fail));
  else if (r === 'pending') toast(label + ' (wordt verstuurd)');
}

function openDoseEdit(did) {
  const p = P(), d = p && p.doses.find(x => x.id === did); if (!d) return;
  if (!canAdd(p, d.friendId) || d.pending) return;
  const f = friendOf(p, d.friendId);
  sheet(`<div class="sh-name">${esc(f.name)}</div><div class="sh-sub">${L.SIZE_NAME[d.size]} (${frac(d.size)}) · pas de tijd aan</div>
    <input class="field" type="time" id="edit-t" value="${hhmm(d.t)}" style="font-size:44px;text-align:center">
    <button class="big" data-a="savedose">Opslaan</button>
    <button class="big danger" data-a="deldose" style="margin-top:12px">Verwijderen</button>`, { did });
}

// ---------- screens: detail / delen / join / new party ----------
function detailBuild(fid) {
  return () => {
    const p = P(), f = p && friendOf(p, fid); if (!p || !f) return null;
    const admin = isAdmin(p), can = canAdd(p, fid), open = !p.closed;
    const ds = L.sortDosesDesc(dosesOf(p, fid));
    const tot = L.total(ds);
    const maxOn = admin && open;
    const stepper = `<div class="stepper"><button data-a="maxdown" ${maxOn ? '' : 'disabled'} aria-label="Minder">${ICON.minus}</button>
      <div class="v ${f.max == null ? 'nomax' : ''}">${f.max == null ? 'GEEN MAX' : frac(f.max)}</div>
      <button data-a="maxup" ${maxOn ? '' : 'disabled'} aria-label="Meer">${ICON.add}</button></div>`;
    const hist = ds.length
      ? ds.map(d => can ? `<li data-did="${esc(d.id)}"><span class="t">${hhmm(d.t)}${d.pending ? ' <span class="pend">wordt verstuurd</span>' : ''}</span><span class="s">${frac(d.size)}</span>${ICON.right}</li>` : `<li class="ro"><span class="t">${hhmm(d.t)}</span><span class="s">${frac(d.size)}</span></li>`).join('')
      : '<li class="ro"><span class="t" style="color:var(--mut)">Nog niks</span></li>';
    return `<div class="d-name" ${admin && open ? `data-a="rename" data-fid="${esc(fid)}"` : ''}>${esc(f.name)}</div>
      ${admin && open ? `<div class="lrow" style="margin-top:10px">${mb()}<button class="big outline" style="margin-top:0;height:56px;font-size:22px" data-a="rename" data-fid="${esc(fid)}">Naam wijzigen</button></div>` : ''}
      <div class="h3" style="margin-top:14px">Max per avond ${mb(admin)}</div>${stepper}
      <p class="note">Stappen van ¼. Standaard staat het op <b>GEEN MAX</b>: tik op − onder ¼ om de max weer uit te zetten.</p>
      ${can ? '<button class="big" data-a="adddose" style="margin-top:18px">Snoepje toevoegen</button>' : ''}
      <div class="h3">Vanavond · totaal ${frac(tot)}</div><ul class="hist">${hist}</ul>
      ${can ? '<p class="note">Tik op een regel om de tijd aan te passen of te verwijderen.</p>' : '<p class="note">Alleen jijzelf en De Michel kunnen snoepjes van deze vriend aanpassen.</p>'}
      <div class="lrow" style="margin-top:22px">${mb(admin)}<button class="big danger ${admin && open ? '' : 'off'}" style="margin-top:0" data-a="delfriend" data-fid="${esc(fid)}">${esc(f.name)} verwijderen</button></div>`;
  };
}
function openDetail(fid) {
  closeSheet();
  pushScreen('detail:' + fid, 'Crew', detailBuild(fid), { live: true });
}

// ---- QR ----
function qrSvg(text, px) {
  const q = window.qrcode(0, 'H');
  q.addData(text); q.make();
  const n = q.getModuleCount(), m = 4, size = n + 2 * m;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR-code"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
function shareBuild() {
  const p = P(); if (!p || p.closed) return null; // sharing only exists inside an open party
  const code = p.codes[0] || '', url = linkFor(p, code); // the QR always carries the main code's link; no code is shown on this screen
  const unclaimed = isAdmin(p) && p.friends.some(f => !p.claims[f.id]);
  const nm = p.name, px = Math.max(34, Math.min(64, Math.floor(330 / (Math.max(...nameLines(nm).map(l => l.length)) * 0.5))));
  const title = `<h1 style="font-size:${px}px;line-height:.95;margin-top:0">Deel<br>${nameLines(nm).map(esc).join('<br>')}</h1>`;
  if (!code) return title + `<p class="lead">${isAdmin(p) ? 'Geen link: maak een nieuwe link (Opties)' : 'Er is geen link beschikbaar. Vraag De Michel om een nieuwe.'}</p>`;
  return title + `
    <div class="qrcard" data-url="${esc(url)}">${qrSvg(url, 260)}</div>
    <button class="big ghost" data-a="qrfull" style="height:62px;font-size:24px">${ICON.expand}<span>Volledig scherm</span></button>
    <button class="big" data-a="doshare" style="margin-top:12px"><span style="font-size:25px">Deel via WhatsApp</span></button>
    <button class="big ghost" data-a="copylink" style="height:62px;font-size:24px">Kopieer link</button>
    ${unclaimed ? `<p class="note">Nieuwe vriend? Voeg eerst zijn naam toe ${mb()}, laat hem dan scannen.</p>` : ''}`;
}
function openQrFull() {
  const p = P(); if (!p) return;
  const code = p.codes[0]; if (!code) return;
  const el = document.createElement('div');
  el.id = 'qrfull';
  el.innerHTML = qrSvg(linkFor(p, code), 400) + `<div class="qrhint">Tik om te sluiten</div>`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}

async function joinWithCode(code, silent) {
  if (joinState.busy) return false;
  joinState.busy = true;
  try {
    const pid = await store.resolveCode(code);
    if (!pid) { toast(DEAD_LINK); return false; } // a dead link never fails silently, also on the auto-join path
    let name = 'Feestje';
    try { const snap = await store.fetchParty(pid); if (snap) name = snap.name; } catch { /* name arrives via watch */ }
    addParty(pid, name);
    clearStack(); closeSheet();
    tab = 'crew';
    render();
    return true;
  } catch (e) { fail(e); return false; } finally { joinState.busy = false; }
}
const joinState = { busy: false };
const DEAD_LINK = 'Deze link werkt niet (meer). Vraag De Michel om de nieuwe link of QR.';

// "Plak link": read the clipboard; if that is not possible (or holds no link) offer a paste field
async function pasteLink() {
  let text = '';
  try { text = await nav.clipboard.readText(); } catch { /* denied or unsupported */ }
  const tok = L.tokenFromLink(text, { origin: location.origin, pathname: location.pathname });
  if (tok) return joinWithCode(tok);
  closeSheet();
  sheet(`<div class="sh-name">Plak link</div><div class="sh-sub">Plak hier de link die je van De Michel kreeg.</div>
    <input class="field" id="paste-in" placeholder="https://…?p=…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="font-size:22px;text-transform:none">
    <button class="big" data-a="pastego">Doe mee</button>`);
  const inp = $('#paste-in'); if (inp) inp.focus();
}

const newState = { name: DEFAULT_NAME };
function newPartyBuild() {
  return () => `<h1 style="margin-top:0">Nieuw<br>feestje</h1>
    <div class="h3" style="margin-top:0">Naam</div>
    <input class="field" id="np-name" maxlength="30" autocomplete="off" autocapitalize="characters" value="${esc(newState.name)}">
    <p class="note">Jij wordt De Michel van dit feestje: alleen jij maakt vrienden aan, stelt max in en deelt de link of QR. Iedereen die de link of QR krijgt, kan meedoen en snoepjes invoeren.</p>
    <button class="big xl" data-a="createparty" style="margin-top:22px">Aanmaken</button>`;
}
function openNewParty() {
  closeSheet();
  newState.name = DEFAULT_NAME;
  pushScreen('new', 'Terug', newPartyBuild());
}

async function createParty() {
  const name = $('#np-name').value.trim();
  if (!name) return toast('Geef het feestje een naam');
  const id = L.newId();
  for (let attempt = 0; ; attempt++) {
    try {
      await store.createParty({ id, name, codes: [L.newToken()] }); // the join token is generated, nobody types it
      break;
    } catch (e) {
      if (e && e.code === 'taken' && attempt < 2) continue;
      if (e && e.code === 'denied') return toast('Deze telefoon mag nog geen feestje maken. Vraag De Michel om de link of QR, of stuur je telefoon-ID.');
      return fail(e);
    }
  }
  addParty(id, name);
  clearStack(); closeSheet();
  tab = 'crew';
  render();
}

// ---------- spelregels ----------
function rulesBuild() {
  return () => `<h1 style="font-size:84px;margin-top:0">Spel-<br>regels</h1>
    <h2 class="rh">Hoe werkt het</h2>
    <ul class="rl">
      <li>Iedereen kiest zijn eigen naam. Tik op de grote <b>+</b> om bij te pakken: kies <b>1</b>, <b>½</b> of <b>¼</b>, en de tijd (nu of eerder).</li>
      <li>Na een hele gaat na <b>2 uur</b> het alarm af, na een halve na <b>1,5 uur</b>, na een kwart na <b>1 uur</b>: <b>INKAKKEN IS BIJPAKKEN!</b></li>
      <li>Alarm werkt alleen met De Michel open.</li>
      <li>De Michel krijgt ieders alarm, de rest alleen hun eigen.</li>
      <li>Max bereikt? Dan geen alarm meer.</li>
      <li><b>TOP</b> = wie heeft het meest, <b>LOG</b> = wie nam wat wanneer.</li>
    </ul>
    <h2 class="rh">Wie kan wat</h2>
    <ul class="rl">
      <li><b>Iedereen:</b> meedoen via de link of QR van De Michel, eigen naam kiezen, eigen snoepjes toevoegen en tijden aanpassen, alles bekijken.</li>
      <li>${mb()} <b>De Michel:</b> feestjes aanmaken en afsluiten, vrienden toevoegen en verwijderen, max instellen, de uitnodigingslink vernieuwen, namen vrijgeven.</li>
    </ul>
    <h2 class="rh">Installeren</h2>
    <ul class="rl"><li>Open de link in Safari, tik op <b>Deel</b>, kies <b>Zet op beginscherm</b> en open <b>De Michel</b> vanaf je beginscherm.</li></ul>
    <button class="big" data-a="rulesok" style="margin-top:22px">Begrepen</button>`;
}
function openRules() { pushScreen('rules', 'Terug', rulesBuild()); }

// ---------- install screen (iOS Safari tab) ----------
function showInstall() {
  document.body.classList.add('install');
  $('#install').innerHTML = `<div class="ins-in">
    <h1>Zet De Michel eerst op je beginscherm</h1>
    <ol class="steps">
      <li><span class="n">1</span><span>Tik op <b>Deel</b> ${ICON.share} onderin Safari</span></li>
      <li><span class="n">2</span><span>Kies <b>Zet op beginscherm</b></span></li>
      <li><span class="n">3</span><span>Open <b>De Michel</b> vanaf je beginscherm</span></li>
    </ol>
  </div>`;
  dataReady();
}

// ---------- actions ----------
document.addEventListener('submit', async e => {
  if (e.target.id === 'renamef') {
    e.preventDefault();
    const fid = e.target.dataset.fid, input = $('#rn-nm'), name = input.value.trim(), p = P();
    if (!name) { shake(input); toast('Vul een naam in'); return input.focus(); }
    if (p && L.nameTaken(p.friends, name, fid)) { shake(input); return toast('Die naam bestaat al'); }
    closeSheet();
    try { await quick(store.renameFriend(current, fid, name)); } catch (err) { toast(err && err.code === 'taken' ? 'Die naam bestaat al' : failMsg(err)); }
    return;
  }
  if (e.target.id === 'addme') {
    e.preventDefault();
    const input = $('#me-nm'), name = input.value.trim(), p = P();
    if (!name) { shake(input); toast('Vul een naam in'); return input.focus(); }
    if (p && L.nameTaken(p.friends, name)) { shake(input); return toast('Die naam bestaat al'); }
    closeSheet();
    try { await store.addFriendAndClaim(current, name); tab = 'crew'; toast('Welkom!'); } catch (err) { toast(err && err.code === 'taken' ? 'Die naam bestaat al' : failMsg(err)); }
    return;
  }
  if (e.target.id !== 'addf') return;
  e.preventDefault();
  const input = $('#nm'), name = input.value.trim(), p = P();
  if (!name) { shake(input); toast('Vul een naam in'); return input.focus(); }
  if (p && L.nameTaken(p.friends, name)) { shake(input); return toast('Die naam bestaat al'); }
  closeSheet();
  try { await quick(store.addFriend(current, name)); } catch (err) { toast(err && err.code === 'taken' ? 'Die naam bestaat al' : failMsg(err)); }
});

document.addEventListener('change', e => {
  if (e.target.id === 't-custom') {
    doseState.custom = e.target.value;
    document.querySelectorAll('#sheet .chip').forEach(c => c.classList.remove('on'));
    $('#chipc').classList.toggle('on', !!doseState.custom);
    $('#chiplbl').textContent = doseState.custom || 'Andere tijd';
    if (!doseState.custom) $('.chip[data-min="0"]').classList.add('on');
  }
});

async function setMax(fid, dir) {
  const p = P(), f = p && friendOf(p, fid); if (!f || p.closed) return;
  let m = f.max;
  if (dir > 0) m = m == null ? 1 : Math.min(20, m + 0.25);
  else m = m == null ? null : m <= 0.25 ? null : m - 0.25;
  try { await quick(store.setMax(current, fid, m)); } catch (e) { fail(e); }
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a],[data-tab],[data-f],[data-did],#bd');
  if (!el) return;
  const d = el.dataset;
  if (el.id === 'bd') return closeSheet();
  if (d.tab) { tab = d.tab; $('#scroll').scrollTop = 0; render(); return; }
  if (d.f && !d.a) {
    const p = P();
    if (p && canAdd(p, d.f)) return openDose(d.f);
    return openDetail(d.f);
  }
  if (d.did && !d.a) return openDoseEdit(d.did);
  const p = P();
  switch (d.a) {
    case 'noop': return;
    case 'close': return closeSheet();
    case 'confirm-ok': { const f = sheetCtx && sheetCtx.onOk; closeSheet(); if (f) f(); return; }
    case 'back': return popScreen();
    case 'undo': { const f = toast.undo; toast.undo = null; $('#toast').classList.remove('on'); if (f) f(); return; }
    case 'parties': return openParties();
    case 'switch': current = d.pid; persistParties(); tab = 'crew'; closeSheet(); $('#scroll').scrollTop = 0; render(); return;
    case 'newparty': return openNewParty();
    case 'pastelink': return pasteLink();
    case 'pastego': { const tok = L.tokenFromLink(($('#paste-in') || {}).value, { origin: location.origin, pathname: location.pathname }); if (!tok) return toast('Dat is geen geldige link'); closeSheet(); return joinWithCode(tok); }
    case 'createparty': return createParty();
    case 'plus': return onPlus();
    case 'share': if (p && !p.closed) pushScreen('delen', 'Crew', shareBuild, { live: true }); return;
    case 'copylink': { if (!p || !p.codes[0]) return; toast(await copyText(linkFor(p)) ? 'Link gekopieerd' : esc(linkFor(p))); return; }
    case 'qrfull': return openQrFull();
    case 'doshare': {
      if (!p || p.closed) return;
      if (!p.codes[0]) return toast('Geen link: maak een nieuwe link (Opties)');
      const url = linkFor(p), text = L.shareText(p.name, url); // URL inside the text, no separate url field
      if (nav.share) { try { await nav.share({ text }); } catch { /* cancelled */ } return; }
      toast(await copyText(url) ? 'Link gekopieerd' : esc(url));
      return;
    }
    case 'pick': return openDose(d.fid);
    case 'newfriend': return isAdmin(p) ? openNewFriend() : adminOnly();
    case 'detail': return openDetail(d.fid);
    case 'chip': {
      doseState.min = +d.min; doseState.custom = '';
      document.querySelectorAll('#sheet .chip').forEach(c => c.classList.toggle('on', c === el));
      $('#chiplbl').textContent = 'Andere tijd'; $('#t-custom').value = '';
      return;
    }
    case 'dose': return addDose(sheetCtx && sheetCtx.fid, +d.size, doseTime());
    case 'adddose': { const fid = screens[screens.length - 1].key.split(':')[1]; return openDose(fid); }
    case 'savedose': {
      const did = sheetCtx.did, dd = p.doses.find(x => x.id === did);
      const t = dd && L.retime($('#edit-t').value, dd.t, nowMs());
      if (t === -1) return toast('Tijd ligt in de toekomst');
      if (!t) return toast('Kies een tijd');
      closeSheet();
      try { await quick(store.setDoseTime(current, did, t)); toast('Tijd aangepast'); } catch (err) { fail(err); }
      return;
    }
    case 'deldose': {
      const did = sheetCtx.did;
      confirmSheet({ title: 'Verwijderen?', text: 'Dit snoepje uit de lijst halen?', ok: 'Verwijderen', onOk: async () => { try { await quick(store.removeDose(current, did)); } catch (err) { fail(err); } } });
      return;
    }
    case 'maxup': { const fid = screens[screens.length - 1].key.split(':')[1]; return setMax(fid, 1); }
    case 'maxdown': { const fid = screens[screens.length - 1].key.split(':')[1]; return setMax(fid, -1); }
    case 'delfriend': {
      if (!isAdmin(p)) return adminOnly();
      if (p.closed) return toast('Dit feestje is afgesloten');
      const f = friendOf(p, d.fid); if (!f) return;
      confirmSheet({ title: `${f.name} verwijderen?`, text: 'Ook alle snoepjes van deze vriend verdwijnen.', ok: 'Verwijderen', onOk: async () => {
        try { await quick(store.removeFriend(current, p, d.fid)); } catch (err) { fail(err); } } });
      return;
    }
    case 'doinstall': { const ev = installEvent; installEvent = null; ls.set('michel_install_hidden', true); render(); if (ev) { try { await ev.prompt(); } catch { /* dismissed */ } } return; }
    case 'hideinstall': installEvent = null; ls.set('michel_install_hidden', true); render(); return;
    case 'rules': return openRules();
    case 'rulesok': { ls.set('michel_rules_seen', true); const r = screens.find(x => x.key === 'rules'); if (r) popScreen(r); return; }
    case 'claim': {
      try { await store.claim(current, d.fid); tab = 'crew'; toast('Welkom!'); if (!ls.get('michel_rules_seen', false)) setTimeout(openRules, 350); } catch (err) { toast(err && err.code === 'denied' ? 'Die naam is al bezet' : failMsg(err)); }
      return;
    }
    case 'claimskip': { if (isAdmin(p)) ls.set('michel_skipclaim_' + p.id, true); else skippedClaim.add(p.id); const s = screens.find(x => x.key === 'claim'); if (s) popScreen(s); return; }
    case 'rename': return openRename(d.fid);
    case 'addme': return !isAdmin(p) ? adminOnly() : meOf(p) ? toast('Je hebt al een naam gekozen') : openAddMe();
    case 'whoami': { skippedClaim.delete(p.id); ls.set('michel_skipclaim_' + p.id, false); return openClaim(); }
    case 'notme': {
      if (p.closed) return toast('Dit feestje is afgesloten');
      const me = meOf(p);
      confirmSheet({ title: 'Iemand anders?', text: 'Je naam komt weer vrij en je kiest opnieuw.', ok: 'Ja, ik ben iemand anders', onOk: async () => {
        try { await store.release(current, me, p.claims[me]); skippedClaim.delete(p.id); } catch (err) { fail(err); } } });
      return;
    }
    case 'release': {
      if (!isAdmin(p)) return adminOnly();
      if (p.closed) return toast('Dit feestje is afgesloten');
      try { await store.release(current, d.fid, p.claims[d.fid]); toast('Naam vrijgegeven'); } catch (err) { fail(err); }
      return;
    }
    case 'sound': settings.sound = !settings.sound; saveSettings(); el.classList.toggle('on', settings.sound); if (settings.sound) previewSound(); return;
    case 'calm': settings.calm = !settings.calm; saveSettings(); el.classList.toggle('on', settings.calm); return;
    case 'allalarms': if (!isAdmin(p)) return adminOnly(); settings.allAlarms = !settings.allAlarms; saveSettings(); el.classList.toggle('on', settings.allAlarms); return;
    case 'newlink': {
      if (!isAdmin(p)) return adminOnly();
      if (p.closed) return toast('Dit feestje is afgesloten');
      if (!requireOnline()) return;
      const pid = current, old = p.codes.slice();
      confirmSheet({ title: 'Nieuwe link maken?', text: 'De oude link en QR werken daarna niet meer. Wie al in het feestje zit, blijft erin. Deel daarna de nieuwe link of QR.', ok: 'Nieuwe link maken', onOk: async () => {
        await linkWrite(async () => {
          const token = L.newToken();
          for (let i = 0; ; i++) { try { await store.rotateLink(pid, i ? L.newToken() : token, old); break; } catch (e) { if (!(e && e.code === 'taken') || i > 2) throw e; } } // ONE atomic write
        }, 'Nieuwe link gemaakt. Deel de nieuwe QR.', 'Nieuwe link maken mislukt, probeer opnieuw'); } });
      return;
    }
    case 'disablelink': {
      if (!isAdmin(p)) return adminOnly();
      if (!requireOnline()) return;
      const pid = current, codes = p.codes.slice();
      confirmSheet({ title: 'Link uitschakelen?', text: 'Daarna werken de link en QR niet meer. Wie al in het feestje zit, blijft erin.', ok: 'Link uitschakelen', onOk: async () => {
        await linkWrite(() => store.disableLink(pid, codes), 'Link uitgeschakeld', 'Oeps, dat is mislukt'); } });
      return;
    }
    case 'closeparty': {
      if (!isAdmin(p)) return adminOnly();
      if (p.closed) return;
      if (!requireOnline()) return;
      sheet(`<div class="sh-name">Feestje afsluiten?</div><div class="sh-sub">Daarna is het alleen-lezen voor iedereen: geen alarm en geen nieuwe snoepjes. Dit kan niet ongedaan worden. Link ook uitschakelen? Dan kan niemand het feestje nog openen met de oude link of QR.</div>
        <button class="big danger" data-a="closeall" style="margin-top:6px">Afsluiten en link uitschakelen</button>
        <button class="big ghost" data-a="closeonly" style="height:66px;font-size:24px">Alleen afsluiten</button>
        <button class="big ghost" data-a="close" style="height:66px;font-size:24px">Annuleren</button>`, { codes: p.codes.slice() });
      return;
    }
    case 'closeall': case 'closeonly': {
      const codes = d.a === 'closeall' && sheetCtx ? sheetCtx.codes : [], pid = current;
      closeSheet();
      await linkWrite(() => store.closeParty(pid, codes), codes.length ? 'Feestje afgesloten, link uitgeschakeld' : 'Feestje afgesloten', 'Oeps, dat is mislukt');
      return;
    }
    case 'leave':
      confirmSheet({ title: 'Feestje verlaten?', text: 'Het verdwijnt van deze telefoon. Met de code kom je er weer in.', ok: 'Verlaten', onOk: () => leaveParty(current) });
      return;
    case 'copyid': toast(await copyText(uid) ? 'ID gekopieerd' : 'Kopiëren lukte niet'); return;
    case 'test': return showAlarm(null);
    case 'a-took': { const a = alarm.target; hideAlarm('done'); if (a && !a.test) { const pp = view(a.pid); if (pp && canAdd(pp, a.fid)) { current = a.pid; persistParties(); tab = 'crew'; render(); openDose(a.fid); } } return; }
    case 'a-snooze': return hideAlarm('snooze');
    case 'a-ok': return hideAlarm('done');
  }
});

// ---------- alarm ----------
const alarm = { target: null, testT: null };
const seenMap = () => ls.get('michel_seen', {});
const snoozeMap = () => ls.get('michel_snooze', {});

function alarmFriends(p) {
  const me = meOf(p);
  if (isAdmin(p) && settings.allAlarms) return p.friends;
  return p.friends.filter(f => f.id === me);
}
function checkAlarms(now) {
  if (alarm.target) return;
  const seen = seenMap(), snooze = snoozeMap();
  for (const pp of parties) {
    if (!L.alarmGate({ live: live.has(pp.id), hasCache: raw.has(pp.id), online, uptimeMs: performance.now() })) continue; // stale cache only when offline / no snapshot after 5 s
    const p = view(pp.id); if (!p) continue;
    for (const f of alarmFriends(p)) {
      const st = L.status(dosesOf(p, f.id), f.max, now), key = p.id + ':' + f.id;
      if (L.canAlarm(st, { closed: p.closed, seenId: seen[key], snoozeUntil: snooze[key] || 0, now })) return showAlarm({ pid: p.id, fid: f.id, key: L.doseKey(st.last) });
    }
  }
}
function alarmInfo() {
  const a = alarm.target;
  if (!a) return null;
  if (a.test) return { who: 'Michel', why: 'Dit is een test', party: '' };
  const p = view(a.pid), f = p && friendOf(p, a.fid);
  if (!f) return null;
  const st = L.status(dosesOf(p, f.id), f.max, nowMs());
  return { st, p, f, who: f.name, why: st.last ? `${L.SIZE_NAME[st.last.size]} om ${hhmm(st.last.t)} · ${dur(nowMs() - st.last.t)} geleden` : '', party: p.name };
}
function showAlarm(a) {
  unlockAudio(); // resume the AudioContext synchronously inside the tap (iOS keeps it suspended otherwise)
  closeSheet();
  alarm.target = a ? { pid: a.pid, fid: a.fid, key: a.key } : { test: true };
  fillAlarm();
  $('#alarm').classList.toggle('calm', settings.calm);
  $('#alarm').classList.add('on');
  startMusic(false); // the strobe is pure CSS (photo / yellow / inverted photo / black); the music does not flip it
  clearTimeout(alarm.testT);
  if (!a) alarm.testT = setTimeout(() => { if (alarm.target && alarm.target.test) hideAlarm('done'); }, 60000); // the test alarm runs a full 60 s unless a button is pressed
  if (nav.vibrate && nav.userActivation && nav.userActivation.hasBeenActive) { try { nav.vibrate([500, 200, 500]); } catch { /* unsupported */ } }
}
function fillAlarm() {
  const i = alarmInfo();
  if (!i) return hideAlarm('gone');
  $('#a-who').textContent = i.who; $('#a-why').textContent = i.why; $('#a-party').textContent = i.party;
}
// 'done' acknowledges exactly the dose that raised the alarm; 'snooze' delays it; 'gone' (state changed elsewhere) writes nothing
function hideAlarm(how) {
  clearTimeout(alarm.testT);
  stopMusic();
  $('#alarm').classList.remove('on');
  const a = alarm.target; alarm.target = null;
  if (!a || a.test) return;
  const key = a.pid + ':' + a.fid;
  if (how === 'snooze') {
    const until = Date.now() + L.SNOOZE_MS;
    const m = snoozeMap(); m[key] = until; ls.set('michel_snooze', m);
    setTimeout(tick, L.SNOOZE_MS + 30); // fire right at expiry instead of waiting for the next 1 s tick
  } else if (how === 'done') {
    const m = seenMap(); m[key] = a.key; ls.set('michel_seen', m);
  }
}

// ---- sound: euphoric trance space synths, synthesized live (no audio files) ----
// High supersaw arpeggio (A minor, A5-A6) with a resonant filter sweep, soft space pads and bleeps, big reverb + ping-pong delay.
// No percussion, no bass. Tempo 138 -> 200 BPM (+6 per bar); at the top the arpeggio doubles its note rate (16ths -> 32nds).
const { CAP_STEP, bpmAt } = L;
const CHORDS = [[880, 1046.5, 1318.5], [698.46, 880, 1046.5], [1046.5, 1318.5, 1568], [783.99, 987.77, 1174.66]]; // Am F C G
const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 2, 1]; // index into [root, 3rd, 5th, octave]
const arpNote = (step, sub = 0) => {
  const c = CHORDS[Math.floor(step / 16) % 4], i = ARP_PATTERN[step % 16];
  return i === 3 ? c[0] * 2 : c[i];
};
let ac = null, bus = null, fxSend = null, killG = null, lfoG = null;
const music = { runs: 0, voices: 0, on: false, timer: null, next: 0, step: 0, lfo: null, beat: false, gen: 0, stopT: null };
const MUSIC_MAX_MS = 3 * 60 * 1000; // after 3 minutes only the visual alarm stays
const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

// a fresh node graph per run: stopping disconnects it (instant silence, tails included), starting never has to undo automation on a gain node (WebKit kept a half-finished setTarget ramp alive and the second alarm stayed silent)
let irBuf = null;
function buildGraph() {
  killG = ac.createGain(); killG.gain.value = 0; // everything passes here; ramped in by startMusic
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 6; comp.ratio.value = 14; comp.attack.value = 0.002; comp.release.value = 0.12;
  const master = ac.createGain(); master.gain.value = 0.95;
  killG.connect(hp); hp.connect(comp); comp.connect(master); master.connect(ac.destination);
  bus = ac.createGain(); bus.connect(killG);
  fxSend = ac.createGain();
  // ping-pong delay, feedback 0.4
  const dl = ac.createDelay(1), dr = ac.createDelay(1), fb = ac.createGain(), wet = ac.createGain();
  dl.delayTime.value = 0.19; dr.delayTime.value = 0.19; fb.gain.value = 0.4; wet.gain.value = 0.55;
  const pan = v => { if (!ac.createStereoPanner) return null; const p = ac.createStereoPanner(); p.pan.value = v; return p; };
  fxSend.connect(dl); dl.connect(dr); dr.connect(fb); fb.connect(dl);
  for (const [d, p] of [[dl, pan(-0.8)], [dr, pan(0.8)]]) { if (p) { d.connect(p); p.connect(wet); } else d.connect(wet); }
  wet.connect(killG);
  // procedural reverb: 2.5 s of decaying noise
  const conv = ac.createConvolver();
  if (!irBuf) { const len = Math.floor(ac.sampleRate * 2.5); irBuf = ac.createBuffer(2, len, ac.sampleRate); for (let c = 0; c < 2; c++) { const d = irBuf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); } }
  conv.buffer = irBuf;
  const revWet = ac.createGain(); revWet.gain.value = 0.75;
  fxSend.connect(conv); conv.connect(revWet); revWet.connect(killG);
  lfoG = ac.createGain(); lfoG.gain.value = 14; // vibrato depth in cents

}
function unlockAudio() {
  try { if (nav.audioSession) nav.audioSession.type = 'playback'; } catch { /* unsupported */ } // plays with the silent switch on (iOS 16.4+)
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    ac = new C();
  }
  if (ac.state !== 'running') ac.resume().catch(() => {});
}
['pointerdown', 'touchend', 'click'].forEach(t => document.addEventListener(t, unlockAudio, { passive: true }));

const out = (node, wetAmt = 0) => { node.connect(bus); if (wetAmt) { const g = ac.createGain(); g.gain.value = wetAmt; node.connect(g); g.connect(fxSend); } };
const env = (g, t, peak, dur, attack = 0.004) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur); };

// supersaw stab: 5 detuned saws through a resonant lowpass
function voiceLead(freq, t, dur, cutoff) {
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 9; f.frequency.value = cutoff;
  const g = ac.createGain(); env(g, t, 0.09, dur);
  for (const cents of [-18, -9, 0, 9, 18]) {
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = cents;
    lfoG.connect(o.detune); o.onended = () => { try { lfoG.disconnect(o.detune); } catch { /* gone */ } };
    o.connect(f); o.start(t); o.stop(t + dur + 0.05);
  }
  f.connect(g); out(g, 0.4);
}
// soft pad: slow triangle chord, heavily into the reverb
function voicePad(chord, t, dur) {
  const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + dur * 0.35); g.gain.linearRampToValueAtTime(0, t + dur);
  for (const f of chord) {
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 14;
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
  }
  out(g, 0.9);
}
function voiceBleep(t) {
  const o = ac.createOscillator(); o.type = Math.random() < 0.5 ? 'sine' : 'triangle';
  o.frequency.setValueAtTime(1200 + Math.random() * 2800, t); o.frequency.exponentialRampToValueAtTime(1200 + Math.random() * 2800, t + 0.06);
  const g = ac.createGain(); env(g, t, 0.16, 0.4, 0.005);
  o.connect(g); o.start(t); o.stop(t + 0.45); out(g, 0.9);
}

function schedStep(step, t) {
  music.voices++;
  const bpm = bpmAt(step), sx = 60 / bpm / 4; // one 16th
  const cutoff = 500 * Math.pow(14, (step % 32) / 32); // resonant sweep up over 2 bars
  const double = step >= CAP_STEP; // at the top the arpeggio runs in 32nds
  voiceLead(arpNote(step), t, sx * (double ? 0.42 : 0.85), cutoff);
  if (double) voiceLead(arpNote(step + 1), t + sx / 2, sx * 0.42, cutoff);
  if (step % 16 === 0) voicePad(CHORDS[Math.floor(step / 16) % 4].map(f => f / 2), t, sx * 16);
  if (Math.random() < 0.3) voiceBleep(t + (Math.random() < 0.5 ? 0 : sx / 2));
  if (step % 4 === 0 && music.beat) { const g = music.gen; setTimeout(() => { if (music.on && g === music.gen) $('#alarm').classList.toggle('flip'); }, Math.max(0, (t - ac.currentTime) * 1000)); }
}
function pump() {
  while (music.on && music.next < ac.currentTime + 0.1) { // 100 ms lookahead, pumped every 25 ms
    schedStep(music.step, music.next);
    music.next += 60 / bpmAt(music.step) / 4;
    music.step++;
  }
}
// every new alarm starts again at 138 BPM
function startMusic(beat) {
  if (!ac || !settings.sound || music.on) return;
  if (ac.state !== 'running') ac.resume().catch(() => {}); // called synchronously from the tap
  buildGraph();
  const t = ac.currentTime;
  music.on = true; music.runs++; music.step = 0; music.next = t + 0.06; music.beat = !!beat; music.gen++;
  clearTimeout(music.stopT); music.stopT = setTimeout(stopMusic, MUSIC_MAX_MS);
  killG.gain.setValueAtTime(0, t); killG.gain.linearRampToValueAtTime(1, t + 0.05); // 50 ms ramp-in
  music.lfo = ac.createOscillator(); music.lfo.frequency.value = 5.5; music.lfo.connect(lfoG); music.lfo.start(t);
  music.timer = setInterval(pump, 25);
  if (beat) { $('#alarm').classList.add('beat'); $('#alarm').classList.remove('flip'); }
  pump();
}
function stopMusic() {
  clearInterval(music.timer); clearTimeout(music.stopT); music.gen++;
  $('#alarm').classList.remove('beat', 'flip');
  if (!music.on) return;
  music.on = false;
  try { killG.disconnect(); music.lfo.stop(); music.lfo.disconnect(); } catch { /* already stopped */ }
  killG = null; bus = null; fxSend = null; lfoG = null;
}
// short preview for the sound toggle
function previewSound() { if (alarm.target) return; startMusic(false); setTimeout(() => { if (!alarm.target) stopMusic(); }, 2200); }

// ---------- tick ----------
function tick() {
  if (!store) return;
  const now = nowMs(), p = P();
  if (p && tab === 'crew') {
    for (const el of document.querySelectorAll('#view .card[data-f]')) {
      const f = friendOf(p, el.dataset.f); if (!f) continue;
      const st = L.status(dosesOf(p, f.id), f.max, now);
      if (el.dataset.k !== st.kind) { renderView(); break; }
      const cd = $('[data-r=cd]', el), bar = $('[data-r=bar]', el);
      if (cd) cd.textContent = dur(st.kind === 'wait' ? st.rem : st.over);
      if (bar) bar.style.width = (st.p * 100).toFixed(1) + '%';
    }
  }
  if (alarm.target && !alarm.target.test) {
    const i = alarmInfo();
    // state changed elsewhere (dose deleted/edited/closed): drop the alarm without acknowledging anything; a new one may follow below
    if (!i || i.st.kind !== 'due' || i.p.closed || L.doseKey(i.st.last) !== alarm.target.key) hideAlarm('gone');
    else fillAlarm();
  }
  checkAlarms(now);
}

// ---------- scroll: collapsing large title ----------
$('#scroll').addEventListener('scroll', e => $('#bar').classList.toggle('small', e.target.scrollTop > 60), { passive: true });

// ---------- init ----------
if (INSTALL) showInstall();
else {
  store.onOnline(v => { const was = online; online = v; barState(); if (v && !was) replayOutbox(); });
  $('.shr').innerHTML = ICON.share;
  $('.plus').innerHTML = ICON.plus;
  document.querySelectorAll('#tabs .tab').forEach(b => { b.innerHTML = ICON[b.dataset.tab] + { crew: 'Crew', top: 'Top', log: 'Log', settings: 'Opties' }[b.dataset.tab]; });
  $('#myid').addEventListener('click', async () => toast(await copyText(uid) ? 'ID gekopieerd' : 'Kopiëren lukte niet'));
  $('#myid').textContent = 'Jouw telefoon-ID: ' + uid;
  for (const pp of parties) subscribe(pp.id);
  render();
  if (!current) dataReady();
  replayOutbox();

  // link ?p=PIN joins that party directly (first standalone launch included), then the PIN leaves the URL
  // each ?p=PIN is auto-joined only once per phone; later launches with the same start URL just open normally
  const linkCode = L.normalizeCode(new URLSearchParams(location.search).get('p')), linkOk = L.isValidCode(linkCode);
  if (linkCode) {
    const u = new URL(location.href); u.searchParams.delete('p');
    history.replaceState(null, '', u);
    const done = ls.get('michel_linkcodes_done', []);
    if (!linkOk) toast(DEAD_LINK);
    else if (!done.includes(linkCode)) {
      const known = parties.length;
      joinWithCode(linkCode, true).then(ok => {
        if (ok) ls.set('michel_linkcodes_done', [...ls.get('michel_linkcodes_done', []), linkCode]);
        else if (!known) dataReady();
      });
    }
  }

  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); tick(); replayOutbox(); } });
  tick();
}
window.__michel = { get state() { return { current, parties, tab, outbox, live: [...live], audio: { on: music.on, runs: music.runs, voices: music.voices, ctx: ac ? ac.state : null, time: ac ? ac.currentTime : 0, gain: killG ? killG.gain.value : null } }; }, tick };
