// Renders the home-screen icons and iOS startup images (yellow Anton on black) with headless Edge.
// Usage: node tools/make-icons.mjs   (needs network for the Anton web font)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchEdge } from './edge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT = '<link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet">';
const css = '*{margin:0;padding:0}html,body{background:#000;width:100%;height:100%;overflow:hidden}.c{width:100vw;height:100vh;display:grid;place-items:center;color:#FFE500;font-family:Anton,Impact,sans-serif;text-transform:uppercase}';

const iconHtml = size => `<!doctype html>${FONT}<style>${css}.c{font-size:${size * 0.9}px;line-height:1;padding-top:${size * 0.06}px}</style><div class="c">M</div>`;
const startHtml = (w, h) => `<!doctype html>${FONT}<style>${css}.c{align-content:end;padding-bottom:${h * 0.11}px}.b{font-size:${w * 0.2}px;line-height:1;white-space:nowrap}</style><div class="c"><div class="b">De Michel</div></div>`;

const shots = [
  ['apple-touch-icon.png', 180, 180, 1, iconHtml(180)],
  ['icon-192.png', 192, 192, 1, iconHtml(192)],
  ['icon-512.png', 512, 512, 1, iconHtml(512)],
  ['startup-390x844.png', 390, 844, 3, startHtml(390, 844)],
  ['startup-393x852.png', 393, 852, 3, startHtml(393, 852)],
  ['startup-430x932.png', 430, 932, 3, startHtml(430, 932)],
];

const { browser, close } = await launchEdge();
try {
  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
  for (const [file, w, h, dpr, html] of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const dest = file.startsWith('startup') ? path.join(ROOT, 'assets', file) : path.join(ROOT, file);
    await page.screenshot({ path: dest, type: 'png' });
    await page.close();
    console.log('wrote', path.relative(ROOT, dest));
  }
} finally { await close(); }
