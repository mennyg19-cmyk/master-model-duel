import 'server-only';

import type { AddOn, FulfillmentKind, Prisma } from '@prisma/client';
import { z } from 'zod';

import { addressLine } from '../addresses/address-mapping';
import type { CatalogOption } from '../catalog/browse';
import { sumCents } from '../core/money';
import { db } from '../db';
import { findOwnedDraft, type DraftOwner } from './draft-access';

/**
 * What one line of the cart looks like on screen.
 *
 * `assignment` is null until the customer says where the item is going, which is
 * the whole point of a cart-first builder: pick the boxes, then pick the people
 * (UR-006, G-018).
 */
export type CartLineAssignment = {
  recipientName: string;
  methodLabel: string;
  methodKind: FulfillmentKind;
  addressSummary: string | null;
  pickupLocationName: string | null;
  customerAddressId: string | null;
  greetingMessage: string | null;
};

export type CartLine = {
  id: string;
  productId: string;
  slug: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  options: CatalogOption[];
  addOns: { id: string; addOnId: string; name: string; lineTotalCents: number }[];
  totalCents: number;
  assignment: CartLineAssignment | null;
};

export type Cart = {
  orderId: string;
  draftReference: string;
  isGuest: boolean;
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  unassignedCount: number;
  isReadyForCheckout: boolean;
};

/**
 * The options picked when the item went into the cart, snapshotted onto the line
 * (R-150). Parsed rather than cast: the column is `Json`, so the compiler has
 * nothing to check against.
 */
const lineOptionsSchema = z.array(
  z.object({ groupLabel: z.string(), label: z.string(), priceAdjustmentCents: z.number().int() }),
);

const CART_LINE_INCLUDE = {
  product: { select: { slug: true, name: true } },
  fulfillmentMethod: { select: { label: true, kind: true } },
  pickupLocation: { select: { name: true } },
  addOns: { include: { addOn: { select: { name: true } } } },
} satisfies Prisma.OrderLineInclude;

type CartLineRow = Prisma.OrderLineGetPayload<{ include: typeof CART_LINE_INCLUDE }>;

/** Null when this owner has no cart yet, which is the normal first visit. */
export async function readCart(owner: DraftOwner, seasonId: string): Promise<Cart | null> {
  const draft = await findOwnedDraft(owner, seasonId);
  if (!draft) return null;

  const rows = await db.orderLine.findMany({
    where: { orderId: draft.id },
    include: CART_LINE_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });

  const lines = rows.map(toCartLine);
  const unassignedCount = lines.filter((line) => line.assignment === null).length;

  return {
    orderId: draft.id,
    draftReference: draft.draftReference,
    isGuest: draft.customerId === null,
    lines,
    itemCount: lines.reduce((count, line) => count + line.quantity, 0),
    subtotalCents: sumCents(lines.map((line) => line.totalCents)),
    unassignedCount,
    isReadyForCheckout: lines.length > 0 && unassignedCount === 0,
  };
}

/**
 * Units a customer can still put in a cart: what is on the shelf minus what
 * placed orders already hold (R-020). Drafts hold nothing — reservations are
 * taken at checkout — so this number moves under everybody, and the builder says
 * so rather than promising stock it cannot hold.
 *
 * Null means the item does not track inventory, like a sponsorship.
 */
export async function readProductAvailability(seasonId: string): Promise<Map<string, number | null>> {
  const products = await db.product.findMany({
    where: { seasonId },
    select: { id: true, tracksInventory: true, inventory: { select: { onHand: true, reserved: true } } },
  });

  return new Map(
    products.map((product) => [
      product.id,
      product.tracksInventory ? availableUnits(product.inventory) : null,
    ]),
  );
}

export function availableUnits(inventory: { onHand: number; reserved: number } | null): number {
  if (!inventory) return 0;
  return Math.max(inventory.onHand - inventory.reserved, 0);
}

/** An add-on with the products it is restricted to, empty for one offered everywhere. */
export type AddOnOffer = { addOn: AddOn; productIds: string[] };

/**
 * Read once for the whole panel rather than per card: a season has a handful of
 * add-ons and a page has dozens of products, so this is one query instead of one
 * per product.
 */
export async function readAddOnOffers(seasonId: string): Promise<AddOnOffer[]> {
  const rows = await db.addOn.findMany({
    where: { seasonId, isActive: true },
    include: { restrictions: { select: { productId: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return rows.map(({ restrictions, ...addOn }) => ({
    addOn,
    productIds: restrictions.map((restriction) => restriction.productId),
  }));
}

/** R-021. No restrictions means every product; any restriction means only those. */
export function addOnsFor(offers: AddOnOffer[], productId: string): AddOn[] {
  return offers
    .filter((offer) => offer.productIds.length === 0 || offer.productIds.includes(productId))
    .map((offer) => offer.addOn);
}

function toCartLine(row: CartLineRow): CartLine {
  const parsedOptions = lineOptionsSchema.safeParse(row.optionsSnapshot);
  const addOns = row.addOns.map((addOn) => ({
    id: addOn.id,
    addOnId: addOn.addOnId,
    name: addOn.addOnNameSnapshot || addOn.addOn.name,
    lineTotalCents: addOn.lineTotalCents,
  }));

  return {
    id: row.id,
    productId: row.productId,
    slug: row.product.slug,
    name: row.productNameSnapshot,
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    lineTotalCents: row.lineTotalCents,
    options: parsedOptions.success ? parsedOptions.data : [],
    addOns,
    totalCents: row.lineTotalCents + sumCents(addOns.map((addOn) => addOn.lineTotalCents)),
    assignment: toAssignment(row),
  };
}

/**
 * The CHECK constraint on the table keeps recipient and method in step, so one
 * null answers for both: this line has not been assigned yet.
 */
function toAssignment(row: CartLineRow): CartLineAssignment | null {
  if (row.recipientName === null || row.fulfillmentMethod === null) return null;

  return {
    recipientName: row.recipientName,
    methodLabel: row.fulfillmentMethod.label,
    methodKind: row.fulfillmentMethod.kind,
    addressSummary: addressLine(row),
    pickupLocationName: row.pickupLocation?.name ?? null,
    customerAddressId: row.customerAddressId,
    greetingMessage: row.greetingMessage,
  };
}
