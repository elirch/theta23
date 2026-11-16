// Date-only arithmetic in whole calendar days, always in UTC.
// No function here reads the wall clock or the local time zone.

import type { IsoDate } from "./types";

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict YYYY-MM-DD check that also rejects impossible dates (e.g. 2027-02-30). */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Days since the Unix epoch for a date-only value. */
export function toDayNumber(date: IsoDate): number {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Invalid ISO date: ${date}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function fromDayNumber(day: number): IsoDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** a − b in whole days. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return toDayNumber(a) - toDayNumber(b);
}

export function maxDate(dates: IsoDate[]): IsoDate | null {
  let best: IsoDate | null = null;
  for (const d of dates) if (best === null || d > best) best = d;
  return best;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parts(date: IsoDate): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Invalid ISO date: ${date}`);
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}

/** "Jun 25, 2027" */
export function formatDate(date: IsoDate | null | undefined): string {
  if (!date) return "—";
  const p = parts(date);
  return `${MONTHS_SHORT[p.m]} ${p.d}, ${p.y}`;
}

/** "Jun 25" */
export function formatDateShort(date: IsoDate | null | undefined): string {
  if (!date) return "—";
  const p = parts(date);
  return `${MONTHS_SHORT[p.m]} ${p.d}`;
}

/** "June 25" — used in plain-language sentences. */
export function formatDateProse(date: IsoDate): string {
  const p = parts(date);
  return `${MONTHS_LONG[p.m]} ${p.d}`;
}

/** "+9 d", "0 d", "−5 d" (true minus sign). */
export function formatMargin(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  if (days > 0) return `+${days} d`;
  if (days < 0) return `−${Math.abs(days)} d`;
  return "0 d";
}
