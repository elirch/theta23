// Persistence for the theta23_space schema. Only authoritative inputs are
// stored; schedule results are always derived by src/lib/schedule.ts.
// No query in this file touches any schema other than theta23_space.

import { buildSeedDataset } from "@/lib/seed";
import type {
  ActionInput, ActionRecord, ActionStatus, Component, ComponentInput, Dataset, Location, Milestone, Mission,
  PlanInput, Route, Scenario,
} from "@/lib/types";
import type { Db } from "./db";

const S = "theta23_space";
const TS = `to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/** PostgreSQL "undefined table" / "invalid schema name": migration not applied. */
export function isSchemaMissingError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "3F000";
}

export async function loadDataset(db: Db): Promise<Dataset | null> {
  const missions = await db.query<Mission>(
    `select id, name, description, analysis_date::text as "analysisDate" from ${S}.missions order by id limit 1`,
  );
  const mission = missions[0];
  if (!mission) return null;

  const [locations, routeRows, stops, milestones, components, scenarios, actions] = await Promise.all([
    db.query<Location>(`select id, code, name, city, country, latitude, longitude, type from ${S}.locations order by code`),
    db.query<{ id: string; code: string; name: string }>(`select id, code, name from ${S}.routes order by code`),
    db.query<{ route_id: string; location_id: string }>(
      `select route_id, location_id from ${S}.route_stops order by route_id, position`,
    ),
    db.query<Milestone>(
      `select id, mission_id as "missionId", code, name, type, scheduled_date::text as "scheduledDate", sequence,
              min_days_after_previous as "minDaysAfterPrevious", alternative_date::text as "alternativeDate"
         from ${S}.milestones where mission_id = $1 order by sequence`,
      [mission.id],
    ),
    db.query<Component>(
      `select id, mission_id as "missionId", part_number as "partNumber", description, subsystem,
              supplier_name as "supplierName", supplier_location_id as "supplierLocationId", route_id as "routeId",
              milestone_id as "milestoneId", baseline_arrival_date::text as "baselineArrivalDate",
              preparation_days as "preparationDays", is_single_source as "isSingleSource", notes
         from ${S}.components where mission_id = $1 order by part_number`,
      [mission.id],
    ),
    db.query<Scenario>(
      `select id, name, description, target_type as "targetType", target_id as "targetId", delay_days as "delayDays"
         from ${S}.scenarios order by position, id`,
    ),
    db.query<ActionRecord>(
      `select a.id, a.component_id as "componentId", a.action_type as "actionType", a.owner, a.status, a.note,
              ${TS.replace("created_at", "a.created_at")} as "createdAt"
         from ${S}.action_records a join ${S}.components c on c.id = a.component_id
        where c.mission_id = $1 order by a.created_at, a.id`,
      [mission.id],
    ),
  ]);

  const routes: Route[] = routeRows.map((r) => ({
    ...r,
    locationIds: stops.filter((s) => s.route_id === r.id).map((s) => s.location_id),
  }));
  return { mission, locations, routes, milestones, components, scenarios, actions };
}

async function insertComponent(db: Db, c: Component): Promise<void> {
  await db.query(
    `insert into ${S}.components
       (id, mission_id, part_number, description, subsystem, supplier_name, supplier_location_id, route_id,
        milestone_id, baseline_arrival_date, preparation_days, is_single_source, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [c.id, c.missionId, c.partNumber, c.description, c.subsystem, c.supplierName, c.supplierLocationId, c.routeId,
     c.milestoneId, c.baselineArrivalDate, c.preparationDays, c.isSingleSource, c.notes],
  );
}

/**
 * Creates or updates components by (mission, part number), all in one
 * transaction: either every row is applied or none is.
 */
