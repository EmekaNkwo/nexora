import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  // Must mirror the `@/*` → `./src/*` mapping in tsconfig.json.
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

/**
 * Almost everything here is pure domain logic and runs in `node` — no DOM, and
 * none wanted: a simulator or rule engine that needed a browser to be tested
 * would be badly factored.
 *
 * The exception is persistence, which is defined entirely in terms of
 * `localStorage` and `document.documentElement`. Those get `jsdom`.
 *
 * The split is declared here, per project, rather than with a
 * `@vitest-environment` comment at the top of the file. Two reasons: a project
 * reports its own file and test counts, so a file that fails to be collected
 * shows up as a project running zero tests instead of quietly shrinking the
 * total; and the environment stops depending on a magic comment surviving the
 * transform cache.
 */
const DOM_TESTS = ["src/utils/persistence.test.ts"];

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: DOM_TESTS,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          include: DOM_TESTS,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/services/**", "src/utils/**", "src/stores/**"],
      exclude: ["**/*.test.ts"],
    },
  },
});
