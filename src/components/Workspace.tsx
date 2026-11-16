"use client";

import { Database, FlaskConical, LogIn, LogOut, RefreshCcw, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { parseComponentsCsv } from "@/lib/csv";
import { applyActionAdd, applyActionStatus, applyComponentDelete, applyComponentUpserts, applyPlan } from "@/lib/mutations";
import { evaluate, TIGHT_MARGIN_THRESHOLD_DAYS } from "@/lib/schedule";
import { buildSeedDataset } from "@/lib/seed";
import type { Dataset, Scenario } from "@/lib/types";
import { validateActionInput, validateComponentInput, validatePlanInput } from "@/lib/validation";
import {
  addActionRecordAction, deleteComponentAction, importCsvAction, resetDemoDataAction, saveComponentAction,
  savePlanAction, setActionStatusAction, signInAction, signOutAction, type ActionResult,
} from "@/server/actions";
import type { AppState, DataSource } from "@/server/state";
import { ComponentDrawer } from "./ComponentDrawer";
import { Header } from "./Header";
import { ImpactPanel } from "./ImpactPanel";
import { Ledger } from "./Ledger";
import { MilestoneStrip } from "./MilestoneStrip";
import { ComponentFormModal, ConfirmModal, CsvImportModal, CustomScenarioModal, PlanEditorModal, SignInModal } from "./Modals";
import type { OpResult, Ops } from "./ops";
import type { Selection } from "./selection";
import { STATUS_META } from "./status";
import { SummaryMetrics } from "./SummaryMetrics";
import { Button } from "./ui";
import { MapLegend, WorldMap } from "./WorldMap";

type ModalState =
  | null
  | { kind: "custom" }
  | { kind: "component"; componentId: string | null }
  | { kind: "csv" }
  | { kind: "plan" }
  | { kind: "signin" }
  | { kind: "reset" };

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const SOURCE_NOTES: Record<Exclude<DataSource, "database">, string> = {
  bundled_no_database: "No database is configured on this deployment, so the bundled demo dataset is shown.",
  bundled_not_migrated: "The database is connected but the theta23_space migration has not been applied, so the bundled demo dataset is shown.",
  bundled_not_seeded: "The database is connected but holds no mission yet, so the bundled demo dataset is shown.",
  bundled_database_error: "The database could not be reached, so the bundled demo dataset is shown.",
};

export function Workspace({ initial }: { initial: AppState }) {
  const [dataset, setDataset] = useState<Dataset>(initial.dataset);
  const [source, setSource] = useState<DataSource>(initial.source);
  const [sandboxDirty, setSandboxDirty] = useState(false);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [hoverComponentId, setHoverComponentId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const persistent = initial.isOwner && source === "database";

  // Results are always derived from inputs; nothing calculated is stored.
  const baseline = useMemo(() => evaluate(dataset, null), [dataset]);
  const evaluation = useMemo(() => (scenario ? evaluate(dataset, scenario) : baseline), [dataset, scenario, baseline]);

  const closeModal = useCallback(() => setModal(null), []);
  const closeDrawer = useCallback(() => setSelection(null), []);
  const openComponent = useCallback((id: string) => setSelection({ kind: "component", id }), []);

  const ops: Ops = useMemo(() => {
    const fromServer = async (call: Promise<ActionResult>): Promise<OpResult> => {
      try {
        const r = await call;
        if (!r.ok) return r;
        setDataset(r.dataset);
        setSource("database");
        return { ok: true, message: r.message };
      } catch {
        return { ok: false, error: "The server could not be reached. Nothing was saved." };
      }
    };
    const local = (next: Dataset, message?: string): OpResult => {
      setDataset(next);
      setSandboxDirty(true);
      return { ok: true, message };
    };
    const invalid = (errors: { field: string; message: string }[]): OpResult => ({
      ok: false, error: "Please correct the highlighted fields.", fieldErrors: errors,
    });

    if (persistent) {
      return {
        persistent: true,
        saveComponent: (input) => fromServer(saveComponentAction(input)),
        deleteComponent: (id) => fromServer(deleteComponentAction(id)),
        importCsv: (text) => fromServer(importCsvAction(text)),
        savePlan: (input) => fromServer(savePlanAction(input)),
        addAction: (input) => fromServer(addActionRecordAction(input)),
        setActionStatus: (id, status) => fromServer(setActionStatusAction(id, status)),
      };
    }
    // Sandbox: same validation and the same pure updates, held in memory only.
    return {
      persistent: false,
      async saveComponent(input) {
        const checked = validateComponentInput(input, dataset);
        return checked.ok ? local(applyComponentUpserts(dataset, [checked.value], newId)) : invalid(checked.errors);
      },
      async deleteComponent(id) {
        return local(applyComponentDelete(dataset, id));
      },
      async importCsv(text) {
        const parsed = parseComponentsCsv(text, dataset);
        if (!parsed.valid) return { ok: false, error: "Import rejected. No rows were imported.", csvErrors: parsed.errors };
        return local(
          applyComponentUpserts(dataset, parsed.rows.map((r) => r.input), newId),
          `Imported ${parsed.rows.length} components into the sandbox: ${parsed.created} created, ${parsed.updated} updated.`,
        );
      },
      async savePlan(input) {
        const checked = validatePlanInput(input, dataset);
        return checked.ok ? local(applyPlan(dataset, checked.value)) : invalid(checked.errors);
      },
      async addAction(input) {
        const checked = validateActionInput(input, dataset);
        return checked.ok
          ? local(applyActionAdd(dataset, checked.value, newId(), new Date().toISOString().slice(0, 19) + "Z"))
          : invalid(checked.errors);
      },
      async setActionStatus(id, status) {
        return local(applyActionStatus(dataset, id, status));
      },
    };
  }, [persistent, dataset]);

  const selectScenario = (id: string | null) => {
    // Always evaluated from baseline inputs: switching never accumulates delay.
    setScenario(id ? dataset.scenarios.find((s) => s.id === id) ?? null : null);
  };

  const resetDemo = async (): Promise<string | null> => {
    if (initial.isOwner && source !== "bundled_no_database") {
      try {
        const r = await resetDemoDataAction();
        if (!r.ok) return r.error;
        setDataset(r.dataset);
        setSource("database");
      } catch {
        return "The server could not be reached. Nothing was changed.";
      }
    } else {
      setDataset(source === "database" ? initial.dataset : buildSeedDataset());
    }
    setSandboxDirty(false);
    setScenario(null);
    setSelection(null);
    setNotice("Demo data restored.");
    return null;
  };

  const signIn = async (password: string): Promise<string | null> => {
    try {
      const r = await signInAction(password);
      if (!r.ok) return r.error;
      window.location.reload();
      return null;
    } catch {
      return "The server could not be reached.";
    }
  };
  const signOut = async () => {
    await signOutAction().catch(() => undefined);
    window.location.reload();
  };

  const drawerComponent = selection?.kind === "component" ? dataset.components.find((c) => c.id === selection.id) : undefined;
  const editing = modal?.kind === "component" && modal.componentId ? dataset.components.find((c) => c.id === modal.componentId) ?? null : null;
  const serverReset = initial.isOwner && source !== "bundled_no_database";

  return (
    <div className="min-h-screen">
      <Header
        dataset={dataset} scenario={scenario} onSelectScenario={selectScenario}
        onCustom={() => setModal({ kind: "custom" })} onBaseline={() => setScenario(null)}
      />

      <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4">
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs ${persistent ? "border-accent/30 text-accent" : "border-line text-muted"}`} role="status">
          {persistent ? (
            <><ShieldCheck size={14} /> <span>Owner mode — edits, imports and action records are saved to the database.</span></>
          ) : (
            <>
              <FlaskConical size={14} className="shrink-0" />
              <span>
                {initial.isOwner ? "Signed in as owner, but changes cannot be saved yet. " : "Public demo — explore scenarios freely. "}
                Edits you make here stay in this browser tab (sandbox) and are not saved.
                {source !== "database" && ` ${SOURCE_NOTES[source]}`}
                {initial.isOwner && source === "bundled_not_seeded" && " Use Reset Demo Data below to load it into the database."}
              </span>
              {sandboxDirty && <span className="rounded border border-tight/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-tight">Unsaved sandbox changes</span>}
            </>
          )}
          {notice && <span className="text-ink">· {notice}</span>}
        </div>

        <SummaryMetrics dataset={dataset} evaluation={evaluation} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section aria-label="Dependency map" className="flex min-w-0 flex-col gap-3 self-start rounded-lg border border-line bg-panel p-3">
            <WorldMap
              dataset={dataset} evaluation={evaluation} scenario={scenario} selection={selection}
              highlightComponentId={hoverComponentId} onSelect={setSelection}
            />
            <div className="flex flex-wrap gap-1.5" aria-label="Planned routes">
              {dataset.routes.map((r) => {
                const comps = dataset.components.filter((c) => c.routeId === r.id);
                const hasMiss = comps.some((c) => evaluation.components[c.id]?.status === "PROJECTED_MISS");
                const hasTight = comps.some((c) => evaluation.components[c.id]?.status === "TIGHT_MARGIN");
                const active = selection?.kind === "route" && selection.id === r.id;
                const color = hasMiss ? STATUS_META.PROJECTED_MISS.hex : hasTight ? STATUS_META.TIGHT_MARGIN.hex : "#3f6f86";
                return (
                  <button
                    key={r.id} type="button" aria-pressed={active} title={r.name}
                    onClick={() => setSelection(active ? null : { kind: "route", id: r.id })}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] ${active ? "border-accent/60 bg-accent/10 text-ink" : "border-line text-muted hover:border-faint hover:text-ink"}`}
                  >
                    <span className="inline-block h-1.5 w-3 rounded-full" style={{ background: color }} />
                    {r.code}
                    <span className="num font-sans text-faint">{comps.length}</span>
                    {scenario?.targetType === "route" && scenario.targetId === r.id && <span className="num font-sans text-tight">+{scenario.delayDays} d</span>}
                  </button>
                );
              })}
            </div>
            <MapLegend />
          </section>

          <ImpactPanel
            dataset={dataset} evaluation={evaluation} baseline={baseline} scenario={scenario} selection={selection}
            onOpenComponent={openComponent} onHoverComponent={setHoverComponentId} onSelect={setSelection}
          />
        </div>

        <MilestoneStrip dataset={dataset} evaluation={evaluation} onEdit={() => setModal({ kind: "plan" })} onOpenComponent={openComponent} />

        <Ledger
          dataset={dataset} evaluation={evaluation}
          selectedComponentId={selection?.kind === "component" ? selection.id : null}
          onOpenComponent={openComponent} onHoverComponent={setHoverComponentId}
          onAdd={() => setModal({ kind: "component", componentId: null })} onImport={() => setModal({ kind: "csv" })}
        />

        <footer className="flex flex-col gap-4 rounded-lg border border-line bg-panel p-4 text-xs text-muted">
          <details>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted hover:text-ink">Scheduling assumptions and limits</summary>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
              <li>All suppliers, part numbers, routes and mission arrangements are illustrative. Geography is real; the business entities are fictional.</li>
              <li>Dates are whole calendar days in UTC. Readiness = baseline arrival + scenario delay + preparation days.</li>
              <li>Margins are measured against each milestone’s original scheduled date. An alternative date is reported separately and never hides an original miss.</li>
              <li>Status thresholds: more than {TIGHT_MARGIN_THRESHOLD_DAYS} days is within plan, 0–{TIGHT_MARGIN_THRESHOLD_DAYS} days is tight, below 0 is a projected miss. The {TIGHT_MARGIN_THRESHOLD_DAYS}-day threshold is a demo planning convention, not an industry standard.</li>
              <li>The interval after a milestone includes that campaign’s own duration and the follow-on preparation. A test start date is not treated as proof that testing is complete.</li>
              <li>A missed milestone is not assumed to happen the next day. Without a usable, known alternative date, downstream timing is unresolved.</li>
              <li>The Launch Integration Cutoff is not the launch date. This tool does not estimate launch delay, cost, or decision deadlines.</li>
              <li>A route is a planned physical path, not a verified commercial freight service. Single-source status adds no delay by itself.</li>
              <li>This is a simplified dependency model, not a full engineering schedule.</li>
            </ul>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <p className="flex items-center gap-1.5">
              <Database size={12} />
              {source === "database" ? "Data source: Supabase PostgreSQL" : "Data source: bundled demo dataset"}
              <span className="text-faint">· Theta23 Phase 1 · Map geometry: Natural Earth</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setModal({ kind: "reset" })}><RefreshCcw size={13} /> Reset Demo Data</Button>
              {initial.isOwner ? (
                <Button onClick={signOut}><LogOut size={13} /> Sign out</Button>
              ) : initial.ownerLoginAvailable ? (
                <Button onClick={() => setModal({ kind: "signin" })}><LogIn size={13} /> Owner sign-in</Button>
              ) : null}
            </div>
          </div>
        </footer>
      </main>

      {drawerComponent && (
        <ComponentDrawer
          key={drawerComponent.id}
          component={drawerComponent} dataset={dataset} evaluation={evaluation} baseline={baseline} scenario={scenario} ops={ops}
          onClose={closeDrawer} onEdit={() => setModal({ kind: "component", componentId: drawerComponent.id })} onSelect={setSelection}
        />
      )}

      {modal?.kind === "custom" && (
        <CustomScenarioModal dataset={dataset} current={scenario} onClose={closeModal} onApply={(s) => { setScenario(s); setModal(null); }} />
      )}
      {modal?.kind === "component" && <ComponentFormModal dataset={dataset} component={editing} ops={ops} onClose={closeModal} />}
      {modal?.kind === "csv" && <CsvImportModal dataset={dataset} ops={ops} onClose={closeModal} />}
      {modal?.kind === "plan" && <PlanEditorModal dataset={dataset} ops={ops} onClose={closeModal} />}
      {modal?.kind === "signin" && <SignInModal onSignIn={signIn} onClose={closeModal} />}
      {modal?.kind === "reset" && (
        <ConfirmModal
          title="Reset demo data" confirmLabel="Reset demo data" onConfirm={resetDemo} onClose={closeModal}
          body={
            serverReset ? (
              <>
                <p>This replaces the saved KESTREL-1 dataset with the original illustrative demo data.</p>
                <p className="text-xs text-muted">All saved component edits, CSV imports, milestone changes and action records for this product are deleted. Only tables in the <span className="font-mono">theta23_space</span> schema are affected.</p>
              </>
            ) : (
              <>
                <p>This discards the sandbox changes in this browser tab and restores the {source === "database" ? "saved" : "bundled"} demo data.</p>
                <p className="text-xs text-muted">Nothing in the database is changed.</p>
              </>
            )
          }
        />
      )}
    </div>
  );
}
