import { describe, expect, it } from "vitest";
import { addDays, diffDays, isIsoDate } from "@/lib/dates";
import { explainComponent, explainMilestone, explainScenario } from "@/lib/explain";
import { applyActionAdd, applyPlan } from "@/lib/mutations";
import { evaluate, statusForMargin, type ScenarioEffect } from "@/lib/schedule";
import { buildSeedDataset } from "@/lib/seed";
import type { Component, Dataset, Milestone } from "@/lib/types";

const TLS = "loc-sup-tls";
const supplierDelay14: ScenarioEffect = { targetType: "supplier_location", targetId: TLS, delayDays: 14 };

/** The fixed worked example: one flight computer, an environmental test, a launch integration cutoff. */
function workedExample(alternativeDate: string | null = null): Dataset {
  const milestones: Milestone[] = [
    { id: "env", missionId: "m", code: "ENV-TEST", name: "Environmental Test Campaign", type: "test_campaign", scheduledDate: "2027-06-20", sequence: 1, minDaysAfterPrevious: null, alternativeDate },
    { id: "lic", missionId: "m", code: "LIC", name: "Launch Integration Cutoff", type: "integration_cutoff", scheduledDate: "2027-07-20", sequence: 2, minDaysAfterPrevious: 12, alternativeDate: null },
  ];
  const fc: Component = {
    id: "fc", missionId: "m", partNumber: "KS-FC-101", description: "Flight Computer", subsystem: "Avionics",
    supplierName: "Aurelia Avionique", supplierLocationId: TLS, routeId: "route-tls-abq", milestoneId: "env",
    baselineArrivalDate: "2027-06-01", preparationDays: 10, isSingleSource: false, notes: "",
  };
  const seed = buildSeedDataset();
  return { ...seed, milestones, components: [fc], actions: [] };
}

const byId = <T extends { milestoneId: string }>(list: T[], id: string): T => {
  const found = list.find((x) => x.milestoneId === id);
  if (!found) throw new Error(`no milestone ${id}`);
  return found;
};

describe("date arithmetic", () => {
  it("uses whole UTC calendar days across month, year and DST boundaries", () => {
    expect(addDays("2027-06-01", 14)).toBe("2027-06-15");
    expect(addDays("2027-03-27", 2)).toBe("2027-03-29"); // EU DST change weekend
    expect(addDays("2027-12-25", 10)).toBe("2028-01-04");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(diffDays("2027-06-20", "2027-06-25")).toBe(-5);
    expect(diffDays("2027-11-08", "2027-10-30")).toBe(9); // US DST change in between
  });
  it("rejects impossible or malformed dates", () => {
    expect(isIsoDate("2027-02-30")).toBe(false);
    expect(isIsoDate("2027-6-1")).toBe(false);
    expect(isIsoDate("06/01/2027")).toBe(false);
    expect(isIsoDate("2027-06-01")).toBe(true);
  });
});

describe("1 · the June worked example", () => {
  it("baseline: ready June 11, margin +9, WITHIN PLAN", () => {
    const r = evaluate(workedExample(), null).components.fc!;
    expect(r.adjustedArrival).toBe("2027-06-01");
    expect(r.readiness).toBe("2027-06-11");
    expect(r.margin).toBe(9);
    expect(r.status).toBe("WITHIN_PLAN");
  });

  it("14-day supplier delay: arrival June 15, ready June 25, margin −5, PROJECTED MISS", () => {
    const r = evaluate(workedExample(), supplierDelay14).components.fc!;
    expect(r.adjustedArrival).toBe("2027-06-15");
    expect(r.readiness).toBe("2027-06-25");
    expect(r.margin).toBe(-5);
    expect(r.status).toBe("PROJECTED_MISS");
  });

  it("produces the required plain-language explanation", () => {
    const data = workedExample();
    const ev = evaluate(data, supplierDelay14);
    expect(explainComponent(data.components[0]!, ev.components.fc!, data.milestones[0], supplierDelay14)).toBe(
      "Supplier delay adds 14 days. The flight computer becomes ready on June 25, five days after the June 20 environmental test campaign.",
    );
    expect(explainMilestone(data.milestones[0]!, byId(ev.milestones, "env"), data)[0]).toBe(
      "The original test slot is projected to be missed. Downstream launch integration timing remains unresolved until an alternative slot is confirmed.",
    );
  });
});

