import 'server-only';

import type { Order, Prisma } from '@prisma/client';

import { normalizeAddressKey, normalizeEmail } from '../core/normalize';
import { failure, ok, type Result } from '../core/result';
import { createDraftReference } from '../orders/draft-reference';
import { db } from '../db';

/**
 * The year-one hook: an order the org took before this system existed (R-186).
 *
 * P12 owns the real migration pipeline — the file formats, the previews, the
 * reconciliation. What P10 needs, and all this does, is put one historic order
 * into the shape the rest of the app already understands, so "same as last
 * year" works in the first Purim the software is live rather than the second.
 *
 * Everything is keyed on `reference`, the number the order had in the old
 * system, and that key is unique within its season: running the hook twice over
 * the same export updates the order it wrote the first time instead of giving a
 * family two copies of their own history.
 *
 * Two liberties are taken, both deliberate. The prior season's products are
 * created on demand as retired, untracked catalogue rows: last year's boxes are
 * not for sale and have no stock, but the repeat resolver needs a real product
 * with a slug and a price to walk forward from. And the recipients land in the
 * customer's address book, because that book is what the review page offers and
 * an imported order whose people are not in it would ask the customer to retype
 * their whole list.
 */
export const PRIOR_YEAR_NO_SEASON = 'prior_year_no_season';
export const PRIOR_YEAR_NO_METHOD = 'prior_year_no_method';
export const PRIOR_YEAR_EMPTY = 'prior_year_empty';

export type PriorYearAddress = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
};

export type PriorYearLine = {
  productSlug: string;
  productName: string;
  category?: string | null;
  quantity: number;
  unitPriceCents: number;
  recipientName: string;
  address: PriorYearAddress;
  greetingMessage?: string | null;
};

export type PriorYearOrder = {
  /** The order number it had in the old system. */
  reference: string;
  seasonYear: number;
  customerEmail: string;
  customerName: string;
  placedAt: Date;
  lines: PriorYearLine[];
};

