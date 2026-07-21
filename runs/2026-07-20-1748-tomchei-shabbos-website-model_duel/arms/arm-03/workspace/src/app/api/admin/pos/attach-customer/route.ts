import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { attachOrCreatePosCustomer } from "@/lib/ops/customers";

const bodySchema = z.union([
  z.object({
    draftRef: z.string().min(1),
    customerId: z.string().min(1),
  }),
  z.object({
    draftRef: z.string().min(1),
    displayName: z.string().min(1).max(200),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(40).optional().nullable(),
  }),
]);

/** Attach existing or find-or-create+attach walk-in to POS draft (R-060, B4). */
export async function POST(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    const body = bodySchema.parse(await request.json());
    const result = await attachOrCreatePosCustomer({
      draftRef: body.draftRef,
      staffId: staff.effectiveStaff.id,
      request,
      ...("customerId" in body
        ? { customerId: body.customerId }
        : {
            displayName: body.displayName,
            email: body.email,
            phone: body.phone,
          }),
    });
    if (!result.ok) {
      const status = result.error === "missing" ? 404 : 409;
      return NextResponse.json(
        { ok: false, error: result.publicMessage },
        { status },
      );
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
