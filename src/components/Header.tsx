"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { formatDate } from "@/lib/dates";
import type { Dataset, Scenario } from "@/lib/types";
import { Button, inputClass } from "./ui";

export function Header({
  dataset, scenario, onSelectScenario, onCustom, onBaseline,
}: {
  dataset: Dataset;
  scenario: Scenario | null;
  onSelectScenario: (id: string | null) => void;
  onCustom: () => void;
  onBaseline: () => void;
}) {
  const isCustom = scenario?.id === "custom";
  return (
    <header className="z-30 border-b lg:sticky lg:top-0 border-line bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h1 className="text-base font-semibold tracking-[0.2em] text-ink">THETA23</h1>
            <span className="text-sm text-accent">Space Mission Readiness Radar</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            <span className="font-medium text-ink">{dataset.mission.name}</span>
            <span className="num">Analysis date: <span className="text-ink">{formatDate(dataset.mission.analysisDate)}</span></span>
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
              Illustrative demo data · Scenario planning
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="scenario-select" className="sr-only">Scenario</label>
          <select
            id="scenario-select"
            value={scenario ? scenario.id : ""}
            onChange={(e) => {
              if (e.target.value === "custom") onCustom();
              else onSelectScenario(e.target.value || null);
            }}
            className={`${inputClass} !w-full !py-1.5 text-xs sm:!w-auto`}
          >
            <option value="">Baseline plan — no disruption</option>
            {dataset.scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            {isCustom && <option value="custom">Custom scenario</option>}
          </select>
          <Button onClick={onCustom}><SlidersHorizontal size={13} /> Custom scenario</Button>
          <Button variant="primary" onClick={onBaseline} disabled={!scenario}><RotateCcw size={13} /> Return to Baseline</Button>
        </div>
      </div>
    </header>
  );
}
