// Deterministic readiness and schedule-margin engine.
// Pure functions only: no persistence, no UI, no wall clock.
//
// This is a simplified dependency model, not a full engineering schedule.

import { addDays, diffDays, maxDate } from "./dates";
import type { Component, Dataset, IsoDate, Milestone, Scenario } from "./types";

/** Demo planning convention — not an industry standard. */
export const TIGHT_MARGIN_THRESHOLD_DAYS = 7;

export type Status = "WITHIN_PLAN" | "TIGHT_MARGIN" | "PROJECTED_MISS" | "UNKNOWN";
export type MilestoneStatus = Status | "UNRESOLVED";

/** The part of a scenario that the engine needs. */
export type ScenarioEffect = Pick<Scenario, "targetType" | "targetId" | "delayDays">;

export function statusForMargin(margin: number | null): Status {
  if (margin === null) return "UNKNOWN";
  if (margin < 0) return "PROJECTED_MISS";
  if (margin <= TIGHT_MARGIN_THRESHOLD_DAYS) return "TIGHT_MARGIN";
  return "WITHIN_PLAN";
}

export function scenarioTargets(component: Component, scenario: ScenarioEffect | null): boolean {
  if (!scenario) return false;
  return scenario.targetType === "supplier_location"
    ? component.supplierLocationId === scenario.targetId
    : component.routeId === scenario.targetId;
}

export type MissingInput = "baselineArrivalDate" | "preparationDays" | "milestone";

export interface ComponentResult {
  componentId: string;
  /** The active scenario targets this component (its supplier location or route). */
  targeted: boolean;
  /** Delay applied by the active scenario; 0 when not targeted. */
  delayDays: number;
  adjustedArrival: IsoDate | null;
  readiness: IsoDate | null;
  milestoneId: string | null;
  /** Assigned milestone's ORIGINAL scheduled date − readiness. */
  margin: number | null;
  status: Status;
  /** Known alternative milestone date − readiness, shown separately. */
  alternativeMargin: number | null;
  missing: MissingInput[];
}

export function evaluateComponent(
  component: Component,
  milestone: Milestone | undefined,
  scenario: ScenarioEffect | null,
): ComponentResult {
  const targeted = scenarioTargets(component, scenario);
  // Only the scenario assumption adds delay. The single-source flag never does.
  const delayDays = targeted && scenario ? scenario.delayDays : 0;

  const missing: MissingInput[] = [];
  if (component.baselineArrivalDate === null) missing.push("baselineArrivalDate");
  if (component.preparationDays === null) missing.push("preparationDays");
  if (!milestone) missing.push("milestone");

  const adjustedArrival =
    component.baselineArrivalDate === null ? null : addDays(component.baselineArrivalDate, delayDays);
  const readiness =
    adjustedArrival === null || component.preparationDays === null
      ? null
      : addDays(adjustedArrival, component.preparationDays);
  const margin = readiness === null || !milestone ? null : diffDays(milestone.scheduledDate, readiness);
  const alternativeMargin =
    readiness === null || !milestone || milestone.alternativeDate === null
      ? null
      : diffDays(milestone.alternativeDate, readiness);

  return {
    componentId: component.id,
    targeted,
    delayDays,
    adjustedArrival,
    readiness,
    milestoneId: milestone ? milestone.id : null,
    margin,
    status: statusForMargin(margin),
    alternativeMargin,
    missing,
  };
}

export type UnresolvedReason =
  /** Readiness is after the original date and no usable alternative date is known. */
  | { kind: "missed_no_usable_alternative"; alternativeTooEarly: boolean }
  /** The preceding milestone has no planned occurrence. */
  | { kind: "predecessor_unresolved"; milestoneId: string }
  /** Assigned components lack inputs, so readiness cannot be fully calculated. */
  | { kind: "unknown_components"; componentIds: string[] }
  /** A non-first milestone has no configured interval after its predecessor. */
  | { kind: "missing_interval" };

export type LimitingDependency =
  | { kind: "component"; componentId: string; date: IsoDate }
  | { kind: "predecessor"; milestoneId: string; date: IsoDate };

