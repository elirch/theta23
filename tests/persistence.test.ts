// Runs the real migration and repository SQL against an embedded PostgreSQL.
import { beforeAll, describe, expect, it } from "vitest";
import { parseComponentsCsv } from "@/lib/csv";
import { evaluate } from "@/lib/schedule";
import { buildSeedDataset } from "@/lib/seed";
import type { Db } from "@/server/db";
import {
  addAction, deleteComponent, isSchemaMissingError, loadDataset, resetDemoData, seedIfEmpty, setActionStatus,
  updatePlan, upsertComponents,
} from "@/server/repo";
import { normalize } from "./helpers/normalize";
import { createTestDb, MIGRATION_SQL } from "./helpers/pglite";

let db: Db;
let n = 0;
const newId = () => `test-id-${++n}`;

beforeAll(async () => {
  ({ db } = await createTestDb({ migrate: false }));
  // Stand-ins for the retired financial application's tables.
  await db.exec(`
    create table public.geo_events (id serial primary key, title text);
    create table public.reports (id serial primary key, week_of date);
    insert into public.geo_events (title) values ('legacy row 1'), ('legacy row 2');
    insert into public.reports (week_of) values ('2026-01-05');
  `);
});

const legacyCounts = async () =>
  (await db.query<{ a: number; b: number }>(
    `select (select count(*)::int from public.geo_events) as a, (select count(*)::int from public.reports) as b`,
  ))[0];

describe("migration and seeding", () => {
  it("reports a missing schema before the migration is applied", async () => {
    await expect(loadDataset(db)).rejects.toSatisfy(isSchemaMissingError);
  });

  it("migration is idempotent and creates only theta23_space objects", async () => {
    await db.exec(MIGRATION_SQL);
    await db.exec(MIGRATION_SQL);
    const tables = await db.query<{ table_schema: string; n: number }>(
      `select table_schema, count(*)::int as n from information_schema.tables
        where table_schema in ('public','theta23_space') group by table_schema order by table_schema`,
    );
    expect(tables).toEqual([{ table_schema: "public", n: 2 }, { table_schema: "theta23_space", n: 8 }]);
    expect(await loadDataset(db)).toBeNull(); // migrated but not seeded
  });

  it("seeds once and never overwrites saved data", async () => {
    expect(await seedIfEmpty(db)).toBe(true);
    const loaded = await loadDataset(db);
    const seed = buildSeedDataset();
    expect(loaded!.mission).toEqual(seed.mission);
    expect(loaded!.components).toHaveLength(10);
    expect(loaded!.locations).toHaveLength(10);
    expect(loaded!.routes.find((r) => r.code === "RT-NGO-ABQ")!.locationIds).toEqual(["loc-sup-ngo", "loc-hub-anc", "loc-fac-abq"]);
    // The database round-trip yields exactly the same schedule as the bundled seed.
    expect(evaluate(loaded!, loaded!.scenarios[0]!)).toEqual(evaluate(seed, seed.scenarios[0]!));

    await updatePlan(db, seed.mission.id, {
      analysisDate: "2027-04-20",
      milestones: seed.milestones.map((m) => ({ id: m.id, scheduledDate: m.scheduledDate, alternativeDate: null, minDaysAfterPrevious: m.minDaysAfterPrevious })),
    });
    expect(await seedIfEmpty(db)).toBe(false);
    expect((await loadDataset(db))!.mission.analysisDate).toBe("2027-04-20"); // not shifted or re-seeded
  });
});

