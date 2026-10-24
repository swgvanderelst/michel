// Screenshots of the real app (390x844 @2x) against a seeded dev server. Usage: node tools/shots.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../dev-server.mjs';
import { launchEdge } from './edge.mjs';

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const srv = await startServer({ port: 0, seed: true });
const base = `http://localhost:${srv.port}`;
const H = { 'x-uid': 'dev-admin', 'x-secret': 'dev-admin-secret', 'content-type': 'application/json' };
const api = (method, url, body) => fetch(base + '/api' + url, { method, headers: H, body: body && JSON.stringify(body) }).then(r => r.json());
const CODE = srv.seed.code, PID = srv.seed.partyId;
const party = await api('GET', '/parties/' + PID);
const fid = n => Object.entries(party.friends).find(([, f]) => f.name === n)[0];
const min = 60000, now = Date.now();
const dose = (n, size, ago) => api('POST', `/parties/${PID}/doses`, { friendId: fid(n), size, t: now - ago * min });
await api('PATCH', `/parties/${PID}/friends/${fid('Fem')}`, { max: 1.5 });
await api('PATCH', `/parties/${PID}/friends/${fid('Sanne')}`, { max: 1.5 });
await dose('Joris', 1, 160); await dose('Joris', 1, 400);
await dose('Sanne', 0.5, 150); await dose('Sanne', 0.5, 80); await dose('Sanne', 0.25, 6);
await dose('Fem', 0.5, 200); await dose('Fem', 0.5, 120); await dose('Fem', 0.5, 25);
await dose('Bart', 0.25, 30);

const { browser, close } = await launchEdge();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
async function newPage(query, ua) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (ua) await page.setUserAgent(ua);
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(base + '/' + query, { waitUntil: 'domcontentloaded' });
  return page;
}
const shot = async (page, name) => { await sleep(500); await page.screenshot({ path: path.join(out, name + '.png') }); console.log('shot', name); };
const dismissAlarm = async page => { await page.evaluate(() => { const b = document.querySelector('[data-a=a-ok]'); if (document.getElementById('alarm').classList.contains('on')) b.click(); }); await sleep(300); };

try {
  let page = await newPage('?safe');
  await sleep(900); await page.screenshot({ path: path.join(out, '00-splash.png') });
  await sleep(1800);
  await shot(page, '01-start');
  await page.close();

  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  page = await newPage(`?safe&p=${CODE}`, iphone);
  await sleep(1500); await shot(page, '02-install');
  await page.close();

  page = await newPage(`?safe&devuid=dev-admin&p=${CODE}`);
  await sleep(2600);
  await dismissAlarm(page);
  await shot(page, '03-wie-ben-jij');
  await click(page, '[data-a=claimskip]'); await sleep(500);
  await dismissAlarm(page);
  await shot(page, '04-crew');
  await click(page, '.plus'); await shot(page, '05-voor-wie');
  await page.evaluate(() => document.getElementById('bd').click()); await sleep(400);
  await click(page, '[data-tab=top]'); await shot(page, '06-top');
  await click(page, '[data-tab=settings]'); await shot(page, '07-opties');
  await page.evaluate(() => { document.getElementById('scroll').scrollTop = 560; }); await shot(page, '08-opties-codes');
  await page.evaluate(() => { document.getElementById('scroll').scrollTop = 1200; }); await shot(page, '09-opties-id');
  await page.evaluate(() => { document.getElementById('scroll').scrollTop = 0; });
  await click(page, '[data-a=rules]'); await sleep(500); await shot(page, '10-spelregels');
  await click(page, '[data-a=rulesok]'); await sleep(400);
  await click(page, '[data-tab=crew]'); await sleep(200);
  await click(page, '[data-a=share]'); await shot(page, '11-delen-qr');
  await click(page, '[data-a=qrfull]'); await shot(page, '12-qr-vol');
  await click(page, '#qrfull'); await sleep(200);
  await click(page, '[data-a=back]'); await sleep(300);
  await click(page, '[data-tab=settings]'); await click(page, '[data-a=test]'); await sleep(300);
  await shot(page, '13-alarm');
  await page.close();
} finally { await close(); await srv.close(); }
