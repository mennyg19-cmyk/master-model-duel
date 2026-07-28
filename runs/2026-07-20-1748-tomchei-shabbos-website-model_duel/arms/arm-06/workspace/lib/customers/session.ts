import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { Customer, CustomerSession } from "@prisma/client";
import { env, isDevAuthBypass } from "@/lib/env";
import { prisma } from "@/lib/db";
import { decodeSignedJson, encodeSignedJson } from "@/lib/session-codec";
import { clientIp } from "@/lib/client-ip";

// P4: customer sign-in, mirroring lib/auth.ts for staff. The HMAC cookie
// names a server-side CustomerSession row; expiry/revocation are validated
// against the DB on every gated request. Clerk swap: replace this module's
// decode half with Clerk session claims (schema already has clerkUserId).
export const CUSTOMER_SESSION_COOKIE = "arm06_customer";
// Same 12h TTL as staff sessions (lib/auth.ts) — README "Customer auth" is
// the documented value and this constant is its single source.
export const CUSTOMER_SESSION_TTL_HOURS = 12;

export interface CustomerSessionPayload {
  customerId: string;
  customerSessionId: string;
}

export interface CustomerContext {
  session: CustomerSessionPayload;
  customer: Customer;
}

export async function encodeCustomerSession(payload: CustomerSessionPayload, secret: string): Promise<string> {
  return encodeSignedJson(payload as unknown as Record<string, unknown>, secret);
}

export async function decodeCustomerSession(value: string, secret: string): Promise<CustomerSessionPayload | null> {
  const parsed = await decodeSignedJson(value, secret);
  if (!parsed) return null;
  if (typeof parsed.customerId !== "string" || typeof parsed.customerSessionId !== "string") return null;
  return parsed as unknown as CustomerSessionPayload;
}

export async function getCustomerSession(): Promise<CustomerSessionPayload | null> {
  const store = await cookies();
  const raw = store.get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!raw) return null;
  return decodeCustomerSession(raw, env.AUTH_SECRET);
}

export const getCustomerContext = cache(async (): Promise<CustomerContext | null> => {
  const session = await getCustomerSession();
  if (!session) return null;

  const row = await prisma.customerSession.findUnique({ where: { id: session.customerSessionId } });
  if (!row || row.revokedAt || row.expiresAt < new Date() || row.customerId !== session.customerId) {
    return null;
  }
  const customer = await prisma.customer.findUnique({ where: { id: session.customerId } });
  if (!customer) return null;
  return { session, customer };
});

export async function requireCustomer(): Promise<CustomerContext> {
  const ctx = await getCustomerContext();
  if (!ctx) redirect(isDevAuthBypass ? "/dev-login" : "/");
  return ctx;
}

type CustomerApiGate = { ok: true; ctx: CustomerContext } | { ok: false; response: NextResponse };

export async function requireApiCustomer(): Promise<CustomerApiGate> {
  const ctx = await getCustomerContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { ok: true, ctx };
}

export async function createCustomerLoginSession(customerId: string): Promise<CustomerSession> {
  const headerStore = await headers();
  const ip = clientIp(headerStore);
  return prisma.customerSession.create({
    data: {
      customerId,
      ip,
      userAgent: headerStore.get("user-agent"),
      expiresAt: new Date(Date.now() + CUSTOMER_SESSION_TTL_HOURS * 60 * 60 * 1000),
    },
  });
}

export async function revokeCustomerLoginSession(customerSessionId: string): Promise<void> {
  await prisma.customerSession.updateMany({
    where: { id: customerSessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

function customerCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: CUSTOMER_SESSION_TTL_HOURS * 60 * 60,
  };
}

export async function issueCustomerSessionResponse(
  payload: CustomerSessionPayload,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const sessionValue = await encodeCustomerSession(payload, env.AUTH_SECRET);
  const response = NextResponse.json(body);
  response.cookies.set(CUSTOMER_SESSION_COOKIE, sessionValue, customerCookieOptions());
  return response;
}

export function clearCustomerSessionResponse(): NextResponse {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(CUSTOMER_SESSION_COOKIE, "", { ...customerCookieOptions(), maxAge: 0 });
  return response;
}