export async function upsertComponents(
  db: Db, missionId: string, inputs: ComponentInput[], newId: () => string,
): Promise<{ created: number; updated: number }> {
  return db.transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    for (const input of inputs) {
      const existing = await tx.query<{ id: string }>(
        `select id from ${S}.components where mission_id = $1 and lower(part_number) = lower($2)`,
        [missionId, input.partNumber],
      );
      const row = existing[0];
      if (row) {
        await tx.query(
          `update ${S}.components set description=$2, subsystem=$3, supplier_name=$4, supplier_location_id=$5,
                  route_id=$6, milestone_id=$7, baseline_arrival_date=$8, preparation_days=$9,
                  is_single_source=$10, notes=$11
            where id=$1`,
          [row.id, input.description, input.subsystem, input.supplierName, input.supplierLocationId, input.routeId,
           input.milestoneId, input.baselineArrivalDate, input.preparationDays, input.isSingleSource, input.notes],
        );
        updated++;
      } else {
        await insertComponent(tx, { ...input, id: newId(), missionId });
        created++;
      }
    }
    return { created, updated };
  });
}

export async function deleteComponent(db: Db, componentId: string): Promise<void> {
  await db.query(`delete from ${S}.components where id = $1`, [componentId]);
}

export async function updatePlan(db: Db, missionId: string, plan: PlanInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`update ${S}.missions set analysis_date = $2 where id = $1`, [missionId, plan.analysisDate]);
    for (const m of plan.milestones) {
      await tx.query(
        `update ${S}.milestones set scheduled_date=$3, alternative_date=$4, min_days_after_previous=$5
          where id=$1 and mission_id=$2`,
        [m.id, missionId, m.scheduledDate, m.alternativeDate, m.minDaysAfterPrevious],
      );
    }
  });
}

export async function addAction(db: Db, input: ActionInput, id: string): Promise<void> {
  await db.query(
    `insert into ${S}.action_records (id, component_id, action_type, owner, status, note)
     values ($1,$2,$3,$4,'open',$5)`,
    [id, input.componentId, input.actionType, input.owner, input.note],
  );
}

export async function setActionStatus(db: Db, actionId: string, status: ActionStatus): Promise<void> {
  await db.query(`update ${S}.action_records set status = $2 where id = $1`, [actionId, status]);
}

async function insertSeed(tx: Db): Promise<void> {
  const seed = buildSeedDataset();
  await tx.query(`insert into ${S}.missions (id, name, description, analysis_date) values ($1,$2,$3,$4)`, [
    seed.mission.id, seed.mission.name, seed.mission.description, seed.mission.analysisDate,
  ]);
  for (const l of seed.locations) {
    await tx.query(
      `insert into ${S}.locations (id, code, name, city, country, latitude, longitude, type) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [l.id, l.code, l.name, l.city, l.country, l.latitude, l.longitude, l.type],
    );
  }
  for (const r of seed.routes) {
    await tx.query(`insert into ${S}.routes (id, code, name) values ($1,$2,$3)`, [r.id, r.code, r.name]);
    for (const [position, locationId] of r.locationIds.entries()) {
      await tx.query(`insert into ${S}.route_stops (route_id, position, location_id) values ($1,$2,$3)`, [
        r.id, position, locationId,
      ]);
    }
  }
  for (const m of seed.milestones) {
    await tx.query(
      `insert into ${S}.milestones (id, mission_id, code, name, type, scheduled_date, sequence, min_days_after_previous, alternative_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [m.id, m.missionId, m.code, m.name, m.type, m.scheduledDate, m.sequence, m.minDaysAfterPrevious, m.alternativeDate],
    );
  }
  for (const c of seed.components) await insertComponent(tx, c);
  for (const [position, s] of seed.scenarios.entries()) {
    await tx.query(
      `insert into ${S}.scenarios (id, name, description, target_type, target_id, delay_days, position) values ($1,$2,$3,$4,$5,$6,$7)`,
      [s.id, s.name, s.description, s.targetType, s.targetId, s.delayDays, position],
    );
  }
}

/** Seeds the demo dataset only when no mission exists. Never overwrites. */
export async function seedIfEmpty(db: Db): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ n: number }>(`select count(*)::int as n from ${S}.missions`);
    if ((rows[0]?.n ?? 0) > 0) return false;
    await insertSeed(tx);
    return true;
  });
}

/**
 * Restores the illustrative demo dataset. Deletes rows only from the
 * theta23_space tables, inside one transaction, and never runs on startup.
 */
export async function resetDemoData(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of ["action_records", "components", "scenarios", "milestones", "route_stops", "routes", "locations", "missions"]) {
      await tx.query(`delete from ${S}.${table}`);
    }
    await insertSeed(tx);
  });
}
