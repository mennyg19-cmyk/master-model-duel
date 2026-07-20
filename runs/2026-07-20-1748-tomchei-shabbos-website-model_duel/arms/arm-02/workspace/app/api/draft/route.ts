import { db } from "@/lib/db";
import { getOpenSeason } from "@/lib/season";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { cartSchema, priceCart, type Cart } from "@/lib/order-builder/cart";
import {
  resolveDraftOwner,
  findActiveDraft,
  saveDraft,
  discardDraft,
} from "@/lib/order-builder/draft-store";
import { getCustomerAddressBook, saveToAddressBook } from "@/lib/addresses/book";

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

// Server-side assignment rules:
// - "new recipient" for a signed-in customer auto-saves to their address book
//   (G-019) and the line is rewritten to point at the saved entry, so editing
//   the book later updates the recipient too.
// - address-book assignments must point into the session customer's own book;
//   anything else (including any book reference from a guest) is dropped back
//   to unassigned rather than trusted.
async function applyAssignmentRules(cart: Cart, customerId: string | null): Promise<Cart> {
  const ownedAddressIds = customerId
    ? new Set(
        (
          await db.customerAddress.findMany({ where: { customerId }, select: { id: true } })
        ).map((address) => address.id)
      )
    : new Set<string>();

  const lines = [];
  for (const line of cart.lines) {
    if (line.assignment?.type === "newRecipient" && customerId) {
      const saved = await saveToAddressBook(customerId, line.assignment.address);
      ownedAddressIds.add(saved.id);
      lines.push({ ...line, assignment: { type: "addressBook" as const, addressId: saved.id } });
      continue;
    }
    if (line.assignment?.type === "addressBook" && !ownedAddressIds.has(line.assignment.addressId)) {
      lines.push({ ...line, assignment: null });
      continue;
    }
    lines.push(line);
  }
  return { ...cart, lines };
}
