import fs from "fs";
import path from "path";

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const migrationsDir = path.join(process.cwd(), "prisma", "migrations");

if (!fs.existsSync(schemaPath)) {
  console.error("migration-guard: prisma/schema.prisma missing");
  process.exit(1);
}

if (!fs.existsSync(migrationsDir)) {
  console.error("migration-guard: prisma/migrations missing — run prisma migrate first");
  process.exit(1);
}

const schema = fs.readFileSync(schemaPath, "utf8");
if (!schema.includes("InventoryItem_target_xor_check")) {
  console.error(
    "migration-guard: schema.prisma must document InventoryItem_target_xor_check (XOR)",
  );
  process.exit(1);
}
if (
  !schema.includes("productId") ||
  !schema.includes("CHECK") ||
  !/InventoryItem[\s\S]*CHECK[\s\S]*productId[\s\S]*addOnId/.test(schema)
) {
  console.error(
    "migration-guard: schema.prisma must include InventoryItem XOR CHECK documentation",
  );
  process.exit(1);
}

const migrations = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory());

if (migrations.length < 1) {
  console.error("migration-guard: no migration folders found");
  process.exit(1);
}

const sqlHasXor = migrations.some((entry) => {
  const sqlPath = path.join(migrationsDir, entry.name, "migration.sql");
  if (!fs.existsSync(sqlPath)) return false;
  return fs.readFileSync(sqlPath, "utf8").includes("InventoryItem_target_xor_check");
});
if (!sqlHasXor) {
  console.error(
    "migration-guard: migrations must include InventoryItem_target_xor_check",
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      migrations: migrations.map((entry) => entry.name),
      xorCheckDocumented: true,
    },
    null,
    2,
  ),
);
