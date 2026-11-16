// Minimal database port. Production uses node-postgres against Supabase
// PostgreSQL; tests use an embedded PostgreSQL (PGlite) through the same port.

import { Pool, type PoolClient } from "pg";

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs one or more statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

function clientDb(client: PoolClient): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await client.query(text, params)).rows as T[];
    },
    async exec(sql) {
      await client.query(sql);
    },
    transaction() {
      throw new Error("Nested transactions are not supported.");
    },
  };
}

export function poolDb(pool: Pool): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pool.query(text, params)).rows as T[];
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(clientDb(client));
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export function createPool(connectionString: string, caCert?: string): Pool {
  const url = new URL(connectionString);
  // TLS is configured explicitly below; drop sslmode so it cannot override it.
  url.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  return new Pool({
    connectionString: url.toString(),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: local ? undefined : caCert ? { ca: caCert, rejectUnauthorized: true } : { rejectUnauthorized: false },
  });
}

const globalForDb = globalThis as unknown as { __theta23Pool?: Pool };

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** The shared pool for this server instance; null when DATABASE_URL is unset. */
export function getDb(): Db | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!globalForDb.__theta23Pool) {
    globalForDb.__theta23Pool = createPool(connectionString, process.env.DATABASE_CA_CERT || undefined);
    globalForDb.__theta23Pool.on("error", () => undefined);
  }
  return poolDb(globalForDb.__theta23Pool);
}
