import type { CsvRowError } from "@/lib/csv";
import type { ActionInput, ActionStatus, ComponentInput, PlanInput } from "@/lib/types";
import type { FieldError } from "@/lib/validation";

export type OpResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: FieldError[]; csvErrors?: CsvRowError[] };

/** Every way the workspace can change planning inputs or the action log. */
export interface Ops {
  /** True when changes are saved to the database; false in the browser-only sandbox. */
  persistent: boolean;
  saveComponent(input: ComponentInput): Promise<OpResult>;
  deleteComponent(componentId: string): Promise<OpResult>;
  importCsv(csvText: string): Promise<OpResult>;
  savePlan(input: PlanInput): Promise<OpResult>;
  addAction(input: ActionInput): Promise<OpResult>;
  setActionStatus(actionId: string, status: ActionStatus): Promise<OpResult>;
}
