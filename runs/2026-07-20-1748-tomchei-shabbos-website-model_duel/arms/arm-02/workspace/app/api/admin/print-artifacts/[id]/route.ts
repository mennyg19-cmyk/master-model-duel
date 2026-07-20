import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { renderArtifactPdf } from "@/lib/print/render";

/** Download one stored artifact as PDF. Read-only: never touches Package stages (G-002). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const artifact = await db.printArtifact.findUnique({ where: { id } });
  if (!artifact) return Response.json({ error: "Print artifact not found" }, { status: 404 });

  const pdf = renderArtifactPdf(artifact.kind, artifact.payload);
  const safeGroup = artifact.filingGroup.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${artifact.kind.toLowerCase()}-${safeGroup}.pdf"`,
    },
  });
}
