import { getCustomerContext } from "@/lib/customers/session";
import { DraftAccess } from "@/lib/orders/drafts";
import { readGuestDraftToken } from "@/lib/orders/guest-draft-cookie";

// Session-or-guest-cookie ownership context (R-121) for the checkout routes
// and the /checkout page — one construction of the access rule, so the
// ownership shape can't drift between call sites.
export async function checkoutAccess(draftRef: string): Promise<DraftAccess> {
  const customerCtx = await getCustomerContext();
  return {
    customerId: customerCtx?.customer.id,
    guestToken: await readGuestDraftToken(draftRef),
  };
}
