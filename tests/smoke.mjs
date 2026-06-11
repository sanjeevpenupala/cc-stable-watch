// Headless smoke test for cc-stable-watch.
// Usage: SITE_URL=http://localhost:8000 node tests/smoke.mjs

import { chromium } from "playwright";

const SITE_URL = process.env.SITE_URL || "http://localhost:8000";
const REQUIRED_IDS = [
  "hero-version",
  "hero-bumped",
  "hero-typical-gap",
  "lag-chart",
  "history-tbody",
  "latest-version",
];

const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
});

await page.goto(SITE_URL, { waitUntil: "networkidle" });

for (const id of REQUIRED_IDS) {
  const found = await page.locator(`#${id}`).count();
  if (found === 0) errors.push(`missing element: #${id}`);
}

const heroText = (await page.locator("#hero-version").textContent())?.trim();
if (!heroText || heroText === "—") {
  errors.push(`hero-version not populated (got "${heroText}")`);
}

await browser.close();

if (errors.length) {
  console.error("SMOKE FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("SMOKE OK");
