import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, getAuthIdentity } from "@/lib/auth";
import { linkOrCreateCustomer } from "@/lib/customers";
import { apiErrorResponse } from "@/lib/api-error";

const schema = z.object({
  phone: z.string().optional(),
  displayName: z.string().min(2).optional(),
});

export async function POST(request: Request) {
  try {
    const identity = await getAuthIdentity();
    if (!identity) {
      throw new AuthError(401, "Sign in required");
    }
    const body = schema.parse(await request.json().catch(() => ({})));
    const result = await linkOrCreateCustomer({
      clerkUserId: identity.clerkUserId,
      email: identity.email,
      phone: body.phone,
      displayName: body.displayName ?? identity.displayName,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
