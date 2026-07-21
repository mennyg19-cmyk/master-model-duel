import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { AuthError } from "@/lib/auth";
import { updateOwnedAddress } from "@/lib/address/book";
import { resolveCustomerId } from "@/lib/orders/draft-access";

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

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const customerId = await resolveCustomerId();
    if (!customerId) throw new AuthError(401, "Sign in required");
    const { id } = await ctx.params;
    const body = schema.parse(await request.json());
    const result = await updateOwnedAddress(customerId, id, body);
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 409;
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status });
    }
    return NextResponse.json({ ok: true, address: result.value.address });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
