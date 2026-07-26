import { DEFAULT_ADDRESS_COUNTRY } from '../core/normalize';
import { addressSummary } from './address-summary';

/**
 * The one adapter between a row's `address*` columns and an address.
 *
 * Packages, order lines and cart rows all carry the same six prefixed columns,
 * and every screen that shows or keys an address used to unprefix them by hand
 * with its own defaults. Two of those sites defaulted the country to `US` and
 * six to the empty string, which is enough to key the same house two ways.
 *
 * It sits beside `address-summary.ts` rather than in `address-book.ts` for the
 * same reason that one does: neither is `server-only`, so a client component
 * can spell an address the same way the server does.
 */
export type AddressColumns = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string | null;
};

export type AddressParts = {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

/** Null when the row has no street line: a pickup box has no address by design. */
export function toAddressParts(row: AddressColumns): AddressParts | null {
  if (!row.addressLine1) return null;

  return {
    line1: row.addressLine1,
    line2: row.addressLine2 ?? null,
    city: row.addressCity ?? '',
    state: row.addressState ?? '',
    postalCode: row.addressPostalCode ?? '',
    country: row.addressCountry ?? DEFAULT_ADDRESS_COUNTRY,
  };
}

/** The row's address on one line, or null when it has none. */
export function addressLine(row: AddressColumns): string | null {
  const address = toAddressParts(row);
  return address === null ? null : addressSummary(address);
}

/**
 * Where a box is going, as one line for a screen: the pickup counter, the
 * address, or null when it has neither yet. Callers supply their own dash for
 * the last case, because a table cell and a detail field want different ones.
 */
export function destinationLabel(
  row: AddressColumns & { pickupLocation: { name: string } | null },
): string | null {
  return row.pickupLocation ? `Pick up at ${row.pickupLocation.name}` : addressLine(row);
}
