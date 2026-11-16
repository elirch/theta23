// Shared helpers for the database scripts. Loads .env.local when present.
import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";

export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
    }
  }
}

export function connect(): Pool {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Add it to .env.local or the environment.");
    process.exit(1);
  }
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  const ca = process.env.DATABASE_CA_CERT;
  return new Pool({
    connectionString: url.toString(),
    max: 1,
    ssl: local ? undefined : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  });
}
