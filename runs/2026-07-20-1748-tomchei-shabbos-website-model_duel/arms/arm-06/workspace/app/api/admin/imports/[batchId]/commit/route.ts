import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { mapDomainError } from "@/lib/http-errors";
import { commitImport } from "@/lib/imports/engine";
import { IMPORT_HANDLERS, IMPORT_PERMISSION } from "@/lib/imports/kinds";

export const dynamic = "force-dynamic";

// R-063: atomic commit — the still-valid rows land in one transaction or the
// whole batch rolls back. Re-commit is a domain refusal, never a double write.
export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });

  const gate = await requireApiPermission(IMPORT_PERMISSION[batch.kind]);
  if (!gate.ok) return gate.response;

  try {
    const committed = await commitImport({
      batchId,
      handler: IMPORT_HANDLERS[batch.kind],
      ctx: gate.ctx,
    });
    return NextResponse.json({
      ok: true,
      batch: {
        id: committed.id,
        status: committed.status,
        committedRows: committed.committedRows,
        duplicateRows: committed.duplicateRows,
      },
    });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
