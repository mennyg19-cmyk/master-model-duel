import { requirePermissionApi } from "@/lib/auth/current-user";
import { ActionError } from "@/lib/packages/actions";
import { buildOrderPackingSlip } from "@/lib/print/batches";
import { renderArtifactPdf } from "@/lib/print/render";

/** Live packing-slip PDF from the order detail page (R-056). Read-only. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("orders.view");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  try {
    const payload = await buildOrderPackingSlip(id);
    const pdf = renderArtifactPdf("PACKING_SLIP", payload);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="packing-slip-${payload.orderRef.replace("#", "")}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof ActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
