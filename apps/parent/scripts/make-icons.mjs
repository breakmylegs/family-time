// Draws the app icons from one SVG (the Control screen's day rail on the teal shell) and renders
// the PNGs iOS and the manifest need. Run once after changing the drawing:
//   node apps/parent/scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

// 100 by 100 units. Maskable icons keep everything inside the middle 80%.
const svg = (inset) => {
  const s = (v) => inset + (v * (100 - 2 * inset)) / 100;
  const w = (v) => (v * (100 - 2 * inset)) / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#123A40"/>
  <rect x="${s(14)}" y="${s(44)}" width="${w(26)}" height="${w(14)}" rx="${w(4)}" fill="#7BCB9C"/>
  <rect x="${s(42)}" y="${s(44)}" width="${w(10)}" height="${w(14)}" rx="${w(4)}" fill="#9DB0B5"/>
  <rect x="${s(54)}" y="${s(44)}" width="${w(14)}" height="${w(14)}" rx="${w(4)}" fill="#B9A0D6"/>
  <rect x="${s(70)}" y="${s(44)}" width="${w(16)}" height="${w(14)}" rx="${w(4)}" fill="#5B4E86"/>
  <rect x="${s(47)}" y="${s(30)}" width="${w(4)}" height="${w(36)}" rx="${w(2)}" fill="#F1F7F6"/>
</svg>`;
};

const shots = [
  { file: 'icon-192.png', size: 192, inset: 0 },
  { file: 'icon-512.png', size: 512, inset: 0 },
  { file: 'icon-512-maskable.png', size: 512, inset: 10 },
  { file: 'apple-touch-icon.png', size: 180, inset: 0 },
];

const browser = await chromium.launch();
for (const { file, size, inset } of shots) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg(inset)}`);
  await page.screenshot({ path: join(out, file) });
  await page.close();
}
await browser.close();
console.log(`icons written to ${out}`);
