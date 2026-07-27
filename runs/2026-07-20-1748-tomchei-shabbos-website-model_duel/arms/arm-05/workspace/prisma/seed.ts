import { prisma } from "../lib/db";

async function seed() {
  await prisma.appSetting.upsert({
    where: { key: "foundation.seeded" },
    create: { key: "foundation.seeded", value: { version: 1 } },
    update: { value: { version: 1 } },
  });
  console.log("Foundation settings seeded.");
}

void seed()
  .catch((error: unknown) => {
    console.error("Unable to seed the PostgreSQL database.", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
