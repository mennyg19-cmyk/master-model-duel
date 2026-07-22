import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { runCronJob } from "@/lib/cron";
import { planLegacyImport, legacyFileHash } from "@/lib/legacy-import/plan";
import { commitLegacyImport } from "@/lib/legacy-import/commit";

// Legacy migration pipeline API (R-186, G-029). POST = dry-run (parse,
// normalize, plan, write nothing but the run record + report), PUT = commit
// the same file through the staged atomic pipeline, GET = run history +
// address review queue.

const bodySchema = z.object({ csv: z.string().min(1).max(5_000_000), fileName: z.string().max(200).default("legacy.csv") });

export async function GET() {
  const gate = await requirePermissionApi("imports.legacy");
  if ("response" in gate) return gate.response;

  const [runs, reviewItems] = await Promise.all([
    db.legacyImportRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { stages: { orderBy: { finishedAt: "asc" } } },
    }),
    db.addressReviewItem.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);
  return Response.json({ runs, reviewItems });
}

export async function POST(request: Request) {
  const gate = await requirePermissionApi("imports.legacy");
  if ("response" in gate) return gate.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "csv text is required" }, { status: 400 });

  const plan = await planLegacyImport(parsed.data.csv);
  if ("error" in plan) return Response.json({ error: plan.error }, { status: 400 });

  const fileHash = legacyFileHash(parsed.data.csv);
  const report = {
    seasonName: plan.seasonName,
    sourceTotals: plan.sourceTotals,
    products: plan.products.length,
    addresses: plan.addresses.length,
    reviewFlags: plan.addresses.filter((address) => address.reviewReason).length,
    mergesIntoExisting: plan.customers.filter((customer) => customer.existingId).length,
    invalidRows: plan.invalidRows,
    repairs: plan.repairs,
    merges: plan.merges,
    orders: plan.orders.map((order) => ({
      orderNumber: order.orderNumber,
      repaired: order.numberRepaired,
      lines: order.lines.length,
      totalCents: order.totalCents,
    })),
  };
  const run = await db.legacyImportRun.upsert({
    where: { fileHash },
    update: { report },
    create: { fileHash, fileName: parsed.data.fileName, report, createdByStaffId: gate.staff.realUser.id },
  });
  await writeAudit(gate.staff, {
    action: "legacy_import.dry_run",
    targetType: "LegacyImportRun",
    targetId: run.id,
    detail: { fileName: parsed.data.fileName, ...plan.sourceTotals },
  });
  return Response.json({ ok: true, runId: run.id, status: run.status, report });
}

export async function PUT(request: Request) {
  const gate = await requirePermissionApi("imports.legacy");
  if ("response" in gate) return gate.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "csv text is required" }, { status: 400 });

  const fileHash = legacyFileHash(parsed.data.csv);
  const run = await db.legacyImportRun.findUnique({ where: { fileHash } });
  if (!run) return Response.json({ error: "Dry-run this exact file first — the commit re-checks the same bytes" }, { status: 409 });
  if (run.status === "COMPLETED") return Response.json({ error: "This file is already fully imported" }, { status: 409 });

  const plan = await planLegacyImport(parsed.data.csv);
  if ("error" in plan) return Response.json({ error: plan.error }, { status: 400 });

  // Per-run overlap lock (same machinery as crons): concurrent PUTs skip;
  // a finished/failed claim releases so a crash mid-stage can resume.
  const result = await runCronJob(`legacy-import:${run.id}`, () => commitLegacyImport(run.id, plan));
  if ("skipped" in result) {
    return Response.json({ error: "This import is already committing — wait for it to finish" }, { status: 409 });
  }
  await writeAudit(gate.staff, {
    action: "legacy_import.commit",
    targetType: "LegacyImportRun",
    targetId: run.id,
    detail: { status: result.status, stages: result.completedStages as unknown as object },
  });
  return Response.json({ ok: true, ...result });
}
