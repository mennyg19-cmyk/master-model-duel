import 'server-only';

import type { Prisma } from '@prisma/client';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { abort, runInTransaction } from '../transaction';
import { createDraftReference } from './draft-reference';
import { ownerColumns } from './draft-access';

/**
 * "Same as last time" (R-057), as far as this phase goes.
 *
 * A repeat copies a past order into a fresh cart on the staff member's till and
 * stops there. It is deliberately a draft: last season's catalogue is not this
 * season's, prices move, and the person paying should see the new total before
 * anything is placed.
 *
 * What is *not* here is the replacement flow — offering a substitute for a box
 * that no longer exists — which is P10's whole subject. A line whose product is
 * not on sale this season is reported by name and left out, so the staff member
 * knows what to talk to the customer about instead of finding a short order.
 */
export const REPEAT_SOURCE_NOT_FOUND = 'repeat_source_not_found';
export const REPEAT_NO_CUSTOMER = 'repeat_no_customer';
export const REPEAT_NOTHING_TO_COPY = 'repeat_nothing_to_copy';
export const REPEAT_TILL_BUSY = 'repeat_till_busy';

export type RepeatResult = {
  draftId: string;
  draftReference: string;
  customerId: string;
  copiedLines: number;
  /** Products that were on the old order and are not on sale now. */
  skippedLines: string[];
};

const SOURCE_INCLUDE = {
  lines: { include: { addOns: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

export async function repeatOrderAtCounter(
  staff: StaffContext,
  sourceOrderId: string,
  seasonId: string,
  batchId?: string,
): Promise<Result<RepeatResult>> {
  const source = await db.order.findUnique({ where: { id: sourceOrderId }, include: SOURCE_INCLUDE });
  if (!source) return failure(REPEAT_SOURCE_NOT_FOUND, 'That order no longer exists.');

  if (source.customerId === null) {
    return failure(REPEAT_NO_CUSTOMER, 'That order has no customer on it yet, so there is nobody to repeat it for.');
  }
  const customerId = source.customerId;

  const catalog = await currentCatalog(seasonId, source.lines.map((line) => line.productId));
  const addOnCatalog = await currentAddOns(
    seasonId,
    source.lines.flatMap((line) => line.addOns.map((addOn) => addOn.addOnId)),
  );

  const copyable = source.lines.filter((line) => catalog.has(line.productId));
  const skippedLines = [
    ...new Set(
      source.lines.filter((line) => !catalog.has(line.productId)).map((line) => line.productNameSnapshot),
    ),
  ];

  if (copyable.length === 0) {
    return failure(
      REPEAT_NOTHING_TO_COPY,
      'Nothing on that order is on sale this season. Build the new one by hand.',
    );
  }

  const draft = await runInTransaction(async (tx) => {
    // One till, one open cart per customer. A repeat that quietly merged into a
    // cart already on the screen would double somebody's order, and a staff
    // member double-clicking is exactly how that happens — so the look and the
    // create are the same transaction rather than two reads apart.
    const openCart = await tx.order.findFirst({
      where: { seasonId, status: 'DRAFT', posStaffUserId: staff.acting.id, customerId },
    });
    if (openCart) {
      abort(
        failure(
          REPEAT_TILL_BUSY,
          `Your till already has ${openCart.draftReference} open for this customer. Finish or discard it first.`,
        ),
      );
    }

    const created = await tx.order.create({
      data: {
        seasonId,
        draftReference: createDraftReference(),
        ...ownerColumns({ kind: 'pos', staffUserId: staff.acting.id, customerId }),
      },
    });

    for (const line of copyable) {
      const product = catalog.get(line.productId)!;
      const addOns = line.addOns.filter((addOn) => addOnCatalog.has(addOn.addOnId));

      // Today's prices, last year's choices. The recipient, the method and the
      // card come across because that is what "same as last time" means; the
      // money does not, because it is this season's money.
      await tx.orderLine.create({
        data: {
          orderId: created.id,
          productId: product.id,
          quantity: line.quantity,
          productNameSnapshot: product.name,
          unitPriceCents: product.priceCents,
          optionsSnapshot: line.optionsSnapshot as Prisma.InputJsonValue,
          lineTotalCents: product.priceCents * line.quantity,
          recipientName: line.recipientName,
          fulfillmentMethodId: line.fulfillmentMethodId,
          pickupLocationId: line.pickupLocationId,
          customerAddressId: line.customerAddressId,
          addressLine1: line.addressLine1,
          addressLine2: line.addressLine2,
          addressCity: line.addressCity,
          addressState: line.addressState,
          addressPostalCode: line.addressPostalCode,
          addressCountry: line.addressCountry,
          greetingMessage: line.greetingMessage,
          addOns: {
            create: addOns.map((addOn) => {
              const current = addOnCatalog.get(addOn.addOnId)!;
              return {
                addOnId: current.id,
                quantity: addOn.quantity,
                addOnNameSnapshot: current.name,
                unitPriceCents: current.priceCents,
                lineTotalCents: current.priceCents * addOn.quantity,
              };
            }),
          },
        },
      });
    }

    await recordAudit(
      staff,
      {
        action: 'order.repeated',
        entityType: 'Order',
        entityId: created.id,
        detail: { sourceOrderId, copiedLines: copyable.length, skippedLines, batchId },
      },
      tx,
    );

    return created;
  });

  if (!draft.ok) return draft;

  return ok({
    draftId: draft.value.id,
    draftReference: draft.value.draftReference,
    customerId,
    copiedLines: copyable.length,
    skippedLines,
  });
}

type CatalogItem = { id: string; slug: string; name: string; priceCents: number };

/**
 * The same products, this season.
 *
 * Matched by slug rather than id because a season is a fresh set of catalogue
 * rows: the id on last year's line points at last year's product, and the slug
 * is what makes "the classic box" the same box a year later. An item with no
 * match this season is simply absent from the map, which is what the caller
 * reads as "not on sale".
 */
async function currentCatalog(seasonId: string, productIds: string[]) {
  const previous = await db.product.findMany({
    where: { id: { in: [...new Set(productIds)] } },
    select: { id: true, slug: true },
  });

  return remapBySlug(
    previous,
    await db.product.findMany({
      where: { seasonId, isActive: true, slug: { in: previous.map((row) => row.slug) } },
      select: { id: true, slug: true, name: true, priceCents: true },
    }),
  );
}

async function currentAddOns(seasonId: string, addOnIds: string[]) {
  const previous = await db.addOn.findMany({
    where: { id: { in: [...new Set(addOnIds)] } },
    select: { id: true, slug: true },
  });

  return remapBySlug(
    previous,
    await db.addOn.findMany({
      where: { seasonId, isActive: true, slug: { in: previous.map((row) => row.slug) } },
      select: { id: true, slug: true, name: true, priceCents: true },
    }),
  );
}

/** Old id → this season's row, for the ids that still have one. */
function remapBySlug(
  previous: { id: string; slug: string }[],
  current: CatalogItem[],
): Map<string, CatalogItem> {
  const bySlug = new Map(current.map((row) => [row.slug, row]));

  return new Map(
    previous.flatMap((row) => {
      const match = bySlug.get(row.slug);
      return match ? [[row.id, match] as const] : [];
    }),
  );
}
