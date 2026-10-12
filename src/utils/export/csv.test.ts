import { describe, expect, it } from "vitest";

import { csvFilename, toCsv, type CsvColumn } from "./csv";

interface Row {
  readonly name: string;
  readonly value: number | null;
}

const COLUMNS: readonly CsvColumn<Row>[] = [
  { header: "Name", value: (row) => row.name },
  { header: "Value", value: (row) => row.value },
];

describe("toCsv", () => {
  it("writes a header even with no rows", () => {
    expect(toCsv([], COLUMNS)).toBe("Name,Value");
  });

  it("separates rows with CRLF", () => {
    const csv = toCsv(
      [
        { name: "a", value: 1 },
        { name: "b", value: 2 },
      ],
      COLUMNS,
    );
    expect(csv).toBe("Name,Value\r\na,1\r\nb,2");
  });

  it("renders null and undefined as empty cells, not as text", () => {
    const csv = toCsv([{ name: "a", value: null }], COLUMNS);
    expect(csv).toBe("Name,Value\r\na,");
  });

  it("quotes cells containing a comma", () => {
    const csv = toCsv([{ name: "Lagos, Nigeria", value: 1 }], COLUMNS);
    expect(csv).toBe('Name,Value\r\n"Lagos, Nigeria",1');
  });

  it("doubles embedded quotes", () => {
    const csv = toCsv([{ name: 'He said "go"', value: 1 }], COLUMNS);
    expect(csv).toBe('Name,Value\r\n"He said ""go""",1');
  });

  it("quotes cells containing line breaks so the row is not split", () => {
    const csv = toCsv([{ name: "line one\nline two", value: 1 }], COLUMNS);
    expect(csv).toBe('Name,Value\r\n"line one\nline two",1');
  });

  it("neutralises formula injection", () => {
    // Each of these executes on open in Excel if written through unescaped.
    // Note "+1" and "-1" are absent: they parse as numbers, are exempted on
    // purpose, and evaluate to themselves anyway.
    for (const payload of [
      "=1+1",
      "+1+1",
      "-1-1",
      "@SUM(A1)",
      '=cmd|\'/c calc\'!A1',
    ]) {
      const csv = toCsv([{ name: payload, value: 0 }], COLUMNS);
      expect(csv).toContain(`'${payload}`);
    }
  });

  it("still quotes a neutralised cell that also contains a comma", () => {
    const csv = toCsv([{ name: "=A1,B1", value: 0 }], COLUMNS);
    expect(csv).toBe("Name,Value\r\n\"'=A1,B1\",0");
  });

  it("leaves negative numbers as numbers", () => {
    // Signal strength is -70 and freezer temperatures are negative. Prefixing
    // these would make every one of them text in the spreadsheet and break
    // sorting and averaging, for no security gain.
    const csv = toCsv([{ name: "signal", value: -70 }], COLUMNS);
    expect(csv).toBe("Name,Value\r\nsignal,-70");
  });

  it("leaves numeric strings alone but still catches formulas", () => {
    const numeric: readonly CsvColumn<{ readonly cell: string }>[] = [
      { header: "Cell", value: (row) => row.cell },
    ];
    expect(toCsv([{ cell: "-18.5" }], numeric)).toBe("Cell\r\n-18.5");
    expect(toCsv([{ cell: "-1+1" }], numeric)).toBe("Cell\r\n'-1+1");
  });
});

describe("csvFilename", () => {
  it("builds a sortable, zero-padded timestamp", () => {
    const at = new Date(2026, 0, 5, 9, 7);
    expect(csvFilename("nexora-alerts", at)).toBe("nexora-alerts-20260105-0907.csv");
  });
});
