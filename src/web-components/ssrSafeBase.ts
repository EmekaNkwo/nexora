/**
 * SSR-safe base class for custom elements.
 *
 * `class X extends HTMLElement` is evaluated when the module is *imported*,
 * not when the element is registered — so any module defining a custom
 * element throws `HTMLElement is not defined` the moment it is pulled into a
 * server-rendered module graph, which in an App Router tree is unavoidable.
 *
 * Substituting an inert base on the server keeps the class declaration legal
 * everywhere. It is never instantiated there: `registerWebComponents` is
 * called from a client effect, and the elements only come to life once the
 * browser upgrades them.
 *
 * The alternative — wrapping every class in a factory called at registration
 * time — works too, but costs an extra indirection and a hand-written API
 * interface per element for ref typing. This is the smaller change.
 */
const InertBase = class {} as unknown as typeof HTMLElement;

export const CustomElementBase: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? InertBase : HTMLElement;
