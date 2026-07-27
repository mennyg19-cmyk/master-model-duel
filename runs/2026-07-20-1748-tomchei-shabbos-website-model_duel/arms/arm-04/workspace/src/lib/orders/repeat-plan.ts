import 'server-only';

import type { Prisma } from '@prisma/client';

import {
  closestPricedProduct,
  listSeasonCatalog,
  resolveReplacements,
  type SeasonProduct,
} from '../catalog/replacements';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import {
  greetingFor,
  planRecipient,
  savedAddressLookup,
  type LiveMethod,
  type RepeatRecipient,
} from './repeat-recipients';

/**
 * "Same as last year" worked out in full, before anything is written (UR-007).
 *
 * A repeat is three separate questions and the plan answers all three up front,
 * which is what makes a review page possible: what is this item now, who is it
 * going to, and what does the card say. Nothing here creates a row — the plan is
 * read, shown to whoever is repeating, and only then applied by `repeat-apply`.
 *
 * Every price is this season's. Last year's is carried alongside purely so the
 * screen can say "was $42, now $46" and so the price-smart suggestion has a
 * number to aim at.
 */
export const REPEAT_SOURCE_NOT_FOUND = 'repeat_source_not_found';
export const REPEAT_NO_CUSTOMER = 'repeat_no_customer';
export const REPEAT_NOTHING_TO_COPY = 'repeat_nothing_to_copy';

export type RepeatLinePlan = {
  sourceLineId: string;
  sourceName: string;
  quantity: number;
  lastUnitPriceCents: number;
  /** `same` and `mapped` arrive pre-selected; `needs_choice` starts blank. */
  resolution: 'same' | 'mapped' | 'needs_choice';
  product: SeasonProduct | null;
  /** The retired items the mapping was followed through, for the screen. */
  viaNames: string[];
  suggestion: SeasonProduct | null;
  recipient: RepeatRecipient;
  greetingMessage: string | null;
  addOns: CurrentAddOn[];
  droppedAddOnNames: string[];
};

export type RepeatPlan = {
  sourceOrderId: string;
  sourceLabel: string;
  sourceSeasonLabel: string;
  customerId: string;
  targetSeasonId: string;
  targetSeasonLabel: string;
  wasImported: boolean;
  lines: RepeatLinePlan[];
  catalog: SeasonProduct[];
  addressBook: { id: string; recipientName: string; summary: string }[];
  needsChoiceCount: number;
  recipientProblemCount: number;
};

export type CurrentAddOn = { id: string; name: string; priceCents: number };

const SOURCE_INCLUDE = {
  season: { select: { label: true } },
  lines: {
    include: {
      product: { select: { slug: true, category: true } },
      addOns: { include: { addOn: { select: { slug: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrderInclude;

export async function buildRepeatPlan(
  sourceOrderId: string,
  targetSeasonId: string,
): Promise<Result<RepeatPlan>> {
  const source = await db.order.findUnique({
    where: { id: sourceOrderId },
    include: SOURCE_INCLUDE,
  });
  if (!source) return failure(REPEAT_SOURCE_NOT_FOUND, 'That order no longer exists.');
  if (source.customerId === null) {
    return failure(REPEAT_NO_CUSTOMER, 'That order has no customer on it, so there is nobody to repeat it for.');
  }
  if (source.lines.length === 0) {
    return failure(REPEAT_NOTHING_TO_COPY, 'There is nothing on that order to repeat.');
  }

  const customerId = source.customerId;

  const [season, catalog, resolutions, addOnCatalog, methods, addresses] = await Promise.all([
    db.season.findUniqueOrThrow({ where: { id: targetSeasonId }, select: { label: true } }),
    listSeasonCatalog(targetSeasonId),
    resolveReplacements(
      source.lines.map((line) => line.productId),
      targetSeasonId,
    ),
    currentAddOnsBySlug(targetSeasonId),
    db.fulfillmentMethod.findMany({
      where: { isActive: true },
      select: { id: true, label: true, requiresAddress: true },
    }),
    db.customerAddress.findMany({
      where: { customerId, isArchived: false },
      orderBy: { recipientName: 'asc' },
    }),
  ]);

  const liveMethods = new Map<string, LiveMethod>(methods.map((method) => [method.id, method]));
  const savedAddresses = savedAddressLookup(addresses);

  const lines = source.lines.map((line): RepeatLinePlan => {
    const resolution = resolutions.get(line.productId) ?? { kind: 'unmapped' as const };
    const resolved = resolution.kind === 'unmapped' ? null : resolution.product;
    const addOns = line.addOns.map((row) => ({
      name: row.addOnNameSnapshot,
      current: addOnCatalog.get(row.addOn.slug) ?? null,
    }));

    return {
      sourceLineId: line.id,
      sourceName: line.productNameSnapshot,
      quantity: line.quantity,
      lastUnitPriceCents: line.unitPriceCents,
      resolution: resolution.kind === 'unmapped' ? 'needs_choice' : resolution.kind,
      product: resolved,
      viaNames: resolution.kind === 'unmapped' ? [] : resolution.viaNames,
      suggestion:
        resolved === null
          ? closestPricedProduct(catalog, line.unitPriceCents, line.product.category)
          : null,
      recipient: planRecipient(line, liveMethods, savedAddresses),
      greetingMessage: greetingFor(line, savedAddresses),
      addOns: addOns.flatMap((addOn) => (addOn.current ? [addOn.current] : [])),
      droppedAddOnNames: addOns.filter((addOn) => addOn.current === null).map((addOn) => addOn.name),
    };
  });

  return ok({
    sourceOrderId: source.id,
    sourceLabel: source.orderNumber === null ? source.draftReference : `#${source.orderNumber}`,
    sourceSeasonLabel: source.season.label,
    customerId,
    targetSeasonId,
    targetSeasonLabel: season.label,
    wasImported: source.importedOrderReference !== null,
    lines,
    catalog,
    addressBook: addresses.map((address) => ({
      id: address.id,
      recipientName: address.recipientName,
      summary: `${address.recipientName} — ${address.line1}, ${address.city}`,
    })),
    needsChoiceCount: lines.filter((line) => line.resolution === 'needs_choice').length,
    recipientProblemCount: lines.filter(
      (line) => line.recipient.state === 'address_missing' || line.recipient.state === 'method_missing',
    ).length,
  });
}

async function currentAddOnsBySlug(seasonId: string): Promise<Map<string, CurrentAddOn>> {
  const rows = await db.addOn.findMany({
    where: { seasonId, isActive: true },
    select: { id: true, slug: true, name: true, priceCents: true },
  });

  return new Map(rows.map((row) => [row.slug, { id: row.id, name: row.name, priceCents: row.priceCents }]));
}