export async function importPriorYearOrder(input: PriorYearOrder): Promise<Result<Order>> {
  if (input.lines.length === 0) {
    return failure(PRIOR_YEAR_EMPTY, `${input.reference} has no lines to import.`);
  }

  const season = await db.season.findUnique({ where: { year: input.seasonYear } });
  if (!season) {
    return failure(
      PRIOR_YEAR_NO_SEASON,
      `There is no ${input.seasonYear} season to import ${input.reference} into. Create it first.`,
    );
  }

  // Historic lines are all "somebody received a box". The method is only needed
  // so the line satisfies `OrderLine_assignment_complete`; which one it was is
  // not in the old data, so the first address-bearing method stands in.
  const method = await db.fulfillmentMethod.findFirst({
    where: { isActive: true, requiresAddress: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (!method) {
    return failure(PRIOR_YEAR_NO_METHOD, 'No delivery or shipping method is set up to attach history to.');
  }

  const imported = await db.$transaction(async (tx) => {
    const customer = await upsertCustomer(tx, input);
    const products = await archiveProducts(tx, season.id, input.lines);
    const addresses = await upsertAddresses(tx, customer.id, input.lines);

    const subtotalCents = input.lines.reduce(
      (total, line) => total + line.unitPriceCents * line.quantity,
      0,
    );

    const existing = await tx.order.findFirst({
      where: { seasonId: season.id, importedOrderReference: input.reference },
      select: { id: true },
    });

    // Replacing the lines rather than diffing them: the old system is the source
    // of truth for an imported order, and a re-import is a corrected export.
    if (existing) await tx.orderLine.deleteMany({ where: { orderId: existing.id } });

    const order = existing
      ? await tx.order.update({
          where: { id: existing.id },
          data: {
            customerId: customer.id,
            placedAt: input.placedAt,
            subtotalCents,
            totalCents: subtotalCents,
            // A corrected export restates what was paid as well as what it cost.
            // Leaving the first import's figure behind would read as a historic
            // order that is PAID and short at the same time.
            paymentStatus: 'PAID',
            amountPaidCents: subtotalCents,
          },
        })
      : await tx.order.create({
          data: {
            seasonId: season.id,
            customerId: customer.id,
            status: 'COMPLETED',
            paymentStatus: 'PAID',
            amountPaidCents: subtotalCents,
            subtotalCents,
            totalCents: subtotalCents,
            placedAt: input.placedAt,
            draftReference: createDraftReference(),
            importedOrderReference: input.reference,
          },
        });

    for (const line of input.lines) {
      const address = addresses.get(addressKeyOf(line));

      await tx.orderLine.create({
        data: {
          orderId: order.id,
          productId: products.get(line.productSlug) ?? '',
          quantity: line.quantity,
          productNameSnapshot: line.productName,
          unitPriceCents: line.unitPriceCents,
          lineTotalCents: line.unitPriceCents * line.quantity,
          recipientName: line.recipientName,
          fulfillmentMethodId: method.id,
          customerAddressId: address?.id ?? null,
          addressLine1: line.address.line1,
          addressLine2: line.address.line2 ?? null,
          addressCity: line.address.city,
          addressState: line.address.state,
          addressPostalCode: line.address.postalCode,
          addressCountry: line.address.country ?? 'US',
          greetingMessage: line.greetingMessage ?? null,
        },
      });
    }

    return order;
  });

  return ok(imported);
}

function addressKeyOf(line: PriorYearLine): string {
  return normalizeAddressKey({
    line1: line.address.line1,
    line2: line.address.line2 ?? null,
    city: line.address.city,
    state: line.address.state,
    postalCode: line.address.postalCode,
    country: line.address.country ?? 'US',
  });
}

async function upsertCustomer(tx: Prisma.TransactionClient, input: PriorYearOrder) {
  const normalizedEmail = normalizeEmail(input.customerEmail);

  return tx.customer.upsert({
    where: { normalizedEmail },
    create: { email: input.customerEmail.trim(), normalizedEmail, fullName: input.customerName },
    update: {},
  });
}

/**
 * Last year's catalogue as history rather than stock: retired so no storefront
 * shows it, untracked so no inventory row is implied, and priced at what the
 * customer actually paid so the review page can say "was $42".
 */
async function archiveProducts(
  tx: Prisma.TransactionClient,
  seasonId: string,
  lines: PriorYearLine[],
): Promise<Map<string, string>> {
  const products = new Map<string, string>();

  for (const line of lines) {
    if (products.has(line.productSlug)) continue;

    const product = await tx.product.upsert({
      where: { seasonId_slug: { seasonId, slug: line.productSlug } },
      create: {
        seasonId,
        slug: line.productSlug,
        name: line.productName,
        category: line.category ?? null,
        priceCents: line.unitPriceCents,
        tracksInventory: false,
        isActive: false,
      },
      update: {},
      select: { id: true },
    });

    products.set(line.productSlug, product.id);
  }

  return products;
}

async function upsertAddresses(
  tx: Prisma.TransactionClient,
  customerId: string,
  lines: PriorYearLine[],
): Promise<Map<string, { id: string }>> {
  const addresses = new Map<string, { id: string }>();

  for (const line of lines) {
    const addressKey = addressKeyOf(line);
    if (addresses.has(addressKey)) continue;

    const saved = await tx.customerAddress.upsert({
      where: { customerId_addressKey: { customerId, addressKey } },
      create: {
        customerId,
        addressKey,
        recipientName: line.recipientName,
        line1: line.address.line1,
        line2: line.address.line2 ?? null,
        city: line.address.city,
        state: line.address.state,
        postalCode: line.address.postalCode,
        country: line.address.country ?? 'US',
        lastGreeting: line.greetingMessage ?? null,
      },
      // The card message is the one thing worth carrying forward onto an address
      // already on file: it is what checkout offers as this year's default.
      update: line.greetingMessage ? { lastGreeting: line.greetingMessage } : {},
      select: { id: true },
    });

    addresses.set(addressKey, saved);
  }

  return addresses;
}
