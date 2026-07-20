import { db } from "@/lib/db";
import { normalizedAddressKey, type AddressInput } from "@/lib/addresses/normalize";
import { geocodeAddress } from "@/lib/addresses/geocode";

// The single per-customer address book (UR-014). Saves dedupe on the
// normalized key: re-saving the same place updates the existing row (fills a
// label, refreshes geocode) instead of creating a twin.
export async function saveToAddressBook(customerId: string, input: AddressInput) {
  const normalizedKey = normalizedAddressKey(input);
  const coordinates = await geocodeAddress(input);
  const geocodeFields = coordinates ? { ...coordinates, geocodedAt: new Date() } : {};

  return db.customerAddress.upsert({
    where: { customerId_normalizedKey: { customerId, normalizedKey } },
    update: {
      label: input.label,
      recipient: input.recipient,
      line1: input.line1,
      line2: input.line2,
      city: input.city,
      state: input.state,
      zip: input.zip,
      ...geocodeFields,
    },
    create: {
      customerId,
      normalizedKey,
      label: input.label,
      recipient: input.recipient,
      line1: input.line1,
      line2: input.line2,
      city: input.city,
      state: input.state,
      zip: input.zip,
      ...geocodeFields,
    },
  });
}

/**
 * Edit an existing saved address in place (R-024/R-029). Recomputes the dedupe
 * key and geocode. Throws Prisma's unique error if the edit would collide with
 * another saved address — callers surface that as "you already have this one".
 */
export async function updateAddressBookEntry(addressId: string, input: AddressInput) {
  const normalizedKey = normalizedAddressKey(input);
  const coordinates = await geocodeAddress(input);
  const geocodeFields = coordinates
    ? { ...coordinates, geocodedAt: new Date() }
    : { latitude: null, longitude: null, geocodedAt: null };

  return db.customerAddress.update({
    where: { id: addressId },
    data: {
      normalizedKey,
      label: input.label,
      recipient: input.recipient,
      line1: input.line1,
      line2: input.line2,
      city: input.city,
      state: input.state,
      zip: input.zip,
      ...geocodeFields,
    },
  });
}
