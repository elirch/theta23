// Input validation shared by the server actions, the browser sandbox and CSV import.

import { isIsoDate } from "./dates";
import {
  ACTION_STATUSES, ACTION_TYPES,
  type ActionInput, type ActionStatus, type ActionType, type ComponentInput, type Dataset, type PlanInput,
} from "./types";

export interface FieldError {
  field: string;
  message: string;
}
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const MAX_TEXT = 200;
const MAX_NOTES = 1000;
export const MAX_DAYS = 3650;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function isWholeNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/** Validates a component against the dataset's locations, routes and milestones. */
export function validateComponentInput(raw: ComponentInput, dataset: Dataset): Validated<ComponentInput> {
  const errors: FieldError[] = [];
  const partNumber = text(raw.partNumber);
  const description = text(raw.description);
  const subsystem = text(raw.subsystem);
  const supplierName = text(raw.supplierName);
  const notes = text(raw.notes);

  if (!partNumber) errors.push({ field: "partNumber", message: "Part number is required." });
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(partNumber))
    errors.push({ field: "partNumber", message: "Part number must be 2–40 letters, digits, dots, dashes or underscores." });
  if (!description) errors.push({ field: "description", message: "Description is required." });
  if (!subsystem) errors.push({ field: "subsystem", message: "Subsystem is required." });
  if (!supplierName) errors.push({ field: "supplierName", message: "Supplier name is required." });
  for (const [field, value] of [["description", description], ["subsystem", subsystem], ["supplierName", supplierName]] as const) {
    if (value.length > MAX_TEXT) errors.push({ field, message: `Must be ${MAX_TEXT} characters or fewer.` });
  }
  if (notes.length > MAX_NOTES) errors.push({ field: "notes", message: `Notes must be ${MAX_NOTES} characters or fewer.` });

  const location = dataset.locations.find((l) => l.id === raw.supplierLocationId);
  if (!location) errors.push({ field: "supplierLocationId", message: "Choose a supplier location." });
  else if (location.type !== "supplier")
    errors.push({ field: "supplierLocationId", message: `${location.code} is a ${location.type.replace("_", " ")}, not a supplier location.` });

  const routeId = raw.routeId || null;
  if (routeId !== null) {
    const route = dataset.routes.find((r) => r.id === routeId);
    if (!route) errors.push({ field: "routeId", message: "Unknown route." });
    else if (location && route.locationIds[0] !== location.id) {
      const start = dataset.locations.find((l) => l.id === route.locationIds[0]);
      errors.push({
        field: "routeId",
        message: `Route ${route.code} starts at ${start ? start.code : "another location"}, not at supplier location ${location.code}. Choose a route that starts at the supplier.`,
      });
    }
  }

  const milestoneId = raw.milestoneId || null;
  if (milestoneId !== null && !dataset.milestones.some((m) => m.id === milestoneId))
    errors.push({ field: "milestoneId", message: "Unknown milestone." });

  const baselineArrivalDate = raw.baselineArrivalDate || null;
  if (baselineArrivalDate !== null && !isIsoDate(baselineArrivalDate))
    errors.push({ field: "baselineArrivalDate", message: "Baseline arrival must be a valid date (YYYY-MM-DD)." });

  const preparationDays = raw.preparationDays;
  if (preparationDays !== null) {
    if (!isWholeNumber(preparationDays)) errors.push({ field: "preparationDays", message: "Preparation days must be a whole number." });
    else if (preparationDays < 0) errors.push({ field: "preparationDays", message: "Preparation days cannot be negative." });
    else if (preparationDays > MAX_DAYS) errors.push({ field: "preparationDays", message: `Preparation days cannot exceed ${MAX_DAYS}.` });
  }

  if (typeof raw.isSingleSource !== "boolean")
    errors.push({ field: "isSingleSource", message: "Single-source must be true or false." });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      partNumber, description, subsystem, supplierName, notes,
      supplierLocationId: raw.supplierLocationId,
      routeId, milestoneId, baselineArrivalDate, preparationDays,
      isSingleSource: raw.isSingleSource,
    },
  };
}

