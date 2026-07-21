import { getOpenSeason } from "@/lib/season";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { cartSchema, priceCart } from "@/lib/order-builder/cart";
import {
  resolveDraftOwner,
  findActiveDraft,
  saveDraft,
  discardDraft,
  applyAssignmentRules,
} from "@/lib/order-builder/draft-store";
import { getCustomerAddressBook } from "@/lib/addresses/book";

// The draft endpoint never takes a draft id: the draft is whatever the
// session/guest cookie owns (R-121 anti-enumeration).

// Both GET and PUT return the owner's current address book alongside the
// priced cart: auto-saved recipients (below) create book entries the client
// hasn't seen yet, and the sidebar renders assignments by address id.
async function ownerAddressBook(customerId: string | null) {
  return customerId ? getCustomerAddressBook(customerId) : [];
}

export async function GET() {
  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });

  const owner = await resolveDraftOwner();
  const addressBook = await ownerAddressBook(owner.kind === "customer" ? owner.customerId : null);
  const draft = await findActiveDraft(season.id, owner);
  if (!draft) return Response.json({ draft: null, addressBook });

  const cart = cartSchema.parse(draft.cart);
  const priced = await priceCart(season.id, cart);
  return Response.json({ draft: { updatedAt: draft.updatedAt, priced }, addressBook });
}

export async function PUT(request: Request) {
  if (!rateLimit(`draft-save:${clientIp(request)}`, 120, 60_000)) {
    return Response.json({ error: "Saving too fast — slow down a moment." }, { status: 429 });
  }
  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });

  const parsed = cartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Cart payload is invalid" }, { status: 400 });
  }

  const owner = await resolveDraftOwner();
  const customerId = owner.kind === "customer" ? owner.customerId : null;
  const cart = await applyAssignmentRules(parsed.data, customerId);
  const draft = await saveDraft(season.id, owner, cart);
  const priced = await priceCart(season.id, cart);
  const addressBook = await ownerAddressBook(customerId);
  return Response.json({ draft: { updatedAt: draft.updatedAt, priced }, addressBook });
}

export async function DELETE() {
  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });
  const owner = await resolveDraftOwner();
  const discarded = await discardDraft(season.id, owner);
  return Response.json({ ok: discarded });
}
