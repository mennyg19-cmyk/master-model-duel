import { createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

// Customer auth mirrors the staff session design (DB-backed + HMAC token hash)
// but lives in its own table and cookie, so the two identity worlds can never
// cross: a customer cookie is meaningless to requirePermission* and vice versa.
export const CUSTOMER_COOKIE = "tomchei_customer";
const SESSION_TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(`customer:${token}`).digest("hex");
}

export async function createCustomerSession(customerId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await db.customerSession.create({
    data: {
      tokenHash: hashToken(token),
      customerId,
      expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000),
    },
  });
  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 3600,
  });
}

export type CustomerContext = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
};

export async function getCustomerContext(): Promise<CustomerContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  const session = await db.customerSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { customer: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const { id, email, name, phone } = session.customer;
  return { id, email, name, phone };
}

export async function destroyCustomerSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_COOKIE)?.value;
  if (token) {
    await db.customerSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  cookieStore.delete(CUSTOMER_COOKIE);
}