describe("2 · status thresholds", () => {
  it("zero margin is TIGHT MARGIN, not a miss", () => {
    expect(statusForMargin(0)).toBe("TIGHT_MARGIN");
    const data = workedExample();
    data.components[0]!.baselineArrivalDate = "2027-06-10"; // ready exactly June 20
    const ev = evaluate(data, null);
    expect(ev.components.fc!.margin).toBe(0);
    expect(ev.components.fc!.status).toBe("TIGHT_MARGIN");
    expect(byId(ev.milestones, "env").status).toBe("TIGHT_MARGIN");
    expect(byId(ev.milestones, "env").plannedOccurrence).toBe("2027-06-20");
  });
  it("7 is tight, 8 is within plan, −1 is a miss, missing data is unknown", () => {
    expect(statusForMargin(7)).toBe("TIGHT_MARGIN");
    expect(statusForMargin(8)).toBe("WITHIN_PLAN");
    expect(statusForMargin(-1)).toBe("PROJECTED_MISS");
    expect(statusForMargin(null)).toBe("UNKNOWN");
  });
  it("a component with missing inputs is UNKNOWN and keeps its milestone from looking safe", () => {
    const data = workedExample();
    data.components[0]!.baselineArrivalDate = null;
    const ev = evaluate(data, null);
    expect(ev.components.fc!.status).toBe("UNKNOWN");
    expect(ev.components.fc!.missing).toEqual(["baselineArrivalDate"]);
    const env = byId(ev.milestones, "env");
    expect(env.status).toBe("UNKNOWN");
    expect(env.plannedOccurrence).toBeNull();
    expect(byId(ev.milestones, "lic").status).toBe("UNRESOLVED");
  });
});

describe("3–6 · scenario targeting on the seed dataset", () => {
  const seed = buildSeedDataset();
  const baseline = evaluate(seed, null);

  it("3 · a supplier scenario affects only components from that supplier location", () => {
    const scenario = seed.scenarios.find((s) => s.id === "scn-a")!;
    const ev = evaluate(seed, scenario);
    for (const c of seed.components) {
      const expected = c.supplierLocationId === scenario.targetId;
      expect(ev.components[c.id]!.targeted, c.partNumber).toBe(expected);
      expect(ev.components[c.id]!.delayDays, c.partNumber).toBe(expected ? 14 : 0);
      if (!expected) expect(ev.components[c.id]).toEqual(baseline.components[c.id]);
    }
    expect(ev.summary.affectedComponentIds).toEqual(["cmp-ks-fc-101"]);
  });

  it("4 · a route scenario affects all and only components on that route", () => {
    const scenario = seed.scenarios.find((s) => s.id === "scn-b")!;
    const ev = evaluate(seed, scenario);
    const onRoute = seed.components.filter((c) => c.routeId === scenario.targetId).map((c) => c.id);
    expect(onRoute.length).toBe(2);
    expect([...ev.summary.affectedComponentIds].sort()).toEqual([...onRoute].sort());
    for (const c of seed.components) {
      const r = ev.components[c.id]!;
      if (onRoute.includes(c.id)) {
        expect(r.adjustedArrival).toBe(addDays(c.baselineArrivalDate!, 8));
        expect(r.margin).toBe(baseline.components[c.id]!.margin! - 8);
      } else {
        expect(r).toEqual(baseline.components[c.id]);
      }
    }
    // A component at the same supplier location but on another route is not delayed.
    const sameSupplierOtherRoute = seed.components.find((c) => c.partNumber === "KS-SR-909")!;
    expect(ev.components[sameSupplierOtherRoute.id]!.delayDays).toBe(0);
  });

  it("5 · switching scenarios never accumulates delay", () => {
    const [a, b, c] = seed.scenarios;
    const snapshot = JSON.stringify(seed);
    const firstA = evaluate(seed, a!);
    evaluate(seed, b!);
    evaluate(seed, c!);
    evaluate(seed, { targetType: "supplier_location", targetId: TLS, delayDays: 99 });
    const secondA = evaluate(seed, a!);
    expect(secondA).toEqual(firstA);
    expect(secondA.components["cmp-ks-fc-101"]!.readiness).toBe("2027-06-25");
    expect(JSON.stringify(seed)).toBe(snapshot); // inputs are never mutated
  });

  it("6 · returning to baseline restores every baseline result", () => {
    for (const s of seed.scenarios) evaluate(seed, s);
    const again = evaluate(seed, null);
    expect(again).toEqual(baseline);
    expect(again.summary.affectedComponentIds).toEqual([]);
    expect(again.summary.missedMilestoneIds).toEqual([]);
    for (const c of seed.components) expect(again.components[c.id]!.adjustedArrival).toBe(c.baselineArrivalDate);
  });

  it("the seeded baseline is achievable with some tight margins", () => {
    expect(baseline.milestones.map((m) => [m.readiness, m.margin, m.status])).toEqual([
      ["2027-04-28", 12, "WITHIN_PLAN"],
      ["2027-06-14", 6, "TIGHT_MARGIN"],
      ["2027-07-10", 10, "WITHIN_PLAN"],
    ]);
    expect(baseline.summary.nextMilestoneId).toBe("ms-ait-rr");
    expect(baseline.summary.lowestMargin).toEqual({ milestoneId: "ms-env-test", margin: 6 });
    // Ties are all reported as limiting dependencies.
    expect(baseline.milestones[0]!.limiting.map((l) => (l.kind === "component" ? l.componentId : l.milestoneId)).sort())
      .toEqual(["cmp-ks-bt-405", "cmp-ks-sp-707"]);
  });

  it("scenario A in the seed reproduces the worked example and leaves launch integration unresolved", () => {
    const ev = evaluate(seed, seed.scenarios[0]!);
    expect(ev.components["cmp-ks-fc-101"]!.margin).toBe(-5);
    expect(ev.summary.missedMilestoneIds).toEqual(["ms-env-test"]);
    expect(ev.summary.unresolvedMilestoneIds).toEqual(["ms-env-test", "ms-lic"]);
    expect(byId(ev.milestones, "ms-lic").status).toBe("UNRESOLVED");
    expect(explainScenario(seed.scenarios[0]!, seed, ev).join(" ")).toContain(
      "Changing the freight route cannot recover this delay",
    );
  });
});

