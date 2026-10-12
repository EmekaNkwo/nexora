"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { onSelect } from "@/components/shared/selectValue";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PAGE_GAP, pageWindow } from "@/utils/pagination";
import { formatNumber } from "@/utils/formatting";

/**
 * Pager control.
 *
 * Shared rather than inlined because paging is a behaviour several surfaces
 * need, and the accessible version of it is more than a pair of arrows:
 *
 * - The range summary is a polite live region, so a screen-reader user hears
 *   "showing 26 to 50 of 143" after paging rather than having to hunt for what
 *   changed.
 * - Page buttons carry `aria-current="page"`, and every control has an
 *   explicit label — an unlabelled chevron is meaningless out of context.
 * - Numeric buttons are windowed with gaps, so the control is a fixed width
 *   whether there are 3 pages or 300, and collapse to a compact "x / y"
 *   readout on narrow viewports where the numbers would wrap.
 */

export interface PaginationProps {
  /** Zero-based current page. */
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  /** One-based bounds of the visible slice, as produced by `paginate`. */
  readonly from: number;
  readonly to: number;
  readonly onPageChange: (page: number) => void;
  readonly pageSize?: number;
  readonly pageSizeOptions?: readonly number[];
  readonly onPageSizeChange?: (pageSize: number) => void;
  /** Plural noun for the range summary, e.g. "alerts". */
  readonly itemLabel?: string;
  readonly className?: string;
}

export function Pagination({
  page,
  pageCount,
  total,
  from,
  to,
  onPageChange,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  itemLabel = "items",
  className,
}: PaginationProps) {
  const tokens = pageWindow(page, pageCount);
  const onFirstPage = page <= 0;
  const onLastPage = page >= pageCount - 1;

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {total === 0
          ? `No ${itemLabel}`
          : `Showing ${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)} ${itemLabel}`}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {pageSize !== undefined && pageSizeOptions && onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Rows</span>
            <Select
              value={String(pageSize)}
              onValueChange={onSelect((value) => onPageSizeChange(Number(value)))}
            >
              <SelectTrigger
                className="h-7 w-[4.5rem] text-xs"
                aria-label={`Rows per page, currently ${pageSize}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onPageChange(0)}
            disabled={onFirstPage}
            aria-label="First page"
          >
            <ChevronsLeft className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onPageChange(page - 1)}
            disabled={onFirstPage}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </Button>

          {/* Numbered pages on wider viewports… */}
          <span className="hidden items-center gap-1 sm:flex">
            {tokens.map((token, index) =>
              token === PAGE_GAP ? (
                <span
                  key={`gap-${index}`}
                  className="px-1 text-xs text-muted-foreground"
                  aria-hidden="true"
                >
                  …
                </span>
              ) : (
                <Button
                  key={token}
                  size="icon-xs"
                  variant={token === page ? "secondary" : "ghost"}
                  onClick={() => onPageChange(token)}
                  aria-label={`Page ${token + 1}`}
                  aria-current={token === page ? "page" : undefined}
                  className="tabular min-w-6 px-1 text-xs"
                >
                  {token + 1}
                </Button>
              ),
            )}
          </span>

          {/* …and a compact readout where they would wrap. */}
          <span className="tabular px-1.5 text-xs text-muted-foreground sm:hidden">
            {page + 1} / {pageCount}
          </span>

          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onPageChange(page + 1)}
            disabled={onLastPage}
            aria-label="Next page"
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onPageChange(pageCount - 1)}
            disabled={onLastPage}
            aria-label="Last page"
          >
            <ChevronsRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
