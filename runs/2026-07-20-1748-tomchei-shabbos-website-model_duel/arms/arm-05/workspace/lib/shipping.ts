import { prisma } from "@/lib/db";
import { createShippoClient, selectMarginRate, type ShippingAddress, type ShipmentParcel } from "@/lib/shippo";

function toShippingAddress(address: {
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}) {
  return {
    name: address.recipientName,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
  } satisfies ShippingAddress;
}

async function shippingOrigin() {
  const pickupLocation = await prisma.pickupLocation.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  if (!pickupLocation) throw new Error("Add an active pickup location before requesting Shippo rates or labels.");
  return {
    name: pickupLocation.name,
    line1: pickupLocation.line1,
    line2: pickupLocation.line2,
    city: pickupLocation.city,
    state: pickupLocation.state,
    postalCode: pickupLocation.postalCode,
    country: "US",
  } satisfies ShippingAddress;
}

function numberValue(value: { toString(): string } | null) {
  return value === null ? null : Number(value.toString());
}

function checkoutChargeForPackage(packageRecord: {
  addressId: string | null;
  order: { wireFormat: unknown };
}) {
  const wireFormat = packageRecord.order.wireFormat;
  if (!packageRecord.addressId || !wireFormat || typeof wireFormat !== "object" || Array.isArray(wireFormat)) {
    throw new Error("This package has no checkout shipping charge to reconcile.");
  }
  const checkout = (wireFormat as Record<string, unknown>).checkout;
  if (!checkout || typeof checkout !== "object" || Array.isArray(checkout)) {
    throw new Error("This package has no checkout shipping charge to reconcile.");
  }
  const quotes = (checkout as Record<string, unknown>).shippingQuotes;
  if (!Array.isArray(quotes)) throw new Error("This package has no checkout shipping charge to reconcile.");
  const quote = quotes.find((candidate) =>
    candidate
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && (candidate as Record<string, unknown>).addressId === packageRecord.addressId,
  ) as Record<string, unknown> | undefined;
  if (!quote || typeof quote.customerChargeCents !== "number" || !Number.isInteger(quote.customerChargeCents)) {
    throw new Error("This package has no checkout shipping charge to reconcile.");
  }
  return quote.customerChargeCents;
}

