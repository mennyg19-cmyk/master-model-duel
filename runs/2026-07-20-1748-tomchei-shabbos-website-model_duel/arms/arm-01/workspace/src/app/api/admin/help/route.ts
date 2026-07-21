import { z } from "zod";
import { NextResponse } from "next/server";
import {
  adminRequestErrorResponse,
  requireSameOriginAdminRequest,
} from "@/lib/admin-request";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const requestSchema = z.object({
  tourKey: z.enum(["orders", "fulfillment", "delivery", "reports"]),
});

export async function POST(request: Request) {
  try {
    requireSameOriginAdminRequest(request);
    const session = await requirePermission("admin:view");
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "A supported tour is required." }, { status: 400 });
    }
    const progress = await db.helpTourProgress.upsert({
      where: {
        staffUserId_tourKey: {
          staffUserId: session.effective.id,
          tourKey: parsed.data.tourKey,
        },
      },
      update: { completedAt: new Date() },
      create: {
        staffUserId: session.effective.id,
        tourKey: parsed.data.tourKey,
      },
    });
    return NextResponse.json(progress);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return adminRequestErrorResponse(error);
  }
}
