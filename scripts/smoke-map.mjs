/**
 * Browser smoke test for the device map.
 *
 * Exists because the map has twice failed in a way no static check could
 * catch: it mounted without error, reported no console warnings, built and
 * typechecked cleanly — and rendered as an invisible zero-height box. Once
 * because MapLibre's web worker could not load, and once because MapLibre's
 * own stylesheet sets `.maplibregl-map { position: relative }`, which has the
 * same specificity as Tailwind's `.absolute` and loads later, collapsing a
 * container that relied on `absolute inset-0`.
 *
 * Both are invisible to `tsc`, `eslint` and `next build`. The only thing that
 * catches them is measuring the rendered canvas, so that is what this does.
 *
 * Usage:  node scripts/smoke-map.mjs [baseUrl]
 * Needs a dev or production server already running at `baseUrl`.
 */
import { chromium } from "playwright";

const baseUrl = process.argv[2] ?? "http://localhost:3000";

/** Minimum believable rendered size — a collapsed box is the failure mode. */
const MIN_DIMENSION = 100;

const routes = [
  { path: "/", label: "dashboard map panel" },
  { path: "/map", label: "full map page" },
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const failures = [];

for (const route of routes) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  const url = `${baseUrl}${route.path}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
    // The fleet is generated client-side, then the map loads its style.
    await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 45_000 });
    await page.waitForTimeout(8000);

    const result = await page.evaluate(() => {
      const container = document.querySelector(".maplibregl-map");
      const canvas = document.querySelector("canvas.maplibregl-canvas");
      const box = container?.getBoundingClientRect();
      const canvasBox = canvas?.getBoundingClientRect();
      return {
        containerHeight: Math.round(box?.height ?? 0),
        containerWidth: Math.round(box?.width ?? 0),
        canvasHeight: Math.round(canvasBox?.height ?? 0),
        canvasWidth: Math.round(canvasBox?.width ?? 0),
        // Backing store: a 0×0 drawing buffer paints nothing even if the
        // element is laid out correctly.
        bufferHeight: canvas?.height ?? 0,
        bufferWidth: canvas?.width ?? 0,
        clusters: document.querySelectorAll(".maplibregl-marker").length,
        error: document.querySelector('[role="alert"]')?.textContent ?? null,
      };
    });

    const problems = [];
    if (result.containerHeight < MIN_DIMENSION) {
      problems.push(`container height ${result.containerHeight}px`);
    }
    if (result.canvasHeight < MIN_DIMENSION || result.canvasWidth < MIN_DIMENSION) {
      problems.push(`canvas ${result.canvasWidth}×${result.canvasHeight}`);
    }
    if (result.bufferHeight < MIN_DIMENSION || result.bufferWidth < MIN_DIMENSION) {
      problems.push(`drawing buffer ${result.bufferWidth}×${result.bufferHeight}`);
    }
    // Clustering runs in the web worker, so markers are proof it started.
    if (result.clusters === 0) {
      problems.push("no cluster markers (web worker may have failed)");
    }
    if (result.error) problems.push(`error overlay: ${result.error.trim()}`);
    if (pageErrors.length > 0) problems.push(`page errors: ${pageErrors.join("; ")}`);

    if (problems.length > 0) {
      failures.push(`${route.label} (${url}): ${problems.join(", ")}`);
      console.error(`✗ ${route.label}: ${problems.join(", ")}`);
    } else {
      console.log(
        `✓ ${route.label}: canvas ${result.canvasWidth}×${result.canvasHeight}, ` +
          `${result.clusters} clusters`,
      );
    }
  } catch (error) {
    failures.push(`${route.label} (${url}): ${String(error).split("\n")[0]}`);
    console.error(`✗ ${route.label}: ${String(error).split("\n")[0]}`);
  } finally {
    await page.close();
  }
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} map smoke check(s) failed.`);
  process.exit(1);
}
console.log("\nMap renders correctly on all checked routes.");
