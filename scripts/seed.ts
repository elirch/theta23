// Seeds the illustrative KESTREL-1 dataset ONCE. If a mission already exists
// this does nothing — it never overwrites or shifts saved dates.
// Usage: npm run db:seed
import { connect } from "./db";

async function main() {
  const pool = connect();
  // Imported after connect() so .env.local is loaded first.
  const { poolDb } = await import("../src/server/db");
  const { seedIfEmpty } = await import("../src/server/repo");
  try {
    const seeded = await seedIfEmpty(poolDb(pool));
    console.log(seeded ? "Seeded the KESTREL-1 demo dataset." : "A mission already exists — nothing changed.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Seeding failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
