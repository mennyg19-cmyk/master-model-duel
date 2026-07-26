import 'server-only';

import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

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
  const line1 = destination.addressLine1 ?? '';

  const parts = [
    normalizeName(destination.recipientName),
    destination.fulfillmentMethodId,
    destination.pickupLocationId ?? '',
    line1 === ''
      ? ''
      : normalizeAddressKey({
          line1,
          line2: destination.addressLine2,
          city: destination.addressCity ?? '',
          state: destination.addressState ?? '',
          postalCode: destination.addressPostalCode ?? '',
          country: destination.addressCountry,
        }),
    normalizeGreeting(destination.greetingMessage),
  ];

  return createHash('sha256').update(parts.join(GROUPING_KEY_SEPARATOR)).digest('hex');
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
        destination: pickPackageDestination(line),
        lines: [line],
      });
    }
  }

  return [...groups.values()];
}

/**
 * A line carries far more than a package does. This narrows it to exactly the
 * columns `package.create` accepts, so nothing else on the line can ride along
 * into the insert.
 */
function pickPackageDestination(line: PackageDestination): PackageDestination {
  return Object.fromEntries(
    PACKAGE_DESTINATION_FIELDS.map((field) => [field, line[field] ?? null]),
  ) as PackageDestination;
}

function normalizeGreeting(greeting: string | null | undefined): string {
  return (greeting ?? '').replace(/\s+/g, ' ').trim();
}
