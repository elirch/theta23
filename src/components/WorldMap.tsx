"use client";

import { Minus, Plus, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import world from "@/data/world-110m.json";
import { greatCircleSegments, MAP_HEIGHT, MAP_WIDTH, project, segmentsToPath, type Point } from "@/lib/geo";
import type { Evaluation, Status } from "@/lib/schedule";
import { LOCATION_TYPE_LABELS, type Dataset, type Location, type LocationType, type Scenario } from "@/lib/types";
import type { Selection } from "./selection";
import { STATUS_META, worstStatus } from "./status";
import { Button } from "./ui";

const VIEW_H = 430;
const VIEW_Y0 = (MAP_HEIGHT - VIEW_H) / 2;
const MAX_ZOOM = 10;
const NEUTRAL = "#9fb0c9";
const ROUTE_IDLE = "#3f6f86";

interface View {
  cx: number;
  cy: number;
  k: number;
}
const HOME: View = { cx: MAP_WIDTH / 2, cy: MAP_HEIGHT / 2, k: 1 };

function clampView(v: View): View {
  const k = Math.max(1, Math.min(MAX_ZOOM, v.k));
  const halfW = MAP_WIDTH / (2 * k);
  const halfH = VIEW_H / (2 * k);
  return {
    k,
    cx: Math.max(halfW, Math.min(MAP_WIDTH - halfW, v.cx)),
    cy: Math.max(VIEW_Y0 + halfH, Math.min(VIEW_Y0 + VIEW_H - halfH, v.cy)),
  };
}

function Glyph({ type, fill, stroke }: { type: LocationType; fill: string; stroke: string }) {
  const common = { fill, stroke, strokeWidth: 1.5, strokeLinejoin: "round" as const };
  switch (type) {
    case "supplier":
      return <circle r={5} {...common} />;
    case "transit_hub":
      return <rect x={-4} y={-4} width={8} height={8} transform="rotate(45)" {...common} />;
    case "integration_facility":
      return <rect x={-5} y={-5} width={10} height={10} rx={1} {...common} />;
    case "test_facility":
      return <path d="M0,-6.5 L6.5,5 L-6.5,5 Z" {...common} />;
    case "launch_site":
      return <path d="M0,-8 L4.5,1 L4.5,5.5 L-4.5,5.5 L-4.5,1 Z" {...common} />;
  }
}

interface LabelBox {
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
}

/** Greedy label placement in screen pixels: pick the least-overlapping side of each node. */
function placeLabels(nodes: { id: string; px: Point; text: string; priority: boolean }[]): Map<string, LabelBox> {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out = new Map<string, LabelBox>();
  const overlap = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a) =>
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const nodeBoxes = nodes.map((n) => ({ x0: n.px.x - 8, y0: n.px.y - 8, x1: n.px.x + 8, y1: n.px.y + 8 }));
  const ordered = [...nodes].sort((a, b) => Number(b.priority) - Number(a.priority));
  for (const n of ordered) {
    const w = n.text.length * 6 + 4;
    const h = 13;
    const candidates: (LabelBox & { box: { x0: number; y0: number; x1: number; y1: number } })[] = [
      { x: 10, y: 4, anchor: "start", box: { x0: n.px.x + 10, y0: n.px.y - 7, x1: n.px.x + 10 + w, y1: n.px.y + 6 } },
      { x: -10, y: 4, anchor: "end", box: { x0: n.px.x - 10 - w, y0: n.px.y - 7, x1: n.px.x - 10, y1: n.px.y + 6 } },
      { x: 0, y: 19, anchor: "middle", box: { x0: n.px.x - w / 2, y0: n.px.y + 9, x1: n.px.x + w / 2, y1: n.px.y + 9 + h } },
      { x: 0, y: -11, anchor: "middle", box: { x0: n.px.x - w / 2, y0: n.px.y - 10 - h, x1: n.px.x + w / 2, y1: n.px.y - 10 } },
    ];
    let best: (typeof candidates)[number] | null = null;
    let bestCost = Infinity;
    for (const c of candidates) {
      let cost = 0;
      for (const b of placed) cost += overlap(c.box, b);
      nodes.forEach((other, i) => {
        if (other.id !== n.id) cost += overlap(c.box, nodeBoxes[i]!) * 2;
      });
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    if (best && (bestCost < 40 || n.priority)) {
      placed.push(best.box);
      out.set(n.id, { x: best.x, y: best.y, anchor: best.anchor });
    }
  }
  return out;
}

export function WorldMap({
  dataset, evaluation, scenario, selection, highlightComponentId, onSelect,
}: {
  dataset: Dataset;
  evaluation: Evaluation;
  scenario: Scenario | null;
  selection: Selection;
  highlightComponentId: string | null;
  onSelect: (selection: Selection) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(HOME);
  const [width, setWidth] = useState(1100);
  const drag = useRef<{ pointers: Map<number, { x: number; y: number }>; moved: boolean; pinchDist: number | null }>({
    pointers: new Map(), moved: false, pinchDist: null,
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(svg);
    // Ctrl/⌘ + wheel (and trackpad pinch) zooms around the cursor; plain wheel scrolls the page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const factor = Math.exp(-e.deltaY * 0.01);
      setView((v) => {
        const k = Math.max(1, Math.min(MAX_ZOOM, v.k * factor));
        const ratio = v.k / k;
        return clampView({ k, cx: p.x + (v.cx - p.x) * ratio, cy: p.y + (v.cy - p.y) * ratio });
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      svg.removeEventListener("wheel", onWheel);
    };
  }, []);

  const viewW = MAP_WIDTH / view.k;
  const viewH = VIEW_H / view.k;
  const pxPerUnit = (width * view.k) / MAP_WIDTH;
  const unit = 1 / pxPerUnit; // one screen pixel in map units

  const locById = useMemo(() => new Map(dataset.locations.map((l) => [l.id, l])), [dataset.locations]);

  const model = useMemo(() => {
    const statusOf = (ids: string[]): Status | null =>
      worstStatus(ids.map((id) => evaluation.components[id]?.status).filter((s): s is Status => s !== undefined));
    const affected = new Set(evaluation.summary.affectedComponentIds);
    const locationStatus = new Map<string, Status | null>();
    const locationAffected = new Set<string>();
    for (const l of dataset.locations) {
      const comps = dataset.components.filter((c) => c.supplierLocationId === l.id);
      locationStatus.set(l.id, l.type === "supplier" ? statusOf(comps.map((c) => c.id)) : null);
      if (comps.some((c) => affected.has(c.id))) locationAffected.add(l.id);
    }
    const routes = dataset.routes.map((r) => {
      const comps = dataset.components.filter((c) => c.routeId === r.id);
      const stops = r.locationIds.map((id) => locById.get(id)).filter((l): l is Location => l !== undefined);
      const legs: Point[][] = [];
      for (let i = 0; i < stops.length - 1; i++) legs.push(...greatCircleSegments(stops[i]!, stops[i + 1]!));
      const longest = [...legs].sort((a, b) => b.length - a.length)[0];
      return {
        route: r,
        path: segmentsToPath(legs),
        status: statusOf(comps.map((c) => c.id)),
        affected: comps.some((c) => affected.has(c.id)),
        count: comps.length,
        labelAt: longest ? longest[Math.floor(longest.length / 2)]! : null,
      };
    });
    // Illustrative programme flow between the facilities, in milestone order.
    const flowStops = (["integration_facility", "test_facility", "launch_site"] as const)
      .map((t) => dataset.locations.find((l) => l.type === t))
      .filter((l): l is Location => l !== undefined);
    const flow: Point[][] = [];
    for (let i = 0; i < flowStops.length - 1; i++) flow.push(...greatCircleSegments(flowStops[i]!, flowStops[i + 1]!, 12));
    return { locationStatus, locationAffected, routes, flowPath: segmentsToPath(flow) };
  }, [dataset, evaluation, locById]);

  // What is in focus: an explicit selection, or the component being inspected.
  const focus = useMemo(() => {
    const routes = new Set<string>();
    const locations = new Set<string>();
    const component = (id: string) => {
      const c = dataset.components.find((x) => x.id === id);
      if (!c) return;
      locations.add(c.supplierLocationId);
      const r = c.routeId ? dataset.routes.find((x) => x.id === c.routeId) : undefined;
      if (r) {
        routes.add(r.id);
        r.locationIds.forEach((l) => locations.add(l));
      }
    };
    if (highlightComponentId) component(highlightComponentId);
    else if (selection?.kind === "component") component(selection.id);
    else if (selection?.kind === "route") {
      const r = dataset.routes.find((x) => x.id === selection.id);
      if (r) {
        routes.add(r.id);
        r.locationIds.forEach((l) => locations.add(l));
      }
    } else if (selection?.kind === "location") {
      locations.add(selection.id);
      dataset.routes.filter((r) => r.locationIds.includes(selection.id)).forEach((r) => routes.add(r.id));
    }
    return { active: routes.size > 0 || locations.size > 0, routes, locations };
  }, [dataset, selection, highlightComponentId]);

  const labels = useMemo(
    () =>
      placeLabels(
        dataset.locations.map((l) => {
          const p = project(l.longitude, l.latitude);
          return {
            id: l.id,
            px: { x: p.x * pxPerUnit, y: p.y * pxPerUnit },
            text: l.city,
            priority: (selection?.kind === "location" && selection.id === l.id) || focus.locations.has(l.id),
          };
        }),
      ),
    [dataset.locations, pxPerUnit, selection, focus],
  );

  const zoomBy = (factor: number) => setView((v) => clampView({ ...v, k: v.k * factor }));

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pointers.size === 1) d.moved = false;
    d.pinchDist = null;
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const prev = d.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (d.pointers.size === 2) {
      d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...d.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d.pinchDist !== null && dist > 0) {
        const factor = dist / d.pinchDist;
        setView((v) => clampView({ ...v, k: v.k * factor }));
      }
      d.pinchDist = dist;
      d.moved = true;
      return;
    }
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = Math.max(viewW / rect.width, viewH / rect.height);
    setView((v) => clampView({ ...v, cx: v.cx - dx * scale, cy: v.cy - dy * scale }));
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    d.pointers.delete(e.pointerId);
    d.pinchDist = null;
  };
  const guardedSelect = (next: Selection) => {
    if (!drag.current.moved) onSelect(next);
  };

  const targetLocationId = scenario?.targetType === "supplier_location" ? scenario.targetId : null;
  const targetRouteId = scenario?.targetType === "route" ? scenario.targetId : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`${view.cx - viewW / 2} ${view.cy - viewH / 2} ${viewW} ${viewH}`}
        className="block aspect-[1000/600] w-full cursor-grab touch-none select-none rounded-lg bg-[#070d19] active:cursor-grabbing sm:aspect-[1000/430]"
        role="group"
        aria-label="World map of mission supplier locations, facilities and planned routes"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as Element).getAttribute("data-bg") === "1") guardedSelect(null);
        }}
      >
        <rect data-bg="1" x={-MAP_WIDTH} y={-MAP_HEIGHT} width={MAP_WIDTH * 3} height={MAP_HEIGHT * 3} fill="#070d19" />
        <g pointerEvents="none">
          {[-120, -60, 0, 60, 120].map((lon) => {
            const x = project(lon, 0).x;
            return <line key={lon} x1={x} x2={x} y1={0} y2={MAP_HEIGHT} stroke="#111c30" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
          })}
          {[-30, 0, 30, 60].map((lat) => {
            const y = project(0, lat).y;
            return <line key={lat} x1={0} x2={MAP_WIDTH} y1={y} y2={y} stroke="#111c30" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
          })}
          <path d={world.land} fill="#121d31" stroke="#243450" strokeWidth={0.75} vectorEffect="non-scaling-stroke" />
          <path d={world.borders} fill="none" stroke="#1b2942" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
          <path d={model.flowPath} fill="none" stroke="#51607c" strokeWidth={1} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        </g>

        {model.routes.map(({ route, path, status, affected, count, labelAt }) => {
          const selected = selection?.kind === "route" && selection.id === route.id;
          const focused = focus.routes.has(route.id);
          const dim = focus.active && !focused;
          const isTarget = targetRouteId === route.id;
          const color = affected || focused || selected ? (status ? STATUS_META[status].hex : NEUTRAL) : status && status !== "WITHIN_PLAN" ? STATUS_META[status].hex : ROUTE_IDLE;
          return (
            <g key={route.id} opacity={dim ? 0.18 : 1}>
              {selected && <path d={path} fill="none" stroke="#e8f1ff" strokeOpacity={0.35} strokeWidth={7} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeOpacity={affected || focused || selected ? 1 : 0.7}
                strokeWidth={affected || selected ? 2.4 : focused ? 2 : 1.3}
                strokeDasharray={isTarget ? "7 5" : undefined}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`Route ${route.code}: ${route.name}. ${count} component${count === 1 ? "" : "s"}.`}
                onClick={() => guardedSelect(selected ? null : { kind: "route", id: route.id })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(selected ? null : { kind: "route", id: route.id });
                  }
                }}
              >
                <title>{`${route.code} · ${route.name}`}</title>
              </path>
              {isTarget && scenario && labelAt && (
                <g transform={`translate(${labelAt.x},${labelAt.y}) scale(${unit})`} pointerEvents="none">
                  <rect x={-22} y={-10} width={44} height={18} rx={4} fill="#070d19" stroke={color} strokeWidth={1} />
                  <text textAnchor="middle" y={3.5} fontSize={11} fontWeight={600} fill={color} className="num">{`+${scenario.delayDays} d`}</text>
                </g>
              )}
            </g>
          );
        })}

        {dataset.locations.map((l) => {
          const p = project(l.longitude, l.latitude);
          const status = model.locationStatus.get(l.id) ?? null;
          const selected = selection?.kind === "location" && selection.id === l.id;
          const dim = focus.active && !focus.locations.has(l.id);
          const isTarget = targetLocationId === l.id;
          const color = status ? STATUS_META[status].hex : NEUTRAL;
          const label = labels.get(l.id);
          const aria = `${LOCATION_TYPE_LABELS[l.type]}: ${l.name}, ${l.city}, ${l.country}${status ? `. Related component status: ${STATUS_META[status].label}` : ""}`;
          return (
            <g
              key={l.id}
              transform={`translate(${p.x},${p.y}) scale(${unit})`}
              opacity={dim ? 0.35 : 1}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={aria}
              aria-pressed={selected}
              onClick={() => guardedSelect(selected ? null : { kind: "location", id: l.id })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(selected ? null : { kind: "location", id: l.id });
                }
              }}
            >
              <title>{aria}</title>
              <circle r={13} fill="transparent" />
              {selected && <circle r={11} fill="none" stroke="#e8f1ff" strokeWidth={1.5} />}
              {isTarget && scenario && (
                <>
                  <circle r={selected ? 15 : 11} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="3 3" />
                  <g transform="translate(0,-22)">
                    <rect x={-22} y={-10} width={44} height={18} rx={4} fill="#070d19" stroke={color} strokeWidth={1} />
                    <text textAnchor="middle" y={3.5} fontSize={11} fontWeight={600} fill={color} className="num">{`+${scenario.delayDays} d`}</text>
                  </g>
                </>
              )}
              <Glyph type={l.type} fill={l.type === "supplier" ? color : "#0b1220"} stroke={l.type === "supplier" ? "#070d19" : color} />
              {label && !(isTarget && label.y < 0) && (
                <text
                  x={label.x} y={label.y} textAnchor={label.anchor} fontSize={11}
                  fill={selected || focus.locations.has(l.id) ? "#e8f1ff" : "#9aa8c0"}
                  stroke="#070d19" strokeWidth={3} paintOrder="stroke" pointerEvents="none"
                >
                  {l.city}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <Button aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.5)} disabled={view.k >= MAX_ZOOM} className="!px-1.5"><Plus size={14} /></Button>
        <Button aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.5)} disabled={view.k <= 1} className="!px-1.5"><Minus size={14} /></Button>
        <Button aria-label="Reset view" title="Reset view" onClick={() => setView(HOME)} disabled={view.k === 1} className="!px-1.5"><RotateCcw size={14} /></Button>
      </div>
      {selection && (
        <div className="absolute left-2 top-2">
          <Button onClick={() => onSelect(null)}><XCircle size={13} /> Clear selection</Button>
        </div>
      )}
      <p className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] text-faint">{world.attribution}</p>
      <p className="pointer-events-none absolute bottom-1.5 left-2 hidden text-[10px] text-faint sm:block">Drag to pan · Ctrl/⌘ + scroll or buttons to zoom</p>
    </div>
  );
}

