import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function runConcurrencySmoke() {
  const fixture = await db.staffUser.upsert({
    where: { email: "concurrency@example.test" },
    update: { version: 1, displayName: "Concurrency Fixture" },
    create: {
      email: "concurrency@example.test",
      displayName: "Concurrency Fixture",
      role: "STAFF",
      status: "ACTIVE",
      version: 1,
    },
  });

  const attempts = await Promise.all(
    Array.from({ length: 10 }, (_, attempt) =>
      db.staffUser.updateMany({
        where: { id: fixture.id, version: 1 },
        data: {
          displayName: `Concurrency Winner ${attempt + 1}`,
          version: { increment: 1 },
        },
      }),
    ),
  );
  const successfulUpdates = attempts.filter(
    (attempt) => attempt.count === 1,
  ).length;
  const conflicts = attempts.filter((attempt) => attempt.count === 0).length;

  if (successfulUpdates !== 1 || conflicts !== 9) {
    throw new Error(
      `Expected 1 successful update and 9 conflicts; received ${successfulUpdates} and ${conflicts}.`,
    );
  }
  console.log(JSON.stringify({ attempts: 10, successfulUpdates, conflicts }));
}

runConcurrencySmoke()
  .then(() => db.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
