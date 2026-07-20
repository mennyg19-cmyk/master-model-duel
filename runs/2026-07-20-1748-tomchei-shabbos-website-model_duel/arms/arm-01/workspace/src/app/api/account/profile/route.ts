import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer-access";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";

export async function PATCH(request: Request) {
  const account = await getAuthenticatedCustomer();
  if (!account?.customerId) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  const body = (await request.json()) as {
    displayName?: string;
    email?: string;
    phone?: string;
  };
  if (!body.displayName?.trim()) {
    return NextResponse.json({ error: "Display name is required." }, { status: 400 });
  }
  const customer = await db.customer.update({
    where: { id: account.customerId },
    data: {
      displayName: body.displayName.trim(),
      email: body.email?.trim() || null,
      emailNormalized: body.email ? normalizeEmail(body.email) : null,
      phone: body.phone?.trim() || null,
      phoneNormalized: body.phone?.replace(/\D/g, "") || null,
    },
  });
  return NextResponse.json({ customer });
}
