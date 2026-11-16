"use client";

import { ArrowDown, ArrowUp, Download, Plus, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDateShort, formatMargin } from "@/lib/dates";
import type { Evaluation, Status } from "@/lib/schedule";
import type { Component, Dataset } from "@/lib/types";
import { marginTextClass, STATUS_META } from "./status";
import { Button, inputClass, StatusBadge } from "./ui";

type SortKey =
  | "partNumber" | "supplier" | "subsystem" | "milestone" | "baselineArrival" | "adjustedArrival"
  | "preparationDays" | "readiness" | "margin" | "status" | "singleSource";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "partNumber", label: "Part / description" },
  { key: "supplier", label: "Supplier" },
  { key: "subsystem", label: "Subsystem" },
  { key: "milestone", label: "Required for" },
  { key: "baselineArrival", label: "Baseline arrival", align: "right" },
  { key: "adjustedArrival", label: "Adjusted arrival", align: "right" },
  { key: "preparationDays", label: "Prep", align: "right" },
  { key: "readiness", label: "Ready", align: "right" },
  { key: "margin", label: "Margin", align: "right" },
  { key: "status", label: "Status" },
  { key: "singleSource", label: "Single source" },
];

const STATUS_ORDER: Record<Status, number> = { PROJECTED_MISS: 0, TIGHT_MARGIN: 1, UNKNOWN: 2, WITHIN_PLAN: 3 };

