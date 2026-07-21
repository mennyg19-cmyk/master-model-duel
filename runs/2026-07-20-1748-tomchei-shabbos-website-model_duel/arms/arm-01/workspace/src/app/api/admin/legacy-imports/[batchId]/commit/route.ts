import { NextResponse } from "next/server";
import {
  commitLegacyImport,
  ImportConflictError,
} from "@/domain/legacy-import";
import {
  adminRequestErrorResponse,
  requireSameOriginAdminRequest,
} from "@/lib/admin-request";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    requireSameOriginAdminRequest(request);
    const session = await requirePermission("settings:manage");
    const { batchId } = await context.params;
    return NextResponse.json(
      await commitLegacyImport(db, batchId, session.actor.id),
    );
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ImportConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return adminRequestErrorResponse(error);
  }
}
