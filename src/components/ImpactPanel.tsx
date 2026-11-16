"use client";

import { ArrowRight, MapPin, Route as RouteIcon } from "lucide-react";
import { formatDateShort, formatMargin } from "@/lib/dates";
import { explainMilestone, explainScenario } from "@/lib/explain";
import type { Evaluation } from "@/lib/schedule";
import { LOCATION_TYPE_LABELS, type Component, type Dataset, type Scenario } from "@/lib/types";
import type { Selection } from "./selection";
import { marginTextClass } from "./status";
import { StatusBadge } from "./ui";

function ComponentRow({
  component, evaluation, baseline, onOpen, onHover,
}: {
  component: Component;
  evaluation: Evaluation;
  baseline: Evaluation;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const now = evaluation.components[component.id];
  const base = baseline.components[component.id];
  if (!now || !base) return null;
  const moved = now.delayDays > 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(component.id)}
        onMouseEnter={() => onHover(component.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(component.id)}
        onBlur={() => onHover(null)}
        className="flex w-full flex-col gap-1 rounded-md border border-line bg-canvas/60 px-3 py-2 text-left hover:border-faint"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs">
            <span className="font-mono text-ink">{component.partNumber}</span>
            <span className="text-muted"> · {component.description}</span>
          </span>
          <StatusBadge status={now.status} />
        </span>
        <span className="num flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          Ready
          {moved && (
            <>
              <span className="line-through decoration-faint">{formatDateShort(base.readiness)}</span>
              <ArrowRight size={11} />
            </>
          )}
          <span className="text-ink">{formatDateShort(now.readiness)}</span>
          <span>· margin</span>
          {moved && (
            <>
              <span className="line-through decoration-faint">{formatMargin(base.margin)}</span>
              <ArrowRight size={11} />
            </>
          )}
          <span className={`font-semibold ${marginTextClass(now.margin)}`}>{formatMargin(now.margin)}</span>
        </span>
      </button>
    </li>
  );
}

