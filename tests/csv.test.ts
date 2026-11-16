import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, componentsToCsv, parseComponentsCsv } from "@/lib/csv";
import { applyComponentUpserts } from "@/lib/mutations";
import { evaluate } from "@/lib/schedule";
import { buildSeedDataset } from "@/lib/seed";

const HEADER = CSV_COLUMNS.join(",");
const sample = readFileSync("public/sample-components.csv", "utf8");
const row = (overrides: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    partNumber: "KS-NEW-001", description: "Sun Sensor", subsystem: "Attitude Control", supplierLocationCode: "SUP-MUC",
    supplierName: "Isarwerk Optik", routeCode: "RT-MUC-ABQ", milestoneCode: "ENV-TEST", baselineArrivalDate: "2027-05-20",
    preparationDays: "5", isSingleSource: "false", notes: "",
  };
  const merged = { ...base, ...overrides };
  return CSV_COLUMNS.map((c) => merged[c]).join(",");
};
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n") + "\n";

describe("sample CSV", () => {
  it("is generated from the seed, has ten fictional components and validates", () => {
    const seed = buildSeedDataset();
    expect(sample).toBe(componentsToCsv(seed));
    const empty = { ...seed, components: [] };
    const result = parseComponentsCsv(sample, empty);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.rows).toHaveLength(10);
    expect(result.created).toBe(10);
  });
});

describe("12 · CSV validation is atomic", () => {
  const seed = buildSeedDataset();

  it("one bad row rejects the whole file with row-specific errors", () => {
    const result = parseComponentsCsv(
      csv(row(), row({ partNumber: "KS-NEW-002", preparationDays: "-3" }), row({ partNumber: "KS-NEW-003" })),
      seed,
    );
    expect(result.valid).toBe(false);
    expect(result.rows).toEqual([]); // nothing is importable, including the valid rows
    expect(result.errors).toEqual([
      { line: 3, column: "preparationDays", message: "Preparation days cannot be negative." },
    ]);
  });

  it("reports unknown location, route and milestone codes with the valid options", () => {
    const result = parseComponentsCsv(
      csv(row({ supplierLocationCode: "SUP-XXX", routeCode: "RT-NOPE", milestoneCode: "PDR" })),
      seed,
    );
    expect(result.valid).toBe(false);
    const byColumn = Object.fromEntries(result.errors.map((e) => [e.column, e.message]));
    expect(byColumn.supplierLocationCode).toMatch(/Unknown location code "SUP-XXX".*SUP-TLS/);
    expect(byColumn.routeCode).toMatch(/Unknown route code "RT-NOPE".*RT-TLS-ABQ/);
    expect(byColumn.milestoneCode).toMatch(/Unknown milestone code "PDR".*AIT-RR, ENV-TEST, LIC/);
    expect(result.errors.every((e) => e.line === 2)).toBe(true);
  });

  it("validates required fields, ISO dates, integers and booleans", () => {
    const result = parseComponentsCsv(
      csv(
        row({ description: "" }),
        row({ partNumber: "KS-NEW-002", baselineArrivalDate: "06/01/2027" }),
        row({ partNumber: "KS-NEW-003", baselineArrivalDate: "2027-02-30" }),
        row({ partNumber: "KS-NEW-004", preparationDays: "4.5" }),
        row({ partNumber: "KS-NEW-005", isSingleSource: "maybe" }),
      ),
      seed,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => [e.line, e.column])).toEqual([
      [2, "description"], [3, "baselineArrivalDate"], [4, "baselineArrivalDate"], [5, "preparationDays"], [6, "isSingleSource"],
    ]);
  });

  it("rejects duplicate part numbers within one upload", () => {
    const result = parseComponentsCsv(csv(row(), row({ description: "Other" })), seed);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ line: 3, column: "partNumber" });
    expect(result.errors[0]!.message).toContain("first used on line 2");
  });

  it("rejects inconsistent dependencies: a route that does not start at the supplier, or a non-supplier location", () => {
    const wrongRoute = parseComponentsCsv(csv(row({ routeCode: "RT-TLS-ABQ" })), seed);
    expect(wrongRoute.valid).toBe(false);
    expect(wrongRoute.errors[0]).toMatchObject({ line: 2, column: "routeCode" });
    expect(wrongRoute.errors[0]!.message).toContain("starts at SUP-TLS");

    const hub = parseComponentsCsv(csv(row({ supplierLocationCode: "HUB-FRA" })), seed);
    expect(hub.valid).toBe(false);
    expect(hub.errors[0]).toMatchObject({ line: 2, column: "supplierLocationCode" });
  });

  it("rejects missing or unexpected columns", () => {
    const missing = parseComponentsCsv("partNumber,description\nKS-1,Thing\n", seed);
    expect(missing.valid).toBe(false);
    expect(missing.errors.some((e) => e.message.includes('Missing column "routeCode"'))).toBe(true);
    const extra = parseComponentsCsv(`${HEADER},riskScore\n${row()},5\n`, seed);
    expect(extra.valid).toBe(false);
    expect(extra.errors[0]!.message).toContain('Unexpected column "riskScore"');
  });

  it("supports quoted fields containing commas, quotes and newlines", () => {
    const result = parseComponentsCsv(
      csv(row({ description: '"Sensor, coarse ""CSS"""', notes: '"line one\nline two"' })),
      seed,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.input.description).toBe('Sensor, coarse "CSS"');
    expect(result.rows[0]!.input.notes).toBe("line one\nline two");
  });
});

describe("12 · CSV import is idempotent", () => {
  it("explains creates versus updates and re-importing creates no duplicates", () => {
    const seed = buildSeedDataset();
    const file = csv(row(), row({ partNumber: "KS-FC-101", description: "Flight Computer", supplierLocationCode: "SUP-TLS", supplierName: "Aurelia Avionique", routeCode: "RT-TLS-ABQ", baselineArrivalDate: "2027-06-04", preparationDays: "10" }));
    const first = parseComponentsCsv(file, seed);
    expect(first.valid).toBe(true);
    expect(first.rows.map((r) => [r.input.partNumber, r.action])).toEqual([["KS-NEW-001", "create"], ["KS-FC-101", "update"]]);
    expect([first.created, first.updated]).toEqual([1, 1]);

    let n = 0;
    const once = applyComponentUpserts(seed, first.rows.map((r) => r.input), () => `new-${++n}`);
    expect(once.components).toHaveLength(11);

    const second = parseComponentsCsv(file, once);
    expect([second.created, second.updated]).toEqual([0, 2]);
    const twice = applyComponentUpserts(once, second.rows.map((r) => r.input), () => `new-${++n}`);
    expect(twice.components).toHaveLength(11);
    expect(twice).toEqual(once);

    // The import changed a planning input, so results recalculate.
    expect(evaluate(seed, null).components["cmp-ks-fc-101"]!.margin).toBe(9);
    expect(evaluate(twice, null).components["cmp-ks-fc-101"]!.margin).toBe(6);
  });
});
