// Shared helpers for DB-integration tests. The "seasons_single_open" partial
// index allows only one OPEN season at a time, so a test that needs its own
// OPEN season must first close whatever is open (e.g. the seeded season) and
// restore it during cleanup.
import { PrismaClient } from "@prisma/client";

export async function closeAllOpenSeasons(prisma: PrismaClient): Promise<string[]> {
  const open = await prisma.season.findMany({ where: { status: "OPEN" }, select: { id: true } });
  await prisma.season.updateMany({ where: { status: "OPEN" }, data: { status: "CLOSED" } });
  return open.map((season) => season.id);
}

export async function reopenSeasons(prisma: PrismaClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.season.updateMany({ where: { id: { in: ids } }, data: { status: "OPEN" } });
}

// tsx loads lib/*.ts through its CJS loader and these .mts scripts through
// ESM, so a shared error class can materialize as two distinct class objects —
// instanceof across that boundary is unreliable. Match the error type by its
// declared name instead (error.name is set in every typed error constructor).
export async function expectThrow(
  run: () => Promise<unknown>,
  type: new (...args: never[]) => Error,
): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (error) {
    return (error as Error)?.name === type.name;
  }
}
