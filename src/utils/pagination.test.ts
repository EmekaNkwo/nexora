import { describe, expect, it } from "vitest";

import { PAGE_GAP, pageWindow, paginate } from "@/utils/pagination";

const items = Array.from({ length: 23 }, (_, index) => index);

describe("paginate", () => {
  it("slices the requested page", () => {
    const result = paginate(items, 0, 10);
    expect(result.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.page).toBe(0);
    expect(result.pageCount).toBe(3);
    expect(result.total).toBe(23);
  });

  it("reports one-based human bounds", () => {
    expect(paginate(items, 0, 10)).toMatchObject({ from: 1, to: 10 });
    expect(paginate(items, 1, 10)).toMatchObject({ from: 11, to: 20 });
    // Final partial page stops at the real end, not at page × size.
    expect(paginate(items, 2, 10)).toMatchObject({ from: 21, to: 23 });
  });

  it("returns a short final page rather than padding it", () => {
    expect(paginate(items, 2, 10).items).toEqual([20, 21, 22]);
  });

  /**
   * The behaviour that matters most here: lists in this app shrink underneath
   * the operator as alerts resolve, so a stale page index must land on real
   * content rather than a blank page.
   */
  it("clamps a page index beyond the end to the last page", () => {
    const result = paginate(items, 99, 10);
    expect(result.page).toBe(2);
    expect(result.items).toEqual([20, 21, 22]);
    expect(result.from).toBe(21);
  });

  it("clamps a negative page index to the first page", () => {
    expect(paginate(items, -5, 10).page).toBe(0);
  });

  it("handles an empty list without reporting a phantom row", () => {
    const result = paginate([], 0, 25);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.pageCount).toBe(1);
    // `from` is 0, not 1 — there is no first item to point at.
    expect(result.from).toBe(0);
    expect(result.to).toBe(0);
  });

  it("treats a page size below one as a single item per page", () => {
    const result = paginate(items, 0, 0);
    expect(result.items).toEqual([0]);
    expect(result.pageCount).toBe(23);
  });

  it("does not mutate the input", () => {
    const original = [...items];
    paginate(items, 1, 10);
    expect(items).toEqual(original);
  });

  it("covers every item exactly once across all pages", () => {
    const size = 7;
    const { pageCount } = paginate(items, 0, size);
    const seen: number[] = [];
    for (let page = 0; page < pageCount; page += 1) {
      seen.push(...paginate(items, page, size).items);
    }
    expect(seen).toEqual(items);
  });
});

describe("pageWindow", () => {
  it("lists every page when there are few enough", () => {
    expect(pageWindow(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(pageWindow(3, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("always includes the first and last page", () => {
    const tokens = pageWindow(10, 30);
    expect(tokens[0]).toBe(0);
    expect(tokens[tokens.length - 1]).toBe(29);
  });

  it("windows around the current page with gaps on both sides", () => {
    expect(pageWindow(10, 30)).toEqual([0, PAGE_GAP, 9, 10, 11, PAGE_GAP, 29]);
  });

  it("omits the leading gap near the start", () => {
    const tokens = pageWindow(1, 30);
    expect(tokens).toEqual([0, 1, 2, PAGE_GAP, 29]);
  });

  it("omits the trailing gap near the end", () => {
    const tokens = pageWindow(28, 30);
    expect(tokens).toEqual([0, PAGE_GAP, 27, 28, 29]);
  });

  it("keeps a bounded width however many pages there are", () => {
    // The whole point: the control must not grow with the result set.
    const small = pageWindow(5, 12).length;
    const huge = pageWindow(500, 1000).length;
    expect(huge).toBe(small);
    expect(huge).toBeLessThanOrEqual(7);
  });

  it("always contains the current page", () => {
    for (const page of [0, 1, 7, 15, 28, 29]) {
      expect(pageWindow(page, 30)).toContain(page);
    }
  });

  it("respects a wider radius", () => {
    expect(pageWindow(10, 30, 2)).toEqual([
      0,
      PAGE_GAP,
      8,
      9,
      10,
      11,
      12,
      PAGE_GAP,
      29,
    ]);
  });

  it("handles a single page", () => {
    expect(pageWindow(0, 1)).toEqual([0]);
  });
});
