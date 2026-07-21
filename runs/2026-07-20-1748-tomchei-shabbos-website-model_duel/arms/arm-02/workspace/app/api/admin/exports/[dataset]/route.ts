import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { getOpenSeason } from "@/lib/season";
import { exportCsv, isExportDataset } from "@/lib/exports";

// CSV export center download (R-092). Streams line pages so a 5k-package
// deliveries export never builds one giant string in memory.

export async function GET(request: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const gate = await requirePermissionApi("reports.view");
  if ("response" in gate) return gate.response;

  const { dataset } = await params;
  if (!isExportDataset(dataset)) {
    return Response.json({ error: "Unknown export dataset" }, { status: 404 });
  }

  const url = new URL(request.url);
  let seasonId = url.searchParams.get("season");
  if (seasonId) {
    const season = await db.season.findUnique({ where: { id: seasonId } });
    if (!season) return Response.json({ error: "Unknown season" }, { status: 404 });
  } else {
    const open = await getOpenSeason();
    if (!open) return Response.json({ error: "No open season — pass ?season=" }, { status: 409 });
    seasonId = open.id;
  }

  let rowCount = 0;
  const generator = exportCsv(dataset, seasonId);
  const encoder = new TextEncoder();
  const staff = gate.staff;
  // Every download leaves an audit row, even when the client aborts mid-stream
  // (R-092 / S2 detective control) — an aborted pull already delivered rows.
  let audited = false;
  const auditExport = async (outcome: "completed" | "aborted") => {
    if (audited) return;
    audited = true;
    await writeAudit(staff, {
      action: "export.run",
      targetType: "ExportDataset",
      targetId: dataset,
      detail: { seasonId, rows: rowCount, outcome },
    });
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await generator.next();
      if (next.done) {
        await auditExport("completed");
        controller.close();
        return;
      }
      rowCount += 1;
      controller.enqueue(encoder.encode(next.value));
    },
    async cancel() {
      await generator.return(undefined);
      await auditExport("aborted");
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${dataset}.csv"`,
    },
  });
}
