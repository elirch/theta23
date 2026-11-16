// Loads what the page needs: the dataset, where it came from, and who is asking.

import "server-only";
import { buildSeedDataset } from "@/lib/seed";
import type { Dataset } from "@/lib/types";
import { isOwner, isOwnerLoginConfigured } from "./auth";
import { getDb } from "./db";
import { isSchemaMissingError, loadDataset } from "./repo";

export type DataSource =
  /** Live data from Supabase PostgreSQL. */
  | "database"
  /** DATABASE_URL is not set: bundled demo data, nothing can be saved. */
  | "bundled_no_database"
  /** Connected, but the theta23_space migration has not been applied. */
  | "bundled_not_migrated"
  /** Connected and migrated, but no mission has been seeded yet. */
  | "bundled_not_seeded"
  /** The database could not be reached. */
  | "bundled_database_error";

export interface AppState {
  dataset: Dataset;
  source: DataSource;
  isOwner: boolean;
  ownerLoginAvailable: boolean;
}

export async function loadAppState(): Promise<AppState> {
  const owner = await isOwner();
  const ownerLoginAvailable = isOwnerLoginConfigured();
  const fallback = (source: DataSource): AppState => ({
    dataset: buildSeedDataset(), source, isOwner: owner, ownerLoginAvailable,
  });

  const db = getDb();
  if (!db) return fallback("bundled_no_database");
  try {
    const dataset = await loadDataset(db);
    if (!dataset) return fallback("bundled_not_seeded");
    return { dataset, source: "database", isOwner: owner, ownerLoginAvailable };
  } catch (error) {
    if (isSchemaMissingError(error)) return fallback("bundled_not_migrated");
    console.error("Database unavailable:", error instanceof Error ? error.message : "unknown error");
    return fallback("bundled_database_error");
  }
}