export interface MilestoneResult {
  milestoneId: string;
  scheduledDate: IsoDate;
  /** Latest readiness among assigned components with complete inputs. */
  componentReadiness: IsoDate | null;
  /** Preceding planned occurrence + interval; null when that is not known. */
  predecessorConstraint: IsoDate | null;
  /** Earliest readiness; null when it cannot be calculated. */
  readiness: IsoDate | null;
  /**
   * When readiness cannot be calculated: the earliest date it could possibly
   * be, from what IS known. A bound, never a plan.
   */
  lowerBound: IsoDate | null;
  /** Original scheduled date − readiness. */
  margin: number | null;
  status: MilestoneStatus;
  /** True when a miss is proven by a known dependency although readiness is unresolved. */
  knownBreach: boolean;
  /** For a known breach: scheduled date − lower bound ("at least this late"). */
  knownBreachMargin: number | null;
  alternativeDate: IsoDate | null;
  /** Alternative date − readiness; null when either is unknown. */
  alternativeMargin: number | null;
  /** null when no alternative exists or readiness is unknown. */
  alternativeUsable: boolean | null;
  /** The date downstream planning uses; null means downstream timing is unresolved. */
  plannedOccurrence: IsoDate | null;
  plannedVia: "scheduled" | "alternative" | null;
  unresolvedReasons: UnresolvedReason[];
  /** Every dependency that sets readiness (or the lower bound), including ties. */
  limiting: LimitingDependency[];
}

export interface Evaluation {
  components: Record<string, ComponentResult>;
  milestones: MilestoneResult[];
  summary: {
    /** First milestone scheduled on or after the analysis date; null if none. */
    nextMilestoneId: string | null;
    /** Lowest margin among milestones whose margin can be calculated. */
    lowestMargin: { milestoneId: string; margin: number } | null;
    /** Milestones whose ORIGINAL date is projected to be missed. */
    missedMilestoneIds: string[];
    /** Milestones without a planned occurrence. */
    unresolvedMilestoneIds: string[];
    /** Components whose dates the scenario actually moves. */
    affectedComponentIds: string[];
  };
}

export function sortMilestones(milestones: Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => a.sequence - b.sequence);
}

