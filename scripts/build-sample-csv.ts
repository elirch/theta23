// Regenerates public/sample-components.csv from the seed dataset.
import { writeFileSync } from "node:fs";
import { componentsToCsv } from "../src/lib/csv";
import { buildSeedDataset } from "../src/lib/seed";

writeFileSync("public/sample-components.csv", componentsToCsv(buildSeedDataset()));
console.log("wrote public/sample-components.csv");
