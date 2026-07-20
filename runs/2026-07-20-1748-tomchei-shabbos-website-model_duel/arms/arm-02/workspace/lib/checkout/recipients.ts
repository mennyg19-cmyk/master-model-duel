import { db } from "@/lib/db";
import type { Cart } from "@/lib/order-builder/cart";
import type { AddressInput } from "@/lib/addresses/normalize";

// Checkout works per recipient (R-033): every assigned cart line resolves to a
// concrete recipient + address here, and fulfillment/greeting choices are made
// against these keys. The key is stable across requests ("onOrder" or
// "book:<addressId>") so the client can echo choices back without ever sending
// an address we'd have to trust.

export type CheckoutRecipient = {
  key: string;
  recipientName: string;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    zip: string;
  };
  /** Saved-book id when the recipient came from the address book (greeting memory target). */
  addressBookId: string | null;
  /** Prefill for the per-recipient greeting override (UR-013, G-020). */
  rememberedGreeting: string | null;
  lineIds: string[];
};

export function assignmentKey(assignment: NonNullable<Cart["lines"][number]["assignment"]>): string {
  if (assignment.type === "onOrder") return "onOrder";
  if (assignment.type === "addressBook") return `book:${assignment.addressId}`;
  // newRecipient assignments for signed-in customers are rewritten to book
  // entries on save; a guest's stay inline, keyed by the address content.
  const { recipient, line1, zip } = assignment.address;
  return `new:${[recipient, line1, zip].map((part) => part.trim().toLowerCase()).join("|")}`;
}

/**
 * Resolve every assigned line to its concrete recipient. Address-book ids are
 * re-checked against the OWNER's book (never trusted from the cart blindly —
 * the draft API already enforces this, this is the second lock on the door).
 * Returns null when any line is unassigned — checkout must refuse.
 */
export async function resolveCheckoutRecipients(
  cart: Cart,
  customerId: string | null
): Promise<CheckoutRecipient[] | null> {
  const bookIds = new Set<string>();
  for (const line of cart.lines) {
    if (!line.assignment) return null;
    if (line.assignment.type === "addressBook") bookIds.add(line.assignment.addressId);
    if (line.assignment.type === "onOrder" && !cart.onOrderRecipient) return null;
  }

  const bookEntries = bookIds.size
    ? await db.customerAddress.findMany({
        where: { id: { in: [...bookIds] }, ...(customerId ? { customerId } : { customerId: "__none__" }) },
      })
    : [];
  const bookById = new Map(bookEntries.map((entry) => [entry.id, entry]));

  const byKey = new Map<string, CheckoutRecipient>();
  for (const line of cart.lines) {
    const assignment = line.assignment!;
    const key = assignmentKey(assignment);
    const existing = byKey.get(key);
    if (existing) {
      existing.lineIds.push(line.id);
      continue;
    }

    let recipient: CheckoutRecipient;
    if (assignment.type === "onOrder") {
      const onOrder = cart.onOrderRecipient!;
      recipient = {
        key,
        recipientName: onOrder.recipient,
        address: pickAddress(onOrder),
        addressBookId: null,
        rememberedGreeting: null,
        lineIds: [line.id],
      };
    } else if (assignment.type === "addressBook") {
      const saved = bookById.get(assignment.addressId);
      if (!saved) return null; // stale or foreign book reference — refuse
      recipient = {
        key,
        recipientName: saved.recipient,
        address: {
          line1: saved.line1,
          line2: saved.line2,
          city: saved.city,
          state: saved.state,
          zip: saved.zip,
        },
        addressBookId: saved.id,
        rememberedGreeting: saved.lastGreeting,
        lineIds: [line.id],
      };
    } else {
      recipient = {
        key,
        recipientName: assignment.address.recipient,
        address: pickAddress(assignment.address),
        addressBookId: null,
        rememberedGreeting: null,
        lineIds: [line.id],
      };
    }
    byKey.set(key, recipient);
  }

  return [...byKey.values()];
}

function pickAddress(input: AddressInput) {
  return {
    line1: input.line1,
    line2: input.line2 ?? null,
    city: input.city,
    state: input.state,
    zip: input.zip,
  };
}

/** Distinct-destination key: same normalization the package engine uses for addresses. */
export function destinationKey(address: CheckoutRecipient["address"]): string {
  return [address.line1, address.line2 ?? "", address.city, address.state, address.zip]
    .map((part) => part.trim().replace(/\s+/g, " ").toLowerCase())
    .join("|");
}
