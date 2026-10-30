// Renders the free drive map picture (public/freedrive/map.jpg) from the real game: the whole map
// from straight above (see FREE_DRIVE_MAP in src/world/freeDrive.ts).
// Usage: start `npm run dev`, then `node scripts/render-freedrive-map.mjs [http://localhost:5173]`.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const url = process.argv[2] ?? 'http://localhost:5173';
const out = new URL('../public/freedrive/', import.meta.url);
const { chromium } = createRequire(import.meta.url)('playwright');

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
await page.addInitScript(() => localStorage.setItem('tokyo-circuit.settings.v1', JSON.stringify({ quality: 'high', autoQuality: false })));
await page.goto(`${url}/?debug`);
await page.waitForSelector('#loading.hidden', { state: 'attached', timeout: 600_000 });
const data = await page.evaluate(() => window.game.captureFreeDriveMap());
const file = new URL('map.jpg', out);
await writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
console.log('saved', file.pathname);
await browser.close();
