"use client";

import { useRef, useState } from "react";
import { parseComponentsCsv, type CsvParseResult, type CsvRowError } from "@/lib/csv";
import { formatDate } from "@/lib/dates";
import type { Component, ComponentInput, Dataset, PlanInput, Scenario } from "@/lib/types";
import { validateCustomScenario, type FieldError } from "@/lib/validation";
import type { OpResult, Ops } from "./ops";
import { Button, ErrorNote, errorFor, Field, inputClass, Modal } from "./ui";

function intOrNull(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  return /^-?\d+$/.test(t) ? Number(t) : Number.NaN;
}

function SandboxNote({ ops }: { ops: Ops }) {
  if (ops.persistent) return null;
  return (
    <p className="rounded-md border border-line bg-canvas/60 px-3 py-2 text-[11px] text-muted">
      Sandbox mode: this change is applied in your browser tab only and is not saved.
    </p>
  );
}

// ---------------------------------------------------------------- Custom scenario

export function CustomScenarioModal({
  dataset, current, onApply, onClose,
}: {
  dataset: Dataset;
  current: Scenario | null;
  onApply: (scenario: Scenario) => void;
  onClose: () => void;
}) {
  const suppliers = dataset.locations.filter((l) => l.type === "supplier");
  const [targetType, setTargetType] = useState<Scenario["targetType"]>(current?.targetType ?? "supplier_location");
  const [targetId, setTargetId] = useState(current?.targetId ?? suppliers[0]?.id ?? "");
  const [delay, setDelay] = useState(String(current?.delayDays ?? 10));
  const [description, setDescription] = useState(current?.id === "custom" ? current.description : "");
  const [errors, setErrors] = useState<FieldError[]>([]);

  const switchType = (type: Scenario["targetType"]) => {
    setTargetType(type);
    setTargetId(type === "supplier_location" ? suppliers[0]?.id ?? "" : dataset.routes[0]?.id ?? "");
  };
  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const delayDays = intOrNull(delay);
    const checked = validateCustomScenario(
      { targetType, targetId, delayDays: delayDays === null ? Number.NaN : delayDays, description },
      dataset,
    );
    if (!checked.ok) return setErrors(checked.errors);
    onApply({
      id: "custom",
      name: "Custom scenario",
      description: checked.value.description,
      targetType: checked.value.targetType,
      targetId: checked.value.targetId,
      delayDays: checked.value.delayDays,
    });
  };

  return (
    <Modal
      title="Custom delay scenario" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="custom-scenario-form">Apply scenario</Button></>}
    >
      <form id="custom-scenario-form" onSubmit={apply} className="flex flex-col gap-3">
        <p className="text-xs text-muted">
          Applies one delay to a supplier location or a planned route. It replaces the active scenario and is calculated from baseline —
          delays never accumulate. Scenarios are exploratory and are not saved.
        </p>
        <fieldset className="flex gap-4 text-sm text-ink">
          <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Disruption target</legend>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="targetType" checked={targetType === "supplier_location"} onChange={() => switchType("supplier_location")} className="accent-[#56c8e0]" />
            Supplier location
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="targetType" checked={targetType === "route"} onChange={() => switchType("route")} className="accent-[#56c8e0]" />
            Route
          </label>
        </fieldset>
        <Field label={targetType === "supplier_location" ? "Supplier location" : "Route"} error={errorFor(errors, "targetId")}>
          {(id) => (
            <select id={id} value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputClass}>
              {targetType === "supplier_location"
                ? suppliers.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.city}, {l.country}</option>)
                : dataset.routes.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Added delay (days)" error={errorFor(errors, "delayDays")} hint="Whole number, 0 or more.">
          {(id) => <input id={id} inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value)} className={`${inputClass} num`} />}
        </Field>
        <Field label="Short description (optional)" error={errorFor(errors, "description")}>
          {(id) => <input id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="e.g. Port closure, production line stop" className={inputClass} />}
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Component form

