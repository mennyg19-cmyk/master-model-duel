import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { mapDomainError } from "@/lib/http-errors";
import { discardImport } from "@/lib/imports/engine";
import { IMPORT_PERMISSION } from "@/lib/imports/kinds";

export const dynamic = "force-dynamic";

// Staged batch the staff decided against: status flips, nothing ever wrote
// to the domain tables, and the audit row records the discard.
export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });

  const gate = await requireApiPermission(IMPORT_PERMISSION[batch.kind]);
  if (!gate.ok) return gate.response;

  try {
    const discarded = await discardImport({ batchId, ctx: gate.ctx });
    return NextResponse.json({ ok: true, batch: { id: discarded.id, status: discarded.status } });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
