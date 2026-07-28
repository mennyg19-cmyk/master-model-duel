import { Order } from "@prisma/client";
import { prisma } from "@/lib/db";
import { claimDraftRef } from "@/lib/orders/numbers";
import { assertOpenSeason } from "@/lib/orders/drafts";
import {
  DraftLineInput,
  insertResolvedLines,
  resolveDraftLines,
} from "@/lib/orders/resolve-lines";

export type { DraftLineInput } from "@/lib/orders/resolve-lines";

// Creates a fresh DRAFT order. Line resolution (price snapshots, option/add-on
// validation) lives in resolve-lines.ts and is shared with the P4 draft-save
// engine — one price path, no drift.
export async function createDraftOrder(input: {
  seasonId: string;
  customerId: string;
  lines: DraftLineInput[];
}): Promise<Order> {
  return prisma.$transaction(async (tx) => {
    const season = await assertOpenSeason(tx, input.seasonId);

    const resolved = await resolveDraftLines(tx, input.lines);
    const draftRef = await claimDraftRef(tx, season.id, season.name);
    const totalCents = resolved.reduce((sum, line) => sum + line.lineTotalCents, 0);

    const order = await tx.order.create({
      data: { seasonId: season.id, customerId: input.customerId, draftRef, totalCents },
    });
    await insertResolvedLines(tx, order.id, resolved, new Map());

    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
  });
}
