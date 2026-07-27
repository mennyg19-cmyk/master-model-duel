import 'server-only';

import type { FulfillmentKind, PackageStage, Prisma } from '@prisma/client';

import { destinationLabel } from '../addresses/address-mapping';
import { pageInfo, type PageInfo, type PageRequest } from '../admin/list-query';
import { db } from '../db';
import { lineTotalWithAddOns, optionsLabel } from '../orders/lines';
import { ALL_STAGES, boardScopeWhere } from './channel-summary';

/**
 * The package board (UR-001, G-003, G-004).
 *
 * The order desk answers "what did this person buy"; the board answers "what is
 * on the packing table". They are different jobs done by different people, which
 * is why boxes get their own searchable, filtered, bounded list rather than
 * living inside the order screen.
 */
export type BoardFilters = {
  search: string;
  stage: PackageStage | null;
  /** A fulfillment method id. Arrives and leaves as the `channel` URL param. */
  methodId: string | null;
};

export type BoardRow = {
  id: string;
  version: number;
  recipientName: string;
  methodLabel: string;
  destination: string;
  deliveryDay: string | null;
  stage: PackageStage;
  itemCount: number;
  hasGreeting: boolean;
  orderId: string;
  orderNumber: number | null;
  draftReference: string;
  /** Whether this box has been on a nightly batch. Not a stage: paper, not progress. */
  filedForPrint: boolean;
};

export function readBoardFilters(input: {
  q?: string;
  stage?: string;
  channel?: string;
}): BoardFilters {
  const stage = (input.stage ?? '').trim().toUpperCase();

  return {
    search: (input.q ?? '').trim().slice(0, 120),
    stage: (ALL_STAGES as string[]).includes(stage) ? (stage as PackageStage) : null,
    methodId: (input.channel ?? '').trim() || null,
  };
}

export function boardWhere(seasonId: string, filters: BoardFilters): Prisma.PackageWhereInput {
  const where: Prisma.PackageWhereInput = {
    ...boardScopeWhere(seasonId),
    ...(filters.stage ? { stage: filters.stage } : {}),
    ...(filters.methodId ? { fulfillmentMethodId: filters.methodId } : {}),
  };

  if (filters.search === '') return where;

  // The search is one box because staff hold one string: a recipient's name, the
  // order number on the slip in their hand, or a draft reference. `OR` sits
  // beside the scope above rather than inside it, so a search can widen the rows
  // it matches but never the season or the statuses it may reach.
  const orderNumber = /^#?\d{1,9}$/.test(filters.search)
    ? Number(filters.search.replace('#', ''))
    : null;

  return {
    ...where,
    OR: [
      { recipientName: { contains: filters.search, mode: 'insensitive' } },
      ...(orderNumber === null ? [] : [{ order: { orderNumber } }]),
      { order: { draftReference: { equals: filters.search, mode: 'insensitive' } } },
    ],
  };
}

export async function listPackageBoard(
  seasonId: string,
  filters: BoardFilters,
  request: PageRequest,
): Promise<{ rows: BoardRow[]; page: PageInfo }> {
  const where = boardWhere(seasonId, filters);

  const [totalCount, packages] = await Promise.all([
    db.package.count({ where }),
    db.package.findMany({
      where,
      include: {
        fulfillmentMethod: { select: { label: true } },
        pickupLocation: { select: { name: true } },
        lines: { select: { quantity: true } },
        order: { select: { orderNumber: true, draftReference: true } },
        _count: { select: { printItems: true } },
      },
      // Recipient first: staff at the table are looking for a person. The id
      // breaks ties so a box cannot swap pages while somebody is reading them.
      orderBy: [{ recipientName: 'asc' }, { id: 'asc' }],
      skip: request.skip,
      take: request.take,
    }),
  ]);

  return {
    rows: packages.map((box) => ({
      id: box.id,
      version: box.version,
      recipientName: box.recipientName,
      methodLabel: box.fulfillmentMethod.label,
      destination: destinationLabel(box) ?? '—',
      deliveryDay: box.deliveryDay,
      stage: box.stage,
      itemCount: box.lines.reduce((count, line) => count + line.quantity, 0),
      hasGreeting: box.greetingMessage !== null && box.greetingMessage.trim() !== '',
      orderId: box.orderId,
      orderNumber: box.order.orderNumber,
      draftReference: box.order.draftReference,
      filedForPrint: box._count.printItems > 0,
    })),
    page: pageInfo(request, totalCount),
  };
}

