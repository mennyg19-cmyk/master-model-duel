import 'server-only';

import type { Order, Prisma, Product } from '@prisma/client';
import { z } from 'zod';

import { recordAudit } from '../audit';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { availableUnits } from './cart';
import { createDraftReference } from './draft-reference';
import { findOwnedDraft, ownerColumns, ownerFilter, type DraftOwner } from './draft-access';

export const CART_LINE_NOT_FOUND = 'cart_line_not_found';
export const PRODUCT_NOT_AVAILABLE = 'product_not_available';
export const NOT_ENOUGH_STOCK = 'not_enough_stock';
export const INVALID_CART_INPUT = 'invalid_cart_input';
export const DRAFT_ALREADY_IN_PROGRESS = 'draft_already_in_progress';
export const GUEST_DRAFT_NOT_FOUND = 'guest_draft_not_found';

const MISSING_LINE = 'That item is no longer in your order.';

/** One recipient per line, so a line quantity is what that one person receives. */
const MAX_LINE_QUANTITY = 99;

const addToCartSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce
    .number()
    .int('Enter a whole number of items.')
    .min(1, 'Add at least one.')
    .max(MAX_LINE_QUANTITY, `The most one recipient can be sent at once is ${MAX_LINE_QUANTITY}.`),
  optionLabels: z.record(z.string(), z.string()),
  addOnIds: z.array(z.string().min(1)),
});

export type AddToCartInput = z.input<typeof addToCartSchema>;

/**
 * The cart a write is about, created on first use. A draft is cheap: it holds no
 * stock and burns no order number, which is why an abandoned cart costs nothing
 * (R-151).
 */
export async function getOrCreateDraft(owner: DraftOwner, seasonId: string): Promise<Order> {
  const existing = await findOwnedDraft(owner, seasonId);
  if (existing) return existing;

  return db.order.create({
    data: { seasonId, draftReference: createDraftReference(), ...ownerColumns(owner) },
  });
}

/**
 * Adds one catalog item to the cart with no destination yet (UR-006).
 *
 * Every add makes its own line, because a line is one recipient's box. Two of
 * the same product for two different people are two lines; a quantity above one
 * is that many boxes for the same person.
 */
export async function addProductToCart(
  owner: DraftOwner,
  seasonId: string,
  input: AddToCartInput,
): Promise<Result<{ orderId: string; lineId: string }>> {
  const parsed = addToCartSchema.safeParse(input);
  if (!parsed.success) return failure(INVALID_CART_INPUT, parsed.error.issues[0].message);

  const product = await db.product.findFirst({
    where: { id: parsed.data.productId, seasonId, isActive: true },
    include: { options: true, inventory: true, addOnLimits: true },
  });
  if (!product) return failure(PRODUCT_NOT_AVAILABLE, 'That item is not on sale this season.');

  const options = pickOptions(product.options, parsed.data.optionLabels);
  if (!options.ok) return options;

  const addOns = await readAddOns(seasonId, product.id, parsed.data.addOnIds);
  if (!addOns.ok) return addOns;

  const draft = await getOrCreateDraft(owner, seasonId);

  const stock = await checkStock(product, draft.id, parsed.data.quantity);
  if (!stock.ok) return stock;

  const unitPriceCents =
    product.priceCents + options.value.reduce((total, option) => total + option.priceAdjustmentCents, 0);

  const line = await db.orderLine.create({
    data: {
      orderId: draft.id,
      productId: product.id,
      quantity: parsed.data.quantity,
      productNameSnapshot: product.name,
      unitPriceCents,
      optionsSnapshot: options.value,
      lineTotalCents: unitPriceCents * parsed.data.quantity,
      addOns: {
        create: addOns.value.map((addOn) => ({
          addOnId: addOn.id,
          quantity: parsed.data.quantity,
          addOnNameSnapshot: addOn.name,
          unitPriceCents: addOn.priceCents,
          lineTotalCents: addOn.priceCents * parsed.data.quantity,
        })),
      },
    },
  });

  return ok({ orderId: draft.id, lineId: line.id });
}

/** Zero removes the line: "none of these" and "delete" are the same intent. */
export async function setLineQuantity(
  owner: DraftOwner,
  input: { lineId: string; quantity: number },
): Promise<Result<{ removed: boolean }>> {
  if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > MAX_LINE_QUANTITY) {
    return failure(INVALID_CART_INPUT, `Enter a whole number between 0 and ${MAX_LINE_QUANTITY}.`);
  }
  if (input.quantity === 0) return removeCartLine(owner, input.lineId);

  const line = await findOwnedLine(owner, input.lineId);
  if (!line) return failure(CART_LINE_NOT_FOUND, MISSING_LINE);

  const stock = await checkStock(
    { id: line.productId, name: line.productNameSnapshot, tracksInventory: line.product.tracksInventory, inventory: line.product.inventory },
    line.orderId,
    input.quantity,
    line.id,
  );
  if (!stock.ok) return stock;

  await db.$transaction(async (tx) => {
    await tx.orderLine.update({
      where: { id: line.id },
      data: {
        quantity: input.quantity,
        lineTotalCents: line.unitPriceCents * input.quantity,
      },
    });

    // Add-ons ride along with the item they were added to: three boxes with a
    // bottle of wine each is three bottles.
    for (const addOn of line.addOns) {
      await tx.orderLineAddOn.update({
        where: { id: addOn.id },
        data: { quantity: input.quantity, lineTotalCents: addOn.unitPriceCents * input.quantity },
      });
    }
  });

  return ok({ removed: false });
}

