import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { AuthError } from "@/lib/auth";
import { listAddresses, upsertCustomerAddress } from "@/lib/address/book";
import { resolveCustomerId } from "@/lib/orders/draft-access";

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

export async function GET() {
  try {
    const customerId = await resolveCustomerId();
    if (!customerId) throw new AuthError(401, "Sign in required");
    const addresses = await listAddresses(customerId);
    return NextResponse.json({ ok: true, addresses });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const customerId = await resolveCustomerId();
    if (!customerId) throw new AuthError(401, "Sign in required");
    const body = schema.parse(await request.json());
    const result = await upsertCustomerAddress(customerId, body);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
