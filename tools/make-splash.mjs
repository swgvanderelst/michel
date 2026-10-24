// Bakes assets/splash-source.* into a yellow/black duotone assets/splash.jpg (the colour original never ships).
// Usage: node tools/make-splash.mjs   (needs puppeteer-core + Microsoft Edge)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchEdge } from './edge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'assets');
const src = fs.readdirSync(dir).find(f => /^splash-source\.(png|jpe?g|webp)$/i.test(f));
if (!src) { console.error('assets/splash-source.* not found'); process.exit(1); }
const mime = /png$/i.test(src) ? 'image/png' : /webp$/i.test(src) ? 'image/webp' : 'image/jpeg';
const b64 = fs.readFileSync(path.join(dir, src)).toString('base64');

const { browser, close } = await launchEdge();
try {
  const page = await browser.newPage();
  const out = await page.evaluate(async (data, MAXH, LO, HI) => {
    const img = new Image();
    img.src = data;
    await img.decode();
    const k = Math.min(1, MAXH / img.height);
    const w = Math.round(img.width * k), h = Math.round(img.height * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h), d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      let l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      l = Math.min(1, Math.max(0, (l - LO) / (HI - LO))); // levels
      l = l * l * (3 - 2 * l); // S-curve for contrast
      d[i] = 255 * l; d[i + 1] = 229 * l; d[i + 2] = 0; // lerp(black #000, yellow #FFE500)
    }
    g.putImageData(px, 0, 0);
    return c.toDataURL('image/jpeg', 0.8);
  }, `data:${mime};base64,${b64}`, 1200, Number(process.env.LO ?? 0.1), Number(process.env.HI ?? 0.55));
  fs.writeFileSync(path.join(dir, 'splash.jpg'), Buffer.from(out.split(',')[1], 'base64'));
  console.log('wrote assets/splash.jpg', fs.statSync(path.join(dir, 'splash.jpg')).size, 'bytes');
} finally { await close(); }