export function validatePlanInput(raw: PlanInput, dataset: Dataset): Validated<PlanInput> {
  const errors: FieldError[] = [];
  if (!isIsoDate(raw.analysisDate)) errors.push({ field: "analysisDate", message: "Analysis date must be a valid date." });

  const ordered = [...dataset.milestones].sort((a, b) => a.sequence - b.sequence);
  const byId = new Map(raw.milestones.map((m) => [m.id, m]));
  if (raw.milestones.length !== ordered.length || ordered.some((m) => !byId.has(m.id))) {
    return { ok: false, errors: [{ field: "milestones", message: "Milestone list does not match the mission." }] };
  }
  let previous: { name: string; date: string } | null = null;
  ordered.forEach((m, i) => {
    const input = byId.get(m.id);
    if (!input) return;
    const f = (name: string) => `${m.id}.${name}`;
    if (!isIsoDate(input.scheduledDate)) {
      errors.push({ field: f("scheduledDate"), message: `${m.name}: scheduled date must be a valid date.` });
    } else {
      if (previous && input.scheduledDate < previous.date)
        errors.push({ field: f("scheduledDate"), message: `${m.name} cannot be scheduled before ${previous.name}.` });
      previous = { name: m.name, date: input.scheduledDate };
      if (input.alternativeDate !== null) {
        if (!isIsoDate(input.alternativeDate))
          errors.push({ field: f("alternativeDate"), message: `${m.name}: alternative date must be a valid date.` });
        else if (input.alternativeDate <= input.scheduledDate)
          errors.push({ field: f("alternativeDate"), message: `${m.name}: an alternative date must be later than the original scheduled date.` });
      }
    }
    if (i > 0) {
      const days = input.minDaysAfterPrevious;
      if (!isWholeNumber(days) || days < 0 || days > MAX_DAYS)
        errors.push({ field: f("minDaysAfterPrevious"), message: `${m.name}: the interval after the preceding milestone must be a whole number of days, 0 or more.` });
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      analysisDate: raw.analysisDate,
      milestones: ordered.map((m, i) => {
        const input = byId.get(m.id)!;
        return {
          id: m.id,
          scheduledDate: input.scheduledDate,
          alternativeDate: input.alternativeDate || null,
          minDaysAfterPrevious: i === 0 ? null : input.minDaysAfterPrevious,
        };
      }),
    },
  };
}

export function validateActionInput(raw: ActionInput, dataset: Dataset): Validated<ActionInput> {
  const errors: FieldError[] = [];
  const owner = text(raw.owner);
  const note = text(raw.note);
  if (!dataset.components.some((c) => c.id === raw.componentId))
    errors.push({ field: "componentId", message: "Unknown component." });
  if (!(ACTION_TYPES as readonly string[]).includes(raw.actionType))
    errors.push({ field: "actionType", message: "Choose an action type." });
  if (!owner) errors.push({ field: "owner", message: "Owner is required." });
  else if (owner.length > 80) errors.push({ field: "owner", message: "Owner must be 80 characters or fewer." });
  if (note.length > MAX_NOTES) errors.push({ field: "note", message: `Note must be ${MAX_NOTES} characters or fewer.` });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { componentId: raw.componentId, actionType: raw.actionType as ActionType, owner, note } };
}

export function isActionStatus(v: unknown): v is ActionStatus {
  return typeof v === "string" && (ACTION_STATUSES as readonly string[]).includes(v);
}

export interface CustomScenarioInput {
  targetType: "supplier_location" | "route";
  targetId: string;
  delayDays: number;
  description: string;
}

export function validateCustomScenario(raw: CustomScenarioInput, dataset: Dataset): Validated<CustomScenarioInput> {
  const errors: FieldError[] = [];
  if (raw.targetType === "supplier_location") {
    const loc = dataset.locations.find((l) => l.id === raw.targetId);
    if (!loc || loc.type !== "supplier") errors.push({ field: "targetId", message: "Choose a supplier location." });
  } else if (raw.targetType === "route") {
    if (!dataset.routes.some((r) => r.id === raw.targetId)) errors.push({ field: "targetId", message: "Choose a route." });
  } else {
    errors.push({ field: "targetType", message: "Choose a supplier location or a route." });
  }
  if (!isWholeNumber(raw.delayDays) || raw.delayDays < 0)
    errors.push({ field: "delayDays", message: "Delay must be a whole number of days, 0 or more." });
  else if (raw.delayDays > MAX_DAYS) errors.push({ field: "delayDays", message: `Delay cannot exceed ${MAX_DAYS} days.` });
  const description = text(raw.description);
  if (description.length > 200) errors.push({ field: "description", message: "Description must be 200 characters or fewer." });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { ...raw, description } };
}
