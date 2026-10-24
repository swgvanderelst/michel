// Browser smoke test (needs Edge): claim, dose via UI, toast vs sheet, QR, outbox replay, install screen, console errors.
import assert from 'node:assert/strict';
import { startServer } from '../dev-server.mjs';
import { launchEdge } from './edge.mjs';

const srv = await startServer({ port: 0, seed: true });
const base = `http://localhost:${srv.port}`;
const { browser, close } = await launchEdge();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const admin = { 'x-uid': 'dev-admin', 'x-secret': 'dev-admin-secret', 'content-type': 'application/json' };
const get = u => fetch(base + '/api' + u, { headers: admin }).then(r => r.json());
const PID = (await get('/codes/8209')).partyId;
const friendId = async name => Object.entries((await get('/parties/' + PID)).friends).find(([, f]) => f.name === name)[0];
const errors = [];
async function phone(query, { ua } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (ua) await page.setUserAgent(ua);
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text() + ' ' + (m.location().url || '')); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/api/')) errors.push('http ' + r.status() + ' ' + r.url()); });
  await page.goto(base + '/' + query, { waitUntil: 'domcontentloaded' });
  return page;
}
const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);

try {
  // ---- non-admin: claim, dose through the big + ----
  const sanne = await friendId('Sanne');
  let sanneSecret = null;
  let page = await phone('?devuid=phone-sanne-01&p=8209');
  await sleep(2600);
  await page.click(`[data-a=claim][data-fid="${sanne}"]`);
  await sleep(1200);
  assert.equal((await get('/parties/' + PID)).claims[sanne], 'phone-sanne-01');
  assert.match(await page.$eval('.screen .scr', e => e.textContent), /Wie kan wat/i); // spelregels show once after the first claim
  await click(page, '[data-a=rulesok]'); await sleep(500);
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => {}; window.dispatchEvent(e); }); await sleep(300);
  assert.equal(await page.$('.ibanner') !== null, true); // Android install offer
  await click(page, '[data-a=hideinstall]'); await sleep(300);
  assert.equal(await page.$('.ibanner'), null);
  await page.click('.plus'); await sleep(400);
  assert.match(await page.$eval('#sheet .sh-name', e => e.textContent), /Sanne/i);
  await page.click('.chip[data-min="15"]');
  await page.click('[data-a=dose][data-size="0.25"]'); await sleep(900);
  const doses = Object.entries((await get('/parties/' + PID)).doses);
  assert.equal(doses.length, 1);
  assert.equal(doses[0][1].friendId, sanne);
  assert.ok(Math.abs(doses[0][1].t - (Date.now() - 15 * 60000)) < 20000);
  assert.match(doses[0][0], /^[-_A-Za-z0-9]{1,32}$/); // client-chosen id is key-safe
  await page.evaluate(() => document.querySelector('.card[data-f]:not(:first-child)').click()); await sleep(500);
  assert.equal(await page.$('[data-a=adddose]'), null); // other cards are view-only
  sanneSecret = await page.evaluate(() => localStorage.getItem('michel_dev_secret')); // storage is shared between pages: keep it for later
  await page.close();

  // ---- admin: toast must not block the confirm button of a sheet ----
  page = await phone('?devuid=dev-admin');
  await sleep(2600);
  await click(page, '[data-a=claimskip]').catch(() => {});
  await sleep(400);
  const joris = await friendId('Joris');
  await fetch(`${base}/api/parties/${PID}/doses`, { method: 'POST', headers: admin, body: JSON.stringify({ friendId: joris, size: 0.5, t: Date.now() - 20 * 60000 }) });
  await sleep(600);
  await click(page, `.card[data-f="${joris}"]`); await sleep(400); // admin: opens the dose sheet
  await click(page, '[data-a=detail]'); await sleep(600);
  await click(page, '.hist li[data-did]'); await sleep(400);
  await page.evaluate(() => { const i = document.getElementById('edit-t'); const d = new Date(Date.now() - 10 * 60000); i.value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); });
  await click(page, '[data-a=savedose]'); await sleep(500); // toast "Tijd aangepast" is now visible
  await click(page, '.hist li[data-did]'); await sleep(400);
  await click(page, '[data-a=deldose]'); await sleep(400); // confirm sheet while the toast is still up
  const hit = await page.evaluate(() => {
    const b = document.querySelector('[data-a=confirm-ok]').getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return el.closest('[data-a=confirm-ok]') !== null || (el.outerHTML.slice(0, 120) + ' @' + Math.round(b.top) + ' ' + innerHeight);
  });
  assert.equal(hit, true, 'confirm button is covered by ' + hit);
  await click(page, '[data-a=confirm-ok]'); await sleep(700);
  assert.equal(Object.keys((await get('/parties/' + PID)).doses).length, 1); // only Sanne's dose is left

  // ---- QR: the encoded string equals the share link; decode when the browser can ----
  await click(page, '[data-a=back]'); await sleep(400);
  await click(page, '[data-a=share]'); await sleep(700);
  const url = await page.$eval('.qrcard', e => e.dataset.url);
  assert.equal(url, `${base}/?p=8209`);
  assert.equal(await page.$eval('.qrcard svg', e => !!e.querySelector('path')), true);
  const decoded = await page.evaluate(async () => {
    if (!('BarcodeDetector' in window)) return null;
    const svg = document.querySelector('.qrcard svg');
    const img = new Image(); img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 520; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 520, 520);
    const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(c);
    return r[0] && r[0].rawValue;
  });
  if (decoded !== null) assert.equal(decoded, url); else console.log('BarcodeDetector unavailable: checked the encoded string only');
  await click(page, '[data-a=qrpick][data-i="1"]');
  assert.equal(await page.$eval('.qrcard', e => e.dataset.url), `${base}/?p=7815`);
  await click(page, '[data-a=qrfull]');
  assert.equal(await page.$('#qrfull svg') !== null, true);
  await click(page, '#qrfull');
  assert.equal(await page.$('#qrfull'), null);

  // ---- duplicate / empty friend names ----
  await click(page, '[data-a=back]'); await sleep(400);
  await click(page, '.plus'); await sleep(300);
  await click(page, '[data-a=newfriend]'); await sleep(300);
  await page.type('#nm', ' sanne ');
  await page.keyboard.press('Enter'); await sleep(300);
  assert.match(await page.$eval('#toast', e => e.textContent), /Die naam bestaat al/);
  await page.$eval('#nm', e => { e.value = ''; });
  await page.keyboard.press('Enter'); await sleep(300);
  assert.match(await page.$eval('#toast', e => e.textContent), /Vul een naam in/);
  assert.equal(await page.$eval('#nm', e => e.classList.contains('shake')), true);
  await page.close();

  // ---- outbox: a dose added while the server is unreachable is kept and replayed ----
  page = await phone('?devuid=phone-sanne-01&devsecret=' + sanneSecret);
  await sleep(2600);
  await page.setOfflineMode(true);
  await page.click('.plus'); await sleep(400);
  await page.click('[data-a=dose][data-size="0.5"]'); await sleep(2000);
  const st = await page.evaluate(() => window.__michel.state);
  assert.equal(st.outbox.length, 1);
  assert.match(await page.$eval('#view', e => e.textContent), /wordt verstuurd/i);
  await page.setOfflineMode(false);
  await page.goto(`${base}/?devuid=phone-sanne-01&devsecret=${sanneSecret}`, { waitUntil: 'domcontentloaded' });
  await sleep(3200);
  const after = await get('/parties/' + PID);
  assert.equal(Object.values(after.doses).filter(d => d.size === 0.5 && d.friendId === sanne).length, 1); // replayed exactly once
  assert.equal((await page.evaluate(() => window.__michel.state)).outbox.length, 0);
  await page.close();

  // ---- alarm: a changed latest dose is not swallowed; done acknowledges only that dose; an edited time re-arms ----
  page = await phone('?devuid=dev-admin');
  await sleep(2600);
  await click(page, '[data-a=claimskip]').catch(() => {});
  const post = b => fetch(`${base}/api/parties/${PID}/doses`, { method: 'POST', headers: admin, body: JSON.stringify({ friendId: joris, ...b }) }).then(r => r.json());
  const alarmOn = () => page.$eval('#alarm', e => e.classList.contains('on'));
  await post({ size: 1, t: Date.now() - 130 * 60000 });
  await sleep(1800);
  assert.equal(await alarmOn(), true);
  assert.match(await page.$eval('#a-who', e => e.textContent), /joris/i);
  const B = await post({ size: 0.25, t: Date.now() - 70 * 60000 }); // newer latest dose while the alarm is up
  await sleep(2500);
  assert.equal(await alarmOn(), true, 'alarm for the new latest dose was swallowed');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('michel_seen') || '{}')), {}); // nothing acknowledged yet
  await click(page, '[data-a=a-ok]'); await sleep(2600);
  assert.equal(await alarmOn(), false);
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('michel_seen') || '{}'));
  assert.equal(Object.values(seen).length, 1);
  assert.match(Object.values(seen)[0], new RegExp('^' + B.id + ':'));
  await fetch(`${base}/api/parties/${PID}/doses/${B.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ t: Date.now() - 80 * 60000 }) });
  await sleep(2500);
  assert.equal(await alarmOn(), true, 'editing the time of an acknowledged dose must re-arm the alarm');
  await page.close();

  // ---- install screen: iPhone Safari tab (not standalone) ----
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  page = await phone('?p=8209', { ua: iphone });
  await sleep(2500);
  assert.match(await page.$eval('#install', e => e.textContent), /beginscherm/i);
  assert.match(await page.$eval('#install .code', e => e.textContent), /8209/);
  assert.equal(await page.evaluate(() => location.search), '?p=8209'); // PIN stays in the URL
  assert.equal(await page.$('link[rel=manifest]'), null); // iOS uses the current URL for the home-screen icon
  assert.equal(await page.$eval('[data-a=newparty]', e => getComputedStyle(e.closest('#start')).display), 'none');
  await page.close();

  const real = errors.filter(e => !/ERR_INTERNET_DISCONNECTED|ERR_FAILED/.test(e) && !e.includes("/api/")); // dev API answers unknown codes with 404 on purpose
  assert.deepEqual(real, []);
  console.log('smoke ok');
} finally { await close(); await srv.close(); }
