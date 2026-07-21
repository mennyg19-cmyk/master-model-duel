import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { requirePermission } from "@/lib/auth";
import { updateOwnedAddress } from "@/lib/address/book";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  label: z.string().optional().nullable(),
  recipientName: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional().nullable(),
  city: z.string().min(1),
  state: z.string().min(2).max(2),
  postalCode: z.string().min(5),
  country: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

/** Staff edit of any customer address — audited (UR-014 / G-019). */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const staff = await requirePermission("admin.access");
    const { id } = await ctx.params;
    const existing = await db.savedAddress.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Address not found" }, { status: 404 });
    }
    const body = schema.parse(await request.json());
    const result = await updateOwnedAddress(existing.customerId, id, body, {
      actorStaffId: staff.effectiveStaff.id,
      bypassOwnership: true,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      address: result.value.address,
      audited: true,
      actorId: staff.effectiveStaff.id,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
