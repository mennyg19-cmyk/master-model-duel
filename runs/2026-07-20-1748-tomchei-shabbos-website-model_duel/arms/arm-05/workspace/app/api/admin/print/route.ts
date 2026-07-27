import { NextResponse } from "next/server";
import { z } from "zod";
import { createNightlyPrintBatch, createPdf, orderPackingSlipDocument, printArtifactDocument, reprintArtifact, reprintOrderPackingSlip } from "@/lib/print-batches";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("nightly_batch") }),
  z.object({ action: z.literal("reprint_artifact"), artifactId: z.string().cuid() }),
  z.object({ action: z.literal("reprint_order"), orderId: z.string().cuid() }),
]);

export async function GET(request: Request) {
  const authorization = await authorize(request, "orders.read");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const url = new URL(request.url);
  const artifactId = url.searchParams.get("artifactId");
  const orderId = url.searchParams.get("orderId");
  if (!artifactId && !orderId) return NextResponse.json({ error: "Choose a print artifact or order." }, { status: 400 });
  try {
    const document = artifactId
      ? await printArtifactDocument(artifactId)
      : await orderPackingSlipDocument(orderId ?? "");
    return new NextResponse(createPdf(document), {
      headers: {
        "content-disposition": `inline; filename="${document.title.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf"`,
        "content-type": "application/pdf",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Print document could not be prepared." }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "orders.write");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid print action." }, { status: 400 });
  try {
    if (parsed.data.action === "nightly_batch") {
      return NextResponse.json(await createNightlyPrintBatch(authorization.staffMember.id));
    }
    if (parsed.data.action === "reprint_artifact") {
      return NextResponse.json({ artifact: await reprintArtifact(parsed.data.artifactId, authorization.staffMember.id) });
    }
    return NextResponse.json({ order: await reprintOrderPackingSlip(parsed.data.orderId, authorization.staffMember.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Print action could not be completed." }, { status: 400 });
  }
}
