"use server";

// Every write goes through this file. Each action checks the owner session on
// the server before touching the database; hiding a button is not authorization.

import { randomUUID } from "node:crypto";
import { parseComponentsCsv, type CsvRowError } from "@/lib/csv";
import {
  isActionStatus, validateActionInput, validateComponentInput, validatePlanInput, type FieldError,
} from "@/lib/validation";
import type { ActionInput, ComponentInput, Dataset, PlanInput } from "@/lib/types";
import { isOwner, signIn, signOut } from "./auth";
import { getDb, type Db } from "./db";
import {
  addAction, deleteComponent, isSchemaMissingError, loadDataset, resetDemoData, setActionStatus, updatePlan,
  upsertComponents,
} from "./repo";

export type ActionResult =
  | { ok: true; dataset: Dataset; message?: string }
  | { ok: false; error: string; fieldErrors?: FieldError[]; csvErrors?: CsvRowError[] };

const UNAUTHORIZED: ActionResult = { ok: false, error: "Not authorized. Sign in as the owner to save changes." };
const NO_DATABASE: ActionResult = { ok: false, error: "No database is configured on this deployment, so nothing can be saved." };

function failure(error: unknown): ActionResult {
  if (isSchemaMissingError(error)) {
    return { ok: false, error: "The theta23_space schema does not exist yet. Apply the migration first (npm run db:migrate)." };
  }
  console.error("Write failed:", error instanceof Error ? error.message : "unknown error");
  return { ok: false, error: "The change could not be saved. Nothing was modified." };
}

/** Authorizes, loads the current dataset, runs the write, and returns fresh data. */
async function write(
  run: (db: Db, current: Dataset) => Promise<ActionResult | { message?: string } | void>,
): Promise<ActionResult> {
  if (!(await isOwner())) return UNAUTHORIZED;
  const db = getDb();
  if (!db) return NO_DATABASE;
  try {
    const current = await loadDataset(db);
    if (!current) return { ok: false, error: "The database has no mission yet. Use Reset Demo Data to load the demo dataset." };
    const outcome = await run(db, current);
    if (outcome && "ok" in outcome) return outcome;
    const dataset = await loadDataset(db);
    if (!dataset) return { ok: false, error: "The mission could not be reloaded." };
    return { ok: true, dataset, message: outcome?.message };
  } catch (error) {
    return failure(error);
  }
}

export async function saveComponentAction(input: ComponentInput): Promise<ActionResult> {
  return write(async (db, current) => {
    const checked = validateComponentInput(input, current);
    if (!checked.ok) return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: checked.errors };
    await upsertComponents(db, current.mission.id, [checked.value], randomUUID);
  });
}

export async function deleteComponentAction(componentId: string): Promise<ActionResult> {
  return write(async (db, current) => {
    if (!current.components.some((c) => c.id === componentId)) return { ok: false, error: "Unknown component." };
    await deleteComponent(db, componentId);
  });
}

/** The server re-parses and re-validates the file; the browser preview is never trusted. */
export async function importCsvAction(csvText: string): Promise<ActionResult> {
  return write(async (db, current) => {
    if (typeof csvText !== "string") return { ok: false, error: "No file content received." };
    const parsed = parseComponentsCsv(csvText, current);
    if (!parsed.valid) {
      return { ok: false, error: "Import rejected. No rows were imported.", csvErrors: parsed.errors };
    }
    const { created, updated } = await upsertComponents(db, current.mission.id, parsed.rows.map((r) => r.input), randomUUID);
    return { message: `Imported ${created + updated} components: ${created} created, ${updated} updated.` };
  });
}

export async function savePlanAction(input: PlanInput): Promise<ActionResult> {
  return write(async (db, current) => {
    const checked = validatePlanInput(input, current);
    if (!checked.ok) return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: checked.errors };
    await updatePlan(db, current.mission.id, checked.value);
  });
}

export async function addActionRecordAction(input: ActionInput): Promise<ActionResult> {
  return write(async (db, current) => {
    const checked = validateActionInput(input, current);
    if (!checked.ok) return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: checked.errors };
    await addAction(db, checked.value, randomUUID());
  });
}

export async function setActionStatusAction(actionId: string, status: string): Promise<ActionResult> {
  return write(async (db, current) => {
    if (!isActionStatus(status)) return { ok: false, error: "Unknown status." };
    if (!current.actions.some((a) => a.id === actionId)) return { ok: false, error: "Unknown action record." };
    await setActionStatus(db, actionId, status);
  });
}

/** Restores the illustrative dataset. Affects only theta23_space tables. */
export async function resetDemoDataAction(): Promise<ActionResult> {
  if (!(await isOwner())) return UNAUTHORIZED;
  const db = getDb();
  if (!db) return NO_DATABASE;
  try {
    await resetDemoData(db);
    const dataset = await loadDataset(db);
    if (!dataset) return { ok: false, error: "The mission could not be reloaded." };
    return { ok: true, dataset, message: "Demo data restored." };
  } catch (error) {
    return failure(error);
  }
}

export async function signInAction(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return signIn(password);
}

export async function signOutAction(): Promise<void> {
  await signOut();
}
