import { db } from "../src/lib/db";

async function main() {
  const fixture = await db.versionedFixture.upsert({
    where: { label: "concurrency-fixture" },
    create: { label: "concurrency-fixture", payload: "start", version: 1 },
    update: { payload: "start", version: 1 },
  });

  const expectedVersion = fixture.version;
  const attempts = Array.from({ length: 10 }, (_, index) => index);

  const results = await Promise.all(
    attempts.map(async (index) => {
      try {
        const updated = await db.versionedFixture.updateMany({
          where: { id: fixture.id, version: expectedVersion },
          data: {
            payload: `writer-${index}`,
            version: { increment: 1 },
          },
        });
        return { index, wrote: updated.count === 1 };
      } catch (error) {
        return {
          index,
          wrote: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const winners = results.filter((row) => row.wrote);
  const conflicts = results.filter((row) => !row.wrote);
  const latest = await db.versionedFixture.findUnique({ where: { id: fixture.id } });

  const summary = {
    ok: winners.length === 1 && conflicts.length === 9,
    winners: winners.length,
    conflicts: conflicts.length,
    finalVersion: latest?.version,
    finalPayload: latest?.payload,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
