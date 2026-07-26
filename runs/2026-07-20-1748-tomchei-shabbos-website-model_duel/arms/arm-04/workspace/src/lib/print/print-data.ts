import 'server-only';

import type { OrderStatus, PackageStage, Prisma } from '@prisma/client';

import type { DbClient } from '../core/db-client';
import { db } from '../db';
import { optionsLabel } from '../orders/lines';
import type { FilingSubject } from './filing-groups';

/**
 * Everything a printed artifact says about one box, read in one query.
 *
 * Slips, labels and cards are three views of the same box, so they share one
 * reader: a card that named a different recipient from the label in the same
 * box is the failure this phase exists to prevent.
 */
export type PrintablePackage = FilingSubject & {
  id: string;
  orderId: string;
  stage: PackageStage;
  customerName: string;
  addressLines: string[];
  destinationLabel: string;
  greetingMessage: string | null;
  itemCount: number;
  lines: { id: string; quantity: number; description: string }[];
};

/**
 * The orders paper is made for, in the season being worked.
 *
 * A cancelled order keeps its boxes — nothing is deleted, so that what was
 * cancelled stays readable — and not one of them may be printed. Every path
 * that produces paper reads through this, so no screen and no reprint can file
 * something the nightly build would have refused.
 */
export const PRINTABLE_ORDER_STATUSES: OrderStatus[] = ['PLACED', 'IN_FULFILLMENT'];

export function printableOrderWhere(seasonId: string): Prisma.OrderWhereInput {
  return { seasonId, status: { in: PRINTABLE_ORDER_STATUSES } };
}

const PRINT_INCLUDE = {
  fulfillmentMethod: { select: { code: true, label: true, kind: true, sortOrder: true } },
  pickupLocation: { select: { id: true, name: true, line1: true, city: true, state: true, postalCode: true } },
  order: {
    select: {
      orderNumber: true,
      draftReference: true,
      customer: { select: { fullName: true } },
    },
  },
  lines: {
    include: { addOns: { select: { addOnNameSnapshot: true, quantity: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PackageInclude;

/**
 * `client` so the nightly batch can read its candidates inside the transaction
 * that claims them: reading them outside is where two runs pick up the same box.
 */
export async function readPrintablePackages(
  where: Prisma.PackageWhereInput,
  client: DbClient = db,
): Promise<PrintablePackage[]> {
  const packages = await client.package.findMany({ where, include: PRINT_INCLUDE });
  return packages.map(toPrintable);
}

type PackageWithPrintData = Prisma.PackageGetPayload<{ include: typeof PRINT_INCLUDE }>;

function toPrintable(box: PackageWithPrintData): PrintablePackage {
  return {
    id: box.id,
    orderId: box.orderId,
    stage: box.stage,
    methodCode: box.fulfillmentMethod.code,
    methodLabel: box.fulfillmentMethod.label,
    methodKind: box.fulfillmentMethod.kind,
    methodSortOrder: box.fulfillmentMethod.sortOrder,
    pickupLocationId: box.pickupLocationId,
    pickupLocationName: box.pickupLocation?.name ?? null,
    deliveryDay: box.deliveryDay,
    recipientName: box.recipientName,
    orderNumber: box.order.orderNumber,
    draftReference: box.order.draftReference,
    customerName: box.order.customer?.fullName ?? 'Guest',
    addressLines: addressLinesOf(box),
    destinationLabel: box.pickupLocation
      ? `Pick up at ${box.pickupLocation.name}`
      : [box.addressCity, box.addressState].filter(Boolean).join(', '),
    greetingMessage: box.greetingMessage,
    itemCount: box.lines.reduce((count, line) => count + line.quantity, 0),
    lines: box.lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      description: describeLine(line),
    })),
  };
}

function describeLine(line: PackageWithPrintData['lines'][number]): string {
  const options = optionsLabel(line.optionsSnapshot);
  const addOns = line.addOns.map((addOn) => addOn.addOnNameSnapshot);

  return [
    line.productNameSnapshot,
    options === '' ? '' : `(${options})`,
    addOns.length === 0 ? '' : `+ ${addOns.join(', ')}`,
  ]
    .filter((part) => part !== '')
    .join(' ');
}

/**
 * A pickup box carries the counter's address, not the recipient's: it is the
 * shelf the box waits on, and the label on it has to say where it is.
 */
function addressLinesOf(box: PackageWithPrintData): string[] {
  if (box.pickupLocation) {
    return [
      box.pickupLocation.name,
      box.pickupLocation.line1,
      `${box.pickupLocation.city}, ${box.pickupLocation.state} ${box.pickupLocation.postalCode}`,
    ];
  }

  return [
    box.addressLine1,
    box.addressLine2,
    [box.addressCity, box.addressState].filter(Boolean).join(', ') +
      (box.addressPostalCode ? ` ${box.addressPostalCode}` : ''),
  ].filter((line): line is string => Boolean(line && line.trim() !== ''));
}
