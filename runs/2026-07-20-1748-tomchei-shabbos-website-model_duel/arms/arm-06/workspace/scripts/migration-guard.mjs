import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Migration guard (R-140/R-141): fails CI when
//   1. migration folders are malformed or out of order, or
//   2. the database has unapplied migrations, or
//   3. schema.prisma drifted from the applied migrations.
const MIGRATIONS_DIR = "prisma/migrations";

const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "migration_lock")
  .map((entry) => entry.name);

if (entries.length === 0) {
  console.error("migration-guard: no migrations found in prisma/migrations");
  process.exit(1);
}

const malformed = entries.filter((name) => !/^\d{14}_.+$/.test(name));
if (malformed.length > 0) {
  console.error(`migration-guard: malformed migration folder names: ${malformed.join(", ")}`);
  process.exit(1);
}

const sorted = [...entries].sort();
if (entries.join("|") !== sorted.join("|")) {
  console.error("migration-guard: migrations are not in timestamp order on disk");
  process.exit(1);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (args) =>
  execFileSync(npx, ["prisma", ...args], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

try {
  const status = run(["migrate", "status"]);
  if (!/up to date/i.test(status)) {
    console.error(`migration-guard: database is not up to date:\n${status}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`migration-guard: prisma migrate status failed:\n${error.stdout ?? error.message}`);
  process.exit(1);
}

// Drift detection parses the diff output instead of relying on --exit-code's
// numeric status (which differs across prisma versions): an empty diff prints
// "-- This is an empty migration." with --script ("No difference detected"
// without it); anything else IS the drift, printed for the log.
try {
  const diff = run([
    "migrate",
    "diff",
    "--from-schema-datasource",
    "prisma/schema.prisma",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--script",
  ]);
  if (!/No difference detected|empty migration/i.test(diff)) {
    console.error(`migration-guard: schema.prisma has drifted from the applied migrations. Create a migration:\n${diff}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`migration-guard: migrate diff failed:\n${error.stdout ?? error.message}`);
  process.exit(1);
}

console.log(`migration-guard: ok (${entries.length} migration(s), DB in sync, no schema drift)`);
