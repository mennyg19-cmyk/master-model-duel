import { commitLegacyImport } from "@/domain/legacy-import";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    const session = await requirePermission("settings:manage");
    const { batchId } = await context.params;
    return Response.json(
      await commitLegacyImport(db, batchId, session.actor.id),
    );
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof Error && /blocking|resumable/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
