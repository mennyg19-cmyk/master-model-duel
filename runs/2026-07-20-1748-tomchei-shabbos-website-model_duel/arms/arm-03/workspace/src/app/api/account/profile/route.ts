import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { AuthError, getAuthIdentity } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveCustomerId } from "@/lib/orders/draft-access";
import { normalizePhone } from "@/lib/phone";

const schema = z.object({
  displayName: z.string().min(2).max(120).optional(),
  phone: z.string().optional().nullable(),
});

export async function PATCH(request: Request) {
  try {
    const identity = await getAuthIdentity();
    if (!identity) throw new AuthError(401, "Sign in required");
    const customerId = await resolveCustomerId();
    if (!customerId) throw new AuthError(401, "Customer profile required");

    const body = schema.parse(await request.json());
    const phoneNorm = body.phone ? normalizePhone(body.phone) : null;

    // Ownership enforced: only update the resolved customer for this session.
    const updated = await db.customer.update({
      where: { id: customerId },
      data: {
        displayName: body.displayName?.trim() || undefined,
        phone: body.phone?.trim() || null,
        phoneNorm,
      },
    });

    return NextResponse.json({
      ok: true,
      profile: {
        id: updated.id,
        displayName: updated.displayName,
        email: updated.email,
        phone: updated.phone,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
