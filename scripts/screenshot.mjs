// Visual check: screenshots of the main views in light/dark and desktop/mobile.
// Usage: node scripts/screenshot.mjs http://127.0.0.1:5173 out-dir
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const [base = 'http://127.0.0.1:5173', out = './screenshots'] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];

async function shoot(name, { width, height, dark, actions }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1, locale: 'zh-TW' });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${name} console: ${message.text()}`); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ranking tbody tr', { timeout: 60_000 });
  if (actions) await actions(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  await context.close();
  console.log('saved', name);
}

await shoot('ranking-light', { width: 1440, height: 900, dark: false });
await shoot('ranking-dark', { width: 1440, height: 900, dark: true });
await shoot('details-light', { width: 1440, height: 900, dark: false, actions: async (page) => {
  await page.click('.ranking tbody tr:first-child');
  await page.waitForSelector('.chart-svg .candle', { timeout: 60_000 });
  await page.waitForSelector('.timing-grid', { timeout: 60_000 });
} });
await shoot('details-dark-panned', { width: 1440, height: 900, dark: true, actions: async (page) => {
  await page.click('.ranking tbody tr:first-child');
  await page.waitForSelector('.chart-svg .candle', { timeout: 60_000 });
  const box = await page.locator('.chart-svg').boundingBox();
  // drag right to pan into the past, then zoom with the wheel
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.35);
} });
await shoot('mobile-ranking', { width: 390, height: 844, dark: false });
await shoot('mobile-details', { width: 390, height: 844, dark: true, actions: async (page) => {
  await page.click('.ranking tbody tr:first-child');
  await page.waitForSelector('.chart-svg .candle', { timeout: 60_000 });
} });

await browser.close();
if (errors.length) { console.log('\nBrowser errors:'); for (const error of errors) console.log(' -', error); }
else console.log('\nNo browser errors.');