export function Ledger({
  dataset, evaluation, selectedComponentId, onOpenComponent, onHoverComponent, onAdd, onImport,
}: {
  dataset: Dataset;
  evaluation: Evaluation;
  selectedComponentId: string | null;
  onOpenComponent: (id: string) => void;
  onHoverComponent: (id: string | null) => void;
  onAdd: () => void;
  onImport: () => void;
}) {
  const [query, setQuery] = useState("");
  const [subsystem, setSubsystem] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [status, setStatus] = useState("");
  const [affectedOnly, setAffectedOnly] = useState(false);
  const [singleOnly, setSingleOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "margin", dir: 1 });

  const milestoneById = useMemo(() => new Map(dataset.milestones.map((m) => [m.id, m])), [dataset.milestones]);
  const locationById = useMemo(() => new Map(dataset.locations.map((l) => [l.id, l])), [dataset.locations]);
  const subsystems = useMemo(() => [...new Set(dataset.components.map((c) => c.subsystem))].sort(), [dataset.components]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const value = (c: Component): string | number | null => {
      const r = evaluation.components[c.id];
      switch (sort.key) {
        case "partNumber": return c.partNumber.toLowerCase();
        case "supplier": return c.supplierName.toLowerCase();
        case "subsystem": return c.subsystem.toLowerCase();
        case "milestone": return c.milestoneId ? milestoneById.get(c.milestoneId)?.sequence ?? null : null;
        case "baselineArrival": return c.baselineArrivalDate;
        case "adjustedArrival": return r?.adjustedArrival ?? null;
        case "preparationDays": return c.preparationDays;
        case "readiness": return r?.readiness ?? null;
        case "margin": return r?.margin ?? null;
        case "status": return r ? STATUS_ORDER[r.status] : null;
        case "singleSource": return c.isSingleSource ? 0 : 1;
      }
    };
    return dataset.components
      .filter((c) => {
        const r = evaluation.components[c.id];
        if (q && !`${c.partNumber} ${c.description} ${c.supplierName} ${c.subsystem}`.toLowerCase().includes(q)) return false;
        if (subsystem && c.subsystem !== subsystem) return false;
        if (milestoneId && c.milestoneId !== milestoneId) return false;
        if (status && r?.status !== status) return false;
        if (affectedOnly && !(r && r.targeted && r.delayDays > 0)) return false;
        if (singleOnly && !c.isSingleSource) return false;
        return true;
      })
      .sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        if (va === vb) return a.partNumber.localeCompare(b.partNumber);
        if (va === null) return 1; // unknowns last in either direction
        if (vb === null) return -1;
        return (va < vb ? -1 : 1) * sort.dir;
      });
  }, [dataset.components, evaluation, query, subsystem, milestoneId, status, affectedOnly, singleOnly, sort, milestoneById]);

  const filtersActive = Boolean(query || subsystem || milestoneId || status || affectedOnly || singleOnly);
  const selectClass = `${inputClass} !w-auto !py-1 text-xs`;

  return (
    <section aria-label="Component ledger" className="rounded-lg border border-line bg-panel">
      <div className="flex flex-col gap-3 border-b border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Component ledger <span className="num font-normal normal-case text-faint">· {rows.length} of {dataset.components.length}</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={onAdd}><Plus size={13} /> Add component</Button>
            <Button onClick={onImport}><Upload size={13} /> Import CSV</Button>
            <a
              href="/sample-components.csv" download
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-faint"
            >
              <Download size={13} /> Sample CSV
            </a>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search part, description, supplier…"
            aria-label="Search components" className={`${inputClass} !w-full !py-1 text-xs sm:!w-64`}
          />
          <select aria-label="Filter by subsystem" value={subsystem} onChange={(e) => setSubsystem(e.target.value)} className={selectClass}>
            <option value="">All subsystems</option>
            {subsystems.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select aria-label="Filter by milestone" value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} className={selectClass}>
            <option value="">All milestones</option>
            {dataset.milestones.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
          </select>
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
            <option value="">All statuses</option>
            {(["PROJECTED_MISS", "TIGHT_MARGIN", "WITHIN_PLAN", "UNKNOWN"] as const).map((s) => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={affectedOnly} onChange={(e) => setAffectedOnly(e.target.checked)} className="accent-[#56c8e0]" />
            Affected by scenario
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={singleOnly} onChange={(e) => setSingleOnly(e.target.checked)} className="accent-[#56c8e0]" />
            Single source
          </label>
          {filtersActive && (
            <Button
              variant="ghost"
              onClick={() => { setQuery(""); setSubsystem(""); setMilestoneId(""); setStatus(""); setAffectedOnly(false); setSingleOnly(false); }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key} scope="col"
                    aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                    className={`px-3 py-2 font-medium ${col.align === "right" ? "text-right" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => setSort((s) => ({ key: col.key, dir: s.key === col.key && s.dir === 1 ? -1 : 1 }))}
                      className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${active ? "text-ink" : ""}`}
                    >
                      {col.label}
                      {active && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const r = evaluation.components[c.id];
              if (!r) return null;
              const moved = r.targeted && r.delayDays > 0;
              const location = locationById.get(c.supplierLocationId);
              const milestone = c.milestoneId ? milestoneById.get(c.milestoneId) : undefined;
              return (
                <tr
                  key={c.id}
                  tabIndex={0}
                  onClick={() => onOpenComponent(c.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpenComponent(c.id); }}
                  onMouseEnter={() => onHoverComponent(c.id)}
                  onMouseLeave={() => onHoverComponent(null)}
                  className={`cursor-pointer border-b border-line/60 last:border-0 hover:bg-raised ${selectedComponentId === c.id ? "bg-raised" : ""} ${moved ? "shadow-[inset_2px_0_0_0_#f2b441]" : ""}`}
                >
                  <td className="px-3 py-2">
                    <span className="font-mono text-ink">{c.partNumber}</span>
                    <span className="block text-muted">{c.description}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-ink">{c.supplierName}</span>
                    <span className="block text-muted">{location ? `${location.city}, ${location.country}` : "—"}</span>
                  </td>
                  <td className="px-3 py-2 text-muted">{c.subsystem}</td>
                  <td className="px-3 py-2 text-muted">{milestone ? milestone.code : <span className="text-unknown">Unassigned</span>}</td>
                  <td className="num px-3 py-2 text-right text-muted">{formatDateShort(c.baselineArrivalDate)}</td>
                  <td className={`num px-3 py-2 text-right ${moved ? "text-tight" : "text-muted"}`}>
                    {formatDateShort(r.adjustedArrival)}
                    {moved && <span className="block text-[10px]">+{r.delayDays} d</span>}
                  </td>
                  <td className="num px-3 py-2 text-right text-muted">{c.preparationDays === null ? "—" : `${c.preparationDays} d`}</td>
                  <td className="num px-3 py-2 text-right text-ink">{formatDateShort(r.readiness)}</td>
                  <td className={`num px-3 py-2 text-right font-semibold ${marginTextClass(r.margin)}`}>{formatMargin(r.margin)}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-muted">{c.isSingleSource ? <span className="text-ink">Single source</span> : "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted">No components match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
