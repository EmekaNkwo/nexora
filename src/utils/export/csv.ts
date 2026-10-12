/**
 * CSV export.
 *
 * Operators take data out of a console as often as they look at it in one —
 * into a spreadsheet for a handover note, into a ticket as evidence. This is
 * the whole of that capability: a serialiser and a download trigger, with no
 * dependency, because RFC 4180 is about thirty lines of rules.
 */

export interface CsvColumn<T> {
  readonly header: string;
  /** Extracts the cell. `null`/`undefined` become an empty cell, not "null". */
  readonly value: (row: T) => string | number | boolean | null | undefined;
}

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * A device named `=cmd|'/c calc'!A1` would otherwise execute on open in Excel.
 * The device names here are generated, but alert messages and rule names are
 * operator-authored free text, and "our input is trusted" is exactly the
 * assumption CSV injection relies on. Prefixing with an apostrophe is the
 * standard mitigation: the cell displays as typed and is inert.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/** RFC 4180 says CRLF, and Excel is the consumer that cares. */
const ROW_SEPARATOR = "\r\n";

/**
 * Whether a *string* cell needs neutralising.
 *
 * Numbers are exempt, and that matters: signal strength is -70 and freezer
 * temperatures are negative, so blanket-prefixing anything starting with "-"
 * would turn every one of them into text and break sorting and averaging in
 * the spreadsheet — trading a real usability loss for no security gain. A
 * string that parses as a finite number is treated the same way, which leaves
 * the prefix applied only where a cell genuinely looks like a formula.
 */
function needsNeutralising(text: string): boolean {
  if (!FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) return false;
  return !Number.isFinite(Number(text));
}

function escapeCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return "";

  let text = String(raw);

  if (typeof raw === "string" && needsNeutralising(text)) {
    text = `'${text}`;
  }

  // Quote when the cell contains a delimiter, a quote or a line break; inner
  // quotes are doubled.
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/** Serialises rows to an RFC 4180 CSV document, header row included. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(column.value(row))).join(","),
  );
  return [header, ...body].join(ROW_SEPARATOR);
}

/**
 * `nexora-alerts-20261012-1432.csv` — prefix, then a sortable local timestamp,
 * so a folder of exports sorts chronologically and nothing is overwritten.
 */
export function csvFilename(prefix: string, at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `${prefix}-${stamp}.csv`;
}

/**
 * Triggers a browser download.
 *
 * The BOM is not decoration: without it Excel reads the file as the system
 * codepage and mangles every non-ASCII character — degree signs in metric
 * units, accented site names.
 */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === "undefined") return;

  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";

  document.body.append(link);
  link.click();
  link.remove();

  // Revoking immediately can cancel the download in some browsers; one frame
  // is enough for the navigation to have been queued.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/** Serialise and download in one step — what every call site actually wants. */
export function exportCsv<T>(
  prefix: string,
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): void {
  downloadCsv(csvFilename(prefix, new Date()), toCsv(rows, columns));
}
