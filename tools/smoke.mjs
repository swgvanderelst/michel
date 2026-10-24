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
const CODE = srv.seed.code, PID = srv.seed.partyId; // the seed generates a random join token
const friendId = async name => Object.entries((await get('/parties/' + PID)).friends).find(([, f]) => f.name === name)[0];
const errors = [];
async function phone(query, { ua } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (ua) await page.setUserAgent(ua);
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('error', e => console.log('PAGE CRASH', e.message)); // a renderer crash would explain 'detached frame' flakes
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text() + ' ' + (m.location().url || '')); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/api/')) errors.push('http ' + r.status() + ' ' + r.url()); });
  await page.goto(base + '/' + query, { waitUntil: 'domcontentloaded' });
  return page;
}
const splashGone = async p => { await p.waitForSelector('#splash', { hidden: true, timeout: 9000 }).catch(() => {}); await sleep(1200); }; // splash: min 3 s, max 5 s
const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);

try {
  // ---- non-admin: claim, dose through the big + ----
  const sanne = await friendId('Sanne');
  let sanneSecret = null;
  let page = await phone(`?devuid=phone-sanne-01&p=${CODE}`);
  await splashGone(page);
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
  await page.evaluate(() => [...document.querySelectorAll('.card[data-f]')].find(c => !c.querySelector('.you')).click()); await sleep(500);
  assert.equal(await page.$('[data-a=adddose]'), null); // other cards are view-only
  // ---- personal plan: no max, no plan; with max and end it lists moments and stops at the cutoff ----
  await page.evaluate(() => document.querySelector('.card .you').closest('.card').click()); await sleep(400); // own card: dose sheet
  await click(page, '[data-a=detail]'); await sleep(600);
  await click(page, '.screen [data-a=plan]'); await sleep(500);
  assert.match(await page.$eval('#stack > .screen:last-child .scr', e => e.textContent), /Stel eerst je max in/);
  await click(page, '[data-a=plan-maxup]'); await sleep(200); await click(page, '[data-a=plan-maxup]'); await sleep(200); // 1 then 1 1/4
  assert.match(await page.$eval('#stack > .screen:last-child .scr', e => e.textContent), /Vul het einde/);
  await page.evaluate(() => { const i = document.getElementById('pl-end'); const d = new Date(Date.now() + 8 * 3600000); i.value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(300);
  assert.equal((await page.$$('.plan-row')).length >= 1, true, 'plan rows missing');
  assert.equal((await page.$$('.plan-row.next')).length, 1);
  assert.match(await page.$eval('#stack > .screen:last-child .scr', e => e.textContent), /Plan stopt om \d\d:\d\d \(laatste moment\)/);
  await click(page, '[data-a=back]'); await sleep(400); await click(page, '[data-a=back]'); await sleep(400);
  assert.match(await page.$eval('#view', e => e.textContent), /Volgens plan: ± \d\d:\d\d/); // the line on the own card
  sanneSecret = await page.evaluate(() => localStorage.getItem('michel_dev_secret')); // storage is shared between pages: keep it for later
  await page.close();

  // ---- admin: toast must not block the confirm button of a sheet ----
  page = await phone('?devuid=dev-admin');
  await splashGone(page);
  await click(page, '[data-a=claimskip]').catch(() => {});
  await sleep(400);
  const joris = await friendId('Joris');
  await fetch(`${base}/api/parties/${PID}/doses`, { method: 'POST', headers: admin, body: JSON.stringify({ friendId: joris, size: 0.5, t: Date.now() - 20 * 60000 }) });
  await sleep(600);
  // ---- crew order: due first (longest overdue), then wait (least left), then none, max last; the own card is not pinned ----
  {
    const names = await page.$$eval('#view .card[data-f] .name', els => els.map(e => e.textContent.replace(/JIJ|DE MICHEL/, '').trim()));
    const kinds = await page.$$eval('#view .card[data-f]', els => els.map(e => e.dataset.k));
    const rank = { due: 0, wait: 1, none: 2, max: 3 };
    assert.deepEqual(kinds.slice().sort((x, y) => rank[x] - rank[y]), kinds, 'cards are grouped due, wait, none, max: ' + kinds + ' ' + names);
  }
  await click(page, `.card[data-f="${joris}"]`); await sleep(400); // admin: opens the dose sheet
  await click(page, '[data-a=detail]'); await sleep(600);
  await click(page, '.hist li[data-did]'); await sleep(400);
  await page.evaluate(() => { const i = document.getElementById('edit-t'); const d = new Date(Date.now() + 30 * 60000); i.value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); });
  await click(page, '[data-a=savedose]'); await sleep(300);
  assert.match(await page.$eval('#toast', e => e.textContent), /Tijd ligt in de toekomst/); // no silent jump of -24 h
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
  assert.equal(url, `${base}/?p=${CODE}`);
  await page.evaluate(() => { window.__shared = null; navigator.share = async d => { window.__shared = d; }; });
  await click(page, '[data-a=doshare]'); await sleep(300);
  const shared = await page.evaluate(() => window.__shared);
  assert.deepEqual(Object.keys(shared), ['text']); // the URL is inside the text, no separate url field
  assert.ok(shared.text.includes(`?p=${CODE}`), shared.text);
  assert.equal(await page.$('[data-a=copylink]') !== null, true);
  assert.match(await page.$eval('.screen h1', e => e.textContent), /AWAKENINGS/i); // the title names the party being shared
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
  const shown = await page.$eval('.screen .scr', e => e.textContent);
  assert.ok(!shown.includes(CODE), 'DELEN must not show the join token');
  assert.equal(await page.$('.screen .code, .qrchips'), null);
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
  await splashGone(page);
  await page.setOfflineMode(true);
  await page.click('.plus'); await sleep(400);
  await page.click('[data-a=dose][data-size="0.5"]'); await sleep(2000);
  const st = await page.evaluate(() => window.__michel.state);
  assert.equal(st.outbox.length, 1);
  assert.match(await page.$eval('#view', e => e.textContent), /wordt verstuurd/i);
  await page.setOfflineMode(false);
  await page.goto(`${base}/?devuid=phone-sanne-01&devsecret=${sanneSecret}`, { waitUntil: 'domcontentloaded' });
  await splashGone(page);
  const after = await get('/parties/' + PID);
  assert.equal(Object.values(after.doses).filter(d => d.size === 0.5 && d.friendId === sanne).length, 1); // replayed exactly once
  assert.equal((await page.evaluate(() => window.__michel.state)).outbox.length, 0);
  await page.close();

  // ---- alarm: a changed latest dose is not swallowed; done acknowledges only that dose; an edited time re-arms ----
  page = await phone('?devuid=dev-admin');
  await splashGone(page);
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

  // ---- N7: reduced motion keeps the calm strobe (no beat flipping) ----
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(base + '/?devuid=dev-admin', { waitUntil: 'domcontentloaded' });
  await splashGone(page);
  assert.equal(await page.$eval('#alarm', e => e.classList.contains('on')), true);
  assert.equal(await page.$eval('#alarm', e => e.classList.contains('beat')), false);
  await page.close();

  // ---- N2: offline cold start still alarms from the cache ----
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);
  page.on('request', r => (r.url().includes('/api/') ? r.abort() : r.continue())); // server unreachable, app shell loads
  await page.goto(base + '/?devuid=dev-admin', { waitUntil: 'domcontentloaded' });
  await splashGone(page);
  assert.equal(await page.$eval('#alarm', e => e.classList.contains('on')), true, 'no alarm from the cache while offline');
  await page.close();

  // ---- admin: own name + claim in one go, rename, new link; a fresh phone joins by pasted link ----
  page = await phone('?devuid=dev-admin');
  await splashGone(page);
  await click(page, '[data-a=claimskip]').catch(() => {});
  await click(page, '[data-tab=settings]'); await sleep(300);
  await click(page, '[data-a=whoami]'); await sleep(500);
  await click(page, '[data-a=addme]'); await sleep(400);
  await page.type('#me-nm', 'Michel');
  await page.keyboard.press('Enter'); await sleep(1000);
  const mePartyNow = await get('/parties/' + PID);
  const meId = Object.entries(mePartyNow.friends).find(([, f]) => f.name === 'Michel')[0];
  assert.equal(mePartyNow.claims[meId], 'dev-admin');
  assert.equal(mePartyNow.members['dev-admin'], meId);
  await click(page, '[data-tab=crew]'); await sleep(300);
  await click(page, '.card[data-f="' + meId + '"]'); await sleep(400); // admin: dose sheet
  await click(page, '[data-a=detail]'); await sleep(600);
  await click(page, '.screen [data-a=rename]'); await sleep(400);
  await page.$eval('#rn-nm', e => { e.value = ''; });
  await page.type('#rn-nm', 'Michel2');
  await page.keyboard.press('Enter'); await sleep(800);
  const renamed = await get('/parties/' + PID);
  assert.equal(renamed.friends[meId].name, 'Michel2');
  assert.equal(renamed.claims[meId], 'dev-admin'); // claim and id stay linked
  await click(page, '[data-a=back]'); await sleep(400);
  await click(page, '[data-tab=settings]'); await sleep(300);
  await click(page, '[data-a=newlink]'); await sleep(400);
  await click(page, '[data-a=confirm-ok]'); await sleep(1000);
  const afterLink = await get('/parties/' + PID);
  const newCodes = Object.keys(afterLink.codes || {});
  assert.equal(newCodes.length, 1);
  assert.notEqual(newCodes[0], CODE);
  assert.equal((await fetch(base + '/api/codes/' + CODE, { headers: admin })).status, 404); // the old link is dead
  assert.equal((await get('/codes/' + newCodes[0])).partyId, PID);
  await page.close();
  const fresh = await browser.createBrowserContext(); // clean storage: a phone that never joined anything
  page = await fresh.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(base + '/?devuid=fresh-phone-01', { waitUntil: 'domcontentloaded' });
  await splashGone(page);
  assert.equal(await page.$eval('#start', e => getComputedStyle(e).display), 'flex');
  assert.match(await page.$eval('#start', e => e.textContent), /Vraag De Michel om de link of QR/);
  assert.equal(await page.$eval('.shr', e => getComputedStyle(e).display), 'none'); // nothing to share without a party
  assert.equal(await page.$('[data-a=joinparty]'), null); // no code entry any more
  await page.evaluate(link => Object.defineProperty(navigator, 'clipboard', { value: { readText: async () => link, writeText: async () => {} }, configurable: true }), `${base}/?p=${newCodes[0]}`);
  await click(page, '[data-a=pastelink]'); await sleep(1500);
  assert.equal((await page.evaluate(() => window.__michel.state)).parties.length, 1); // joined from the pasted link
  await page.close();

  // ---- N3: a start URL with an already handled ?p= opens normally, also after the code was deleted ----
  page = await phone(`?devuid=dev-admin&p=${CODE}`); // CODE was auto-joined in this browser before and is gone by now (new link)
  await splashGone(page);
  const done = await page.evaluate(() => JSON.parse(localStorage.getItem('michel_linkcodes_done') || '[]'));
  assert.ok(done.includes(CODE));
  await page.close();
  page = await phone(`?devuid=dev-admin&p=${CODE}`);
  await splashGone(page);
  assert.doesNotMatch(await page.$eval('#toast', e => e.textContent), /werkt niet/);
  assert.equal(await page.evaluate(() => location.search.includes('p=')), false);
  await page.close();

  // ---- N4: an outbox entry whose dose the server already has is dropped, never duplicated ----
  const existing = Object.keys((await get('/parties/' + PID)).doses)[0];
  const exDose = (await get('/parties/' + PID)).doses[existing];
  const before = Object.keys((await get('/parties/' + PID)).doses).length;
  page = await phone('?devuid=dev-admin');
  await page.evaluate(({ PID, existing, exDose }) => localStorage.setItem('michel_outbox', JSON.stringify([{ pid: PID, id: existing, friendId: exDose.friendId, size: exDose.size, t: exDose.t, addedAt: exDose.addedAt }])), { PID, existing, exDose });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await splashGone(page);
  assert.equal((await page.evaluate(() => window.__michel.state)).outbox.length, 0);
  assert.equal(Object.keys((await get('/parties/' + PID)).doses).length, before);
  await page.close();

  // ---- zombie dose: the POST reaches the server, the response is lost, the admin deletes the dose, the phone reconnects ----
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    const real = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      const r = real(url, opts);
      if (window.__dropDoseResponse && opts && opts.method === 'POST' && String(url).includes('/doses')) { await r; throw new TypeError('Failed to fetch'); } // delivered, but the answer never arrives
      return r;
    };
    window.__dropDoseResponse = true;
  });
  await page.goto(`${base}/?devuid=phone-sanne-01&devsecret=${sanneSecret}`, { waitUntil: 'domcontentloaded' });
  await splashGone(page);
  await page.evaluate(() => { for (const d of document.querySelectorAll('#alarm.on [data-a=a-ok]')) d.click(); });
  const zBefore = Object.keys((await get('/parties/' + PID)).doses);
  await page.click('.plus'); await sleep(400);
  await page.click('[data-a=dose][data-size="0.25"]'); await sleep(1800);
  const zMid = (await get('/parties/' + PID)).doses;
  const zId = Object.keys(zMid).find(k => !zBefore.includes(k));
  assert.ok(zId, 'the POST must have reached the server');
  const zEntry = (await page.evaluate(() => window.__michel.state.outbox))[0];
  assert.equal(zEntry && zEntry.sent, true, "the outbox entry must be flagged 'sent' before the write");
  assert.equal((await fetch(`${base}/api/parties/${PID}/doses/${zId}`, { method: 'DELETE', headers: admin })).status, 200); // the admin deletes it
  await page.evaluate(() => { window.__dropDoseResponse = false; });
  await page.reload({ waitUntil: 'domcontentloaded' }); // reconnect: replay
  await page.evaluate(() => { window.__dropDoseResponse = false; });
  await page.waitForFunction(() => /mogelijk niet opgeslagen/.test(document.getElementById('toast').textContent), { timeout: 15000 });
  assert.equal((await get('/parties/' + PID)).doses[zId], undefined, 'zombie dose was recreated');
  assert.equal((await page.evaluate(() => window.__michel.state.outbox)).length, 0);
  // the warning is actionable: the banner keeps the data until "Opnieuw toevoegen" re-adds it under a NEW id
  assert.equal(await page.$('.ibanner [data-a=readd]') !== null, true, 'no re-add banner');
  await page.evaluate(() => { window.__dropDoseResponse = false; });
  await splashGone(page); // the cold-start splash covers the page for 3 s after the reload
  await page.click('.ibanner [data-a=readd]'); await sleep(1500);
  const zAfter = (await get('/parties/' + PID)).doses;
  const readded = Object.entries(zAfter).find(([k, d]) => !zBefore.includes(k) && k !== zId);
  assert.ok(readded, 'the dose was not re-added');
  assert.equal(readded[1].t, zEntry.t); assert.equal(readded[1].size, zEntry.size); assert.equal(readded[1].friendId, zEntry.friendId);
  assert.equal(await page.$('.ibanner [data-a=readd]'), null, 'banner stays after re-adding');
  await page.close();

  // ---- admin link actions offline: refused at once, nothing written, button not stuck ----
  page = await phone('?devuid=dev-admin');
  await splashGone(page);
  await page.evaluate(() => { for (const d of document.querySelectorAll('#alarm.on [data-a=a-ok]')) d.click(); });
  const codesBefore = JSON.stringify(Object.keys((await get('/parties/' + PID)).codes || {}));
  await click(page, '[data-tab=settings]'); await sleep(300);
  await page.setOfflineMode(true);
  await page.click('[data-a=newlink]'); await sleep(300);
  assert.match(await page.$eval('#toast', e => e.textContent), /Geen verbinding: dit kan alleen online/);
  assert.equal(await page.$('[data-a=confirm-ok]'), null, 'no confirm dialog while offline');
  assert.equal(await page.$eval('[data-a=newlink]', e => e.disabled || e.classList.contains('off')), false, 'button stuck');
  await page.click('[data-a=closeparty]'); await sleep(300);
  assert.match(await page.$eval('#toast', e => e.textContent), /Geen verbinding/);
  await page.setOfflineMode(false);
  assert.equal(JSON.stringify(Object.keys((await get('/parties/' + PID)).codes || {})), codesBefore, 'nothing may be written');
  assert.equal((await get('/parties/' + PID)).closedAt, undefined);
  await page.close();

  // ---- a dead start-URL token toasts only once ----
  const dead = 'DeadTokenAbc1234';
  page = await phone('?devuid=dev-admin&p=' + dead);
  await page.waitForFunction(() => /werkt niet/.test(document.getElementById('toast').textContent), { timeout: 15000 });
  await page.close();
  page = await phone('?devuid=dev-admin&p=' + dead);
  await splashGone(page);
  assert.doesNotMatch(await page.$eval('#toast', e => e.textContent), /werkt niet/);
  await page.close();

  // ---- test alarm three times in a row: overlay, music (graph rebuilt each run), strobe at 0.05 s per step ----
  page = await phone('?devuid=dev-admin');
  await splashGone(page);
  await page.evaluate(() => { for (const d of document.querySelectorAll('#alarm.on [data-a=a-ok]')) d.click(); });
  await click(page, '[data-tab=settings]'); await sleep(300);
  for (let i = 1; i <= 3; i++) {
    const before = await page.evaluate(() => window.__michel.state.audio.runs); // a real alarm may have run before
    await page.click('[data-a=test]'); // a trusted tap, like the user's
    await sleep(900);
    const a1 = await page.evaluate(() => window.__michel.state.audio);
    assert.equal(await page.$eval('#alarm', e => e.classList.contains('on')), true, 'overlay missing in run ' + i);
    assert.equal(a1.on, true, 'music not on in run ' + i);
    assert.equal(a1.runs, before + 1, 'run counter in run ' + i);
    assert.equal(a1.ctx, 'running', 'AudioContext not running in run ' + i);
    assert.ok(a1.voices > 0, 'no voices scheduled in run ' + i);
    assert.ok(a1.gain > 0.9, 'master not ramped up in run ' + i + ': ' + a1.gain);
    await sleep(600);
    const a2 = await page.evaluate(() => window.__michel.state.audio);
    assert.ok(a2.time > a1.time + 0.3, 'audio clock not advancing in run ' + i);
    assert.ok(a2.voices > a1.voices, 'music not progressing in run ' + i);
    const anim = await page.evaluate(() => { const an = document.querySelector('.abg').getAnimations(); return { n: an.length, running: an.every(x => x.playState === 'running'), dur: getComputedStyle(document.querySelector('.abg')).animationDuration }; });
    assert.ok(anim.n >= 1 && anim.running, 'strobe not running in run ' + i);
    assert.equal(anim.dur, '0.2s', 'strobe must be 0.05 s per step');
    await page.click('#alarm [data-a=a-ok]'); await sleep(300);
    assert.equal(await page.$eval('#alarm', e => e.classList.contains('on')), false);
    assert.equal((await page.evaluate(() => window.__michel.state.audio)).on, false, 'music still on after closing, run ' + i);
  }
  await page.close();

  // ---- test alarm: photo strobe, runs a full 60 s on its own, then closes ----
  page = await phone('?devuid=dev-admin');
  await splashGone(page);
  await page.evaluate(() => { for (const d of document.querySelectorAll('#alarm.on [data-a=a-ok]')) d.click(); });
  await click(page, '[data-tab=settings]'); await sleep(300);
  await click(page, '[data-a=test]'); await sleep(4000);
  assert.equal(await page.$eval('#alarm', e => e.classList.contains('on')), true);
  assert.match(await page.$eval('.abg', e => getComputedStyle(e).backgroundImage), /splash.jpg/);
  await sleep(52000);
  assert.equal(await page.$eval('#alarm', e => e.classList.contains('on')), true, 'test alarm stopped before 60 s');
  await sleep(10000);
  assert.equal(await page.$eval('#alarm', e => e.classList.contains('on')), false, 'test alarm did not close after 60 s');
  await page.close();

  // ---- iPhone Safari tab: joined read-only, step card, NO claim UI; ?p= stays for Add to Home Screen ----
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const tokenNow = Object.keys((await get('/parties/' + PID)).codes || {})[0];
  const newIos = async (standalone) => {
    const ctx = await browser.createBrowserContext(); // a phone that never joined anything
    const pg = await ctx.newPage();
    await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await pg.setUserAgent(iphone);
    if (standalone) await pg.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await pg.goto(`${base}/?p=${tokenNow}`, { waitUntil: 'domcontentloaded' });
    await splashGone(pg);
    return { pg, ctx };
  };
  {
    const { pg, ctx } = await newIos(false);
    assert.equal(await pg.$('link[rel=manifest]'), null); // iOS: no manifest at all, so Add to Home Screen uses the current URL (with ?p=)
    assert.equal(await pg.evaluate(() => location.search), `?p=${tokenNow}`); // the token stays in an iOS tab
    assert.equal((await pg.evaluate(() => window.__michel.state)).parties.length, 1); // joined: in the party
    assert.equal(await pg.$('.screen'), null, 'no claim screen in a Safari tab');
    assert.equal(await pg.$('[data-a=addme]'), null);
    assert.equal(await pg.$('[data-a=claim]'), null);
    assert.equal(await pg.$('.stepcard') !== null, true, 'step card missing');
    assert.match(await pg.$eval('.stepcard', e => e.textContent), /Stap 1[\s\S]*Stap 2/);
    assert.equal(await pg.$('.card[data-f]') !== null, true, 'the crew must be visible read-only');
    await pg.evaluate(() => { for (const d of document.querySelectorAll('#alarm.on [data-a=a-ok]')) d.click(); });
    await pg.click('.plus'); await sleep(300);
    assert.match(await pg.$eval('#toast', e => e.textContent), /beginscherm/);
    assert.equal(await pg.$('.screen'), null);
    await pg.close(); await ctx.close();
  }
  // ---- the installed app (standalone): auto-join, then WIE BEN JIJ? with + MIJN NAAM TOEVOEGEN on top; a member adds themselves ----
  {
    const { pg, ctx } = await newIos(true);
    assert.equal(await pg.evaluate(() => location.search), ''); // the standalone app strips the token after joining
    assert.match(await pg.$eval('.screen .scr', e => e.textContent), /Wie ben/i);
    assert.equal(await pg.$eval('.screen .scr', e => e.querySelector('[data-a=addme]') === e.querySelector('button')), true, 'addme must come first');
    assert.match(await pg.$eval('.screen .scr', e => e.textContent), /nieuw toestel/); // BEZET hint for claimed names
    await pg.evaluate(() => { for (const d of document.querySelectorAll('#alarm.on [data-a=a-ok]')) d.click(); });
    await pg.click('[data-a=addme]'); await sleep(400);
    await pg.type('#me-nm', 'Selfie');
    await pg.keyboard.press('Enter'); await sleep(1200);
    const sp = await get('/parties/' + PID);
    const sid = Object.entries(sp.friends).find(([, f]) => f.name === 'Selfie');
    assert.ok(sid, 'self-added friend missing');
    assert.ok(sp.claims[sid[0]] && sp.members[sp.claims[sid[0]]] === sid[0], 'self-add must claim in the same step');
    await pg.close(); await ctx.close();
  }

  // ---- splash: visible for at least 3 s, gone within about 5.5 s ----
  page = await phone('?devuid=dev-admin');
  await sleep(2600);
  assert.equal(await page.evaluate(() => !!document.getElementById('splash')), true, 'splash gone before 3 s');
  await page.waitForSelector('#splash', { hidden: true, timeout: 4000 });
  await page.close();

  const real = errors.filter(e => !/ERR_INTERNET_DISCONNECTED|ERR_FAILED/.test(e) && !e.includes("/api/")); // dev API answers unknown codes with 404 on purpose
  assert.deepEqual(real, []);
  console.log('smoke ok');
} finally { await close(); await srv.close(); }
