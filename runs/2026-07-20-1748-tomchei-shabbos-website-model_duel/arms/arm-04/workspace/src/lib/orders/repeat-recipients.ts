import type { CustomerAddress } from '@prisma/client';

import { addressLine, type AddressColumns } from '../addresses/address-mapping';
import { normalizeAddressKey } from '../core/normalize';

/**
 * Who last year's line is going to this year, worked out against the address
 * book as it stands today (UR-007, UR-013).
 *
 * This is the half of a repeat plan that has nothing to do with the catalogue:
 * the item can be resolved without knowing whether the aunt it was sent to still
 * lives there, and the two questions are asked separately on the review page for
 * the same reason.
 */

/** Where the line's recipient stands against the address book as it is today. */
export type RecipientState =
  | 'ready'
  /** The saved address it used has been archived or deleted; pick another. */
  | 'address_missing'
  /** The way it was fulfilled last year is no longer offered. */
  | 'method_missing'
  /** Collected at the counter, so there is no address to confirm. */
  | 'pickup';

export type RepeatRecipient = {
  name: string;
  state: RecipientState;
  methodId: string | null;
  methodLabel: string | null;
  pickupLocationId: string | null;
  customerAddressId: string | null;
  addressSummary: string | null;
  address: AddressColumns;
};

/**
 * What this module reads off last year's line. An order line row satisfies it,
 * which keeps the recipient rules free of the query that fetched them.
 */
export type RecipientSourceLine = AddressColumns & {
  recipientName: string | null;
  fulfillmentMethodId: string | null;
  pickupLocationId: string | null;
  customerAddressId: string | null;
  greetingMessage: string | null;
};

export type LiveMethod = { id: string; label: string; requiresAddress: boolean };

export type SavedAddressLookup = {
  byId: Map<string, CustomerAddress>;
  byKey: Map<string, CustomerAddress>;
};

export function savedAddressLookup(addresses: CustomerAddress[]): SavedAddressLookup {
  return {
    byId: new Map(addresses.map((address) => [address.id, address])),
    byKey: new Map(addresses.map((address) => [address.addressKey, address])),
  };
}

export function addressColumnsFromSaved(address: CustomerAddress): AddressColumns {
  return {
    addressLine1: address.line1,
    addressLine2: address.line2,
    addressCity: address.city,
    addressState: address.state,
    addressPostalCode: address.postalCode,
    addressCountry: address.country,
  };
}

export function addressColumnsFromLine(line: AddressColumns): AddressColumns {
  return {
    addressLine1: line.addressLine1,
    addressLine2: line.addressLine2,
    addressCity: line.addressCity,
    addressState: line.addressState,
    addressPostalCode: line.addressPostalCode,
    addressCountry: line.addressCountry,
  };
}

/**
 * The address book row the line quoted is the first choice. If that row has been
 * archived — people move, and an archived row is exactly how the book says so —
 * the same street is looked for under its normalized key before giving up, so a
 * re-added address is recognised rather than re-typed.
 */
export function planRecipient(
  line: RecipientSourceLine,
  methods: Map<string, LiveMethod>,
  addresses: SavedAddressLookup,
): RepeatRecipient {
  const method = line.fulfillmentMethodId === null ? null : methods.get(line.fulfillmentMethodId);
  const address = savedAddressFor(line, addresses);
  const addressColumns = address ? addressColumnsFromSaved(address) : addressColumnsFromLine(line);

  return {
    name: address?.recipientName ?? line.recipientName ?? 'Not assigned yet',
    state: recipientState(method, address, line),
    methodId: method?.id ?? null,
    methodLabel: method?.label ?? null,
    pickupLocationId: line.pickupLocationId,
    customerAddressId: address?.id ?? null,
    addressSummary: addressLine(addressColumns),
    address: addressColumns,
  };
}

/**
 * What last year's card said, or what this recipient's card said most recently
 * (UR-013, G-020). A donor who writes the same line to the same aunt every year
 * should find it already typed.
 */
export function greetingFor(
  line: RecipientSourceLine,
  addresses: SavedAddressLookup,
): string | null {
  if (line.greetingMessage) return line.greetingMessage;
  return savedAddressFor(line, addresses)?.lastGreeting ?? null;
}

function recipientState(
  method: LiveMethod | null | undefined,
  address: CustomerAddress | null,
  line: RecipientSourceLine,
): RecipientState {
  if (!method) return 'method_missing';
  if (!method.requiresAddress) return line.pickupLocationId === null ? 'method_missing' : 'pickup';
  return address === null ? 'address_missing' : 'ready';
}

function savedAddressFor(
  line: RecipientSourceLine,
  addresses: SavedAddressLookup,
): CustomerAddress | null {
  const quoted = line.customerAddressId === null ? null : addresses.byId.get(line.customerAddressId);
  if (quoted) return quoted;
  if (!line.addressLine1) return null;

  return (
    addresses.byKey.get(
      normalizeAddressKey({
        line1: line.addressLine1,
        line2: line.addressLine2 ?? null,
        city: line.addressCity ?? '',
        state: line.addressState ?? '',
        postalCode: line.addressPostalCode ?? '',
        country: line.addressCountry,
      }),
    ) ?? null
  );
}
