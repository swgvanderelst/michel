// Launch headless Edge on a debugging port and connect puppeteer-core to it
// (puppeteer's own pipe launch does not work with Edge here).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export async function launchEdge(port = 9300 + Math.floor(Math.random() * 500)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'michel-edge-'));
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 50 && !browser; i++) {
    await new Promise(r => setTimeout(r, 200));
    try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }); } catch { /* retry */ }
  }
  if (!browser) { proc.kill(); throw new Error('Edge did not start'); }
  const close = async () => {
    try { await browser.close(); } catch { /* ignore */ }
    proc.kill();
    setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 1000).unref();
  };
  return { browser, close };
}
