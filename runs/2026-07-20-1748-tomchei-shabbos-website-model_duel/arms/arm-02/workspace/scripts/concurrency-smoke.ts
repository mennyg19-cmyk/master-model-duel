import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// G-024 groundwork: 10 concurrent versioned updates against one row.
// Optimistic versioning must let exactly one writer per version through and
// report the rest as conflicts instead of silently overwriting.
async function main() {
  const fixture = await db.concurrencyFixture.upsert({
    where: { name: "smoke-counter" },
    update: { counter: 0, version: 0 },
    create: { name: "smoke-counter" },
  });

  const attempts = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const updated = await db.concurrencyFixture.updateMany({
        where: { id: fixture.id, version: fixture.version },
        data: { counter: { increment: 1 }, version: { increment: 1 } },
      });
      return updated.count === 1 ? "committed" : "conflict";
    })
  );

  const committed = attempts.filter((outcome) => outcome === "committed").length;
  const conflicts = attempts.filter((outcome) => outcome === "conflict").length;
  const finalRow = await db.concurrencyFixture.findUniqueOrThrow({ where: { id: fixture.id } });

  console.log(`10 concurrent versioned updates: ${committed} committed, ${conflicts} conflicts`);
  console.log(`Final counter=${finalRow.counter} version=${finalRow.version}`);

  if (committed !== 1 || conflicts !== 9 || finalRow.counter !== 1) {
    console.error("FAIL: expected exactly 1 commit and 9 reported conflicts");
    process.exit(1);
  }
  console.log("PASS: conflicts reported, no silent overwrite");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
