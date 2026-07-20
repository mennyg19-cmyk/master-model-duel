import { renderArtifactPdf } from "@/domain/print-batches";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  await requirePermission("admin:view");
  const { artifactId } = await context.params;
  const artifact = await db.printArtifact.findUnique({
    where: { id: artifactId },
  });
  if (!artifact) {
    return Response.json({ error: "Print artifact was not found." }, { status: 404 });
  }
  const pdf = renderArtifactPdf(artifact.payload);
  const filename = `${artifact.kind.toLowerCase()}-${artifact.filingGroup
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
