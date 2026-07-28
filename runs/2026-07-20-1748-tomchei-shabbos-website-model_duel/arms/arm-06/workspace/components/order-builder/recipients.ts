import type { DraftRecipient } from "@prisma/client";
import { BookAddress, RecipientState } from "./types";
import { newClientId } from "./draft-reducer";

// RecipientState construction for the two ways a recipient enters the cart:
// picked from the address book, or hydrated from a saved draft's recipient
// rows. One mapper per source so field order and the source/saveToBook
// defaults live in exactly one place.
export function recipientFromBook(address: BookAddress): RecipientState {
  return {
    clientId: newClientId(),
    source: "book",
    name: address.label ?? address.line1,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    country: address.country,
    addressId: address.id,
    saveToBook: false,
    label: address.label,
  };
}

export function recipientFromOrderRow(recipient: DraftRecipient): RecipientState {
  return {
    clientId: recipient.id,
    source: recipient.addressId ? "book" : "on-order",
    name: recipient.name,
    line1: recipient.line1,
    line2: recipient.line2,
    city: recipient.city,
    region: recipient.region,
    postalCode: recipient.postalCode,
    country: recipient.country,
    addressId: recipient.addressId,
    saveToBook: false,
    label: null,
  };
}
