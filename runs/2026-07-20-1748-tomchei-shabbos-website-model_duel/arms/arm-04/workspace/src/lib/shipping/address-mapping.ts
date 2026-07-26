import { toAddressParts, type AddressColumns } from '../addresses/address-mapping';
import type { ShippingAddress } from './provider';

/**
 * A row's address columns in the shape a carrier is asked about (R-173, R-177).
 *
 * Quoting and address validation both need this and used to build it apart,
 * which is how the two ended up one `country` default and one phone default
 * away from asking the carrier about slightly different addresses.
 */
export function toShippingAddress(
  row: AddressColumns,
  contact: { name: string; phone?: string | null },
): ShippingAddress | null {
  const parts = toAddressParts(row);

  // A carrier prices a whole address or none: a box missing its city is one the
  // office has to finish before anybody can be asked what it costs to ship.
  if (!parts || !parts.city || !parts.state || !parts.postalCode) return null;

  return { name: contact.name, ...parts, phone: contact.phone ?? null };
}
