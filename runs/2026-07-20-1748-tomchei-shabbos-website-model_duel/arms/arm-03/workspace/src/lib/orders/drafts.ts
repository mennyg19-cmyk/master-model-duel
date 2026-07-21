import { randomBytes } from "node:crypto";
import { AuditAction, OrderStatus, type Order, type OrderLine } from "@prisma/client";
import { upsertCustomerAddress, type AddressInput } from "@/lib/address/book";
import { db } from "@/lib/db";
import { availableUnits } from "@/lib/inventory/reserve";
import { formatDraftRef } from "@/lib/orders/draft-wire";
import { buildGroupingKey } from "@/lib/orders/grouping";
import { hashGuestToken, mintGuestToken, guestTokenMatches } from "@/lib/orders/guest-token";
import { draftSubtotalCents, lineSubtotalCents } from "@/lib/orders/totals";
import { getCurrentSeason, isStoreOpen } from "@/lib/storefront/season";
import { err, ok, type Result } from "@/lib/result";

/** Shared Prisma include for draft serialization (M10). */
export const draftInclude = {
  lines: {
    include: {
      product: { include: { inventory: true } },
      productOption: true,
      addOns: { include: { addOn: true } },
      savedAddress: true,
      fulfillmentMethod: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  customer: true,
  season: true,
};

export type DraftWithLines = Awaited<ReturnType<typeof serializeDraft>> extends infer R
  ? R
  : never;

export function serializeDraft(
  order: Order & {
    lines: Array<
      OrderLine & {
        product: {
          id: string;
          name: string;
          sku: string;
          basePriceCents: number;
          tracksInventory: boolean;
          inventory: { onHand: number; reserved: number } | null;
        };
        productOption: { id: string; name: string; priceAdjustmentCents: number } | null;
        addOns: Array<{
          id: string;
          quantity: number;
          unitPriceCents: number;
          addOn: { id: string; name: string; sku: string; isRestricted: boolean };
        }>;
        savedAddress: { id: string; label: string | null; recipientName: string } | null;
        fulfillmentMethod: { id: string; code: string; label: string } | null;
      }
    >;
    season: { id: string; name: string; year: number; slug: string };
  },
) {
  const lines = order.lines.map((line) => {
    const assigned = Boolean(line.recipientName && line.addressLine1);
    return {
      id: line.id,
      productId: line.productId,
      productName: line.product.name,
      productSku: line.product.sku,
      productOptionId: line.productOptionId,
      productOptionName: line.productOption?.name ?? null,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      optionAdjustCents: line.optionAdjustCents,
      lineTotalCents: lineSubtotalCents(line),
      assigned,
      recipientName: line.recipientName,
      addressLine1: line.addressLine1,
      addressLine2: line.addressLine2,
      city: line.city,
      state: line.state,
      postalCode: line.postalCode,
      country: line.country,
      savedAddressId: line.savedAddressId,
      savedAddressLabel: line.savedAddress?.label ?? null,
      greeting: line.greeting,
      stockAvailable: line.product.tracksInventory
        ? line.product.inventory
          ? availableUnits(line.product.inventory)
          : 0
        : null,
      addOns: line.addOns.map((a) => ({
        id: a.id,
        addOnId: a.addOn.id,
        name: a.addOn.name,
        sku: a.addOn.sku,
        quantity: a.quantity,
        unitPriceCents: a.unitPriceCents,
        isRestricted: a.addOn.isRestricted,
      })),
    };
  });

  return {
    id: order.id,
    draftRef: order.draftRef,
    status: order.status,
    seasonId: order.seasonId,
    seasonName: order.season.name,
    customerId: order.customerId,
    isGuest: !order.customerId,
    guestClearedAt: order.guestClearedAt,
    version: order.version,
    greetingDefault: order.greetingDefault,
    subtotalCents: draftSubtotalCents(lines),
    lineCount: lines.length,
    unassignedCount: lines.filter((l) => !l.assigned).length,
    lines,
  };
}

async function findGuestDraftByToken(token: string, seasonId: string) {
  const candidates = await db.order.findMany({
    where: {
      seasonId,
      customerId: null,
      status: OrderStatus.DRAFT,
      guestClearedAt: null,
      guestAccessTokenHash: { not: null },
    },
    include: draftInclude,
    orderBy: { updatedAt: "desc" },
    take: 25,
  });
  return (
    candidates.find((o) =>
      guestTokenMatches(token, o.guestAccessTokenHash, o.guestTokenVersion),
    ) ?? null
  );
}

/** Cart-aggregated demand for a product on this draft (excludes optional line). */
async function cartDemandForProduct(
  orderId: string,
  productId: string,
  excludeLineId?: string,
): Promise<number> {
  const lines = await db.orderLine.findMany({
    where: {
      orderId,
      productId,
      ...(excludeLineId ? { NOT: { id: excludeLineId } } : {}),
    },
    select: { quantity: true },
  });
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

export async function getOrCreateActiveDraft(input: {
  customerId?: string | null;
  asGuest?: boolean;
  /** Reuse existing guest draft when cookie token already matches (M3). */
  existingGuestToken?: string | null;
}): Promise<
  Result<{
    draft: ReturnType<typeof serializeDraft>;
    created: boolean;
    /** Raw token for Set-Cookie only — never put in JSON body (M1). */
    guestAccessToken?: string;
  }>
> {
  const season = await getCurrentSeason();
  if (!season || !isStoreOpen(season)) {
    return err("store_closed", "Ordering is closed for this season.");
  }

  if (input.customerId) {
    const existing = await db.order.findFirst({
      where: {
        seasonId: season.id,
        customerId: input.customerId,
        status: OrderStatus.DRAFT,
      },
      include: draftInclude,
      orderBy: { updatedAt: "desc" },
    });
    if (existing) {
      return ok({ draft: serializeDraft(existing), created: false });
    }
  }

  if (!input.customerId && input.existingGuestToken) {
    const existingGuest = await findGuestDraftByToken(input.existingGuestToken, season.id);
    if (existingGuest) {
      return ok({
        draft: serializeDraft(existingGuest),
        created: false,
        guestAccessToken: input.existingGuestToken,
      });
    }
  }

  const draftRef = formatDraftRef(season.year, randomBytes(6).toString("hex"));
  let guestAccessToken: string | undefined;
  let guestAccessTokenHash: string | null = null;
  const guestTokenVersion = 1;

  if (!input.customerId) {
    guestAccessToken = mintGuestToken();
    guestAccessTokenHash = hashGuestToken(guestAccessToken, guestTokenVersion);
  }

  const created = await db.order.create({
    data: {
      seasonId: season.id,
      customerId: input.customerId ?? null,
      status: OrderStatus.DRAFT,
      draftRef,
      guestAccessTokenHash,
      guestTokenVersion,
      greetingDefault: "Chag Purim Sameach!",
    },
    include: draftInclude,
  });

  await db.auditLog.create({
    data: {
      action: AuditAction.DRAFT_CREATED,
      meta: {
        draftRef,
        orderId: created.id,
        guest: !input.customerId,
        customerId: input.customerId,
      },
    },
  });

  return ok({
    draft: serializeDraft(created),
    created: true,
    guestAccessToken,
  });
}

export async function addDraftLine(input: {
  orderId: string;
  productId: string;
  productOptionId?: string | null;
  quantity: number;
  addOnIds?: string[];
}): Promise<Result<{ draft: ReturnType<typeof serializeDraft> }>> {
  if (input.quantity < 1) return err("qty", "Quantity must be at least 1.");

  const product = await db.product.findUnique({
    where: { id: input.productId },
    include: {
      inventory: true,
      options: true,
      allowedAddOns: { include: { addOn: { include: { inventory: true } } } },
    },
  });
  if (!product || !product.isActive) {
    return err("product", "Product is not available.");
  }

  if (product.tracksInventory) {
    const avail = product.inventory ? availableUnits(product.inventory) : 0;
    const alreadyInCart = await cartDemandForProduct(input.orderId, product.id);
    if (avail < alreadyInCart + input.quantity) {
      const remaining = Math.max(0, avail - alreadyInCart);
      return err(
        "stock",
        remaining === 0
          ? `No more stock available for ${product.name}.`
          : `Only ${remaining} more in stock for ${product.name}.`,
      );
    }
  }

  let optionAdjustCents = 0;
  if (input.productOptionId) {
    const option = product.options.find((o) => o.id === input.productOptionId && o.isActive);
    if (!option) return err("option", "Selected option is not available.");
    optionAdjustCents = option.priceAdjustmentCents;
  }

  const addOnCreates: Array<{ addOnId: string; quantity: number; unitPriceCents: number }> = [];
  for (const addOnId of input.addOnIds ?? []) {
    const allow = product.allowedAddOns.find((a) => a.addOnId === addOnId);
    if (!allow || !allow.addOn.isActive) {
      return err("addon", "That add-on is not allowed on this product.");
    }
    if (allow.addOn.tracksInventory) {
      const avail = allow.addOn.inventory ? availableUnits(allow.addOn.inventory) : 0;
      if (avail < 1) {
        return err("stock", `${allow.addOn.name} is out of stock.`);
      }
    }
    addOnCreates.push({
      addOnId,
      quantity: 1,
      unitPriceCents: allow.addOn.priceCents,
    });
  }

  await db.orderLine.create({
    data: {
      orderId: input.orderId,
      productId: product.id,
      productOptionId: input.productOptionId ?? null,
      quantity: input.quantity,
      unitPriceCents: product.basePriceCents,
      optionAdjustCents,
      groupingKey: "unassigned",
      addOns: addOnCreates.length ? { create: addOnCreates } : undefined,
    },
  });

  await db.order.update({
    where: { id: input.orderId },
    data: { version: { increment: 1 } },
  });

  const order = await db.order.findUniqueOrThrow({
    where: { id: input.orderId },
    include: draftInclude,
  });
  await db.auditLog.create({
    data: {
      action: AuditAction.DRAFT_UPDATED,
      meta: { orderId: input.orderId, draftRef: order.draftRef, op: "add_line" },
    },
  });
  return ok({ draft: serializeDraft(order) });
}

export async function updateDraftLineQty(
  orderId: string,
  lineId: string,
  quantity: number,
): Promise<Result<{ draft: ReturnType<typeof serializeDraft> }>> {
  if (quantity < 1) return err("qty", "Quantity must be at least 1.");
  const line = await db.orderLine.findFirst({
    where: { id: lineId, orderId },
    include: { product: { include: { inventory: true } } },
  });
  if (!line) return err("not_found", "Line not found.");
  if (line.product.tracksInventory) {
    const avail = line.product.inventory ? availableUnits(line.product.inventory) : 0;
    const others = await cartDemandForProduct(orderId, line.productId, lineId);
    if (avail < others + quantity) {
      const remaining = Math.max(0, avail - others);
      return err("stock", `Only ${remaining} in stock.`);
    }
  }
  await db.orderLine.update({ where: { id: lineId }, data: { quantity } });
  await db.order.update({
    where: { id: orderId },
    data: { version: { increment: 1 } },
  });
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: draftInclude,
  });
  return ok({ draft: serializeDraft(order) });
}

export async function removeDraftLine(
  orderId: string,
  lineId: string,
): Promise<Result<{ draft: ReturnType<typeof serializeDraft> }>> {
  const line = await db.orderLine.findFirst({ where: { id: lineId, orderId } });
  if (!line) return err("not_found", "Line not found.");
  await db.orderLine.delete({ where: { id: lineId } });
  await db.order.update({
    where: { id: orderId },
    data: { version: { increment: 1 } },
  });
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: draftInclude,
  });
  return ok({ draft: serializeDraft(order) });
}

