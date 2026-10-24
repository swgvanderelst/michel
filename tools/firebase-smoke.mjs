// Smoke test against the REAL Firebase project (rules must be deployed first). Needs Edge + network.
// Usage: MICHEL_LINK='https://…/?p=TOKEN' node tools/firebase-smoke.mjs
//   MICHEL_LINK = the join link (or bare token) of an existing party with at least two unclaimed friends (made by an allow-listed creator).
// The page is served by a throwaway static server and forced onto Firebase with ?prod=1 (localhost is otherwise dev-only).
// Each "phone" is its own browser context, so each gets its own anonymous Firebase user.
import assert from 'node:assert/strict';
import { startServer } from '../dev-server.mjs';
import { launchEdge } from './edge.mjs';

import { tokenFromLink } from '../logic.js';
const PIN = tokenFromLink(process.env.MICHEL_LINK); // join token
const srv = await startServer({ port: 0 }); // only serves the static files here; the dev API is not used
const base = `http://localhost:${srv.port}`;
const { browser, close } = await launchEdge();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const logs = [];
async function phone() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  return { ctx, page };
}
// poll until fn() is truthy (no fixed sleeps: Firebase latency varies)
const waitFor = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what); await sleep(250); } };
const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
const state = page => page.evaluate(() => window.__michel.state);
const toastText = page => page.$eval('#toast', e => e.textContent);
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['ok', name]); console.log('ok  ', name); } catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '-', e.message); } };

try {
  const A = await phone(), B = await phone();

  await step('anonymous auth + app starts on Firebase', async () => {
    await A.page.goto(`${base}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    const s = await state(A.page);
    assert.deepEqual(s.parties, []);
    const id = await A.page.evaluate(async () => (await import('/store.js')).store.uid);
    assert.match(id, /^[A-Za-z0-9]{20,}$/); // a real Firebase uid, not the dev one
    assert.equal(await A.page.evaluate(async () => (await import('/store.js')).store.kind), 'firebase');
  });

  await step('creating a party is denied without the creator allow-list', async () => {
    await click(A.page, '[data-a=newparty]'); await sleep(1500);
    await click(A.page, '[data-a=createparty]'); await sleep(2500);
    const t = await toastText(A.page);
    assert.match(t, /mag nog geen feestje maken/i, 'expected "denied", got: ' + t + ' (if this phone IS allow-listed, remove it from creators first)');
    assert.deepEqual((await state(A.page)).parties, []);
  });

  if (!PIN) console.log('MICHEL_LINK not set (or not a valid link): skipping join / claim / dose / sync / denied checks');
  else {
    let pid = null, friendA = null, friendB = null;
    const freeFriends = page => page.$$eval('[data-a=claim]', els => els.map(e => e.dataset.fid));

    await step('join by link on phone A, then claim a name', async () => {
      await A.page.goto(`${base}/?prod=1&p=${PIN}`, { waitUntil: 'domcontentloaded' });
      await sleep(5000);
      pid = (await state(A.page)).current;
      assert.ok(pid, 'party joined');
      const free = await freeFriends(A.page);
      assert.ok(free.length >= 2, 'need two unclaimed friends');
      friendA = free[0]; friendB = free[1];
      await A.page.click(`[data-a=claim][data-fid="${friendA}"]`);
      await sleep(2500);
      await click(A.page, '[data-a=rulesok]'); await sleep(500);
      assert.equal((await state(A.page)).parties.length, 1);
      assert.equal(await A.page.evaluate(() => !!document.querySelector('.card .you')), true);
    });

    await step('phone A adds a dose, phone B sees it within 5 s (sync)', async () => {
      await A.page.click('.plus'); await sleep(500);
      await A.page.click('[data-a=dose][data-size="0.25"]');
      await sleep(2500);
      await B.page.goto(`${base}/?prod=1&p=${PIN}`, { waitUntil: 'domcontentloaded' });
      await waitFor(async () => (await state(B.page)).current === pid, 15000, 'B joined');
      await waitFor(() => B.page.evaluate(() => /Laatste:/i.test(document.body.innerText)), 15000, 'B sees the first dose');
      // live push: A adds another, B must update without reload
      await A.page.click('.plus'); await sleep(500);
      await A.page.click('[data-a=dose][data-size="0.5"]');
      await waitFor(() => B.page.$$eval('.card .tot', els => els.some(e => /¾/.test(e.textContent))), 15000, 'B shows 3/4 total (live push)');
    });

    await step('phone B claims the other name; double claim of A\'s name is denied', async () => {
      const ok = await B.page.evaluate(async (fid) => { const { store } = await import('/store.js'); try { await store.claim(window.__michel.state.current, fid); return true; } catch (e) { return e.code; } }, friendB);
      assert.equal(ok, true);
      const dup = await B.page.evaluate(async (fid) => { const { store } = await import('/store.js'); try { await store.claim(window.__michel.state.current, fid); return true; } catch (e) { return e.code; } }, friendA);
      assert.equal(dup, 'denied');
    });

    await step('a non-admin is denied on friend add, max, close, code add and other people\'s doses', async () => {
      const r = await B.page.evaluate(async ({ pid, friendA }) => {
        const { store } = await import('/store.js');
        const out = {};
        const t = async (k, fn) => { try { await fn(); out[k] = 'allowed'; } catch (e) { out[k] = e.code; } };
        await t('addFriend', () => store.addFriend(pid, 'Hacker'));
        await t('setMax', () => store.setMax(pid, friendA, 1));
        await t('close', () => store.closeParty(pid));
        await t('addCode', () => store.addCode(pid, '0000'));
        await t('doseForOther', () => store.addDose(pid, { id: store.newDoseId(pid), friendId: friendA, size: 1, t: Date.now() }));
        return out;
      }, { pid, friendA });
      for (const [k, v] of Object.entries(r)) assert.equal(v, 'denied', `${k} -> ${v}`);
    });

    await step('cleanup: both phones release their names and delete their doses', async () => {
      for (const [P, fid] of [[A.page, friendA], [B.page, friendB]]) {
        await P.evaluate(async (fid) => {
          const { store } = await import('/store.js');
          const pid = window.__michel.state.current;
          const party = await store.fetchParty(pid);
          for (const [did, d] of Object.entries(party.doses || {})) if (d.friendId === fid) await store.removeDose(pid, did);
          await store.release(pid, fid, store.uid);
        }, fid);
      }
    });
  }
  console.log(logs.length ? 'page errors: ' + logs.join(' | ') : 'no page errors');
  const failed = results.filter(r => r[0] === 'FAIL');
  console.log(failed.length ? `${failed.length} step(s) failed` : 'firebase smoke: all steps ok');
  process.exitCode = failed.length ? 1 : 0;
} finally { await close(); await srv.close(); }
