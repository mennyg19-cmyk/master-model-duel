import 'server-only';

import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { toAddressParts } from '../addresses/address-mapping';
import { normalizeAddressKey, normalizeName } from '../core/normalize';

/** Keeps the two rows apart when one field ends where the next begins. */
const GROUPING_KEY_SEPARATOR = '\u0000';

/**
 * The four things that decide whether two order lines can travel in one box
 * (UR-001): who receives it, where it goes, how it gets there, and what the
 * card says.
 *
 * Recipient and address are compared loosely — case and punctuation must not
 * split a package. The greeting is compared exactly apart from whitespace,
 * because two different messages mean two different cards, which means two
 * different boxes even for the same person at the same address.
 *
 * Picked from Prisma's own create input rather than restated, because finalize
 * spreads a destination straight into `package.create`. Renaming or dropping a
 * `Package` column has to break this type, not the insert.
 */
export const PACKAGE_DESTINATION_FIELDS = [
  'recipientName',
  'fulfillmentMethodId',
  'pickupLocationId',
  'addressLine1',
  'addressLine2',
  'addressCity',
  'addressState',
  'addressPostalCode',
  'addressCountry',
  'greetingMessage',
  'deliveryDay',
] as const;

export type PackageDestination = Pick<
  Prisma.PackageUncheckedCreateInput,
  (typeof PACKAGE_DESTINATION_FIELDS)[number]
>;

export type PackageGroup<TLine> = {
  groupingKey: string;
  destination: PackageDestination;
  lines: TLine[];
};

/**
 * Hashed rather than stored raw: a greeting can run to several paragraphs, and
 * the key carries a unique index.
 */
export function packageGroupingKey(destination: PackageDestination): string {
  const parts = [
    recipientDestinationKey(destination),
    normalizeGreeting(destination.greetingMessage),
    destination.deliveryDay ?? '',
  ];

  return createHash('sha256').update(parts.join(GROUPING_KEY_SEPARATOR)).digest('hex');
}

/**
 * Who and where, without what the card says or which day it goes out.
 *
 * Checkout asks its questions per recipient — one greeting, one delivery day —
 * so it has to be able to name a recipient before those answers exist. The
 * package key above is this plus those two answers, which is why setting them
 * cannot move a line into somebody else's box.
 *
 * Hashed like the package key, because checkout puts it in a form field and a
 * street address is not something to hand back to the browser to be posted.
 */
export function recipientDestinationKey(destination: PackageDestination): string {
  const address = toAddressParts(destination);

  const parts = [
    normalizeName(destination.recipientName),
    destination.fulfillmentMethodId,
    destination.pickupLocationId ?? '',
    address === null ? '' : normalizeAddressKey(address),
  ];

  return createHash('sha256').update(parts.join(GROUPING_KEY_SEPARATOR)).digest('hex');
}

/**
 * The place a fee is charged for: the address itself, or the pickup counter.
 * Bulk delivery bills once per one of these however many recipients ride along
 * (UR-009), so it deliberately ignores the recipient's name.
 */
export function deliveryDestinationKey(destination: PackageDestination): string {
  const address = toAddressParts(destination);
  if (address === null) return `pickup:${destination.pickupLocationId ?? 'none'}`;

  return normalizeAddressKey(address);
}

export function groupLinesIntoPackages<TLine extends PackageDestination>(
  lines: TLine[],
): PackageGroup<TLine>[] {
  const groups = new Map<string, PackageGroup<TLine>>();

  for (const line of lines) {
    const groupingKey = packageGroupingKey(line);
    const existing = groups.get(groupingKey);

    if (existing) {
      existing.lines.push(line);
    } else {
      groups.set(groupingKey, {
        groupingKey,
        destination: toPackageDestination(line),
        lines: [line],
      });
    }
  }

  return [...groups.values()];
}

/**
 * A line carries far more than a package does. This narrows it to exactly the
 * columns `package.create` accepts, so nothing else on the line can ride along
 * into the insert. It is the only adapter between the two: a second one that
 * substituted its own defaults would key packages differently and split a box.
 */
function toPackageDestination(line: PackageDestination): PackageDestination {
  return Object.fromEntries(
    PACKAGE_DESTINATION_FIELDS.map((field) => [field, line[field] ?? null]),
  ) as PackageDestination;
}

function normalizeGreeting(greeting: string | null | undefined): string {
  return (greeting ?? '').replace(/\s+/g, ' ').trim();
}
