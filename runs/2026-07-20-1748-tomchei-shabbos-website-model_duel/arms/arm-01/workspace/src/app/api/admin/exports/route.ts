import { NextResponse } from "next/server";
import {
  encodeCsv,
  exportDatasets,
  getExportRows,
  type ExportDataset,
} from "@/domain/launch-exports";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const session = await requirePermission("audit:view");
    const url = new URL(request.url);
    const dataset = url.searchParams.get("dataset");
    const seasonId = url.searchParams.get("seasonId") ?? undefined;
    if (!exportDatasets.includes(dataset as ExportDataset)) {
      return NextResponse.json({ error: "A supported export dataset is required." }, { status: 400 });
    }
    const selectedDataset = dataset as ExportDataset;
    const rows = await getExportRows(db, selectedDataset, seasonId);
    const csv = encodeCsv(rows);
    const exportRun = await db.exportRun.create({
      data: {
        dataset: selectedDataset,
        filters: { seasonId: seasonId ?? null },
        rowCount: rows.length,
        requestedById: session.actor.id,
      },
    });
    await db.auditLog.create({
      data: {
        actorStaffId: session.actor.id,
        action: "export.completed",
        targetType: "ExportRun",
        targetId: exportRun.id,
        metadata: { dataset: selectedDataset, seasonId: seasonId ?? null, rowCount: rows.length },
      },
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < csv.length; offset += 64 * 1024) {
          controller.enqueue(encoder.encode(csv.slice(offset, offset + 64 * 1024)));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${selectedDataset}.csv"`,
        "x-export-run-id": exportRun.id,
        "x-export-row-count": String(rows.length),
      },
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
