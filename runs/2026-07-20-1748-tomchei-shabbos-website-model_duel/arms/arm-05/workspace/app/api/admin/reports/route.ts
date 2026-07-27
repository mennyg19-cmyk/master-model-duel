import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize, hasSameOrigin } from "@/lib/route-auth";
import { approveLegacyAddress, commitLegacyImport, exportCsv, listLegacyAddressReviewQueue, performanceReport, runStripeReconciliation, shippingMarginReport, stageLegacyImport } from "@/lib/reporting";
import { prisma } from "@/lib/db";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reconcile") }),
  z.object({ action: z.literal("stage_legacy_import"), csv: z.string().min(1).max(1_000_000) }),
  z.object({ action: z.literal("commit_legacy_import"), batchId: z.string().uuid() }),
  z.object({ action: z.literal("approve_legacy_address"), addressId: z.string().cuid() }),
]);

const datasets = ["year_metrics", "shipping_margin", "item_sales"] as const;

export async function GET(request: Request) {
  const authorization = await authorize(request, "orders.read");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const url = new URL(request.url);
  const exportDataset = url.searchParams.get("export");
  if (exportDataset) {
    if (!datasets.includes(exportDataset as (typeof datasets)[number])) return NextResponse.json({ error: "Unknown export dataset." }, { status: 400 });
    const csv = await exportCsv(exportDataset as (typeof datasets)[number]);
    await prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, action: "report.exported", subjectId: exportDataset, details: { dataset: exportDataset, bytes: Buffer.byteLength(csv) } } });
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${exportDataset}.csv"` } });
  }
  const [performance, margins, exports, addressReviews] = await Promise.all([
    performanceReport(),
    shippingMarginReport(),
    prisma.auditEvent.findMany({ where: { action: "report.exported" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, action: true, subjectId: true, actorId: true, details: true, createdAt: true } }),
    listLegacyAddressReviewQueue(),
  ]);
  return NextResponse.json({ performance, margins, exports, addressReviews });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid reporting action." }, { status: 400 });
  const authorization = await authorize(request, parsed.data.action === "reconcile" ? "payments.reconcile" : "imports.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    if (parsed.data.action === "reconcile") return NextResponse.json(await runStripeReconciliation(authorization.staffMember.id));
    if (parsed.data.action === "stage_legacy_import") return NextResponse.json(await stageLegacyImport(parsed.data.csv, authorization.staffMember.id));
    if (parsed.data.action === "approve_legacy_address") return NextResponse.json(await approveLegacyAddress(parsed.data.addressId, authorization.staffMember.id));
    return NextResponse.json(await commitLegacyImport(parsed.data.batchId, authorization.staffMember.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The reporting action could not finish." }, { status: 400 });
  }
}
