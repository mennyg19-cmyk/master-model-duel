import type { Prisma } from "@prisma/client";

// Sequential per-season order numbers (R-151). The single UPDATE takes a row
// lock on the season, so concurrent finalizations queue up and each gets a
// distinct number — no gap, no double-claim.
export async function claimNextOrderNumber(
  tx: Prisma.TransactionClient,
  seasonId: string
): Promise<number> {
  const rows = await tx.$queryRaw<{ orderCounter: number }[]>`
    UPDATE "Season"
    SET "orderCounter" = "orderCounter" + 1
    WHERE "id" = ${seasonId}
    RETURNING "orderCounter"
  `;
  if (rows.length === 0) {
    throw new Error(`Season ${seasonId} not found; cannot claim an order number`);
  }
  return rows[0].orderCounter;
}
