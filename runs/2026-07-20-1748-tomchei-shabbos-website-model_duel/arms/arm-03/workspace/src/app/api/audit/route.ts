import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiErrorResponse } from "@/lib/api-error";

export async function GET() {
  try {
    await requirePermission("audit.read");
    const entries = await db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        actor: { select: { id: true, displayName: true, email: true } },
        target: { select: { id: true, displayName: true, email: true } },
      },
    });
    return NextResponse.json({ ok: true, entries });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
