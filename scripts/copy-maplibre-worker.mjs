/**
 * Copies MapLibre's web worker into `public/` so it can be served directly.
 *
 * MapLibre derives its worker URL from the `import.meta.url` of its own
 * module and looks for a sibling `maplibre-gl-worker.mjs`. Once a bundler has
 * rewritten module URLs that sibling no longer exists at the resolved path, so
 * the worker fails to load — which silently disables GeoJSON clustering and
 * tile parsing, because both run off the main thread.
 *
 * The worker bundle is self-contained (it has no relative imports of its own),
 * so serving a single copied file is enough. `setWorkerUrl` then points
 * MapLibre at it explicitly — see `components/maps/DeviceMap.tsx`.
 *
 * Runs from `predev` and `prebuild` rather than `postinstall` so the copy can
 * never drift from the installed version.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Resolved from the package itself, so the version always matches. */
const packageJsonPath = require.resolve("maplibre-gl/package.json");
const distDir = join(dirname(packageJsonPath), "dist");

const WORKER_FILE = "maplibre-gl-worker.mjs";
const publicDir = join(process.cwd(), "public");

try {
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(join(distDir, WORKER_FILE), join(publicDir, WORKER_FILE));
  console.log(`[nexora] copied ${WORKER_FILE} → public/`);
} catch (error) {
  // Not fatal: the map degrades to a non-clustered view rather than breaking
  // the whole build, and the failure is reported rather than swallowed.
  console.error(`[nexora] failed to copy ${WORKER_FILE}:`, error);
  process.exitCode = 1;
}
