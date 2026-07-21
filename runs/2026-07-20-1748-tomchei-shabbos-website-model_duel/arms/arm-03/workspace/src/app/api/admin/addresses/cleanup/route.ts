import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import {
  listAddressReviewQueue,
  mergeAddresses,
  runAddressCleanup,
} from "@/lib/ops/address-cleanup";

export async function GET() {
  try {
    await requirePermission("admin.access");
    const queue = await listAddressReviewQueue(100);
    return NextResponse.json({ ok: true, queue });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cleanup"), customerId: z.string().optional() }),
  z.object({
    action: z.literal("merge"),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
  }),
]);

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("settings.write");
    const body = postSchema.parse(await request.json());
    if (body.action === "cleanup") {
      const result = await runAddressCleanup({
        staffId: staff.effectiveStaff.id,
        customerId: body.customerId,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...result.value });
    }

    const merged = await mergeAddresses({
      sourceId: body.sourceId,
      targetId: body.targetId,
      staffId: staff.effectiveStaff.id,
    });
    if (!merged.ok) {
      return NextResponse.json({ ok: false, error: merged.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...merged.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
