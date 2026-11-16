// CSV import for the component ledger. Parsing uses Papa Parse; validation is
// all-or-nothing: a single invalid row rejects the whole file.

import Papa from "papaparse";
import { validateComponentInput } from "./validation";
import type { ComponentInput, Dataset } from "./types";

export const CSV_COLUMNS = [
  "partNumber", "description", "subsystem", "supplierLocationCode", "supplierName", "routeCode",
  "milestoneCode", "baselineArrivalDate", "preparationDays", "isSingleSource", "notes",
] as const;
type Column = (typeof CSV_COLUMNS)[number];
const REQUIRED: Column[] = CSV_COLUMNS.filter((c) => c !== "notes");

export const MAX_CSV_ROWS = 500;
export const MAX_CSV_BYTES = 512_000;

export interface CsvRowError {
  /** 1-based line in the file (header is line 1); 0 for file-level problems. */
  line: number;
  column?: string;
  message: string;
}

export interface CsvPreviewRow {
  line: number;
  action: "create" | "update";
  input: ComponentInput;
}

export interface CsvParseResult {
  valid: boolean;
  rows: CsvPreviewRow[];
  errors: CsvRowError[];
  created: number;
  updated: number;
}

const FIELD_TO_COLUMN: Record<string, Column> = {
  supplierLocationId: "supplierLocationCode",
  routeId: "routeCode",
  milestoneId: "milestoneCode",
};

function parseBoolean(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return null;
}

function codes(items: { code: string }[]): string {
  return items.map((i) => i.code).join(", ");
}

export function parseComponentsCsv(csvText: string, dataset: Dataset): CsvParseResult {
  const errors: CsvRowError[] = [];
  const rows: CsvPreviewRow[] = [];
  const fail = (): CsvParseResult => ({ valid: false, rows: [], errors, created: 0, updated: 0 });

  if (csvText.length > MAX_CSV_BYTES) {
    errors.push({ line: 0, message: `File is too large (limit ${Math.round(MAX_CSV_BYTES / 1000)} kB).` });
    return fail();
  }
  const parsed = Papa.parse<Record<string, string>>(csvText.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const header = parsed.meta.fields ?? [];
  if (header.length === 0) {
    errors.push({ line: 0, message: "The file is empty or has no header row." });
    return fail();
  }
  for (const col of CSV_COLUMNS) {
    if (!header.includes(col)) errors.push({ line: 1, column: col, message: `Missing column "${col}".` });
  }
  for (const col of header) {
    if (!(CSV_COLUMNS as readonly string[]).includes(col))
      errors.push({ line: 1, column: col, message: `Unexpected column "${col}". Expected: ${CSV_COLUMNS.join(", ")}.` });
  }
  if (errors.length > 0) return fail();

  for (const e of parsed.errors) {
    errors.push({ line: (e.row ?? 0) + 2, message: `Malformed CSV: ${e.message}.` });
  }
  if (parsed.data.length === 0) errors.push({ line: 0, message: "The file has a header but no component rows." });
  if (parsed.data.length > MAX_CSV_ROWS) errors.push({ line: 0, message: `Too many rows (limit ${MAX_CSV_ROWS}).` });
  if (errors.length > 0) return fail();

  const existing = new Set(dataset.components.map((c) => c.partNumber.toLowerCase()));
  const seen = new Map<string, number>();

  parsed.data.forEach((record, index) => {
    const line = index + 2;
    const rowErrors: CsvRowError[] = [];
    const get = (c: Column) => (record[c] ?? "").trim();

    for (const col of REQUIRED) {
      if (get(col) === "") rowErrors.push({ line, column: col, message: `${col} is required.` });
    }

    const locCode = get("supplierLocationCode");
    const location = dataset.locations.find((l) => l.code.toLowerCase() === locCode.toLowerCase());
    if (locCode && !location)
      rowErrors.push({
        line, column: "supplierLocationCode",
        message: `Unknown location code "${locCode}". Supplier locations: ${codes(dataset.locations.filter((l) => l.type === "supplier"))}.`,
      });

    const routeCode = get("routeCode");
    const route = dataset.routes.find((r) => r.code.toLowerCase() === routeCode.toLowerCase());
    if (routeCode && !route)
      rowErrors.push({ line, column: "routeCode", message: `Unknown route code "${routeCode}". Known routes: ${codes(dataset.routes)}.` });

    const msCode = get("milestoneCode");
    const milestone = dataset.milestones.find((m) => m.code.toLowerCase() === msCode.toLowerCase());
    if (msCode && !milestone)
      rowErrors.push({ line, column: "milestoneCode", message: `Unknown milestone code "${msCode}". Known milestones: ${codes(dataset.milestones)}.` });

    const prepText = get("preparationDays");
    let preparationDays: number | null = null;
    if (prepText) {
      if (!/^-?\d+$/.test(prepText))
        rowErrors.push({ line, column: "preparationDays", message: `preparationDays must be a whole number, got "${prepText}".` });
      else preparationDays = Number(prepText);
    }

    const boolText = get("isSingleSource");
    const isSingleSource = boolText ? parseBoolean(boolText) : null;
    if (boolText && isSingleSource === null)
      rowErrors.push({ line, column: "isSingleSource", message: `isSingleSource must be true or false, got "${boolText}".` });

    const partNumber = get("partNumber");
    if (partNumber) {
      const key = partNumber.toLowerCase();
      const firstLine = seen.get(key);
      if (firstLine !== undefined)
        rowErrors.push({ line, column: "partNumber", message: `Duplicate part number "${partNumber}" (first used on line ${firstLine}).` });
      else seen.set(key, line);
    }

    if (rowErrors.length === 0 && location && route && milestone && isSingleSource !== null) {
      const result = validateComponentInput(
        {
          partNumber,
          description: get("description"),
          subsystem: get("subsystem"),
          supplierName: get("supplierName"),
          supplierLocationId: location.id,
          routeId: route.id,
          milestoneId: milestone.id,
          baselineArrivalDate: get("baselineArrivalDate"),
          preparationDays,
          isSingleSource,
          notes: get("notes"),
        },
        dataset,
      );
      if (result.ok) {
        rows.push({ line, action: existing.has(partNumber.toLowerCase()) ? "update" : "create", input: result.value });
      } else {
        for (const e of result.errors)
          rowErrors.push({ line, column: FIELD_TO_COLUMN[e.field] ?? e.field, message: e.message });
      }
    }
    errors.push(...rowErrors);
  });

  if (errors.length > 0) return fail();
  return {
    valid: true,
    rows,
    errors: [],
    created: rows.filter((r) => r.action === "create").length,
    updated: rows.filter((r) => r.action === "update").length,
  };
}

/** Serialises components in the import format (used for the sample file). */
export function componentsToCsv(dataset: Dataset): string {
  const loc = new Map(dataset.locations.map((l) => [l.id, l.code]));
  const route = new Map(dataset.routes.map((r) => [r.id, r.code]));
  const ms = new Map(dataset.milestones.map((m) => [m.id, m.code]));
  const data = dataset.components.map((c) => [
    c.partNumber, c.description, c.subsystem, loc.get(c.supplierLocationId) ?? "", c.supplierName,
    c.routeId ? route.get(c.routeId) ?? "" : "", c.milestoneId ? ms.get(c.milestoneId) ?? "" : "",
    c.baselineArrivalDate ?? "", c.preparationDays === null ? "" : String(c.preparationDays),
    c.isSingleSource ? "true" : "false", c.notes,
  ]);
  return Papa.unparse({ fields: [...CSV_COLUMNS], data }, { newline: "\n" }) + "\n";
}