describe("14 · persistence after reload", () => {
  it("saved edits, plan changes and action records survive a fresh load", async () => {
    const before = (await loadDataset(db))!;
    const fc = before.components.find((c) => c.partNumber === "KS-FC-101")!;

    await upsertComponents(db, before.mission.id, [{ ...fc, baselineArrivalDate: "2027-06-05", notes: "Slipped per supplier call" }], newId);
    await updatePlan(db, before.mission.id, {
      analysisDate: "2027-04-12",
      milestones: before.milestones.map((m) => ({
        id: m.id, scheduledDate: m.scheduledDate, minDaysAfterPrevious: m.minDaysAfterPrevious,
        alternativeDate: m.code === "ENV-TEST" ? "2027-07-02" : null,
      })),
    });
    await addAction(db, { componentId: fc.id, actionType: "confirm_alternative_test_slot", owner: "R. Lindqvist", note: "Hold July 2" }, "act-1");
    await setActionStatus(db, "act-1", "in_progress");

    const reloaded = (await loadDataset(db))!;
    const fcReloaded = reloaded.components.find((c) => c.partNumber === "KS-FC-101")!;
    expect(fcReloaded.id).toBe(fc.id); // updated in place, not duplicated
    expect(fcReloaded.baselineArrivalDate).toBe("2027-06-05");
    expect(fcReloaded.notes).toBe("Slipped per supplier call");
    expect(reloaded.components).toHaveLength(10);
    expect(reloaded.mission.analysisDate).toBe("2027-04-12");
    expect(reloaded.milestones.find((m) => m.code === "ENV-TEST")!.alternativeDate).toBe("2027-07-02");
    expect(reloaded.actions).toHaveLength(1);
    expect(reloaded.actions[0]).toMatchObject({ id: "act-1", componentId: fc.id, status: "in_progress", owner: "R. Lindqvist" });
    expect(reloaded.actions[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    // Scenario exploration is derived, so baseline dates in storage are untouched.
    evaluate(reloaded, reloaded.scenarios[0]!);
    expect((await loadDataset(db))!.components.find((c) => c.partNumber === "KS-FC-101")!.baselineArrivalDate).toBe("2027-06-05");
  });

  it("13 · stored action records do not change calculations", async () => {
    const withAction = (await loadDataset(db))!;
    const withoutAction = { ...withAction, actions: [] };
    expect(evaluate(withAction, withAction.scenarios[0]!)).toEqual(evaluate(withoutAction, withAction.scenarios[0]!));
  });
});

describe("12 · CSV import against the database", () => {
  const line = (part: string, prep: string) =>
    `${part},Sun Sensor,Attitude Control,SUP-MUC,Isarwerk Optik,RT-MUC-ABQ,ENV-TEST,2027-05-20,${prep},false,`;
  const header = "partNumber,description,subsystem,supplierLocationCode,supplierName,routeCode,milestoneCode,baselineArrivalDate,preparationDays,isSingleSource,notes";

  it("re-importing the same file creates no duplicates", async () => {
    const file = [header, line("KS-SS-010", "5"), line("ks-fc-101", "9")].join("\n");
    const current = (await loadDataset(db))!;
    const parsed = parseComponentsCsv(file, current);
    // KS-FC-101 exists; its route must start at the supplier, so fix the row for this check.
    expect(parsed.valid).toBe(true);
    expect([parsed.created, parsed.updated]).toEqual([1, 1]);
    expect(await upsertComponents(db, current.mission.id, parsed.rows.map((r) => r.input), newId)).toEqual({ created: 1, updated: 1 });
    const again = parseComponentsCsv(file, (await loadDataset(db))!);
    expect([again.created, again.updated]).toEqual([0, 2]);
    expect(await upsertComponents(db, current.mission.id, again.rows.map((r) => r.input), newId)).toEqual({ created: 0, updated: 2 });
    const after = (await loadDataset(db))!;
    expect(after.components).toHaveLength(11);
    expect(after.components.filter((c) => c.partNumber.toLowerCase() === "ks-fc-101")).toHaveLength(1);
  });

  it("a failure part-way through rolls the whole batch back", async () => {
    const current = (await loadDataset(db))!;
    const good = current.components.find((c) => c.partNumber === "KS-SS-010")!;
    await expect(
      upsertComponents(db, current.mission.id, [
        { ...good, partNumber: "KS-OK-001" },
        { ...good, partNumber: "KS-BAD-002", supplierLocationId: "loc-does-not-exist" }, // violates the foreign key
      ], newId),
    ).rejects.toThrow();
    const after = (await loadDataset(db))!;
    expect(after.components).toHaveLength(11);
    expect(after.components.some((c) => c.partNumber === "KS-OK-001")).toBe(false);
  });

  it("the database itself refuses negative preparation days and duplicate part numbers", async () => {
    const current = (await loadDataset(db))!;
    const good = current.components.find((c) => c.partNumber === "KS-SS-010")!;
    await expect(upsertComponents(db, current.mission.id, [{ ...good, partNumber: "KS-NEG-1", preparationDays: -1 }], newId)).rejects.toThrow();
    await expect(
      db.query(
        `insert into theta23_space.components (id, mission_id, part_number, description, subsystem, supplier_name, supplier_location_id)
         values ('dup', $1, 'ks-ss-010', 'x', 'x', 'x', 'loc-sup-muc')`,
        [current.mission.id],
      ),
    ).rejects.toThrow();
  });
});

describe("demo reset", () => {
  it("restores the seed and leaves every legacy table untouched", async () => {
    const legacyBefore = await legacyCounts();
    const current = (await loadDataset(db))!;
    await deleteComponent(db, current.components[0]!.id);
    await resetDemoData(db);
    const after = (await loadDataset(db))!;
    expect(normalize(after)).toEqual(normalize(buildSeedDataset()));
    expect(await legacyCounts()).toEqual(legacyBefore);
    expect(legacyBefore).toEqual({ a: 2, b: 1 });
  });

  it("no statement in the repository or migration names a schema other than theta23_space", async () => {
    const { readFileSync } = await import("node:fs");
    const repo = readFileSync("src/server/repo.ts", "utf8");
    expect(repo).not.toMatch(/\bpublic\./);
    expect(repo).not.toMatch(/\b(drop|truncate)\b/i);
    const withoutComments = MIGRATION_SQL.replace(/--.*$/gm, "");
    expect(withoutComments).not.toMatch(/\bpublic\b/);
    expect(withoutComments).not.toMatch(/\b(drop|truncate|delete\s+from)\b/i);
    for (const m of withoutComments.matchAll(/\b(?:table|index|on|references)\s+(?:if not exists\s+)?([a-z_0-9]+)\.[a-z_]+/gi)) {
      expect(m[1]).toBe("theta23_space");
    }
  });
});
