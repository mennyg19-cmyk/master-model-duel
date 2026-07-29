import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { IMPORT_PERMISSION } from "@/lib/imports/kinds";

export const dynamic = "force-dynamic";

// Preview: the staged payload with per-row verdicts — nothing has touched the
// domain tables yet, so this is always safe to render.
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });

  const gate = await requireApiPermission(IMPORT_PERMISSION[batch.kind]);
  if (!gate.ok) return gate.response;

  return NextResponse.json({
    batch: {
      id: batch.id,
      kind: batch.kind,
      status: batch.status,
      filename: batch.filename,
      totalRows: batch.totalRows,
      validRows: batch.validRows,
      duplicateRows: batch.duplicateRows,
      invalidRows: batch.invalidRows,
      committedRows: batch.committedRows,
      createdAt: batch.createdAt,
      committedAt: batch.committedAt,
      payload: batch.payload,
    },
  });
}