export function evaluate(dataset: Dataset, scenario: ScenarioEffect | null): Evaluation {
  const milestones = sortMilestones(dataset.milestones);
  const milestoneById = new Map(milestones.map((m) => [m.id, m]));

  const components: Record<string, ComponentResult> = {};
  for (const c of dataset.components) {
    components[c.id] = evaluateComponent(
      c,
      c.milestoneId ? milestoneById.get(c.milestoneId) : undefined,
      scenario,
    );
  }

  const results: MilestoneResult[] = [];
  milestones.forEach((m, index) => {
    const prev = index > 0 ? results[index - 1] : undefined;
    const assigned = dataset.components.filter((c) => c.milestoneId === m.id);
    const reasons: UnresolvedReason[] = [];

    const known: { componentId: string; date: IsoDate }[] = [];
    const unknownIds: string[] = [];
    for (const c of assigned) {
      const r = components[c.id];
      if (r && r.readiness !== null) known.push({ componentId: c.id, date: r.readiness });
      else unknownIds.push(c.id);
    }
    if (unknownIds.length > 0) reasons.push({ kind: "unknown_components", componentIds: unknownIds });
    const componentReadiness = maxDate(known.map((k) => k.date));

    // Predecessor: use its planned occurrence when known; otherwise only a bound.
    let predecessorConstraint: IsoDate | null = null;
    let predecessorBound: IsoDate | null = null;
    if (prev) {
      const interval = m.minDaysAfterPrevious;
      if (interval === null) reasons.push({ kind: "missing_interval" });
      if (prev.plannedOccurrence !== null) {
        if (interval !== null) predecessorConstraint = addDays(prev.plannedOccurrence, interval);
        predecessorBound = addDays(prev.plannedOccurrence, interval ?? 0);
      } else {
        reasons.push({ kind: "predecessor_unresolved", milestoneId: prev.milestoneId });
        // The predecessor cannot occur before its scheduled date nor before it is ready.
        const earliestOccurrence = maxDate(
          [prev.scheduledDate, prev.readiness ?? prev.lowerBound].filter((d): d is IsoDate => d !== null),
        );
        if (earliestOccurrence !== null) predecessorBound = addDays(earliestOccurrence, interval ?? 0);
      }
    }

    const calculable = reasons.length === 0;
    const candidates: LimitingDependency[] = known.map((k) => ({ kind: "component", ...k }));
    if (prev && predecessorBound !== null) {
      candidates.push({ kind: "predecessor", milestoneId: prev.milestoneId, date: predecessorBound });
    }
    const latest = maxDate(candidates.map((c) => c.date));
    const limiting = latest === null ? [] : candidates.filter((c) => c.date === latest);

    const base = {
      milestoneId: m.id,
      scheduledDate: m.scheduledDate,
      componentReadiness,
      predecessorConstraint,
      alternativeDate: m.alternativeDate,
      limiting,
    };

    if (calculable && latest === null) {
      // Nothing constrains this milestone: no margin to report, nothing blocks its date.
      results.push({
        ...base, readiness: null, lowerBound: null, margin: null, status: "UNKNOWN",
        knownBreach: false, knownBreachMargin: null, alternativeMargin: null, alternativeUsable: null,
        plannedOccurrence: m.scheduledDate, plannedVia: "scheduled", unresolvedReasons: [],
      });
      return;
    }

    if (calculable && latest !== null) {
      const readiness = latest;
      const margin = diffDays(m.scheduledDate, readiness);
      const alternativeMargin = m.alternativeDate === null ? null : diffDays(m.alternativeDate, readiness);
      const alternativeUsable = alternativeMargin === null ? null : alternativeMargin >= 0;
      if (margin >= 0) {
        results.push({
          ...base, readiness, lowerBound: null, margin, status: statusForMargin(margin),
          knownBreach: false, knownBreachMargin: null, alternativeMargin, alternativeUsable,
          plannedOccurrence: m.scheduledDate, plannedVia: "scheduled", unresolvedReasons: [],
        });
      } else if (alternativeUsable && m.alternativeDate !== null) {
        // The original commitment stays a PROJECTED MISS; the alternative only
        // gives downstream planning a date to work from.
        results.push({
          ...base, readiness, lowerBound: null, margin, status: "PROJECTED_MISS",
          knownBreach: false, knownBreachMargin: null, alternativeMargin, alternativeUsable,
          plannedOccurrence: m.alternativeDate, plannedVia: "alternative", unresolvedReasons: [],
        });
      } else {
        // Never assume a missed milestone can simply happen the next day.
        results.push({
          ...base, readiness, lowerBound: null, margin, status: "PROJECTED_MISS",
          knownBreach: false, knownBreachMargin: null, alternativeMargin, alternativeUsable,
          plannedOccurrence: null, plannedVia: null,
          unresolvedReasons: [
            { kind: "missed_no_usable_alternative", alternativeTooEarly: m.alternativeDate !== null },
          ],
        });
      }
      return;
    }

    // Not calculable. Report what is known without pretending it is a plan.
    const knownBreach = latest !== null && latest > m.scheduledDate;
    const onlyUnknownInputs = reasons.every((r) => r.kind === "unknown_components" || r.kind === "missing_interval");
    results.push({
      ...base,
      readiness: null,
      lowerBound: latest,
      margin: null,
      status: knownBreach ? "PROJECTED_MISS" : onlyUnknownInputs ? "UNKNOWN" : "UNRESOLVED",
      knownBreach,
      knownBreachMargin: knownBreach && latest !== null ? diffDays(m.scheduledDate, latest) : null,
      alternativeMargin: null,
      alternativeUsable: null,
      plannedOccurrence: null,
      plannedVia: null,
      unresolvedReasons: reasons,
    });
  });

  const next = milestones
    .filter((m) => m.scheduledDate >= dataset.mission.analysisDate)
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? -1 : a.scheduledDate > b.scheduledDate ? 1 : a.sequence - b.sequence))[0];

  let lowestMargin: { milestoneId: string; margin: number } | null = null;
  for (const r of results) {
    if (r.margin !== null && (lowestMargin === null || r.margin < lowestMargin.margin)) {
      lowestMargin = { milestoneId: r.milestoneId, margin: r.margin };
    }
  }

  return {
    components,
    milestones: results,
    summary: {
      nextMilestoneId: next ? next.id : null,
      lowestMargin,
      missedMilestoneIds: results.filter((r) => r.status === "PROJECTED_MISS").map((r) => r.milestoneId),
      unresolvedMilestoneIds: results.filter((r) => r.plannedOccurrence === null).map((r) => r.milestoneId),
      affectedComponentIds: dataset.components
        .filter((c) => {
          const r = components[c.id];
          return r !== undefined && r.targeted && r.delayDays > 0;
        })
        .map((c) => c.id),
    },
  };
}
