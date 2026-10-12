/**
 * Checks the two labelled dropdown menus render without Base UI's
 * "MenuGroupContext is missing" error, and still behave.
 *
 * Usage: node scripts/menu-check.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 900 } })
).newPage();

const msgs = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") msgs.push(m.text());
});
page.on("pageerror", (e) => msgs.push(`pageerror: ${String(e)}`));

const out = [];
const chk = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);

// --- Columns menu (devices) ---------------------------------------------
await page.goto(`${base}/devices`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(9000);
msgs.length = 0;

await page.getByRole("button", { name: /Columns/ }).click();
await page.waitForTimeout(900);
const colMenu = await page.getByRole("menu").innerText().catch(() => "");
chk("columns menu opens", /visible columns/i.test(colMenu));

const grouped = await page.evaluate(() => {
  const g = document.querySelector('[data-slot="dropdown-menu-group"]');
  const l = document.querySelector('[data-slot="dropdown-menu-label"]');
  return {
    inside: !!(g && l && g.contains(l)),
    role: g?.getAttribute("role"),
    labelledBy: !!g?.getAttribute("aria-labelledby"),
  };
});
chk("label is inside a group", grouped.inside, JSON.stringify(grouped));
chk("group is labelled by it", grouped.role === "group" && grouped.labelledBy);

const before = await page.getByRole("columnheader").allInnerTexts();
await page.getByRole("menuitem", { name: /Signal/ }).click();
await page.waitForTimeout(700);
chk("menu stays open while toggling", (await page.getByRole("menu").count()) > 0);

await page.getByRole("menuitem", { name: /Battery/ }).click();
await page.waitForTimeout(700);
await page.keyboard.press("Escape");
await page.waitForTimeout(700);
const after = await page.getByRole("columnheader").allInnerTexts();
chk("two columns toggled in one visit", before.length - after.length === 2,
  `${before.length} -> ${after.length}`);
chk("no MenuGroupContext error (devices)",
  !msgs.some((m) => /MenuGroupContext/i.test(m)));

// --- Assign menu (alerts) -----------------------------------------------
await page.goto(`${base}/alerts`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(8000);
msgs.length = 0;

await page.getByRole("button", { name: /^Assign$/ }).first().click();
await page.waitForTimeout(900);
const assignMenu = await page.getByRole("menu").innerText().catch(() => "");
chk("assign menu opens", /assign to/i.test(assignMenu));
chk("assignees listed", (await page.getByRole("menuitem").count()) >= 4);

await page.getByRole("menuitem").first().click();
await page.waitForTimeout(900);
chk("assign menu closes after choosing", (await page.getByRole("menu").count()) === 0);
chk("no MenuGroupContext error (alerts)",
  !msgs.some((m) => /MenuGroupContext/i.test(m)));
chk("no console errors or warnings at all", msgs.length === 0,
  msgs.slice(0, 3).join(" | ") || "clean");

console.log(out.join("\n"));
await browser.close();
process.exit(out.some((r) => r.startsWith("FAIL")) ? 1 : 0);
