import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isDevAuthBypass } from "@/lib/env";
import { parseBody } from "@/lib/parse-body";
import {
  clearCustomerSessionResponse,
  createCustomerLoginSession,
  getCustomerSession,
  issueCustomerSessionResponse,
  revokeCustomerLoginSession,
} from "@/lib/customers/session";

// Dev-auth bypass, customer side: stands in for Clerk customer sign-in while
// no live keys exist on this host (same documented seam as /api/dev-auth for
// staff). POST is flag-gated; DELETE only ever clears/revokes a session, so
// it stays available for logout either way.
const loginSchema = z.object({ customerId: z.string().min(1) });

export async function POST(request: Request) {
  if (!isDevAuthBypass) {
    return NextResponse.json(
      { error: "Dev auth is disabled. Set DEV_AUTH_BYPASS=true for local testing only." },
      { status: 404 },
    );
  }

  const parsed = await parseBody(request, loginSchema, "customerId is required");
  if (!parsed.ok) return parsed.response;

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) {
    return NextResponse.json({ error: "No customer account for that id" }, { status: 403 });
  }

  const session = await createCustomerLoginSession(customer.id);
  return issueCustomerSessionResponse(
    { customerId: customer.id, customerSessionId: session.id },
    { ok: true, customer: { id: customer.id, name: customer.name, email: customer.email } },
  );
}

export async function DELETE() {
  const session = await getCustomerSession();
  if (session) {
    await revokeCustomerLoginSession(session.customerSessionId);
  }
  return clearCustomerSessionResponse();
}
