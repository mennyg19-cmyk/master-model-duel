import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
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

  const gate = await requireApiPermission(dataset.permission);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const seasonParam = url.searchParams.get("season") ?? undefined;
  // One season fetch total: an explicit param wins; otherwise the open season
  // (season-scoped datasets only). The same row feeds the filename.
  let season = seasonParam ? await prisma.season.findUnique({ where: { id: seasonParam } }) : null;
  if (dataset.seasonScoped && !season) {
    season = await prisma.season.findFirst({ where: { status: "OPEN" } });
  }
  const seasonId = season?.id ?? seasonParam;
  if (dataset.seasonScoped && !seasonId) {
    return NextResponse.json({ error: "This export needs a season (none is open)" }, { status: 422 });
  }

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
      try {
        await recordAudit({
          ctx: gate.ctx,
          action: "export_csv",
          targetType: "Export",
          targetId: dataset.key,
          metadata: { dataset: dataset.key, seasonId: seasonId ?? null, rows: rowCount, filename },
        });
      } catch (error) {
        // The rows are already sent — an audit-write blip must not truncate a
        // completed download. The gap is logged, not hidden.
        console.error(`export_csv audit failed for ${dataset.key}:`, error);
      }
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
