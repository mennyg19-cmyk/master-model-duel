import { readFile } from "node:fs/promises";

async function verifySchema() {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  if (!schema.includes('provider = "postgresql"') || !schema.includes("model StaffUser")) {
    throw new Error("Migration harness requires the PostgreSQL staff schema.");
  }
  console.log("Migration harness: schema is ready for an isolated PostgreSQL database.");
}

void verifySchema();