export async function removeCartLine(
  owner: DraftOwner,
  lineId: string,
): Promise<Result<{ removed: boolean }>> {
  const line = await findOwnedLine(owner, lineId);
  if (!line) return failure(CART_LINE_NOT_FOUND, MISSING_LINE);

  await db.orderLine.delete({ where: { id: line.id } });
  return ok({ removed: true });
}

/**
 * Hands a guest's cart to the account they just signed in with (R-022, R-023).
 *
 * This is the only success the guest cookie is cleared on: a claim that fails —
 * because the account is already building its own order — leaves the cookie
 * alone, so the guest cart is still there when they come back for it.
 */
export async function claimGuestDraft(
  customerId: string,
  guestOwner: DraftOwner & { kind: 'guest' },
  seasonId: string,
): Promise<Result<Order>> {
  const guestDraft = await findOwnedDraft(guestOwner, seasonId);
  if (!guestDraft || guestDraft.customerId !== null) {
    return failure(GUEST_DRAFT_NOT_FOUND, 'There is no guest order on this browser to pick up.');
  }

  const own = await findOwnedDraft({ kind: 'customer', customerId }, seasonId);
  if (own) {
    return failure(
      DRAFT_ALREADY_IN_PROGRESS,
      'Your account already has an order in progress, so the guest order was left where it is. Finish or cancel that one first.',
    );
  }

  const claimed = await db.order.update({
    where: { id: guestDraft.id },
    data: { customerId, guestTokenHash: null },
  });

  await recordAudit(null, {
    action: 'order.draft_claimed',
    entityType: 'Order',
    entityId: claimed.id,
    detail: { draftReference: claimed.draftReference },
  });

  return ok(claimed);
}

const OWNED_LINE_INCLUDE = {
  addOns: true,
  product: { select: { tracksInventory: true, inventory: true } },
} satisfies Prisma.OrderLineInclude;

/**
 * A line is only reachable through the draft that owns it, and only while that
 * draft is still a draft. Once an order is placed its lines belong to P5.
 */
function findOwnedLine(owner: DraftOwner, lineId: string) {
  return db.orderLine.findFirst({
    where: { id: lineId, order: { status: 'DRAFT', ...ownerFilter(owner) } },
    include: OWNED_LINE_INCLUDE,
  });
}

type StockSubject = Pick<Product, 'id' | 'name' | 'tracksInventory'> & {
  inventory: { onHand: number; reserved: number } | null;
};

/**
 * Refuses a cart that could not be filled from the shelf (R-020). Everything
 * already in this cart counts, because the same product on three lines is three
 * claims on the same stock — and none of them is reserved until checkout, so the
 * number can still move under the customer.
 */
async function checkStock(
  subject: StockSubject,
  orderId: string,
  wantedQuantity: number,
  ignoreLineId?: string,
): Promise<Result<null>> {
  if (!subject.tracksInventory) return ok(null);

  const available = availableUnits(subject.inventory);
  const inCart = await db.orderLine.aggregate({
    where: { orderId, productId: subject.id, id: ignoreLineId ? { not: ignoreLineId } : undefined },
    _sum: { quantity: true },
  });

  const alreadyInCart = inCart._sum.quantity ?? 0;
  if (alreadyInCart + wantedQuantity <= available) return ok(null);

  const remaining = Math.max(available - alreadyInCart, 0);
  return failure(
    NOT_ENOUGH_STOCK,
    remaining === 0
      ? `${subject.name} is sold out.`
      : `Only ${remaining} more ${subject.name} ${remaining === 1 ? 'is' : 'are'} available.`,
  );
}

type ProductOptionRow = { groupLabel: string; label: string; priceAdjustmentCents: number };

/**
 * Turns the form's "Size: Large" into the snapshot the line stores. Every group
 * the product offers has to be answered, and the answer has to be one of its own
 * options — a form can post anything.
 */
function pickOptions(
  offered: ProductOptionRow[],
  picked: Record<string, string>,
): Result<ProductOptionRow[]> {
  const groups = [...new Set(offered.map((option) => option.groupLabel))];
  const chosen: ProductOptionRow[] = [];

  for (const group of groups) {
    const label = picked[group];
    if (label === undefined || label === '') {
      return failure(INVALID_CART_INPUT, `Choose a ${group.toLowerCase()}.`);
    }

    const option = offered.find((row) => row.groupLabel === group && row.label === label);
    if (!option) return failure(INVALID_CART_INPUT, `"${label}" is not one of the ${group} choices.`);

    chosen.push({
      groupLabel: option.groupLabel,
      label: option.label,
      priceAdjustmentCents: option.priceAdjustmentCents,
    });
  }

  return ok(chosen);
}

/**
 * R-021. An add-on with no restrictions is offered everywhere; one that names
 * products may only be bought with those products, and the form is not trusted
 * to have obeyed that.
 */
async function readAddOns(seasonId: string, productId: string, addOnIds: string[]) {
  const wanted = [...new Set(addOnIds)];
  if (wanted.length === 0) return ok([]);

  const rows = await db.addOn.findMany({
    where: {
      id: { in: wanted },
      seasonId,
      isActive: true,
      OR: [{ restrictions: { none: {} } }, { restrictions: { some: { productId } } }],
    },
    include: { inventory: true },
  });

  if (rows.length !== wanted.length) {
    return failure(PRODUCT_NOT_AVAILABLE, 'One of those extras is not available on this item.');
  }

  for (const row of rows) {
    if (row.tracksInventory && availableUnits(row.inventory) === 0) {
      return failure(NOT_ENOUGH_STOCK, `${row.name} is sold out.`);
    }
  }

  return ok(rows);
}
