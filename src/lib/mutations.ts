// Pure dataset updates. The browser sandbox applies these to in-memory state;
// the server applies the equivalent SQL (see src/server/repo.ts). Inputs are
// expected to be validated already.

import type { ActionInput, ActionRecord, ActionStatus, ComponentInput, Dataset, PlanInput } from "./types";

/** Upsert by part number (case-insensitive) within the mission. */
export function applyComponentUpserts(dataset: Dataset, inputs: ComponentInput[], newId: () => string): Dataset {
  const components = [...dataset.components];
  for (const input of inputs) {
    const index = components.findIndex((c) => c.partNumber.toLowerCase() === input.partNumber.toLowerCase());
    const existing = index >= 0 ? components[index] : undefined;
    if (existing) components[index] = { ...existing, ...input, partNumber: existing.partNumber };
    else components.push({ ...input, id: newId(), missionId: dataset.mission.id });
  }
  return { ...dataset, components };
}

export function applyComponentDelete(dataset: Dataset, componentId: string): Dataset {
  return {
    ...dataset,
    components: dataset.components.filter((c) => c.id !== componentId),
    actions: dataset.actions.filter((a) => a.componentId !== componentId),
  };
}

export function applyPlan(dataset: Dataset, plan: PlanInput): Dataset {
  const byId = new Map(plan.milestones.map((m) => [m.id, m]));
  return {
    ...dataset,
    mission: { ...dataset.mission, analysisDate: plan.analysisDate },
    milestones: dataset.milestones.map((m) => {
      const p = byId.get(m.id);
      return p
        ? { ...m, scheduledDate: p.scheduledDate, alternativeDate: p.alternativeDate, minDaysAfterPrevious: p.minDaysAfterPrevious }
        : m;
    }),
  };
}

export function applyActionAdd(dataset: Dataset, input: ActionInput, id: string, createdAt: string): Dataset {
  const record: ActionRecord = { ...input, id, status: "open", createdAt };
  return { ...dataset, actions: [...dataset.actions, record] };
}

export function applyActionStatus(dataset: Dataset, actionId: string, status: ActionStatus): Dataset {
  return { ...dataset, actions: dataset.actions.map((a) => (a.id === actionId ? { ...a, status } : a)) };
}
