// Renders the track-picker pictures (public/previews/<track>-<time>.jpg) from the real game.
// Usage: start `npm run dev`, then `node scripts/render-previews.mjs [http://localhost:5173]`.
// Needs Playwright with Chromium (`npx playwright install chromium` if you don't have it).
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const url = process.argv[2] ?? 'http://localhost:5173';
const out = new URL('../public/previews/', import.meta.url);
const tracks = ['tokyo', 'hakone', 'sakura'];
const times = ['day', 'sunset', 'night'];

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright is not installed: run `npm i -D playwright && npx playwright install chromium` first.');
  process.exit(1);
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
// Best graphics for the pictures.
await page.addInitScript(() => localStorage.setItem('tokyo-circuit.settings.v1', JSON.stringify({ quality: 'high' })));
await page.goto(`${url}/?debug`);
await page.waitForSelector('#loading.hidden', { state: 'attached', timeout: 600_000 });
for (const track of tracks) {
  for (const time of times) {
    const data = await page.evaluate(([t, tod]) => window.game.capturePreview(t, tod), [track, time]);
    const file = new URL(`${track}-${time}.jpg`, out);
    await writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log('saved', file.pathname);
  }
}
await browser.close();