async function shippablePackage(packageId: string) {
  const packageRecord = await prisma.package.findFirst({
    where: { id: packageId, isActive: true, order: { status: "FINALIZED" }, fulfillmentMethod: { code: "SHIP" } },
    include: {
      order: { select: { wireFormat: true } },
      address: true,
      packageType: true,
      lines: { include: { orderLine: { include: { product: true } } } },
      shipmentBoxes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!packageRecord) throw new Error("A label can only be created for an active shipped package in a finalized order.");
  if (!packageRecord.address) throw new Error("A shipped package needs a delivery address before it can be rated.");
  return packageRecord;
}

function boxVolume(box: { lengthInches: { toString(): string }; widthInches: { toString(): string }; heightInches: { toString(): string } }) {
  return Number(box.lengthInches) * Number(box.widthInches) * Number(box.heightInches);
}

function productFitsBox(
  product: { length: number; width: number; height: number },
  box: { lengthInches: { toString(): string }; widthInches: { toString(): string }; heightInches: { toString(): string } },
) {
  const productSides = [product.length, product.width, product.height].sort((left, right) => right - left);
  const boxSides = [Number(box.lengthInches), Number(box.widthInches), Number(box.heightInches)].sort((left, right) => right - left);
  return productSides.every((side, index) => side <= boxSides[index]);
}

function activeShipmentBox<T extends { externalLabelId: string | null; labelVoidedAt: Date | null }>(shipmentBoxes: T[]) {
  return shipmentBoxes.find((box) => box.externalLabelId && !box.labelVoidedAt);
}

async function parcelForPackage(packageId: string) {
  const packageRecord = await shippablePackage(packageId);
  const packageDimensions = packageRecord.lines.reduce((dimensions, packageLine) => {
    const product = packageLine.orderLine.product;
    const length = numberValue(product.lengthInches);
    const width = numberValue(product.widthInches);
    const height = numberValue(product.heightInches);
    const weight = numberValue(product.weightOunces);
    if (!length || !width || !height || !weight) {
      throw new Error(`${product.name} needs dimensions and weight before a shipping label can be planned.`);
    }
    return {
      volume: dimensions.volume + length * width * height * packageLine.quantity,
      weight: dimensions.weight + weight * packageLine.quantity,
      products: [...dimensions.products, { length, width, height }],
    };
  }, { volume: 0, weight: 0, products: [] as Array<{ length: number; width: number; height: number }> });
  const availableBoxes = await prisma.packageType.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  const selectedBox = packageRecord.packageType
    ?? availableBoxes
      .filter((box) =>
        boxVolume(box) >= packageDimensions.volume
        && Number(box.maxWeightOunces) >= packageDimensions.weight
        && packageDimensions.products.every((product) => productFitsBox(product, box)),
      )
      .sort((left, right) => boxVolume(left) - boxVolume(right))[0];
  if (!selectedBox) throw new Error("No active package type can hold this package's measured contents.");
  return {
    packageRecord,
    packageTypeId: selectedBox.id,
    parcel: {
      lengthInches: Number(selectedBox.lengthInches),
      widthInches: Number(selectedBox.widthInches),
      heightInches: Number(selectedBox.heightInches),
      weightOunces: packageDimensions.weight,
    } satisfies ShipmentParcel,
  };
}

async function quotePackage(packageId: string) {
  const { packageRecord, packageTypeId, parcel } = await parcelForPackage(packageId);
  const client = createShippoClient();
  const rates = await client.quoteShipment({
    from: await shippingOrigin(),
    to: toShippingAddress(packageRecord.address!),
    parcel,
  });
  const selection = selectMarginRate(rates);
  return { client, packageRecord, packageTypeId, rates, selection };
}

export async function quoteCheckoutShipping(addresses: Array<{
  id: string;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}>) {
  if (!addresses.length) return [];
  const packageType = await prisma.packageType.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  if (!packageType) throw new Error("Add an active package type before requesting checkout shipping rates.");
  const client = createShippoClient();
  const origin = await shippingOrigin();
  const parcel = {
    lengthInches: Number(packageType.lengthInches),
    widthInches: Number(packageType.widthInches),
    heightInches: Number(packageType.heightInches),
    weightOunces: Number(packageType.maxWeightOunces),
  };
  return Promise.all(addresses.map(async (address) => {
    const selection = selectMarginRate(await client.quoteShipment({ from: origin, to: toShippingAddress(address), parcel }));
    return {
      addressId: address.id,
      customerChargeCents: selection.charge.amountCents,
      carrier: selection.purchase.carrier,
      service: selection.purchase.service,
      purchasedRateCents: selection.purchase.amountCents,
      marginCents: selection.spreadCents,
      providerMode: client.mode,
    };
  }));
}

export async function validatePackageAddress(packageId: string) {
  const packageRecord = await shippablePackage(packageId);
  return createShippoClient().validateAddress(toShippingAddress(packageRecord.address!));
}

export async function createPackageLabel(packageId: string, actorId: string) {
  const quoted = await quotePackage(packageId);
  const validation = await quoted.client.validateAddress(toShippingAddress(quoted.packageRecord.address!));
  if (!validation.isValid) throw new Error(validation.messages.join(" ") || "Shippo could not validate this shipping address.");
  const chargedCents = checkoutChargeForPackage(quoted.packageRecord);
  const purchasedLabel = {
    value: null as { id: string; labelUrl: string | null; trackingNumber: string | null; trackingStatus: string | null } | null,
  };
  try {
    const shipmentBox = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Package" WHERE "id" = ${packageId} FOR UPDATE`;
      const lockedPackage = await transaction.package.findUnique({
        where: { id: packageId },
        select: { version: true, packageTypeId: true },
      });
      if (!lockedPackage || lockedPackage.version !== quoted.packageRecord.version) {
        throw new Error("This package changed while its label was being prepared. Refresh and try again.");
      }
      const existingLabel = await transaction.shipmentBox.findFirst({
        where: { packageId, externalLabelId: { not: null }, labelVoidedAt: null },
      });
      if (existingLabel) throw new Error("Void the active label before buying another one.");
      if (lockedPackage.packageTypeId !== quoted.packageTypeId) {
        await transaction.package.update({
          where: { id: packageId },
          data: { packageTypeId: quoted.packageTypeId, version: { increment: 1 } },
        });
        await transaction.packageAudit.create({
          data: { packageId, actorId, action: "shipping.package_type_selected", details: { packageTypeId: quoted.packageTypeId } },
        });
      }
      const label = await quoted.client.buyLabel(quoted.selection.purchase.id);
      purchasedLabel.value = label;
      await transaction.shippingQuote.deleteMany({ where: { packageId } });
      await transaction.shippingQuote.createMany({
        data: quoted.rates.map((rate) => ({
          packageId,
          carrier: rate.carrier,
          service: rate.service,
          amountCents: rate.amountCents,
          expiresAt: rate.expiresAt,
          externalRateId: rate.id,
        })),
      });
      const created = await transaction.shipmentBox.create({
        data: {
          packageId,
          packageTypeId: quoted.packageTypeId,
          externalLabelId: label.id,
          carrier: quoted.selection.purchase.carrier,
          service: quoted.selection.purchase.service,
          chargedCents,
          labelCostCents: quoted.selection.purchase.amountCents,
          marginCents: chargedCents - quoted.selection.purchase.amountCents,
          labelUrl: label.labelUrl,
          trackingNumber: label.trackingNumber,
          trackingStatus: label.trackingStatus,
          lastTrackedAt: new Date(),
        },
      });
      await transaction.packageAudit.create({
        data: {
          packageId,
          actorId,
          action: "shipping.label_created",
          details: {
            carrier: quoted.selection.purchase.carrier,
            service: quoted.selection.purchase.service,
            customerChargeCents: chargedCents,
            labelCostCents: quoted.selection.purchase.amountCents,
            marginCents: chargedCents - quoted.selection.purchase.amountCents,
            providerMode: quoted.client.mode,
          },
        },
      });
      return created;
    });
    return shipmentBox;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown persistence failure.";
    const purchased = purchasedLabel.value;
    if (!purchased) throw new Error(message);
    try {
      await quoted.client.voidLabel(purchased.id);
    } catch (voidError) {
      const voidMessage = voidError instanceof Error ? voidError.message : "Unknown Shippo void failure.";
      await prisma.$transaction([
        prisma.shipmentBox.create({
          data: {
            packageId,
            packageTypeId: quoted.packageTypeId,
            externalLabelId: purchased.id,
            carrier: quoted.selection.purchase.carrier,
            service: quoted.selection.purchase.service,
            chargedCents,
            labelCostCents: quoted.selection.purchase.amountCents,
            marginCents: chargedCents - quoted.selection.purchase.amountCents,
            labelUrl: purchased.labelUrl,
            trackingNumber: purchased.trackingNumber,
            trackingStatus: "VOID_FAILED",
          },
        }),
        prisma.packageAudit.create({
          data: {
            packageId,
            actorId,
            action: "shipping.label_void_compensation_failed",
            details: { labelId: purchased.id, persistenceError: message, voidError: voidMessage },
          },
        }),
      ]);
      throw new Error(`The label was purchased but could not be saved or voided; it is recorded for reconciliation: ${message}`);
    }
    throw new Error(`The label purchase was voided because its local record could not be saved: ${message}`);
  }
}

