import 'server-only';

import type { Order, Prisma } from '@prisma/client';

import { normalizeAddressKey, normalizeEmail } from '../core/normalize';
import { failure, ok, type Result } from '../core/result';
import { createDraftReference } from '../orders/draft-reference';
import { db } from '../db';
import { runInTransaction } from '../transaction';

/**
 * One order the org took before this system existed (R-186).
 *
 * P10 needed a single historic order in the shape the rest of the app already
 * understands, so that "same as last year" works in the first Purim the
 * software is live. P12's migration pipeline needs the same write, thousands of
 * times, inside its own chunked transactions — so the writer takes a
 * transaction client and the one-shot entry point below opens one for it.
 * Two copies of this logic is how the pipeline and the hook would end up
 * disagreeing about what a historic order looks like.
 *
 * Everything is keyed on `reference`, the number the order had in the old
 * system, unique within its season: running an import twice over the same
 * export updates the order it wrote the first time instead of giving a family
 * two copies of their own history.
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
export const PRIOR_YEAR_NO_CUSTOMER = 'prior_year_no_customer';

export type PriorYearAddress = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  /** Set by the legacy pipeline for an address the cleanup queue has to look at. */
  needsReview?: boolean;
  reviewNote?: string | null;
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
  /** Either an email to upsert on, or a customer a person already matched. */
  customerEmail?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerId?: string | null;
  placedAt: Date;
  lines: PriorYearLine[];
};

export type PriorYearWriteSummary = {
  order: Order;
  customerId: string;
  customerCreated: boolean;
  addressesWritten: number;
  lineCount: number;
};

export type PriorYearContext = { seasonId: string; fulfillmentMethodId: string };

/**
 * Writes one historic order inside a transaction the caller owns. Nothing here
 * commits: a chunk of twenty of these either all land or none of them do.
 */
export async function writePriorYearOrder(
  tx: Prisma.TransactionClient,
  context: PriorYearContext,
  input: PriorYearOrder,
): Promise<PriorYearWriteSummary> {
  const customer = await resolveCustomer(tx, input);
  const products = await archiveProducts(tx, context.seasonId, input.lines);
  const addresses = await upsertAddresses(tx, customer.id, input.lines);

  const subtotalCents = input.lines.reduce(
    (total, line) => total + line.unitPriceCents * line.quantity,
    0,
  );

  const existing = await tx.order.findFirst({
    where: { seasonId: context.seasonId, importedOrderReference: input.reference },
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
          seasonId: context.seasonId,
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
        fulfillmentMethodId: context.fulfillmentMethodId,
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

  return {
    order,
    customerId: customer.id,
    customerCreated: customer.created,
    addressesWritten: addresses.size,
    lineCount: input.lines.length,
  };
}

/** The season and method a historic order needs before it can be written. */
export async function priorYearContext(seasonYear: number): Promise<Result<PriorYearContext>> {
  const season = await db.season.findUnique({ where: { year: seasonYear } });
  if (!season) {
    return failure(
      PRIOR_YEAR_NO_SEASON,
      `There is no ${seasonYear} season to import into. Create it first.`,
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

  return ok({ seasonId: season.id, fulfillmentMethodId: method.id });
}

export async function importPriorYearOrder(input: PriorYearOrder): Promise<Result<Order>> {
  if (input.lines.length === 0) {
    return failure(PRIOR_YEAR_EMPTY, `${input.reference} has no lines to import.`);
  }

  const context = await priorYearContext(input.seasonYear);
  if (!context.ok) return context;

  const written = await runInTransaction((tx) => writePriorYearOrder(tx, context.value, input));
  return written.ok ? ok(written.value.order) : written;
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

/**
 * A customer somebody already matched by hand wins over anything this could
 * work out for itself: the legacy row had no usable email, which is exactly why
 * a person was asked.
 *
 * The phone number is only written when nobody holds it. `normalizedPhone` is
 * unique, and an import must not be the thing that quietly takes a number off
 * another household's record.
 */
async function resolveCustomer(
  tx: Prisma.TransactionClient,
  input: PriorYearOrder,
): Promise<{ id: string; created: boolean }> {
  const phone = input.customerPhone ?? null;

  if (input.customerId) {
    await claimPhone(tx, input.customerId, phone);
    return { id: input.customerId, created: false };
  }

  if (!input.customerEmail) {
    throw new Error(
      `${input.reference} has neither an email address nor a matched customer, so there is nobody to attach it to.`,
    );
  }

  const normalizedEmail = normalizeEmail(input.customerEmail);
  const existing = await tx.customer.findUnique({
    where: { normalizedEmail },
    select: { id: true },
  });

  if (existing) {
    await claimPhone(tx, existing.id, phone);
    return { id: existing.id, created: false };
  }

  const created = await tx.customer.create({
    data: {
      email: input.customerEmail.trim(),
      normalizedEmail,
      fullName: input.customerName,
    },
    select: { id: true },
  });

  await claimPhone(tx, created.id, phone);
  return { id: created.id, created: true };
}

async function claimPhone(
  tx: Prisma.TransactionClient,
  customerId: string,
  normalizedPhone: string | null,
): Promise<void> {
  if (normalizedPhone === null) return;

  const owner = await tx.customer.findUnique({
    where: { normalizedPhone },
    select: { id: true },
  });
  if (owner) return;

  await tx.customer.update({
    where: { id: customerId },
    data: { phone: normalizedPhone, normalizedPhone },
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

    const review = line.address.needsReview
      ? { needsReview: true, reviewNote: line.address.reviewNote ?? null }
      : {};

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
        ...review,
      },
      // The card message is the one thing worth carrying forward onto an address
      // already on file: it is what checkout offers as this year's default.
      update: {
        ...(line.greetingMessage ? { lastGreeting: line.greetingMessage } : {}),
        ...review,
      },
      select: { id: true },
    });

    addresses.set(addressKey, saved);
  }

  return addresses;
}
