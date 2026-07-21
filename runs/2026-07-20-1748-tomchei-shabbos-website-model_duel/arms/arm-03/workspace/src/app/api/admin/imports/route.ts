import { NextResponse } from "next/server";
import { z } from "zod";
import { ImportKind } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { commitImport, getImportBatch, stageImport } from "@/lib/ops/import";

const stageSchema = z.object({
  kind: z.nativeEnum(ImportKind),
  csvText: z.string().min(1).max(2_000_000),
  filename: z.string().max(200).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("settings.write");
    const body = stageSchema.parse(await request.json());
    const result = await stageImport({
      kind: body.kind,
      csvText: body.csvText,
      filename: body.filename,
      staffId: staff.effectiveStaff.id,
      dryRun: body.dryRun,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    const batch = await getImportBatch(result.value.batchId);
    return NextResponse.json({ ok: true, ...result.value, batch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    await requirePermission("settings.write");
    const batchId = new URL(request.url).searchParams.get("batchId");
    if (!batchId) {
      return NextResponse.json({ ok: false, error: "batchId required" }, { status: 400 });
    }
    const batch = await getImportBatch(batchId);
    if (!batch) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, batch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const commitSchema = z.object({
  batchId: z.string().min(1),
  commit: z.literal(true),
  maxRows: z.number().int().positive().optional(),
});

export async function PATCH(request: Request) {
  try {
    const staff = await requirePermission("settings.write");
    const body = commitSchema.parse(await request.json());
    const result = await commitImport({
      batchId: body.batchId,
      staffId: staff.effectiveStaff.id,
      maxRows: body.maxRows,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    const batch = await getImportBatch(body.batchId);
    return NextResponse.json({ ok: true, ...result.value, batch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