export async function voidPackageLabel(packageId: string, actorId: string) {
  const packageRecord = await shippablePackage(packageId);
  if (packageRecord.status === "SENT") throw new Error("A sent package label cannot be voided.");
  const shipmentBox = activeShipmentBox(packageRecord.shipmentBoxes);
  if (!shipmentBox?.externalLabelId) throw new Error("This package has no active label to void.");
  await createShippoClient().voidLabel(shipmentBox.externalLabelId);
  await prisma.$transaction([
    prisma.shipmentBox.update({ where: { id: shipmentBox.id }, data: { labelVoidedAt: new Date() } }),
    prisma.packageAudit.create({ data: { packageId, actorId, action: "shipping.label_voided", details: { labelId: shipmentBox.externalLabelId } } }),
  ]);
}

export async function refreshPackageTracking(packageId: string, actorId: string) {
  const packageRecord = await shippablePackage(packageId);
  const shipmentBox = activeShipmentBox(packageRecord.shipmentBoxes);
  if (!shipmentBox?.externalLabelId) throw new Error("This package has no active label to track.");
  const tracking = await createShippoClient().refreshTracking(shipmentBox.externalLabelId);
  await prisma.$transaction([
    prisma.shipmentBox.update({
      where: { id: shipmentBox.id },
      data: { trackingNumber: tracking.trackingNumber, trackingStatus: tracking.trackingStatus, lastTrackedAt: new Date() },
    }),
    prisma.packageAudit.create({ data: { packageId, actorId, action: "shipping.tracking_refreshed", details: tracking } }),
  ]);
  return tracking;
}

export async function packageShippingSummary(packageId: string, includeMargin: boolean) {
  return prisma.shipmentBox.findMany({
    where: { packageId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      carrier: true,
      service: true,
      ...(includeMargin ? {
        chargedCents: true,
        labelCostCents: true,
        marginCents: true,
      } : {}),
      externalLabelId: true,
      labelUrl: true,
      trackingNumber: true,
      trackingStatus: true,
      labelVoidedAt: true,
      lastTrackedAt: true,
    },
  });
}
