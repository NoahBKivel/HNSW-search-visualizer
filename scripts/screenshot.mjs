/**
 * Smoke-test harness: loads the running dev server in a real browser, captures
 * console errors, and writes screenshots of several interaction states.
 * Not part of the app — a development aid.
 *
 * Usage: node scripts/screenshot.mjs [url]
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173';
const outDir = 'shots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`${msg.type()}: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`  wrote ${name}.png`);
};

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await shot('01-hnsw-start');

const playButton = page.locator('.panel--transport .btn--primary');
await playButton.click();

// Let the greedy descent finish, then inspect the result state up close.
await page.waitForTimeout(11000);
console.log('  ' + (await page.locator('.transport__counter').innerText()).trim());
await shot('02-hnsw-end');

await page.mouse.move(800, 500);
for (let i = 0; i < 9; i++) await page.mouse.wheel(0, -220);
await page.waitForTimeout(900);
await shot('03-hnsw-end-zoom');

// Reset the camera for the remaining shots.
for (let i = 0; i < 9; i++) await page.mouse.wheel(0, 220);
await page.waitForTimeout(600);

// Switch to the brute-force baseline.
const modeSelect = page.locator('select[id="Search.mode"]');
await modeSelect.selectOption({ index: 1 });
await playButton.click();
await page.waitForTimeout(4000);
await shot('04-knn-mid');
await page.waitForTimeout(10000);
console.log('  ' + (await page.locator('.transport__counter').innerText()).trim());
await shot('05-knn-end');

// Back to HNSW, then stress the structural parameters.
await modeSelect.selectOption({ index: 0 });
await page.waitForTimeout(800);

const pointsInput = page.locator('input[id="Dataset.pointCount"]');
await pointsInput.fill('1500');
await pointsInput.press('Enter');
await page.waitForTimeout(120);
console.log(`  toast during rebuild settle: ${await page.locator('.rebuilding-toast').count()}`);
await page.waitForTimeout(1500);
console.log(`  toast after settle: ${await page.locator('.rebuilding-toast').count()}`);
await playButton.click();
await page.waitForTimeout(9000);
await shot('06-hnsw-1500-points');

console.log(problems.length ? `\nPROBLEMS:\n${problems.join('\n')}` : '\nNo console errors.');

await browser.close();
