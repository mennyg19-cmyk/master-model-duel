import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { mapDomainErrorOrThrow } from "@/lib/http-errors";
import { parseBody } from "@/lib/parse-body";
import { commitImport } from "@/lib/imports/engine";
import { IMPORT_HANDLERS, IMPORT_PERMISSION } from "@/lib/imports/kinds";

export const dynamic = "force-dynamic";

const commitSchema = z.object({ confirmPhrase: z.string() });

// R-063: atomic commit — the still-valid rows land in one transaction or the
// whole batch rolls back. Re-commit is a domain refusal, never a double write.
// G-029: the body carries the operator's typed confirmation phrase; a missing
// or wrong phrase is a 422, same as the dry-run refusal. A forbidden caller
// gets the same 404 as an unknown id — the batch's existence is not an oracle.
export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const notFound = () => NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return notFound();

  const gate = await requireApiPermission(IMPORT_PERMISSION[batch.kind]);
  if (!gate.ok) return gate.response.status === 403 ? notFound() : gate.response;

  const parsed = await parseBody(request, commitSchema, "Commit requires the confirmation phrase shown by the preview");
  if (!parsed.ok) return parsed.response;

  try {
    const committed = await commitImport({
      batchId,
      handler: IMPORT_HANDLERS[batch.kind],
      confirmPhrase: parsed.data.confirmPhrase,
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
    return mapDomainErrorOrThrow(error);
  }
}
