import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getLaunchReports } from "@/domain/launch-reporting";

export async function GET() {
  try {
    await requirePermission("audit:view");
    return Response.json(await getLaunchReports(db));
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
