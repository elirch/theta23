"use client";

import { ChevronRight, Pencil } from "lucide-react";
import { formatDate, formatMargin } from "@/lib/dates";
import { explainMilestone } from "@/lib/explain";
import type { Evaluation } from "@/lib/schedule";
import type { Dataset } from "@/lib/types";
import { marginTextClass, STATUS_META } from "./status";
import { Button, StatusBadge } from "./ui";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="num min-w-0 text-right text-ink">{children}</dd>
    </div>
  );
}

export function MilestoneStrip({
  dataset, evaluation, onEdit, onOpenComponent,
}: {
  dataset: Dataset;
  evaluation: Evaluation;
  onEdit: () => void;
  onOpenComponent: (id: string) => void;
}) {
  const ordered = [...dataset.milestones].sort((a, b) => a.sequence - b.sequence);
  return (
    <section aria-label="Mission milestones">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Mission milestones</h2>
        <Button onClick={onEdit}><Pencil size={12} /> Edit dates &amp; intervals</Button>
      </div>
      <ol className="grid gap-3 lg:grid-cols-3">
        {ordered.map((m, index) => {
          const r = evaluation.milestones.find((x) => x.milestoneId === m.id);
          if (!r) return null;
          const meta = STATUS_META[r.status];
          const lines = explainMilestone(m, r, dataset);
          return (
            <li key={m.id} className={`relative rounded-lg border bg-panel p-4 ${r.status === "WITHIN_PLAN" ? "border-line" : meta.border}`}>
              {index > 0 && (
                <span className="absolute -left-3 top-6 hidden text-faint lg:block" aria-hidden><ChevronRight size={16} /></span>
              )}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-muted">{index + 1} · {m.code}</p>
                  <h3 className="text-sm font-semibold text-ink">{m.name}</h3>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <dl className="mt-3 flex flex-col gap-1.5">
                <Row label="Original scheduled date">{formatDate(m.scheduledDate)}</Row>
                <Row label="Earliest readiness">
                  {r.readiness
                    ? formatDate(r.readiness)
                    : r.lowerBound
                      ? <span className="text-unknown">Unresolved · no earlier than {formatDate(r.lowerBound)}</span>
                      : <span className="text-unknown">{r.plannedOccurrence ? "No dependencies" : "Unresolved"}</span>}
                </Row>
                <Row label="Original margin">
                  {r.margin !== null
                    ? <span className={`font-semibold ${marginTextClass(r.margin)}`}>{formatMargin(r.margin)}</span>
                    : r.knownBreach && r.knownBreachMargin !== null
                      ? <span className="font-semibold text-miss">{formatMargin(r.knownBreachMargin)} or worse</span>
                      : <span className="text-unknown">Unresolved</span>}
                </Row>
                {index > 0 && (
                  <Row label="Interval after previous">
                    {m.minDaysAfterPrevious === null ? <span className="text-unknown">Not set</span> : `≥ ${m.minDaysAfterPrevious} d`}
                  </Row>
                )}
                <Row label="Limiting dependency">
                  {r.limiting.length === 0 ? "—" : (
                    <span className="flex flex-wrap justify-end gap-x-2 gap-y-0.5">
                      {r.limiting.map((l) =>
                        l.kind === "component" ? (
                          <button
                            key={l.componentId} type="button" onClick={() => onOpenComponent(l.componentId)}
                            className="font-mono underline decoration-faint underline-offset-2 hover:text-accent"
                          >
                            {dataset.components.find((c) => c.id === l.componentId)?.partNumber ?? l.componentId}
                          </button>
                        ) : (
                          <span key={l.milestoneId}>
                            {dataset.milestones.find((x) => x.id === l.milestoneId)?.code ?? "previous"} + interval
                          </span>
                        ),
                      )}
                    </span>
                  )}
                </Row>
                {m.alternativeDate && (
                  <>
                    <Row label="Known alternative date">{formatDate(m.alternativeDate)}</Row>
                    <Row label="Alternative-plan margin">
                      {r.alternativeMargin !== null ? (
                        <span>
                          <span className={`font-semibold ${marginTextClass(r.alternativeMargin)}`}>{formatMargin(r.alternativeMargin)}</span>
                          <span className="text-muted">
                            {r.plannedVia === "alternative" ? " · used downstream" : r.alternativeUsable === false ? " · not usable" : " · not needed"}
                          </span>
                        </span>
                      ) : <span className="text-unknown">Unresolved</span>}
                    </Row>
                  </>
                )}
              </dl>
              {lines.length > 0 && (
                <div className="mt-3 flex flex-col gap-1 border-t border-line pt-2">
                  {lines.map((line) => <p key={line} className="text-xs text-muted">{line}</p>)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
