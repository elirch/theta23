"use client";

import { ArrowRight, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDate, formatMargin } from "@/lib/dates";
import { explainComponent } from "@/lib/explain";
import type { Evaluation } from "@/lib/schedule";
import {
  ACTION_STATUSES, ACTION_STATUS_LABELS, ACTION_TYPES, ACTION_TYPE_LABELS,
  type ActionStatus, type ActionType, type Component, type Dataset, type Scenario,
} from "@/lib/types";
import type { FieldError } from "@/lib/validation";
import type { Ops } from "./ops";
import type { Selection } from "./selection";
import { marginTextClass } from "./status";
import { Button, ErrorNote, errorFor, Field, inputClass, StatusBadge } from "./ui";

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-line/60 py-2.5 last:border-0">
      <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px] text-muted">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
        <div className="num mt-0.5 text-sm text-ink">{children}</div>
      </div>
    </div>
  );
}

export function ComponentDrawer({
  component, dataset, evaluation, baseline, scenario, ops, onClose, onEdit, onSelect,
}: {
  component: Component;
  dataset: Dataset;
  evaluation: Evaluation;
  baseline: Evaluation;
  scenario: Scenario | null;
  ops: Ops;
  onClose: () => void;
  onEdit: () => void;
  onSelect: (selection: Selection) => void;
}) {
  const result = evaluation.components[component.id];
  const base = baseline.components[component.id];
  const milestone = dataset.milestones.find((m) => m.id === component.milestoneId);
  const route = dataset.routes.find((r) => r.id === component.routeId);
  const location = dataset.locations.find((l) => l.id === component.supplierLocationId);
  const actions = dataset.actions.filter((a) => a.componentId === component.id);

  const [actionType, setActionType] = useState<ActionType>("contact_supplier");
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!result || !base) return null;
  const moved = result.targeted && result.delayDays > 0;

  const submitAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors([]);
    const r = await ops.addAction({ componentId: component.id, actionType, owner, note });
    setBusy(false);
    if (r.ok) {
      setNote("");
    } else {
      setError(r.error);
      setFieldErrors(r.fieldErrors ?? []);
    }
  };

  const changeStatus = async (id: string, status: ActionStatus) => {
    setError(null);
    const r = await ops.setActionStatus(id, status);
    if (!r.ok) setError(r.error);
  };

  const remove = async () => {
    setBusy(true);
    const r = await ops.deleteComponent(component.id);
    setBusy(false);
    if (r.ok) onClose();
    else setError(r.error);
  };

  return (
    <aside
      aria-label={`Component ${component.partNumber}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-panel shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-accent">{component.partNumber}</p>
          <h2 className="text-base font-semibold text-ink">{component.description}</h2>
          <p className="text-xs text-muted">
            {component.subsystem} · {component.supplierName}{location ? `, ${location.city}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={result.status} />
            {component.isSingleSource && (
              <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-ink">SINGLE SOURCE</span>
            )}
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] tracking-wider text-faint">ILLUSTRATIVE</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button onClick={onEdit} aria-label="Edit component"><Pencil size={13} /> Edit</Button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink"><X size={16} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        <Step n={1} label="Route">
          {route ? (
            <>
              <button type="button" onClick={() => onSelect({ kind: "route", id: route.id })} className="font-mono underline decoration-faint underline-offset-2 hover:text-accent">
                {route.code}
              </button>
              <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                {route.locationIds.map((id, i) => (
                  <span key={id} className="flex items-center gap-1">
                    {i > 0 && <ArrowRight size={11} className="text-faint" />}
                    {dataset.locations.find((l) => l.id === id)?.city ?? id}
                  </span>
                ))}
              </span>
              <span className="mt-0.5 block text-[11px] text-faint">Planned physical path — not a verified freight service.</span>
            </>
          ) : <span className="text-unknown">No route assigned</span>}
        </Step>
        <Step n={2} label="Baseline arrival at receiving facility">
          {component.baselineArrivalDate ? formatDate(component.baselineArrivalDate) : <span className="text-unknown">Not provided</span>}
        </Step>
        <Step n={3} label="Scenario delay">
          {moved && scenario ? (
            <>
              <span className="font-semibold text-tight">+{result.delayDays} d</span>
              <span className="text-muted"> → arrives {formatDate(result.adjustedArrival)}</span>
              <span className="mt-0.5 block text-xs text-muted">{scenario.name}</span>
            </>
          ) : (
            <span className="text-muted">{scenario ? "0 d — not targeted by the active scenario" : "0 d — baseline plan"}</span>
          )}
        </Step>
        <Step n={4} label="Preparation interval">
          {component.preparationDays === null ? <span className="text-unknown">Not provided</span> : (
            <>
              {component.preparationDays} d
              <span className="block text-xs text-muted">Inspection, installation and verification after arrival.</span>
            </>
          )}
        </Step>
        <Step n={5} label="Readiness date">
          {result.readiness ? (
            <>
              {moved && <span className="mr-2 text-muted line-through decoration-faint">{formatDate(base.readiness)}</span>}
              <span className="font-semibold">{formatDate(result.readiness)}</span>
            </>
          ) : <span className="text-unknown">Cannot be calculated</span>}
        </Step>
        <Step n={6} label="Milestone and margin">
          {milestone ? (
            <>
              {milestone.name} · {formatDate(milestone.scheduledDate)}
              <span className="mt-0.5 block">
                <span className="text-xs text-muted">Original margin </span>
                {moved && <span className="mr-1.5 text-xs text-muted line-through decoration-faint">{formatMargin(base.margin)}</span>}
                <span className={`font-semibold ${marginTextClass(result.margin)}`}>{formatMargin(result.margin)}</span>
              </span>
              {milestone.alternativeDate && result.alternativeMargin !== null && (
                <span className="block text-xs text-muted">
                  Alternative-plan margin ({formatDate(milestone.alternativeDate)}):{" "}
                  <span className={`font-semibold ${marginTextClass(result.alternativeMargin)}`}>{formatMargin(result.alternativeMargin)}</span>
                </span>
              )}
            </>
          ) : <span className="text-unknown">No milestone assigned</span>}
        </Step>
        <Step n={7} label="Explanation">
          <p className="text-sm leading-relaxed text-ink">{explainComponent(component, result, milestone, scenario)}</p>
          {component.isSingleSource && (
            <p className="mt-1 text-xs text-muted">Single-source: substitution options are limited. The flag itself adds no delay.</p>
          )}
          {component.notes && <p className="mt-1 text-xs text-muted">Note: {component.notes}</p>}
        </Step>
        <Step n={8} label={`Action records (${actions.length})`}>
          <p className="text-[11px] text-faint">
            Recording an action does not change readiness. Only planning inputs do.
            {!ops.persistent && " Sandbox mode: records stay in this browser tab."}
          </p>
          {actions.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {actions.map((a) => (
                <li key={a.id} className="rounded-md border border-line bg-canvas/60 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{ACTION_TYPE_LABELS[a.actionType]}</span>
                    <select
                      aria-label="Action status" value={a.status}
                      onChange={(e) => changeStatus(a.id, e.target.value as ActionStatus)}
                      className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] text-ink"
                    >
                      {ACTION_STATUSES.map((s) => <option key={s} value={s}>{ACTION_STATUS_LABELS[s]}</option>)}
                    </select>
                  </div>
                  <p className="mt-0.5 text-muted">{a.owner} · {a.createdAt.slice(0, 10)} {a.createdAt.slice(11, 16)} UTC</p>
                  {a.note && <p className="mt-0.5 whitespace-pre-wrap text-ink">{a.note}</p>}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={submitAction} className="mt-3 flex flex-col gap-2 rounded-md border border-line p-3">
            <p className="text-xs font-medium text-ink">Record next action</p>
            <Field label="Action">
              {(id) => (
                <select id={id} value={actionType} onChange={(e) => setActionType(e.target.value as ActionType)} className={inputClass}>
                  {ACTION_TYPES.map((t) => <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>)}
                </select>
              )}
            </Field>
            <Field label="Owner" error={errorFor(fieldErrors, "owner")}>
              {(id) => <input id={id} value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={80} placeholder="Name or role" className={inputClass} />}
            </Field>
            <Field label="Note (optional)" error={errorFor(fieldErrors, "note")}>
              {(id) => <textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className={inputClass} />}
            </Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" variant="primary" disabled={busy} className="self-start">Add action record</Button>
          </form>
        </Step>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        {confirmDelete ? (
          <>
            <span className="text-xs text-muted">Delete this component and its action records?</span>
            <span className="flex gap-2">
              <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" onClick={remove} disabled={busy}>Delete</Button>
            </span>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> Delete component</Button>
        )}
      </div>
    </aside>
  );
}