describe("7–9, 11 · missed test, alternative slots and downstream timing", () => {
  it("7 · a missed test without an alternative leaves downstream timing unresolved", () => {
    const ev = evaluate(workedExample(null), supplierDelay14);
    const env = byId(ev.milestones, "env");
    expect(env.status).toBe("PROJECTED_MISS");
    expect(env.margin).toBe(-5);
    expect(env.plannedOccurrence).toBeNull();
    expect(env.unresolvedReasons).toEqual([{ kind: "missed_no_usable_alternative", alternativeTooEarly: false }]);

    const lic = byId(ev.milestones, "lic");
    expect(lic.status).toBe("UNRESOLVED"); // never shown as safe
    expect(lic.readiness).toBeNull();
    expect(lic.margin).toBeNull();
    expect(lic.plannedOccurrence).toBeNull();
    expect(lic.unresolvedReasons).toEqual([{ kind: "predecessor_unresolved", milestoneId: "env" }]);
    // It does not assume the test happens the day hardware is ready: only a bound is reported.
    expect(lic.lowerBound).toBe("2027-07-07");
    expect(lic.knownBreach).toBe(false);
    expect(ev.summary.lowestMargin).toEqual({ milestoneId: "env", margin: -5 });
  });

  it("8 · a valid alternative slot (July 2) propagates: launch integration ready July 14, +6, TIGHT", () => {
    const ev = evaluate(workedExample("2027-07-02"), supplierDelay14);
    const env = byId(ev.milestones, "env");
    expect(env.status).toBe("PROJECTED_MISS"); // the original June 20 miss stays visible
    expect(env.margin).toBe(-5);
    expect(env.alternativeUsable).toBe(true);
    expect(env.plannedOccurrence).toBe("2027-07-02");
    expect(env.plannedVia).toBe("alternative");

    const lic = byId(ev.milestones, "lic");
    expect(lic.readiness).toBe("2027-07-14");
    expect(lic.margin).toBe(6);
    expect(lic.status).toBe("TIGHT_MARGIN");
    expect(lic.limiting).toEqual([{ kind: "predecessor", milestoneId: "env", date: "2027-07-14" }]);
    expect(ev.summary.missedMilestoneIds).toEqual(["env"]);
    expect(ev.summary.unresolvedMilestoneIds).toEqual([]);
  });

  it("8b · the same result in the full seed dataset once the July 2 slot is entered", () => {
    const seed = buildSeedDataset();
    const withAlt = applyPlan(seed, {
      analysisDate: seed.mission.analysisDate,
      milestones: seed.milestones.map((m) => ({
        id: m.id, scheduledDate: m.scheduledDate, minDaysAfterPrevious: m.minDaysAfterPrevious,
        alternativeDate: m.id === "ms-env-test" ? "2027-07-02" : null,
      })),
    });
    const lic = byId(evaluate(withAlt, seed.scenarios[0]!).milestones, "ms-lic");
    expect([lic.readiness, lic.margin, lic.status]).toEqual(["2027-07-14", 6, "TIGHT_MARGIN"]);
  });

  it("9 · an alternative date earlier than readiness is rejected", () => {
    const data = workedExample("2027-06-23"); // readiness is June 25
    const ev = evaluate(data, supplierDelay14);
    const env = byId(ev.milestones, "env");
    expect(env.alternativeUsable).toBe(false);
    expect(env.alternativeMargin).toBe(-2);
    expect(env.plannedOccurrence).toBeNull();
    expect(env.unresolvedReasons).toEqual([{ kind: "missed_no_usable_alternative", alternativeTooEarly: true }]);
    expect(byId(ev.milestones, "lic").status).toBe("UNRESOLVED");
    expect(explainMilestone(data.milestones[0]!, env, data).join(" ")).toContain("cannot be used");
  });

  it("9b · an alternative exactly on the readiness date is usable", () => {
    const ev = evaluate(workedExample("2027-06-25"), supplierDelay14);
    expect(byId(ev.milestones, "env").plannedOccurrence).toBe("2027-06-25");
    expect(byId(ev.milestones, "lic").readiness).toBe("2027-07-07");
  });

  it("11 · original and alternative margins are reported separately and never merged", () => {
    const ev = evaluate(workedExample("2027-07-02"), supplierDelay14);
    const fc = ev.components.fc!;
    expect(fc.margin).toBe(-5); // anchored to the original June 20 commitment
    expect(fc.status).toBe("PROJECTED_MISS");
    expect(fc.alternativeMargin).toBe(7); // July 2 − June 25
    const env = byId(ev.milestones, "env");
    expect(env.margin).toBe(-5);
    expect(env.alternativeMargin).toBe(7);

    // When the original date holds, the alternative is shown but not used.
    const onTime = evaluate(workedExample("2027-07-02"), null);
    const envOnTime = byId(onTime.milestones, "env");
    expect(envOnTime.margin).toBe(9);
    expect(envOnTime.plannedOccurrence).toBe("2027-06-20");
    expect(envOnTime.plannedVia).toBe("scheduled");
    expect(byId(onTime.milestones, "lic").readiness).toBe("2027-07-02"); // June 20 + 12
  });

  it("shows a known downstream breach alongside the unresolved predecessor", () => {
    const data = workedExample(null);
    data.components.push({
      ...data.components[0]!, id: "late", partNumber: "KS-LATE-1", description: "Late Unit",
      supplierLocationId: "loc-sup-blr", routeId: "route-blr-abq", milestoneId: "lic",
      baselineArrivalDate: "2027-07-15", preparationDays: 10, // ready July 25 > July 20
    });
    const lic = byId(evaluate(data, supplierDelay14).milestones, "lic");
    expect(lic.status).toBe("PROJECTED_MISS");
    expect(lic.knownBreach).toBe(true);
    expect(lic.knownBreachMargin).toBe(-5);
    expect(lic.componentReadiness).toBe("2027-07-25");
    expect(lic.readiness).toBeNull(); // still unresolved: the true date depends on the test slot
    expect(lic.unresolvedReasons).toEqual([{ kind: "predecessor_unresolved", milestoneId: "env" }]);
  });
});