export function ImpactPanel({
  dataset, evaluation, baseline, scenario, selection, onOpenComponent, onHoverComponent, onSelect,
}: {
  dataset: Dataset;
  evaluation: Evaluation;
  baseline: Evaluation;
  scenario: Scenario | null;
  selection: Selection;
  onOpenComponent: (id: string) => void;
  onHoverComponent: (id: string | null) => void;
  onSelect: (selection: Selection) => void;
}) {
  const affected = dataset.components.filter((c) => evaluation.summary.affectedComponentIds.includes(c.id));
  const target = scenario
    ? scenario.targetType === "supplier_location"
      ? dataset.locations.find((l) => l.id === scenario.targetId)
      : dataset.routes.find((r) => r.id === scenario.targetId)
    : undefined;
  const consequences = dataset.milestones
    .map((m) => {
      const r = evaluation.milestones.find((x) => x.milestoneId === m.id);
      return r ? { milestone: m, result: r, lines: explainMilestone(m, r, dataset) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && (x.result.status !== "WITHIN_PLAN" || x.lines.length > 0));

  const selectedLocation = selection?.kind === "location" ? dataset.locations.find((l) => l.id === selection.id) : undefined;
  const selectedRoute = selection?.kind === "route" ? dataset.routes.find((r) => r.id === selection.id) : undefined;
  const selectedComponents = selectedLocation
    ? dataset.components.filter((c) => {
        const route = dataset.routes.find((r) => r.id === c.routeId);
        return c.supplierLocationId === selectedLocation.id || Boolean(route?.locationIds.includes(selectedLocation.id));
      })
    : selectedRoute
      ? dataset.components.filter((c) => c.routeId === selectedRoute.id)
      : [];
  const rowProps = { evaluation, baseline, onOpen: onOpenComponent, onHover: onHoverComponent };

  return (
    <div className="flex flex-col gap-3">
      {(selectedLocation || selectedRoute) && (
        <section className="rounded-lg border border-accent/30 bg-panel p-4" aria-label="Map selection">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-accent">
            {selectedLocation ? <MapPin size={12} /> : <RouteIcon size={12} />}
            {selectedLocation ? LOCATION_TYPE_LABELS[selectedLocation.type] : "Planned route"}
          </p>
          <h2 className="mt-1 text-sm font-semibold text-ink">
            {selectedLocation ? selectedLocation.name : selectedRoute?.name}
          </h2>
          <p className="text-xs text-muted">
            {selectedLocation
              ? `${selectedLocation.city}, ${selectedLocation.country} · ${selectedLocation.code}`
              : `${selectedRoute?.code} · a planned physical path, not a verified freight service`}
          </p>
          {selectedRoute && (
            <ol className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted">
              {selectedRoute.locationIds.map((id, i) => {
                const l = dataset.locations.find((x) => x.id === id);
                return (
                  <li key={id} className="flex items-center gap-1">
                    {i > 0 && <ArrowRight size={11} className="text-faint" />}
                    <button type="button" className="rounded px-1 hover:bg-raised hover:text-ink" onClick={() => onSelect({ kind: "location", id })}>
                      {l ? l.city : id}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">
            {selectedLocation?.type === "supplier" ? "Components supplied from here" : selectedLocation ? "Components routed through here" : "Components on this route"} ({selectedComponents.length})
          </p>
          {selectedComponents.length === 0 ? (
            <p className="mt-1 text-xs text-muted">No component depends on this {selectedLocation ? "location" : "route"}.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {selectedComponents.map((c) => <ComponentRow key={c.id} component={c} {...rowProps} />)}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-lg border border-line bg-panel p-4" aria-label="Scenario impact" aria-live="polite">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{scenario ? "Active scenario" : "Baseline plan"}</p>
        {scenario ? (
          <>
            <h2 className="mt-1 text-sm font-semibold text-ink">{scenario.name}</h2>
            {scenario.description && <p className="mt-1 text-xs text-muted">{scenario.description}</p>}
            <p className="num mt-2 text-xs text-ink">
              <span className="text-muted">Assumption:</span> +{scenario.delayDays} d at{" "}
              <button
                type="button"
                className="underline decoration-faint underline-offset-2 hover:text-accent"
                onClick={() => onSelect({ kind: scenario.targetType === "route" ? "route" : "location", id: scenario.targetId })}
              >
                {target ? ("city" in target ? `${target.name} (${target.code})` : `${target.code}`) : "unknown target"}
              </button>
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
              {explainScenario(scenario, dataset, evaluation).map((line) => <li key={line}>{line}</li>)}
            </ul>
            <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">Affected components ({affected.length})</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {affected.map((c) => <ComponentRow key={c.id} component={c} {...rowProps} />)}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted">
            No disruption is applied. Choose a scenario above, or select a supplier or route on the map to see what depends on it.
          </p>
        )}

        <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted">Milestone consequences</p>
        {consequences.length === 0 ? (
          <p className="mt-1 text-xs text-muted">All three milestones are within plan on their original dates.</p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-2">
            {consequences.map(({ milestone, result, lines }) => (
              <li key={milestone.id} className="rounded-md border border-line bg-canvas/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink">{milestone.name}</span>
                  <StatusBadge status={result.status} />
                </div>
                <p className="num mt-0.5 text-[11px] text-muted">
                  {result.margin !== null
                    ? <>Original margin <span className={`font-semibold ${marginTextClass(result.margin)}`}>{formatMargin(result.margin)}</span>{baselineDelta(result.margin, baseline, milestone.id)}</>
                    : "Margin cannot be calculated yet."}
                </p>
                {lines.map((line) => <p key={line} className="mt-1 text-xs text-muted">{line}</p>)}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-faint">
          Schedule margin is not a decision deadline: how late a mitigation can start depends on its lead time, which this model does not hold.
        </p>
      </section>
    </div>
  );
}

function baselineDelta(margin: number, baseline: Evaluation, milestoneId: string): string {
  const base = baseline.milestones.find((m) => m.milestoneId === milestoneId)?.margin;
  if (base === null || base === undefined || base === margin) return "";
  return ` (baseline ${formatMargin(base)})`;
}
