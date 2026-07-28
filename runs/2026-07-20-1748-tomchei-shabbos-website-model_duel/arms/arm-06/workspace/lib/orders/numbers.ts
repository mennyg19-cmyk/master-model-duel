import { Prisma } from "@prisma/client";

// Per-season sequential numbers (R-151) and draft references (R-047). Claims
// are single-statement atomic UPDATEs, so concurrent claimants inside their
// own transactions can never draw the same number; a rolled-back transaction
// rolls the counter back too (no gaps from failed finalizations).

// "MM" = Mishloach Manot — the wire format printed on package paperwork.
export const WIRE_FORMAT_PREFIX = "MM-";
export const DRAFT_REF_PREFIX = "D-";

export function formatWireFormat(seasonName: string, orderNumber: number): string {
  return `${WIRE_FORMAT_PREFIX}${seasonName}-${String(orderNumber).padStart(4, "0")}`;
}

export function formatDraftRef(seasonName: string, draftSeq: number): string {
  return `${DRAFT_REF_PREFIX}${seasonName}-${String(draftSeq).padStart(4, "0")}`;
}

export async function claimOrderNumber(
  tx: Prisma.TransactionClient,
  seasonId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ lastOrderSeq: number }[]>`
    UPDATE seasons SET "lastOrderSeq" = "lastOrderSeq" + 1
    WHERE id = ${seasonId}
    RETURNING "lastOrderSeq"`;
  if (rows.length === 0) throw new Error(`Season not found: ${seasonId}`);
  return rows[0].lastOrderSeq;
}

export async function claimDraftRef(
  tx: Prisma.TransactionClient,
  seasonId: string,
  seasonName: string,
): Promise<string> {
  const rows = await tx.$queryRaw<{ lastDraftSeq: number }[]>`
    UPDATE seasons SET "lastDraftSeq" = "lastDraftSeq" + 1
    WHERE id = ${seasonId}
    RETURNING "lastDraftSeq"`;
  if (rows.length === 0) throw new Error(`Season not found: ${seasonId}`);
  return formatDraftRef(seasonName, rows[0].lastDraftSeq);
}
