import { destroyCustomerSession } from "@/lib/auth/customer-session";

export async function POST() {
  await destroyCustomerSession();
  return Response.json({ ok: true });
}
