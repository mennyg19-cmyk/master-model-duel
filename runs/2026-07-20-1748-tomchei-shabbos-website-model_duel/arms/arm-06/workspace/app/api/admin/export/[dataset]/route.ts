import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { EXPORT_DATASETS, ExportDatasetKey } from "@/lib/exports/datasets";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// R-092: streamed CSV export. Pages of rows flow straight into CSV chunks so
// a full-season export never buffers in memory; the audit row lands when the
// stream completes (an abandoned download leaves no fake success trail).
export async function GET(request: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const { dataset: key } = (await params) as { dataset: ExportDatasetKey };
  const dataset = EXPORT_DATASETS[key];
  if (!dataset) return NextResponse.json({ error: "Unknown export dataset" }, { status: 404 });

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!hasPermission(ctx.staff, dataset.permission)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  let seasonId = url.searchParams.get("season") ?? undefined;
  if (dataset.seasonScoped) {
    if (!seasonId) {
      const open = await prisma.season.findFirst({ where: { status: "OPEN" } });
      seasonId = open?.id;
    }
    if (!seasonId) {
      return NextResponse.json({ error: "This export needs a season (none is open)" }, { status: 422 });
    }
  }

  const season = seasonId ? await prisma.season.findUnique({ where: { id: seasonId } }) : null;
  const filename = dataset.filename({ seasonId }, season?.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());

  let rowCount = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(toCsv([dataset.header])));
      try {
        for await (const row of dataset.rows({ seasonId })) {
          rowCount += 1;
          controller.enqueue(encoder.encode(toCsv([row])));
        }
      } catch (error) {
        controller.error(error);
        throw error;
      }
      await recordAudit({
        ctx: { staff: { id: ctx.staff.id, email: ctx.staff.email }, impersonator: ctx.impersonator ? { id: ctx.impersonator.id, email: ctx.impersonator.email } : null },
        action: "export_csv",
        targetType: "Export",
        targetId: dataset.key,
        metadata: { dataset: dataset.key, seasonId: seasonId ?? null, rows: rowCount, filename },
      });
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
