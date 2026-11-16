// Applies supabase/migrations/*.sql in order. Each file is idempotent and only
// touches the theta23_space schema. Usage: npm run db:migrate
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "./db";

async function main() {
  const pool = connect();
  const dir = path.join(process.cwd(), "supabase", "migrations");
  try {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await pool.query(readFileSync(path.join(dir, file), "utf8"));
      console.log(`applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
