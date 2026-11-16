import type { MilestoneStatus } from "@/lib/schedule";

export interface StatusMeta {
  label: string;
  text: string;
  border: string;
  bg: string;
  hex: string;
}

export const STATUS_META: Record<MilestoneStatus, StatusMeta> = {
  WITHIN_PLAN: { label: "WITHIN PLAN", text: "text-accent", border: "border-accent/40", bg: "bg-accent/10", hex: "#56c8e0" },
  TIGHT_MARGIN: { label: "TIGHT MARGIN", text: "text-tight", border: "border-tight/50", bg: "bg-tight/10", hex: "#f2b441" },
  PROJECTED_MISS: { label: "PROJECTED MISS", text: "text-miss", border: "border-miss/50", bg: "bg-miss/10", hex: "#f06464" },
  UNKNOWN: { label: "UNKNOWN", text: "text-unknown", border: "border-unknown/40", bg: "bg-unknown/10", hex: "#8b97ab" },
  UNRESOLVED: { label: "UNRESOLVED", text: "text-unknown", border: "border-unknown/40", bg: "bg-unknown/10", hex: "#8b97ab" },
};

const SEVERITY: Record<MilestoneStatus, number> = {
  PROJECTED_MISS: 4, TIGHT_MARGIN: 3, UNKNOWN: 2, UNRESOLVED: 2, WITHIN_PLAN: 1,
};

/** The most severe status in a list; null for an empty list. */
export function worstStatus<T extends MilestoneStatus>(statuses: T[]): T | null {
  let worst: T | null = null;
  for (const s of statuses) if (worst === null || SEVERITY[s] > SEVERITY[worst]) worst = s;
  return worst;
}

export function marginTextClass(margin: number | null): string {
  if (margin === null) return "text-unknown";
  if (margin < 0) return "text-miss";
  if (margin <= 7) return "text-tight";
  return "text-ink";
}
