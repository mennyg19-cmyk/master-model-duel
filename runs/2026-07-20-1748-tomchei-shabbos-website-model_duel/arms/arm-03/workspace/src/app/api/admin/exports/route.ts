import { NextResponse } from "next/server";
import { z } from "zod";
import { ExportDataset } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { listExportAudits, runCsvExport } from "@/lib/ops/exports";

export async function GET() {
  try {
    await requirePermission("settings.write");
    const history = await listExportAudits();
    return NextResponse.json({ ok: true, history });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const postSchema = z.object({
  dataset: z.nativeEnum(ExportDataset),
  seasonId: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("settings.write");
    const body = postSchema.parse(await request.json());
    const result = await runCsvExport({
      dataset: body.dataset,
      seasonId: body.seasonId,
      staffId: staff.effectiveStaff.id,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return new NextResponse(result.value.csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${body.dataset.toLowerCase()}.csv"`,
        "x-export-audit-id": result.value.auditId,
        "x-export-row-count": String(result.value.rowCount),
        "x-export-checksum": result.value.checksum,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