export type AssignMode = "on_order" | "address_book" | "new_recipient";

export async function assignDraftLine(input: {
  orderId: string;
  customerId: string | null;
  lineId: string;
  mode: AssignMode;
  /** on_order: use customer's default / self address */
  savedAddressId?: string | null;
  newRecipient?: AddressInput | null;
  autoSaveNew?: boolean;
}): Promise<Result<{ draft: ReturnType<typeof serializeDraft>; savedAddressId?: string }>> {
  const line = await db.orderLine.findFirst({
    where: { id: input.lineId, orderId: input.orderId },
  });
  if (!line) return err("not_found", "Line not found.");

  let recipientName: string;
  let addressLine1: string;
  let addressLine2: string | null = null;
  let city: string;
  let state: string;
  let postalCode: string;
  let country = "US";
  let savedAddressId: string | null = null;

  if (input.mode === "address_book") {
    if (!input.customerId) return err("auth", "Sign in to use your address book.");
    if (!input.savedAddressId) return err("address", "Pick a saved address.");
    const addr = await db.savedAddress.findFirst({
      where: { id: input.savedAddressId, customerId: input.customerId },
    });
    if (!addr) return err("address", "Saved address not found.");
    recipientName = addr.recipientName;
    addressLine1 = addr.line1;
    addressLine2 = addr.line2;
    city = addr.city;
    state = addr.state;
    postalCode = addr.postalCode;
    country = addr.country;
    savedAddressId = addr.id;
  } else if (input.mode === "on_order") {
    if (!input.customerId) return err("auth", "Sign in to assign to yourself.");
    const self =
      (await db.savedAddress.findFirst({
        where: { customerId: input.customerId, isDefault: true },
      })) ??
      (await db.savedAddress.findFirst({
        where: { customerId: input.customerId },
        orderBy: { updatedAt: "desc" },
      }));
    if (!self) {
      return err("address", "Add a default address to your account first.");
    }
    recipientName = self.recipientName;
    addressLine1 = self.line1;
    addressLine2 = self.line2;
    city = self.city;
    state = self.state;
    postalCode = self.postalCode;
    country = self.country;
    savedAddressId = self.id;
  } else {
    if (!input.newRecipient) return err("address", "Recipient details required.");
    if (input.customerId && input.autoSaveNew !== false) {
      const saved = await upsertCustomerAddress(input.customerId, input.newRecipient);
      if (!saved.ok) return err(saved.error, saved.publicMessage);
      savedAddressId = saved.value.address.id;
      const addr = saved.value.address;
      recipientName = addr.recipientName;
      addressLine1 = addr.line1;
      addressLine2 = addr.line2;
      city = addr.city;
      state = addr.state;
      postalCode = addr.postalCode;
      country = addr.country;
    } else {
      recipientName = input.newRecipient.recipientName.trim();
      addressLine1 = input.newRecipient.line1.trim();
      addressLine2 = input.newRecipient.line2?.trim() || null;
      city = input.newRecipient.city.trim();
      state = input.newRecipient.state.trim().toUpperCase();
      postalCode = input.newRecipient.postalCode.trim();
      country = (input.newRecipient.country ?? "US").trim().toUpperCase();
    }
  }

  const order = await db.order.findUniqueOrThrow({ where: { id: input.orderId } });
  const ship = await db.fulfillmentMethod.findFirst({
    where: { code: "SHIP", isActive: true },
  });
  const groupingKey = buildGroupingKey({
    recipientName,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    fulfillmentMethodCode: ship?.code ?? "SHIP",
    greeting: line.greeting || order.greetingDefault || "",
  });

  await db.orderLine.update({
    where: { id: line.id },
    data: {
      recipientName,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      savedAddressId,
      fulfillmentMethodId: ship?.id ?? null,
      groupingKey,
    },
  });
  await db.order.update({
    where: { id: input.orderId },
    data: { version: { increment: 1 } },
  });

  const refreshed = await db.order.findUniqueOrThrow({
    where: { id: input.orderId },
    include: draftInclude,
  });
  return ok({
    draft: serializeDraft(refreshed),
    savedAddressId: savedAddressId ?? undefined,
  });
}

