"use client";

import { formatDate, formatMargin } from "@/lib/dates";
import type { Evaluation } from "@/lib/schedule";
import type { Dataset } from "@/lib/types";
import { marginTextClass } from "./status";

function Metric({ label, value, valueClass = "text-ink", detail }: { label: string; value: string; valueClass?: string; detail: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`num mt-1 text-xl font-semibold ${valueClass}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </div>
  );
}

export function SummaryMetrics({ dataset, evaluation }: { dataset: Dataset; evaluation: Evaluation }) {
  const { summary } = evaluation;
  const name = (id: string) => dataset.milestones.find((m) => m.id === id)?.name ?? id;
  const next = dataset.milestones.find((m) => m.id === summary.nextMilestoneId);
  const missed = summary.missedMilestoneIds;
  const unresolved = summary.unresolvedMilestoneIds;
  const affected = summary.affectedComponentIds;

  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Metric
        label="Next scheduled milestone"
        value={next ? formatDate(next.scheduledDate) : "None"}
        detail={next ? next.name : "No milestone is scheduled on or after the analysis date."}
      />
      <Metric
        label="Lowest calculable milestone margin"
        value={summary.lowestMargin ? formatMargin(summary.lowestMargin.margin) : "—"}
        valueClass={marginTextClass(summary.lowestMargin ? summary.lowestMargin.margin : null)}
        detail={
          <>
            {summary.lowestMargin ? name(summary.lowestMargin.milestoneId) : "No milestone margin can be calculated."}
            {unresolved.length > 0 && (
              <span className="mt-0.5 block text-unknown">
                {unresolved.length} milestone{unresolved.length === 1 ? "" : "s"} with unresolved timing: {unresolved.map(name).join(", ")}
              </span>
            )}
          </>
        }
      />
      <Metric
        label="Original milestones projected to miss"
        value={`${missed.length} of ${dataset.milestones.length}`}
        valueClass={missed.length > 0 ? "text-miss" : "text-ink"}
        detail={missed.length > 0 ? missed.map(name).join(", ") : "Every original date is currently achievable."}
      />
      <Metric
        label="Components affected by scenario"
        value={`${affected.length} of ${dataset.components.length}`}
        valueClass={affected.length > 0 ? "text-tight" : "text-ink"}
        detail={
          affected.length > 0
            ? affected.map((id) => dataset.components.find((c) => c.id === id)?.partNumber ?? id).join(", ")
            : "Baseline dates apply to every component."
        }
      />
    </section>
  );
}