export function MapLegend() {
  const shapes: [LocationType, string][] = [
    ["supplier", "Supplier"], ["transit_hub", "Transit hub"], ["integration_facility", "Integration facility"],
    ["test_facility", "Test facility"], ["launch_site", "Launch site"],
  ];
  return (
    <div className="flex flex-col gap-2 text-[11px] text-muted">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {shapes.map(([type, label]) => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden><Glyph type={type} fill={type === "supplier" ? NEUTRAL : "#0b1220"} stroke={type === "supplier" ? "#070d19" : NEUTRAL} /></svg>
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <svg width={26} height={8} aria-hidden><line x1={1} x2={25} y1={4} y2={4} stroke={ROUTE_IDLE} strokeWidth={1.5} /></svg>
          Planned route
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width={26} height={8} aria-hidden><line x1={1} x2={25} y1={4} y2={4} stroke={NEUTRAL} strokeWidth={2} strokeDasharray="6 4" /></svg>
          Disrupted in scenario
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width={26} height={8} aria-hidden><line x1={1} x2={25} y1={4} y2={4} stroke="#51607c" strokeWidth={1} strokeDasharray="2 4" /></svg>
          Programme flow
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {(["WITHIN_PLAN", "TIGHT_MARGIN", "PROJECTED_MISS", "UNKNOWN"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS_META[s].hex }} />
            {s === "WITHIN_PLAN" ? "Within plan (> 7 d)" : s === "TIGHT_MARGIN" ? "Tight margin (0–7 d)" : s === "PROJECTED_MISS" ? "Projected miss (< 0 d)" : "Unknown / unresolved"}
          </span>
        ))}
      </div>
      <p className="text-faint">
        Colours show the schedule consequence for components linked to a supplier or route. They are not country or regional risk ratings.
      </p>
    </div>
  );
}
