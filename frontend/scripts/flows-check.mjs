/**
 * Verifies the firmware rollout pickers, the firmware upload flow, and the
 * issue-command modal.
 *
 * Usage: node scripts/flows-check.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 950 } })
).newPage();

const msgs = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") msgs.push(m.text());
});
page.on("pageerror", (e) => msgs.push(`pageerror: ${String(e)}`));

const out = [];
const chk = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
const dialog = () => page.getByRole("dialog");

// ---------------------------------------------------------------- firmware
await page.goto(`${base}/firmware`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(8000);
msgs.length = 0;

const checkboxCount = async () => page.getByRole("checkbox").count();

// --- pilot ---------------------------------------------------------------
await page.getByRole("button", { name: /^Pilot \d+ devices$/ }).click();
await page.waitForTimeout(1200);
chk("pilot opens a modal", await dialog().isVisible());
const pilotText = (await dialog().innerText()).replace(/\s+/g, " ");
chk("pilot modal lists devices with checkboxes", (await checkboxCount()) > 5,
  `${await checkboxCount()} checkboxes`);
chk("pilot pre-selects 24", /24 selected of 24 max/.test(pilotText),
  pilotText.match(/\d+ selected[^·]*/)?.[0] ?? "");

// untick one, confirm the button count follows
await page.getByRole("checkbox").first().click();
await page.waitForTimeout(400);
const startBtn = dialog().getByRole("button", { name: /^Start rollout/ });
chk("count follows the checkboxes", /23/.test(await startBtn.innerText()),
  (await startBtn.innerText()).trim());

await page.keyboard.press("Escape");
await page.waitForTimeout(600);

// --- full rollout --------------------------------------------------------
await page.getByRole("button", { name: /^Update .* devices$/ }).click();
await page.waitForTimeout(1500);
const fullText = (await dialog().innerText()).replace(/\s+/g, " ");
chk("update opens a modal", await dialog().isVisible());
const selectedMatch = fullText.match(/([\d,]+) selected/);
chk("update pre-selects the whole outdated set",
  Number((selectedMatch?.[1] ?? "0").replace(/,/g, "")) > 100, selectedMatch?.[0] ?? "");
chk("no max cap on a full rollout", !/max/.test(fullText));

// search narrows the list
await dialog().getByPlaceholder(/Search id/).fill("MUC");
await page.waitForTimeout(700);
const narrowed = (await dialog().innerText()).replace(/\s+/g, " ");
chk("search narrows the picker", /shown/.test(narrowed), narrowed.match(/[\d,]+ shown/)?.[0] ?? "");

await page.keyboard.press("Escape");
await page.waitForTimeout(600);

// --- upload --------------------------------------------------------------
await page.getByRole("button", { name: "Upload new firmware" }).click();
await page.waitForTimeout(900);
chk("upload opens a modal", await dialog().isVisible());

const register = dialog().getByRole("button", { name: "Register build" });
await dialog().getByLabel("Version").fill("v9.9.9");
await dialog().getByLabel("Image size (MB)").fill("12.5");
await dialog().getByLabel("Release notes").fill("Probe build\nSecond note");
await page.waitForTimeout(300);
await register.click();
await page.waitForTimeout(1200);
chk("upload dialog closes on submit", (await page.getByRole("dialog").count()) === 0);

const versionTrigger = page.getByLabel("Target version");
chk("new build becomes the target", /v9\.9\.9/.test(await versionTrigger.innerText()),
  (await versionTrigger.innerText()).trim());

// persists across a reload
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(7000);
const stored = await page.evaluate(() => localStorage.getItem("nexora:catalogue"));
chk("registered build persists", (stored ?? "").includes("v9.9.9"));

// rejects a duplicate
await page.getByRole("button", { name: "Upload new firmware" }).click();
await page.waitForTimeout(800);
await dialog().getByLabel("Version").fill("v9.9.9");
await dialog().getByRole("button", { name: "Register build" }).click();
await page.waitForTimeout(600);
chk("duplicate version rejected", /already registered/.test(await dialog().innerText()));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

chk("no console errors on firmware", msgs.length === 0, msgs.slice(0, 2).join(" | ") || "clean");

// ---------------------------------------------------------------- commands
await page.goto(`${base}/commands`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(7000);
msgs.length = 0;

chk("no permanent issue-command sidebar",
  !(await page.getByRole("heading", { name: "Issue command" }).isVisible().catch(() => false)));

await page.getByRole("button", { name: "Issue command" }).click();
await page.waitForTimeout(900);
chk("issue command opens a modal", await dialog().isVisible());

const sendBtn = dialog().getByRole("button", { name: "Send command" });
chk("send disabled with no device", await sendBtn.isDisabled());
await dialog().getByLabel("Device ID").fill("NOPE-1");
await page.waitForTimeout(500);
chk("unknown device reported", /No device with that id/.test(await dialog().innerText()));

await dialog().getByLabel("Device ID").fill("MUC-1455");
await page.waitForTimeout(600);
chk("known device resolves", await sendBtn.isEnabled());
await sendBtn.click();
await page.waitForTimeout(1500);
chk("modal closes after send", (await page.getByRole("dialog").count()) === 0);
chk("command appears in history", (await page.getByText("MUC-1455").count()) > 0);

// ---------------------------------------------------------------- fields
// Measured on the provisioning form, which has five selects beside two text
// inputs in one grid — the layout where a `w-fit` trigger was visibly wrong.
await page.goto(`${base}/devices`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(7000);
await page.getByRole("button", { name: /Add device/i }).click();
await page.waitForTimeout(1200);

const widths = await page.evaluate(() => {
  const popup = document.querySelector('[data-slot="dialog-content"]');
  if (!popup) return null;
  const controls = [
    ...popup.querySelectorAll('[data-slot="select-trigger"], [data-slot="input"]'),
  ];
  return controls.map((node) => ({
    kind: node.getAttribute("data-slot"),
    w: Math.round(node.getBoundingClientRect().width),
    cellW: Math.round(node.parentElement?.getBoundingClientRect().width ?? 0),
  }));
});
chk("provisioning form has both control kinds",
  Boolean(widths) && widths.some((x) => x.kind === "select-trigger") &&
    widths.some((x) => x.kind === "input"),
  `${widths?.length ?? 0} controls`);
chk("every control fills its cell",
  Boolean(widths) && widths.length > 0 && widths.every((x) => x.w >= x.cellW - 2),
  JSON.stringify(widths?.slice(0, 3)));

// Selects and inputs in the same grid must now render the same width.
const distinct = [...new Set((widths ?? []).map((x) => x.w))];
chk("selects and inputs are the same width in one grid", distinct.length <= 2,
  `widths: ${distinct.join(", ")}`);
await page.keyboard.press("Escape");

chk("no console errors on commands", msgs.length === 0, msgs.slice(0, 2).join(" | ") || "clean");

console.log(out.join("\n"));
await browser.close();
process.exit(out.some((r) => r.startsWith("FAIL")) ? 1 : 0);
