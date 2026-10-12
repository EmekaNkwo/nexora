import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const width = Number(process.argv[3] ?? 1600);
const height = Number(process.argv[4] ?? 900);
const file = process.argv[5] ?? "rules-dialog.png";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
await page.goto(`${base}/rules`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(7000);
await page.getByRole("button", { name: "New rule", exact: true }).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: file });
await browser.close();
console.log(`wrote ${file}`);
