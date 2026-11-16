// Server actions must refuse writes and resets without a valid owner session.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSeedDataset } from "@/lib/seed";
import type { Db } from "@/server/db";
import { normalize } from "./helpers/normalize";
import { createTestDb } from "./helpers/pglite";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

let testDb: Db | null = null;
vi.mock("@/server/db", async (original) => ({
  ...(await original<typeof import("@/server/db")>()),
  getDb: () => testDb,
}));

import * as actions from "@/server/actions";
import { createSessionToken, SESSION_COOKIE, verifySessionToken } from "@/server/auth";
import { loadDataset, seedIfEmpty } from "@/server/repo";

const SECRET = "test-session-secret-0123456789abcdef";
const PASSWORD = "correct horse battery staple";

beforeAll(async () => {
  ({ db: testDb } = await createTestDb());
  await seedIfEmpty(testDb!);
});

beforeEach(() => {
  jar.clear();
  process.env.OWNER_PASSWORD = PASSWORD;
  process.env.SESSION_SECRET = SECRET;
});

const seed = buildSeedDataset();
const fc = seed.components[0]!;
const plan = {
  analysisDate: "2027-04-12",
  milestones: seed.milestones.map((m) => ({ id: m.id, scheduledDate: "2029-01-01", alternativeDate: null, minDaysAfterPrevious: m.minDaysAfterPrevious })),
};
const csvFile =
  "partNumber,description,subsystem,supplierLocationCode,supplierName,routeCode,milestoneCode,baselineArrivalDate,preparationDays,isSingleSource,notes\n" +
  "KS-HACK-1,Injected,Avionics,SUP-TLS,Nobody,RT-TLS-ABQ,ENV-TEST,2027-06-01,1,false,\n";

const everyWrite: [string, () => Promise<actions.ActionResult>][] = [
  ["saveComponent", () => actions.saveComponentAction({ ...fc, baselineArrivalDate: "2030-01-01" })],
  ["deleteComponent", () => actions.deleteComponentAction(fc.id)],
  ["importCsv", () => actions.importCsvAction(csvFile)],
  ["savePlan", () => actions.savePlanAction(plan)],
  ["addActionRecord", () => actions.addActionRecordAction({ componentId: fc.id, actionType: "contact_supplier", owner: "x", note: "" })],
  ["setActionStatus", () => actions.setActionStatusAction("any", "closed")],
  ["resetDemoData", () => actions.resetDemoDataAction()],
];

describe("15 · unauthorized writes and demo resets are rejected", () => {
  const expectUntouched = async () => expect(normalize(await loadDataset(testDb!))).toEqual(normalize(seed));

  it.each(everyWrite)("%s is refused for an anonymous visitor", async (_name, run) => {
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not authorized/i);
    await expectUntouched();
  });

  it.each([
    ["a forged signature", () => `owner.${Date.now() + 3_600_000}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`],
    ["a token signed with another secret", () => createSessionToken("some-other-secret-0123456789", Date.now())],
    ["an expired token", () => createSessionToken(SECRET, Date.now() - 13 * 3_600_000)],
    ["a tampered expiry", () => {
      const [role, , sig] = createSessionToken(SECRET, Date.now() - 13 * 3_600_000).split(".");
      return `${role}.${Date.now() + 3_600_000}.${sig}`;
    }],
  ])("writes and resets are refused with %s", async (_label, makeToken) => {
    jar.set(SESSION_COOKIE, makeToken());
    for (const [, run] of everyWrite) expect((await run()).ok).toBe(false);
    await expectUntouched();
  });

  it("a wrong password does not create a session", async () => {
    expect(await actions.signInAction("guess")).toEqual({ ok: false, error: "Incorrect password." });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect((await actions.resetDemoDataAction()).ok).toBe(false);
  });

  it("owner sign-in is unavailable when secrets are not configured — even with the right cookie", async () => {
    jar.set(SESSION_COOKIE, createSessionToken(SECRET, Date.now()));
    delete process.env.OWNER_PASSWORD;
    expect((await actions.resetDemoDataAction()).ok).toBe(false);
    expect((await actions.signInAction("")).ok).toBe(false);
    process.env.OWNER_PASSWORD = PASSWORD;
    process.env.SESSION_SECRET = "short";
    expect((await actions.signInAction(PASSWORD)).ok).toBe(false);
  });

  it("session tokens verify only when signed, unexpired and for the owner role", () => {
    const now = Date.now();
    expect(verifySessionToken(createSessionToken(SECRET, now), SECRET, now)).toBe(true);
    expect(verifySessionToken(undefined, SECRET, now)).toBe(false);
    expect(verifySessionToken("garbage", SECRET, now)).toBe(false);
  });
});

describe("the signed-in owner", () => {
  it("can save, and the server re-validates what it is sent", async () => {
    expect(await actions.signInAction(PASSWORD)).toEqual({ ok: true });

    const invalid = await actions.saveComponentAction({ ...fc, preparationDays: -2 });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.fieldErrors?.[0]?.field).toBe("preparationDays");

    const badCsv = await actions.importCsvAction(csvFile + "KS-HACK-2,Bad,Avionics,SUP-TLS,Nobody,RT-TLS-ABQ,NOPE,2027-06-01,1,false,\n");
    expect(badCsv.ok).toBe(false);
    if (!badCsv.ok) expect(badCsv.csvErrors?.[0]).toMatchObject({ line: 3, column: "milestoneCode" });
    expect(normalize(await loadDataset(testDb!))).toEqual(normalize(seed)); // atomic: the valid first row was not imported

    const saved = await actions.saveComponentAction({ ...fc, baselineArrivalDate: "2027-06-03" });
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.dataset.components.find((c) => c.id === fc.id)!.baselineArrivalDate).toBe("2027-06-03");

    const reset = await actions.resetDemoDataAction();
    expect(reset.ok).toBe(true);
    expect(normalize(await loadDataset(testDb!))).toEqual(normalize(seed));

    await actions.signOutAction();
    expect((await actions.saveComponentAction(fc)).ok).toBe(false);
  });

  it("cannot write when no database is configured", async () => {
    await actions.signInAction(PASSWORD);
    const keep = testDb;
    testDb = null;
    const result = await actions.resetDemoDataAction();
    testDb = keep;
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/no database/i);
  });
});