export type PackageDetail = {
  id: string;
  version: number;
  stage: PackageStage;
  recipientName: string;
  methodId: string;
  methodLabel: string;
  methodKind: FulfillmentKind;
  destination: string;
  deliveryDay: string | null;
  greetingMessage: string | null;
  fulfillmentFeeCents: number;
  printedAt: Date | null;
  packedAt: Date | null;
  sentAt: Date | null;
  pickedUpAt: Date | null;
  orderId: string;
  orderNumber: number | null;
  draftReference: string;
  customerName: string;
  lines: { id: string; quantity: number; description: string; totalCents: number }[];
  /** The other boxes on the same order — the only places a line may be moved to. */
  siblings: { id: string; recipientName: string; methodLabel: string; stage: PackageStage }[];
  filings: { batchLabel: string; groupLabel: string; batchId: string; groupId: string }[];
};

/** Read through the board's own scope: a box from another season is not on it. */
export async function readPackageDetail(
  seasonId: string,
  packageId: string,
): Promise<PackageDetail | null> {
  const box = await db.package.findFirst({
    where: { id: packageId, ...boardScopeWhere(seasonId) },
    include: {
      fulfillmentMethod: { select: { label: true, kind: true } },
      pickupLocation: { select: { name: true } },
      lines: { include: { addOns: true }, orderBy: { createdAt: 'asc' } },
      order: {
        select: {
          orderNumber: true,
          draftReference: true,
          customer: { select: { fullName: true } },
          packages: {
            where: { id: { not: packageId } },
            select: {
              id: true,
              recipientName: true,
              stage: true,
              fulfillmentMethod: { select: { label: true } },
            },
            orderBy: { recipientName: 'asc' },
          },
        },
      },
      printItems: {
        include: {
          group: { select: { id: true, label: true, batch: { select: { id: true, label: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!box) return null;

  return {
    id: box.id,
    version: box.version,
    stage: box.stage,
    recipientName: box.recipientName,
    methodId: box.fulfillmentMethodId,
    methodLabel: box.fulfillmentMethod.label,
    methodKind: box.fulfillmentMethod.kind,
    destination: destinationLabel(box) ?? '—',
    deliveryDay: box.deliveryDay,
    greetingMessage: box.greetingMessage,
    fulfillmentFeeCents: box.fulfillmentFeeCents,
    printedAt: box.printedAt,
    packedAt: box.packedAt,
    sentAt: box.sentAt,
    pickedUpAt: box.pickedUpAt,
    orderId: box.orderId,
    orderNumber: box.order.orderNumber,
    draftReference: box.order.draftReference,
    customerName: box.order.customer?.fullName ?? 'Guest',
    lines: box.lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      description: [line.productNameSnapshot, optionsLabel(line.optionsSnapshot)]
        .filter((part) => part !== '')
        .join(' · '),
      totalCents: lineTotalWithAddOns(line),
    })),
    siblings: box.order.packages.map((sibling) => ({
      id: sibling.id,
      recipientName: sibling.recipientName,
      methodLabel: sibling.fulfillmentMethod.label,
      stage: sibling.stage,
    })),
    filings: box.printItems.map((filing) => ({
      batchId: filing.group.batch.id,
      batchLabel: filing.group.batch.label,
      groupId: filing.group.id,
      groupLabel: filing.group.label,
    })),
  };
}