describe("10 · single-source status", () => {
  it("adds no delay by itself", () => {
    const data = workedExample();
    const plain = evaluate(data, null).components.fc!;
    data.components[0]!.isSingleSource = true;
    expect(evaluate(data, null).components.fc!).toEqual(plain);
    expect(evaluate(data, supplierDelay14).components.fc!.delayDays).toBe(14);
  });
  it("scenario C's 21 days come from the scenario, not the flag", () => {
    const seed = buildSeedDataset();
    const c = seed.scenarios.find((s) => s.id === "scn-c")!;
    const st = seed.components.find((x) => x.partNumber === "KS-ST-202")!;
    expect(st.isSingleSource).toBe(true);
    expect(evaluate(seed, null).components[st.id]!.delayDays).toBe(0);
    expect(evaluate(seed, c).components[st.id]!.delayDays).toBe(21);
    st.isSingleSource = false;
    expect(evaluate(seed, c).components[st.id]!.delayDays).toBe(21);
  });
});

describe("13 · action records", () => {
  it("do not change any schedule calculation", () => {
    const seed = buildSeedDataset();
    const scenario = seed.scenarios[0]!;
    const before = evaluate(seed, scenario);
    let withActions = applyActionAdd(
      seed, { componentId: "cmp-ks-fc-101", actionType: "confirm_alternative_test_slot", owner: "M. Okafor", note: "Asked for July 2" },
      "a1", "2027-04-12T09:00:00Z",
    );
    withActions = applyActionAdd(
      withActions, { componentId: "cmp-ks-fc-101", actionType: "contact_supplier", owner: "M. Okafor", note: "" },
      "a2", "2027-04-12T09:05:00Z",
    );
    expect(withActions.actions).toHaveLength(2);
    expect(evaluate(withActions, scenario)).toEqual(before);
  });
});

describe("summary", () => {
  it("reports no next milestone when every milestone is in the past", () => {
    const seed = buildSeedDataset();
    seed.mission.analysisDate = "2028-01-01";
    expect(evaluate(seed, null).summary.nextMilestoneId).toBeNull();
  });
  it("a milestone on the analysis date still counts as next", () => {
    const seed = buildSeedDataset();
    seed.mission.analysisDate = "2027-06-20";
    expect(evaluate(seed, null).summary.nextMilestoneId).toBe("ms-env-test");
  });
});