/** Clear guest access only after order is PLACED (post-finalize). */
export async function markGuestDraftSuccess(
  orderId: string,
): Promise<Result<{ draftRef: string }>> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return err("not_found", "Draft not found.");
  if (order.customerId) {
    return err("not_guest", "Only guest drafts clear via guest success.");
  }
  if (order.status === OrderStatus.DRAFT || order.status === OrderStatus.DISCARDED) {
    return err(
      "not_placed",
      "Guest success requires a finalized (PLACED+) order.",
    );
  }
  if (
    order.status !== OrderStatus.PLACED &&
    order.status !== OrderStatus.PAID &&
    order.status !== OrderStatus.FULFILLING &&
    order.status !== OrderStatus.COMPLETED
  ) {
    return err("status", `Cannot clear guest access from status ${order.status}.`);
  }
  const nextVersion = order.guestTokenVersion + 1;
  await db.order.update({
    where: { id: orderId },
    data: {
      guestClearedAt: new Date(),
      guestAccessTokenHash: null,
      guestTokenVersion: nextVersion,
      version: { increment: 1 },
    },
  });
  await db.auditLog.create({
    data: {
      action: AuditAction.DRAFT_GUEST_CLEARED,
      meta: { orderId, draftRef: order.draftRef, status: order.status },
    },
  });
  return ok({ draftRef: order.draftRef });
}

export async function cancelDraft(orderId: string): Promise<Result<{ draftRef: string }>> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== OrderStatus.DRAFT) {
    return err("state", "Draft cannot be cancelled.");
  }
  await db.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.DISCARDED,
      discardedAt: new Date(),
      guestAccessTokenHash: null,
      guestClearedAt: order.guestClearedAt ?? new Date(),
      version: { increment: 1 },
    },
  });
  return ok({ draftRef: order.draftRef });
}
