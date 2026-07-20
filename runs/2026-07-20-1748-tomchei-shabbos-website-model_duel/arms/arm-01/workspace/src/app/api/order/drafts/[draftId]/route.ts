import { RecipientAssignmentSource } from "@prisma/client";
import { NextResponse } from "next/server";
import { discardDraft } from "@/domain/order-engine";
import { findAccessibleDraft } from "@/lib/customer-access";
import { db } from "@/lib/db";

type DraftLineInput = {
  productId: string;
  productOptionId?: string | null;
  quantity: number;
  addOnIds?: string[];
  recipientAddressId?: string | null;
  recipientSource?: RecipientAssignmentSource | null;
};

async function getDraftResponse(request: Request, draftId: string) {
  const accessibleDraft = await findAccessibleDraft(request, draftId);
  if (!accessibleDraft) return null;
  return db.order.findUnique({
    where: { id: accessibleDraft.id },
    include: {
      lines: {
        include: {
          addOns: true,
          productOption: true,
          recipientAddress: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await context.params;
  const order = await getDraftResponse(request, draftId);
  return order
    ? NextResponse.json({ order })
    : NextResponse.json({ error: "Draft not found." }, { status: 404 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await context.params;
  const accessibleDraft = await findAccessibleDraft(request, draftId);
  if (!accessibleDraft) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }
  const body = (await request.json()) as { lines?: DraftLineInput[]; version?: number };
  if (!Array.isArray(body.lines) || !Number.isInteger(body.version) || (body.version ?? 0) < 1) {
    return NextResponse.json(
      { error: "Draft lines and a positive version are required." },
      { status: 400 },
    );
  }
  if (
    body.lines.some(
      (line) =>
        !line.productId ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        (line.recipientSource &&
          !Object.values(RecipientAssignmentSource).includes(line.recipientSource)),
    )
  ) {
    return NextResponse.json({ error: "Every draft line must be valid." }, { status: 400 });
  }

  const productIds = [...new Set(body.lines.map((line) => line.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, seasonId: accessibleDraft.seasonId, isActive: true },
    include: {
      options: { where: { isActive: true } },
      inventoryItem: true,
      allowedAddOns: {
        include: { addOn: { include: { addOnInventoryItem: true } } },
      },
    },
  });
  const productsById = new Map(products.map((product) => [product.id, product]));
  const addressIds = [
    ...new Set(
      body.lines
        .map((line) => line.recipientAddressId)
        .filter((addressId): addressId is string => Boolean(addressId)),
    ),
  ];
  const ownedAddresses = await db.customerAddress.findMany({
    where: { id: { in: addressIds }, customerId: accessibleDraft.customerId },
  });
  const addressesById = new Map(ownedAddresses.map((address) => [address.id, address]));

  try {
    let subtotalCents = 0;
    const preparedLines = body.lines.map((line) => {
    const product = productsById.get(line.productId);
    if (!product) throw new Error("A selected product is unavailable.");
    const availableQuantity = product.tracksInventory
      ? (product.inventoryItem?.onHand ?? 0) - (product.inventoryItem?.reserved ?? 0)
      : null;
    if (availableQuantity !== null && line.quantity > availableQuantity) {
      throw new Error(`${product.name} has only ${Math.max(0, availableQuantity)} available.`);
    }
    const option = line.productOptionId
      ? product.options.find((candidate) => candidate.id === line.productOptionId)
      : null;
    if (line.productOptionId && !option) {
      throw new Error(`The selected option is not available for ${product.name}.`);
    }
    const addOns = (line.addOnIds ?? []).map((addOnId) => {
      const allowedAddOn = product.allowedAddOns.find((candidate) => candidate.addOnId === addOnId);
      if (!allowedAddOn) {
        throw new Error(`The selected add-on is not allowed for ${product.name}.`);
      }
      const availableAddOns =
        (allowedAddOn.addOn.addOnInventoryItem?.onHand ?? 0) -
        (allowedAddOn.addOn.addOnInventoryItem?.reserved ?? 0);
      if (allowedAddOn.addOn.tracksInventory && line.quantity > availableAddOns) {
        throw new Error(`${allowedAddOn.addOn.name} has only ${Math.max(0, availableAddOns)} available.`);
      }
      return allowedAddOn.addOn;
    });
    const recipientAddress = line.recipientAddressId
      ? addressesById.get(line.recipientAddressId)
      : null;
    if (line.recipientAddressId && !recipientAddress) {
      throw new Error("The selected recipient address is not in this customer's address book.");
    }
    const unitPriceCents =
      product.priceCents +
      (option?.priceAdjustmentCents ?? 0) +
      addOns.reduce((total, addOn) => total + addOn.priceCents, 0);
    subtotalCents += unitPriceCents * line.quantity;
    return { line, product, option, addOns, recipientAddress, unitPriceCents };
    });
    const order = await db.$transaction(async (transaction) => {
      const updated = await transaction.order.updateMany({
        where: { id: accessibleDraft.id, version: body.version, status: "DRAFT" },
        data: {
          subtotalCents,
          totalCents: subtotalCents,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      await transaction.orderLine.deleteMany({ where: { orderId: accessibleDraft.id } });
      for (const preparedLine of preparedLines) {
        await transaction.orderLine.create({
          data: {
            orderId: accessibleDraft.id,
            productId: preparedLine.product.id,
            productOptionId: preparedLine.option?.id,
            recipientAddressId: preparedLine.recipientAddress?.id,
            recipientSource: preparedLine.line.recipientSource,
            recipientNameSnapshot: preparedLine.recipientAddress?.recipientName,
            productNameSnapshot: preparedLine.product.name,
            skuSnapshot: preparedLine.product.sku,
            unitPriceCentsSnapshot: preparedLine.unitPriceCents,
            quantity: preparedLine.line.quantity,
            addOns: {
              create: preparedLine.addOns.map((addOn) => ({
                addOnProductId: addOn.id,
                addOnNameSnapshot: addOn.name,
                unitPriceCentsSnapshot: addOn.priceCents,
                quantity: preparedLine.line.quantity,
              })),
            },
          },
        });
      }
      return transaction.order.findUnique({
        where: { id: accessibleDraft.id },
        include: { lines: { include: { addOns: true, recipientAddress: true } } },
      });
    });
    if (!order) {
      return NextResponse.json(
        { error: "This draft changed in another browser. Reload before saving." },
        { status: 409 },
      );
    }
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Draft could not be saved." },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await context.params;
  const accessibleDraft = await findAccessibleDraft(request, draftId);
  if (!accessibleDraft) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }
  await discardDraft(db, accessibleDraft.id);
  return NextResponse.json({ cancelled: true });
}
