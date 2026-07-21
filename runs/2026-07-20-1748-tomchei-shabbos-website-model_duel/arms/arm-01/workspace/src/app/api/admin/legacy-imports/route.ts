import { z } from "zod";
import { NextResponse } from "next/server";
import {
  legacyDocumentSchema,
  MAX_LEGACY_IMPORT_BYTES,
  stageLegacyImport,
} from "@/domain/legacy-import";
import {
  adminRequestErrorResponse,
  requireSameOriginAdminRequest,
} from "@/lib/admin-request";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const requestSchema = z.object({
  sourceName: z.string().trim().min(1).max(200),
  dryRun: z.boolean().default(true),
  document: legacyDocumentSchema,
});

export async function POST(request: Request) {
  try {
    requireSameOriginAdminRequest(request);
    const session = await requirePermission("settings:manage");
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_LEGACY_IMPORT_BYTES) {
      return NextResponse.json({ error: "Legacy import payload is too large." }, { status: 413 });
    }
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_LEGACY_IMPORT_BYTES) {
      return NextResponse.json({ error: "Legacy import payload is too large." }, { status: 413 });
    }
    let input: unknown = null;
    try {
      input = JSON.parse(body);
    } catch {
      input = null;
    }
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Legacy document does not match the documented entity map." },
        { status: 400 },
      );
    }
    const batch = await stageLegacyImport(db, {
      ...parsed.data,
      stagedByStaffId: session.actor.id,
    });
    await db.auditLog.create({
      data: {
        actorStaffId: session.actor.id,
        action: "legacy_import.staged",
        targetType: "LegacyImportBatch",
        targetId: batch.id,
        metadata: { dryRun: batch.dryRun, sourceName: batch.sourceName },
      },
    });
    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return adminRequestErrorResponse(error);
  }
}
