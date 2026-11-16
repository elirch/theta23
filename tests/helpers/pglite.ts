// Embedded PostgreSQL (PGlite) behind the same Db port the app uses in production.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "@/server/db";

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (sql: string) => Promise<unknown>;
};

function wrap(q: Queryable): Omit<Db, "transaction"> {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await q.query(text, params)).rows as T[];
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  };
}

export const MIGRATION_SQL = readFileSync(
  path.join(process.cwd(), "supabase", "migrations", "0001_theta23_space.sql"),
  "utf8",
);

export async function createTestDb(options: { migrate?: boolean } = {}): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite();
  const db: Db = {
    ...wrap(pg as unknown as Queryable),
    transaction: (fn) =>
      pg.transaction(async (tx) =>
        fn({
          ...wrap(tx as unknown as Queryable),
          transaction: () => {
            throw new Error("nested transaction");
          },
        }),
      ) as never,
  };
  if (options.migrate !== false) await db.exec(MIGRATION_SQL);
  return { db, pg };
}
