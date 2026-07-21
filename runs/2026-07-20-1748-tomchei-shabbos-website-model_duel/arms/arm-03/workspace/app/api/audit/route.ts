import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";

export async function GET() {
  const gate = await requirePermissionApi("audit.view");
  if ("response" in gate) return gate.response;

  const entries = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Response.json(entries);
}
