import { z } from "zod";
import { db } from "@/lib/db";
import { addressInputSchema } from "@/lib/addresses/normalize";
import { isSoldOut } from "@/lib/catalog";

// The builder cart, stored as JSON on OrderDraft. Cart-first (UR-006, G-018):
// lines exist with quantities before anyone is assigned; assignment is the
// three-way picker — on-order (the address typed on this order), a saved
// address-book entry, or a brand-new recipient.
const assignmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("onOrder") }),
  z.object({ type: z.literal("addressBook"), addressId: z.string().min(1) }),
  z.object({ type: z.literal("newRecipient"), address: addressInputSchema }),
]);

const cartLineSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(999),
  optionIds: z.array(z.string().min(1)).max(20).default([]),
  addOns: z
    .array(z.object({ addOnId: z.string().min(1), quantity: z.number().int().min(1).max(999) }))
    .max(20)
    .default([]),
  greeting: z.string().max(500).default(""),
  assignment: assignmentSchema.nullable().default(null),
});

export const cartSchema = z.object({
  onOrderRecipient: addressInputSchema.nullable().default(null),
  lines: z.array(cartLineSchema).max(200).default([]),
});

export type Cart = z.infer<typeof cartSchema>;
export type CartLine = z.infer<typeof cartLineSchema>;
export type CartAssignment = z.infer<typeof assignmentSchema>;

export type PricedLine = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  optionNames: string[];
  addOnNames: string[];
  assignment: CartAssignment | null;
  greeting: string;
  issues: string[];
};

export type PricedCart = {
  cart: Cart;
  lines: PricedLine[];
  totalCents: number;
  issues: string[];
};

/**
 * Re-derive every price from the database (never trust client amounts) and
 * report problems — inactive products, options that don't belong, restricted
 * add-ons on the wrong product, quantities beyond live stock. Issues don't
 * block saving (autosave must not lose work); they block checkout later.
 */
export async function priceCart(seasonId: string, cart: Cart): Promise<PricedCart> {
  const productIds = [...new Set(cart.lines.map((line) => line.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    include: {
      options: true,
      inventoryItem: true,
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const addOnIds = [...new Set(cart.lines.flatMap((line) => line.addOns.map((entry) => entry.addOnId)))];
  const addOns = await db.addOn.findMany({
    where: { id: { in: addOnIds } },
    include: { restrictions: true, inventoryItem: true },
  });
  const addOnById = new Map(addOns.map((addOn) => [addOn.id, addOn]));

  // Live stock is checked against the WHOLE cart, not per line: two lines of
  // the same tracked product must not each pass individually.
  const requestedPerProduct = new Map<string, number>();
  for (const line of cart.lines) {
    requestedPerProduct.set(line.productId, (requestedPerProduct.get(line.productId) ?? 0) + line.quantity);
  }

  const cartIssues: string[] = [];
  const pricedLines: PricedLine[] = cart.lines.map((line) => {
    const issues: string[] = [];
    const product = productById.get(line.productId);
    if (!product || !product.isActive || product.seasonId !== seasonId) {
      return {
        id: line.id,
        productId: line.productId,
        productName: product?.name ?? "Unavailable product",
        quantity: line.quantity,
        unitPriceCents: 0,
        lineTotalCents: 0,
        optionNames: [],
        addOnNames: [],
        assignment: line.assignment,
        greeting: line.greeting,
        issues: ["This product is no longer available this season"],
      };
    }

    let unitPriceCents = product.basePriceCents;
    const optionNames: string[] = [];
    for (const optionId of line.optionIds) {
      const option = product.options.find((candidate) => candidate.id === optionId && candidate.isActive);
      if (!option) {
        issues.push("A selected option is no longer available");
        continue;
      }
      unitPriceCents += option.priceAdjustmentCents;
      optionNames.push(option.name);
    }

    let addOnTotalCents = 0;
    const addOnNames: string[] = [];
    for (const entry of line.addOns) {
      const addOn = addOnById.get(entry.addOnId);
      if (!addOn || !addOn.isActive || addOn.seasonId !== seasonId) {
        issues.push("A selected add-on is no longer available");
        continue;
      }
      const isRestricted = addOn.restrictions.length > 0;
      if (isRestricted && !addOn.restrictions.some((rule) => rule.productId === product.id)) {
        issues.push(`${addOn.name} is not offered with ${product.name}`);
        continue;
      }
      if (addOn.trackInventory && addOn.inventoryItem) {
        const available = addOn.inventoryItem.quantityOnHand - addOn.inventoryItem.reserved;
        if (entry.quantity * line.quantity > available) {
          issues.push(`Only ${available} of ${addOn.name} left`);
        }
      }
      addOnTotalCents += addOn.priceCents * entry.quantity;
      addOnNames.push(entry.quantity > 1 ? `${addOn.name} ×${entry.quantity}` : addOn.name);
    }

    if (product.trackInventory && product.inventoryItem) {
      const available = product.inventoryItem.quantityOnHand - product.inventoryItem.reserved;
      const requested = requestedPerProduct.get(product.id) ?? line.quantity;
      if (requested > available) {
        issues.push(`Only ${available} of ${product.name} left in stock`);
      }
    }

    const lineTotalCents = (unitPriceCents + addOnTotalCents) * line.quantity;
    return {
      id: line.id,
      productId: line.productId,
      productName: product.name,
      quantity: line.quantity,
      unitPriceCents,
      lineTotalCents,
      optionNames,
      addOnNames,
      assignment: line.assignment,
      greeting: line.greeting,
      issues,
    };
  });

  const unassignedCount = pricedLines.filter((line) => line.assignment === null).length;
  if (unassignedCount > 0) {
    cartIssues.push(
      `${unassignedCount} ${unassignedCount === 1 ? "item needs" : "items need"} a recipient before checkout`
    );
  }

  return {
    cart,
    lines: pricedLines,
    totalCents: pricedLines.reduce((sum, line) => sum + line.lineTotalCents, 0),
    issues: cartIssues,
  };
}

/** The builder's live-stock product view (R-020): catalog + available counts + add-ons. */
export async function getBuilderCatalog(seasonId: string) {
  const [products, addOns] = await Promise.all([
    db.product.findMany({
      where: { seasonId, isActive: true },
      include: { options: { where: { isActive: true } }, inventoryItem: true, image: true },
      orderBy: { name: "asc" },
    }),
    db.addOn.findMany({
      where: { seasonId, isActive: true },
      include: { restrictions: true, inventoryItem: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      slug: product.slug,
      category: product.category,
      description: product.description,
      basePriceCents: product.basePriceCents,
      imageUrl: product.image?.url ?? null,
      soldOut: isSoldOut(product),
      available:
        product.trackInventory && product.inventoryItem
          ? product.inventoryItem.quantityOnHand - product.inventoryItem.reserved
          : null,
      options: product.options.map((option) => ({
        id: option.id,
        name: option.name,
        priceAdjustmentCents: option.priceAdjustmentCents,
      })),
    })),
    addOns: addOns.map((addOn) => ({
      id: addOn.id,
      name: addOn.name,
      priceCents: addOn.priceCents,
      // Empty list = unrestricted (R-147).
      restrictedToProductIds: addOn.restrictions.map((rule) => rule.productId),
      available:
        addOn.trackInventory && addOn.inventoryItem
          ? addOn.inventoryItem.quantityOnHand - addOn.inventoryItem.reserved
          : null,
    })),
  };
}

export type BuilderCatalog = Awaited<ReturnType<typeof getBuilderCatalog>>;
