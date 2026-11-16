// Plain-language explanations. Every sentence is derived from engine results
// and inputs — nothing here estimates or scores.

import { formatDateProse } from "./dates";
import type { ComponentResult, Evaluation, MilestoneResult, ScenarioEffect } from "./schedule";
import type { Component, Dataset, Milestone } from "./types";

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

export function numberWord(n: number): string {
  return n >= 0 && n <= 20 ? (NUMBER_WORDS[n] as string) : String(n);
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function dayPhrase(n: number): string {
  return `${numberWord(n)} day${n === 1 ? "" : "s"}`;
}

/** "Launch Integration Cutoff" → "launch integration" */
function timingNoun(name: string): string {
  return name.toLowerCase().replace(/\s+(cutoff|review)$/, "");
}

function slotNoun(m: Milestone): string {
  return m.type === "test_campaign" ? "test slot" : "date";
}

export function scenarioCause(scenario: ScenarioEffect): string {
  return scenario.targetType === "supplier_location" ? "Supplier delay" : "Transport disruption";
}

export function explainComponent(
  component: Component,
  result: ComponentResult,
  milestone: Milestone | undefined,
  scenario: ScenarioEffect | null,
): string {
  if (result.missing.length > 0 || result.readiness === null || !milestone || result.margin === null) {
    const labels: Record<string, string> = {
      baselineArrivalDate: "a baseline arrival date",
      preparationDays: "preparation days",
      milestone: "an assigned milestone",
    };
    const list = result.missing.map((m) => labels[m]).join(" and ");
    return `Readiness cannot be calculated: this component is missing ${list}. Its status is UNKNOWN until the input is provided.`;
  }
  const thing = component.description.toLowerCase();
  const ms = `${formatDateProse(milestone.scheduledDate)} ${milestone.name.toLowerCase()}`;
  const relation =
    result.margin > 0
      ? `${dayPhrase(result.margin)} before the ${ms}`
      : result.margin === 0
        ? `on the same day as the ${ms}, leaving no margin`
        : `${dayPhrase(-result.margin)} after the ${ms}`;

  let text: string;
  if (scenario && result.targeted && result.delayDays > 0) {
    text = `${scenarioCause(scenario)} adds ${plural(result.delayDays, "day")}. The ${thing} becomes ready on ${formatDateProse(result.readiness)}, ${relation}.`;
  } else {
    const prep = component.preparationDays ?? 0;
    text = `The ${thing} is ready on ${formatDateProse(result.readiness)} (arrival plus ${plural(prep, "preparation day")}), ${relation}.`;
    if (scenario) text += " The active scenario does not change this component.";
  }
  if (result.margin < 0 && result.alternativeMargin !== null && milestone.alternativeDate) {
    text +=
      result.alternativeMargin >= 0
        ? ` Against the known alternative date of ${formatDateProse(milestone.alternativeDate)} it would have ${dayPhrase(result.alternativeMargin)} of margin; the original commitment is still missed.`
        : ` The known alternative date of ${formatDateProse(milestone.alternativeDate)} is also earlier than its readiness.`;
  }
  return text;
}

export function explainMilestone(
  milestone: Milestone,
  result: MilestoneResult,
  dataset: Dataset,
): string[] {
  const out: string[] = [];
  const ordered = [...dataset.milestones].sort((a, b) => a.sequence - b.sequence);
  const next = ordered[ordered.findIndex((m) => m.id === milestone.id) + 1];
  const byId = new Map(dataset.milestones.map((m) => [m.id, m]));
  const partById = new Map(dataset.components.map((c) => [c.id, c.partNumber]));

  for (const reason of result.unresolvedReasons) {
    if (reason.kind === "missed_no_usable_alternative") {
      const downstream = next
        ? ` Downstream ${timingNoun(next.name)} timing remains unresolved until an alternative slot is confirmed.`
        : "";
      out.push(`The original ${slotNoun(milestone)} is projected to be missed.${downstream}`);
      if (reason.alternativeTooEarly && milestone.alternativeDate && result.readiness) {
        out.push(
          `The alternative date of ${formatDateProse(milestone.alternativeDate)} is earlier than readiness on ${formatDateProse(result.readiness)}, so it cannot be used.`,
        );
      }
    } else if (reason.kind === "predecessor_unresolved") {
      const prev = byId.get(reason.milestoneId);
      out.push(
        `Timing is unresolved because ${prev ? prev.name : "the preceding milestone"} has no planned date. This milestone is not confirmed safe.`,
      );
    } else if (reason.kind === "unknown_components") {
      const parts = reason.componentIds.map((id) => partById.get(id) ?? id).join(", ");
      out.push(`Readiness cannot be fully calculated: ${parts} ${reason.componentIds.length === 1 ? "is" : "are"} missing planning inputs.`);
    } else {
      out.push("Readiness cannot be calculated: the interval after the preceding milestone is not set.");
    }
  }

  if (result.knownBreach && result.lowerBound && result.knownBreachMargin !== null) {
    out.push(
      `A known dependency already proves a miss: readiness is no earlier than ${formatDateProse(result.lowerBound)}, at least ${dayPhrase(-result.knownBreachMargin)} after the scheduled date.`,
    );
  } else if (result.readiness === null && result.lowerBound) {
    out.push(
      `From what is known, readiness is no earlier than ${formatDateProse(result.lowerBound)}. This is a lower bound, not a plan.`,
    );
  }

  if (result.plannedVia === "alternative" && result.alternativeDate && result.alternativeMargin !== null) {
    out.push(
      `Downstream planning uses the alternative date of ${formatDateProse(result.alternativeDate)} (${dayPhrase(result.alternativeMargin)} after readiness). The original ${formatDateProse(milestone.scheduledDate)} commitment remains a projected miss.`,
    );
  }
  return out;
}

/** Scenario-level notes: what the assumption does and does not imply. */
export function explainScenario(
  scenario: ScenarioEffect,
  dataset: Dataset,
  evaluation: Evaluation,
): string[] {
  const out: string[] = [];
  const affected = dataset.components.filter((c) => evaluation.summary.affectedComponentIds.includes(c.id));
  if (scenario.delayDays === 0) {
    out.push("This scenario adds 0 days, so no dates change.");
    return out;
  }
  if (scenario.targetType === "supplier_location") {
    const loc = dataset.locations.find((l) => l.id === scenario.targetId);
    out.push(
      `Every component supplied from ${loc ? loc.name : "this location"} arrives ${plural(scenario.delayDays, "day")} later than baseline.`,
    );
    out.push(
      "Changing the freight route cannot recover this delay: the hardware is not yet available to ship.",
    );
  } else {
    const route = dataset.routes.find((r) => r.id === scenario.targetId);
    out.push(
      `The delay applies to all components planned on ${route ? route.code : "this route"}, and only those. Components on other routes keep their baseline dates.`,
    );
  }
  if (affected.length === 0) out.push("No component currently depends on this target.");
  const single = affected.filter((c) => c.isSingleSource);
  if (single.length > 0) {
    out.push(
      `${single.map((c) => c.partNumber).join(", ")} ${single.length === 1 ? "is" : "are"} flagged single-source. The flag adds no delay by itself — the ${plural(scenario.delayDays, "day")} come from the scenario assumption — but it explains why substitution options are limited.`,
    );
  }
  return out;
}
