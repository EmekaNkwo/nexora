/**
 * Verifies the rule builder behaves as a modal: it opens over the rules page,
 * its body scrolls while the action bar stays pinned, and it actually saves.
 *
 * Usage: node scripts/rules-dialog-check.mjs [baseUrl]
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

await page.goto(`${base}/rules`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(7000);

const ruleCountBefore = await page.locator("ul > li").count();
msgs.length = 0;

// --- opens as a modal, page stays behind ---------------------------------
await page.getByRole("button", { name: "New rule", exact: true }).first().click();
await page.waitForTimeout(800);

const dialog = page.getByRole("dialog");
chk("dialog opens", await dialog.isVisible());
chk("titled 'New rule'", (await dialog.getByRole("heading").first().innerText()) === "New rule");
// The page stays mounted and painted behind the modal — but it is correctly
// hidden from the accessibility tree, so this is a CSS-level check rather than
// a role query, and the a11y side is asserted separately below.
const behind = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("h2")].find(
    (h) => h.textContent?.trim() === "Automation rules",
  );
  if (!heading) return null;
  const rect = heading.getBoundingClientRect();
  return {
    painted: rect.width > 0 && rect.height > 0,
    hiddenFromAt: Boolean(heading.closest("[aria-hidden='true'], [inert]")),
  };
});
chk("rules page still rendered behind it", behind?.painted === true, JSON.stringify(behind));
chk("background hidden from assistive tech", behind?.hiddenFromAt === true);

const box = await dialog.boundingBox();
chk("dialog is wide enough for the two-column form", box.width > 700, `${Math.round(box.width)}px`);
chk("dialog is height-bounded", box.height <= 900 * 0.89, `${Math.round(box.height)}px`);

// --- sections ------------------------------------------------------------
const text = (await dialog.innerText()).replace(/\s+/g, " ");
for (const section of ["DETAILS", "IF", "THEN", "PREVIEW"]) {
  chk(`section "${section}" present`, text.toUpperCase().includes(section));
}

// --- the pinned action bar ----------------------------------------------
const create = dialog.getByRole("button", { name: "Create rule" });
const geom = async () => {
  const d = await dialog.boundingBox();
  const b = await create.boundingBox();
  return { dialogBottom: d.y + d.height, btnBottom: b.y + b.height, btnY: b.y };
};
const g1 = await geom();
chk("action bar inside the dialog", g1.btnBottom <= g1.dialogBottom + 2,
  `btn ${Math.round(g1.btnBottom)} vs dialog ${Math.round(g1.dialogBottom)}`);

// Grow the form well past one screen, then confirm the bar has not moved.
for (let i = 0; i < 6; i += 1) {
  await dialog.getByRole("button", { name: "Add condition" }).click();
  await page.waitForTimeout(120);
}
await page.waitForTimeout(500);
const g2 = await geom();
chk("action bar stays put as the form grows", Math.abs(g2.btnY - g1.btnY) < 2,
  `${Math.round(g1.btnY)} -> ${Math.round(g2.btnY)}`);
chk("Create still visible after 7 conditions", await create.isVisible());

const scrolled = await dialog.evaluate((node) => {
  const scroller = [...node.querySelectorAll("div")].find(
    (d) => d.scrollHeight > d.clientHeight + 20,
  );
  if (!scroller) return null;
  scroller.scrollTop = scroller.scrollHeight;
  return scroller.scrollTop;
});
await page.waitForTimeout(400);
chk("body scrolls independently", scrolled !== null && scrolled > 0, `scrollTop=${scrolled}`);
const g3 = await geom();
chk("action bar unmoved after scrolling", Math.abs(g3.btnY - g1.btnY) < 2);

// --- validation + save ---------------------------------------------------
chk("Create disabled with no name", await create.isDisabled());
await dialog.getByLabel("Rule name").fill("Probe rule from check");
await page.waitForTimeout(400);
chk("Create enabled once named", await create.isEnabled());

await create.click();
await page.waitForTimeout(1200);
chk("dialog closes on save", (await page.getByRole("dialog").count()) === 0);
const listed = await page.getByText("Probe rule from check").count();
chk("new rule appears in the list", listed > 0);
chk("rule count grew", (await page.locator("ul > li").count()) > ruleCountBefore);

// --- edit path + dismissal ----------------------------------------------
await page.getByRole("button", { name: /^Edit/ }).first().click();
await page.waitForTimeout(900);
const editDialog = page.getByRole("dialog");
chk("edit opens the same modal", await editDialog.isVisible());
chk("titled 'Edit rule'", (await editDialog.getByRole("heading").first().innerText()) === "Edit rule");
chk("prefilled", (await editDialog.getByLabel("Rule name").inputValue()).length > 0);

await page.keyboard.press("Escape");
await page.waitForTimeout(700);
chk("Escape dismisses", (await page.getByRole("dialog").count()) === 0);

chk("no console errors or warnings", msgs.length === 0, msgs.slice(0, 3).join(" | ") || "clean");

console.log(out.join("\n"));
await browser.close();
process.exit(out.some((r) => r.startsWith("FAIL")) ? 1 : 0);
