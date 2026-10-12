"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { exportCsv, type CsvColumn } from "@/utils/export/csv";
import { formatNumber } from "@/utils/formatting";

/**
 * CSV export control.
 *
 * Presentational: it is handed the rows and the column definitions and knows
 * nothing about what they mean. The announcement is the part worth keeping — a
 * download gives no visual feedback inside the page, so without a live region
 * a screen-reader user has no way to know the action did anything.
 */
export interface ExportButtonProps<T> {
  /** Filename prefix; a timestamp and `.csv` are appended. */
  readonly filePrefix: string;
  readonly rows: readonly T[];
  readonly columns: readonly CsvColumn<T>[];
  /** Plural noun for the label, e.g. "devices". */
  readonly noun: string;
  readonly label?: string;
  readonly size?: "xs" | "sm";
  readonly className?: string;
}

export function ExportButton<T>({
  filePrefix,
  rows,
  columns,
  noun,
  label = "Export CSV",
  size = "xs",
  className,
}: ExportButtonProps<T>) {
  const [announcement, setAnnouncement] = useState("");
  const count = rows.length;

  const run = (): void => {
    if (count === 0) return;
    exportCsv(filePrefix, rows, columns);
    setAnnouncement(`Exported ${formatNumber(count)} ${noun} to CSV.`);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size={size}
              onClick={run}
              disabled={count === 0}
              className={cn("gap-1.5", className)}
              aria-label={`${label} — ${formatNumber(count)} ${noun}`}
            >
              <Download className="size-3" aria-hidden="true" />
              {label}
            </Button>
          }
        />
        <TooltipContent>
          {count === 0
            ? `No ${noun} to export`
            : `Download ${formatNumber(count)} ${noun} as CSV`}
        </TooltipContent>
      </Tooltip>

      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
