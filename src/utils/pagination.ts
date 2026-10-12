/**
 * Pagination primitives.
 *
 * Lives in `utils` rather than alongside a feature because more than one
 * surface pages its results (devices and alerts), and none of this logic is
 * specific to either.
 */

export interface PageResult<T> {
  readonly items: readonly T[];
  /** Zero-based, and clamped into range — see `paginate`. */
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  /** One-based index of the first item on the page, or 0 when empty. */
  readonly from: number;
  /** One-based index of the last item on the page. */
  readonly to: number;
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): PageResult<T> {
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  // Clamp rather than return an empty page. Lists here shrink underneath the
  // operator — alerts resolve, devices are filtered — and landing on a blank
  // page 7 of a 2-page result is the classic version of this bug.
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const from = safePage * size;
  const to = Math.min(from + size, items.length);

  return {
    items: items.slice(from, to),
    page: safePage,
    pageCount,
    total: items.length,
    from: items.length === 0 ? 0 : from + 1,
    to,
  };
}

/** Marker for a gap in a page-number window. */
export const PAGE_GAP = "gap" as const;

export type PageToken = number | typeof PAGE_GAP;

/**
 * Builds a windowed list of page numbers for a pager control.
 *
 * Always includes the first and last page plus a window around the current
 * one, collapsing the rest into gaps — so the control stays a fixed width
 * whether there are 3 pages or 300.
 *
 * Returns zero-based page indices.
 */
export function pageWindow(
  page: number,
  pageCount: number,
  radius = 1,
): readonly PageToken[] {
  // Few enough pages that a window would only add gaps — show them all.
  const maxWithoutGaps = radius * 2 + 5;
  if (pageCount <= maxWithoutGaps) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  const first = 0;
  const last = pageCount - 1;
  const start = Math.max(first + 1, page - radius);
  const end = Math.min(last - 1, page + radius);

  const tokens: PageToken[] = [first];
  if (start > first + 1) tokens.push(PAGE_GAP);
  for (let index = start; index <= end; index += 1) tokens.push(index);
  if (end < last - 1) tokens.push(PAGE_GAP);
  tokens.push(last);

  return tokens;
}
