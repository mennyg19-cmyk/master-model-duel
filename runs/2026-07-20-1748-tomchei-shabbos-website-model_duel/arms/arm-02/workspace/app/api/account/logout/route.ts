import { destroyCustomerSession } from "@/lib/auth/customer-session";
import { clearGuestDraftCookie } from "@/lib/order-builder/draft-store";

export async function POST() {
  await destroyCustomerSession();
  // Shared-device hygiene: no guest draft may survive a sign-out either.
  await clearGuestDraftCookie();
  return Response.json({ ok: true });
}
