import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { BATCH_ARTIFACTS, loadBatchForPrint, renderBatchPdf, BatchArtifact } from "@/lib/print/pdf";

export const dynamic = "force-dynamic";

// UR-005/UR-013: one PDF per filing group per artifact (slips / labels /
// cards), rendered on demand from persisted batch membership.
export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const { batchId } = await params;

  const artifact = new URL(request.url).searchParams.get("artifact") as BatchArtifact | null;
  if (!artifact || !BATCH_ARTIFACTS.includes(artifact)) {
    return NextResponse.json({ error: `artifact must be one of ${BATCH_ARTIFACTS.join(", ")}` }, { status: 400 });
  }

  try {
    const data = await loadBatchForPrint(batchId);
    const bytes = await renderBatchPdf(data, artifact);
    // Quoted-string header: filingGroup is staff-influenced data, so quotes,
    // backslashes, and control characters can never break out of the filename.
    // eslint-disable-next-line no-control-regex
    const safeGroup = data.filingGroup.toLowerCase().replace(/["\\]/g, "_").replace(/[\x00-\x1f\x7f]/g, "_");
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${safeGroup}-${artifact}-${batchId.slice(-8)}.pdf"`,
      },
    });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