export function ComponentFormModal({
  dataset, component, ops, onClose,
}: {
  dataset: Dataset;
  component: Component | null;
  ops: Ops;
  onClose: () => void;
}) {
  const suppliers = dataset.locations.filter((l) => l.type === "supplier");
  const [partNumber, setPartNumber] = useState(component?.partNumber ?? "");
  const [description, setDescription] = useState(component?.description ?? "");
  const [subsystem, setSubsystem] = useState(component?.subsystem ?? "");
  const [supplierName, setSupplierName] = useState(component?.supplierName ?? "");
  const [supplierLocationId, setSupplierLocationId] = useState(component?.supplierLocationId ?? suppliers[0]?.id ?? "");
  const [routeId, setRouteId] = useState(component ? component.routeId ?? "" : "");
  const [milestoneId, setMilestoneId] = useState(component ? component.milestoneId ?? "" : dataset.milestones[0]?.id ?? "");
  const [arrival, setArrival] = useState(component?.baselineArrivalDate ?? "");
  const [prep, setPrep] = useState(component?.preparationDays === null || !component ? "" : String(component.preparationDays));
  const [single, setSingle] = useState(component?.isSingleSource ?? false);
  const [notes, setNotes] = useState(component?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OpResult | null>(null);

  const routesFromSupplier = dataset.routes.filter((r) => r.locationIds[0] === supplierLocationId);
  const errors = result && !result.ok ? result.fieldErrors : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const preparationDays = intOrNull(prep);
    if (Number.isNaN(preparationDays)) {
      return setResult({ ok: false, error: "Please correct the highlighted fields.", fieldErrors: [{ field: "preparationDays", message: "Preparation days must be a whole number." }] });
    }
    const input: ComponentInput = {
      partNumber, description, subsystem, supplierName, supplierLocationId,
      routeId: routeId || null, milestoneId: milestoneId || null,
      baselineArrivalDate: arrival || null, preparationDays, isSingleSource: single, notes,
    };
    if (!component && dataset.components.some((c) => c.partNumber.toLowerCase() === partNumber.trim().toLowerCase())) {
      return setResult({ ok: false, error: "Please correct the highlighted fields.", fieldErrors: [{ field: "partNumber", message: "A component with this part number already exists. Open it from the ledger to edit it." }] });
    }
    setBusy(true);
    const r = await ops.saveComponent(input);
    setBusy(false);
    if (r.ok) onClose();
    else setResult(r);
  };

  return (
    <Modal
      title={component ? `Edit ${component.partNumber}` : "Add component"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="component-form" disabled={busy}>{component ? "Save changes" : "Add component"}</Button></>}
    >
      <form id="component-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Part number" error={errorFor(errors, "partNumber")} hint={component ? "The part number identifies the component and cannot be changed." : "Fictional identifier, e.g. KS-AB-123."}>
          {(id) => <input id={id} value={partNumber} onChange={(e) => setPartNumber(e.target.value)} disabled={Boolean(component)} className={`${inputClass} font-mono disabled:opacity-60`} />}
        </Field>
        <Field label="Description" error={errorFor(errors, "description")}>
          {(id) => <input id={id} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Subsystem" error={errorFor(errors, "subsystem")}>
          {(id) => <input id={id} value={subsystem} onChange={(e) => setSubsystem(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Supplier name (fictional)" error={errorFor(errors, "supplierName")}>
          {(id) => <input id={id} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Supplier location" error={errorFor(errors, "supplierLocationId")}>
          {(id) => (
            <select
              id={id} value={supplierLocationId} className={inputClass}
              onChange={(e) => { setSupplierLocationId(e.target.value); setRouteId(""); }}
            >
              {suppliers.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.city}, {l.country}</option>)}
            </select>
          )}
        </Field>
        <Field label="Route" error={errorFor(errors, "routeId")} hint="Only routes that start at the supplier location are listed.">
          {(id) => (
            <select id={id} value={routeId} onChange={(e) => setRouteId(e.target.value)} className={inputClass}>
              <option value="">No route assigned</option>
              {routesFromSupplier.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
            </select>
          )}
        </Field>
        <Field label="Required for milestone" error={errorFor(errors, "milestoneId")}>
          {(id) => (
            <select id={id} value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} className={inputClass}>
              <option value="">Unassigned (status UNKNOWN)</option>
              {dataset.milestones.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Baseline arrival date" error={errorFor(errors, "baselineArrivalDate")} hint="At the receiving facility. Leave empty if unknown.">
          {(id) => <input id={id} type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} className={`${inputClass} num`} />}
        </Field>
        <Field label="Preparation days" error={errorFor(errors, "preparationDays")} hint="Inspection, installation and verification after arrival.">
          {(id) => <input id={id} inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} className={`${inputClass} num`} />}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input type="checkbox" checked={single} onChange={(e) => setSingle(e.target.checked)} className="accent-[#56c8e0]" />
          Single source <span className="text-xs text-muted">(adds no delay by itself)</span>
        </label>
        <div className="sm:col-span-2">
          <Field label="Notes" error={errorFor(errors, "notes")}>
            {(id) => <textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />}
          </Field>
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          {result && !result.ok && <ErrorNote>{result.error}</ErrorNote>}
          <SandboxNote ops={ops} />
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Plan editor

export function PlanEditorModal({ dataset, ops, onClose }: { dataset: Dataset; ops: Ops; onClose: () => void }) {
  const ordered = [...dataset.milestones].sort((a, b) => a.sequence - b.sequence);
  const [analysisDate, setAnalysisDate] = useState(dataset.mission.analysisDate);
  const [rows, setRows] = useState(() =>
    ordered.map((m) => ({
      id: m.id, scheduledDate: m.scheduledDate, alternativeDate: m.alternativeDate ?? "",
      interval: m.minDaysAfterPrevious === null ? "" : String(m.minDaysAfterPrevious),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OpResult | null>(null);
  const errors = result && !result.ok ? result.fieldErrors : undefined;
  const update = (id: string, patch: Partial<(typeof rows)[number]>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input: PlanInput = {
      analysisDate,
      milestones: rows.map((r, i) => ({
        id: r.id, scheduledDate: r.scheduledDate, alternativeDate: r.alternativeDate || null,
        minDaysAfterPrevious: i === 0 ? null : intOrNull(r.interval),
      })),
    };
    setBusy(true);
    const r = await ops.savePlan(input);
    setBusy(false);
    if (r.ok) onClose();
    else setResult(r);
  };

  return (
    <Modal
      title="Milestone dates, alternatives and intervals" onClose={onClose} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="plan-form" disabled={busy}>Save plan</Button></>}
    >
      <form id="plan-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="max-w-xs">
          <Field label="Analysis date" error={errorFor(errors, "analysisDate")} hint="The explicit “as of” date. Calculations never use today’s clock.">
            {(id) => <input id={id} type="date" value={analysisDate} onChange={(e) => setAnalysisDate(e.target.value)} className={`${inputClass} num`} />}
          </Field>
        </div>
        {ordered.map((m, i) => {
          const row = rows[i];
          if (!row) return null;
          return (
            <fieldset key={m.id} className="rounded-md border border-line p-3">
              <legend className="px-1 text-xs font-semibold text-ink">{i + 1} · {m.name}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Original scheduled date" error={errorFor(errors, `${m.id}.scheduledDate`)}>
                  {(id) => <input id={id} type="date" value={row.scheduledDate} onChange={(e) => update(m.id, { scheduledDate: e.target.value })} className={`${inputClass} num`} />}
                </Field>
                <Field label="Known alternative date" error={errorFor(errors, `${m.id}.alternativeDate`)} hint="Optional. A confirmed backup slot, later than the original.">
                  {(id) => <input id={id} type="date" value={row.alternativeDate} onChange={(e) => update(m.id, { alternativeDate: e.target.value })} className={`${inputClass} num`} />}
                </Field>
                {i > 0 ? (
                  <Field
                    label={`Min. days after ${ordered[i - 1]?.code}`} error={errorFor(errors, `${m.id}.minDaysAfterPrevious`)}
                    hint="Includes the preceding campaign’s duration and follow-on preparation."
                  >
                    {(id) => <input id={id} inputMode="numeric" value={row.interval} onChange={(e) => update(m.id, { interval: e.target.value })} className={`${inputClass} num`} />}
                  </Field>
                ) : (
                  <p className="self-center text-xs text-faint">First milestone: readiness depends only on its assigned components.</p>
                )}
              </div>
            </fieldset>
          );
        })}
        <p className="text-xs text-muted">
          An alternative date is used for downstream planning only when the original date is projected to be missed and the alternative
          is on or after readiness. The original commitment stays marked as missed.
        </p>
        {result && !result.ok && <ErrorNote>{result.error}{errors && errors.length > 0 && errors[0]?.field === "milestones" ? ` ${errors[0].message}` : ""}</ErrorNote>}
        <SandboxNote ops={ops} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- CSV import

export function CsvImportModal({ dataset, ops, onClose }: { dataset: Dataset; ops: Ops; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvParseResult | null>(null);
  const [serverErrors, setServerErrors] = useState<{ message: string; rows: CsvRowError[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setFileName(file.name);
    setText(content);
    setPreview(parseComponentsCsv(content, dataset));
    setServerErrors(null);
    setDone(null);
  };

  const confirm = async () => {
    if (!text || !preview?.valid) return;
    setBusy(true);
    const r = await ops.importCsv(text);
    setBusy(false);
    if (r.ok) {
      setDone(r.message ?? "Import complete.");
      setPreview(null);
      setText(null);
    } else {
      setServerErrors({ message: r.error, rows: r.csvErrors ?? [] });
    }
  };

  const errors = serverErrors?.rows ?? (preview && !preview.valid ? preview.errors : []);
  const location = (id: string) => dataset.locations.find((l) => l.id === id)?.code ?? id;
  const route = (id: string | null) => (id ? dataset.routes.find((r) => r.id === id)?.code ?? id : "—");
  const milestone = (id: string | null) => (id ? dataset.milestones.find((m) => m.id === id)?.code ?? id : "—");

  return (
    <Modal
      title="Import components from CSV" onClose={onClose} wide
      footer={
        done ? <Button variant="primary" onClick={onClose}>Done</Button> : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={confirm} disabled={busy || !preview?.valid}>
              {preview?.valid ? `Import ${preview.rows.length} component${preview.rows.length === 1 ? "" : "s"}` : "Import"}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">
          Rows are matched to existing components by part number: matches are updated, new part numbers are created. The file is validated
          as a whole — if any row has an error, nothing is imported.{" "}
          <a href="/sample-components.csv" download className="text-accent underline underline-offset-2">Download the sample CSV</a>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
          <Button onClick={() => fileRef.current?.click()}>Choose CSV file…</Button>
          {fileName && <span className="text-xs text-muted">{fileName}</span>}
        </div>

        {done && <p role="status" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">{done} Readiness and margins have been recalculated.</p>}

        {errors.length > 0 && (
          <div role="alert" className="rounded-md border border-miss/40 bg-miss/10 p-3">
            <p className="text-xs font-semibold text-miss">
              {serverErrors ? serverErrors.message : `Import rejected: ${errors.length} problem${errors.length === 1 ? "" : "s"} found. No rows will be imported.`}
            </p>
            <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto text-xs text-ink">
              {errors.map((e, i) => (
                <li key={i} className="num">
                  <span className="text-miss">{e.line > 0 ? `Line ${e.line}` : "File"}{e.column ? ` · ${e.column}` : ""}:</span> {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {serverErrors && serverErrors.rows.length === 0 && <ErrorNote>{serverErrors.message}</ErrorNote>}

        {preview?.valid && !serverErrors && (
          <>
            <p className="text-xs text-ink">
              Preview: <span className="font-semibold text-accent">{preview.created} to create</span>,{" "}
              <span className="font-semibold text-tight">{preview.updated} to update</span>. Nothing changes until you confirm.
            </p>
            <div className="max-h-72 overflow-auto rounded-md border border-line">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="sticky top-0 bg-raised text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    {["Line", "Action", "Part number", "Description", "Supplier loc.", "Route", "Milestone", "Arrival", "Prep", "Single"].map((h) => (
                      <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className="border-t border-line/60">
                      <td className="num px-2 py-1.5 text-muted">{r.line}</td>
                      <td className={`px-2 py-1.5 font-semibold ${r.action === "create" ? "text-accent" : "text-tight"}`}>{r.action === "create" ? "Create" : "Update"}</td>
                      <td className="px-2 py-1.5 font-mono text-ink">{r.input.partNumber}</td>
                      <td className="px-2 py-1.5 text-muted">{r.input.description}</td>
                      <td className="px-2 py-1.5 text-muted">{location(r.input.supplierLocationId)}</td>
                      <td className="px-2 py-1.5 text-muted">{route(r.input.routeId)}</td>
                      <td className="px-2 py-1.5 text-muted">{milestone(r.input.milestoneId)}</td>
                      <td className="num px-2 py-1.5 text-muted">{formatDate(r.input.baselineArrivalDate)}</td>
                      <td className="num px-2 py-1.5 text-muted">{r.input.preparationDays} d</td>
                      <td className="px-2 py-1.5 text-muted">{r.input.isSingleSource ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <SandboxNote ops={ops} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Sign in / confirm

export function SignInModal({ onSignIn, onClose }: { onSignIn: (password: string) => Promise<string | null>; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await onSignIn(password);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <Modal
      title="Owner sign-in" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="signin-form" disabled={busy || !password}>Sign in</Button></>}
    >
      <form id="signin-form" onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-xs text-muted">The owner can save edits, import CSV files and reset the demo data. Everyone else explores in a browser-only sandbox.</p>
        <Field label="Owner password">
          {(id) => <input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />}
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

export function ConfirmModal({
  title, body, confirmLabel, onConfirm, onClose,
}: { title: string; body: React.ReactNode; confirmLabel: string; onConfirm: () => Promise<string | null>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    const err = await onConfirm();
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Modal
      title={title} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" onClick={run} disabled={busy}>{confirmLabel}</Button></>}
    >
      <div className="flex flex-col gap-3 text-sm text-ink">
        {body}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
