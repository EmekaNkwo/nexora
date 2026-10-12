import { STORAGE_KEYS } from "@/utils/persistence";

/**
 * Pre-paint theme script.
 *
 * Runs before React hydrates, so a light-mode operator never sees a dark flash
 * on every navigation that touches the document. This cannot be done in an
 * effect — effects run after paint, which is precisely the flash.
 *
 * It is coupled to two things on purpose, both asserted by `themeScript.test`:
 * the storage key, and zustand-persist's `{ state, version }` envelope. If
 * either changes, the script silently stops working, which is why the test
 * drives this exact string against a real persisted payload rather than
 * checking it in isolation.
 *
 * Any failure is swallowed: a broken theme is a cosmetic problem, but an
 * exception in a blocking head script would block the whole page.
 */
export const themeScript = `(function(){try{
var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEYS.ui)});
var theme = raw ? (JSON.parse(raw).state || {}).theme : "system";
if (theme !== "dark" && theme !== "light") {
  theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light" : "dark";
}
if (theme === "light") document.documentElement.classList.add("light");
document.documentElement.style.colorScheme = theme;
}catch(e){}})();`;
