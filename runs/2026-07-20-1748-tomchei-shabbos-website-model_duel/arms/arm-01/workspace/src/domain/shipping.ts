import { Prisma, type PrismaClient } from "@prisma/client";
import {
  type CarrierRate,
  type ShippingAddress,
  type ShippingParcel,
  type ShippingProvider,
} from "@/lib/shippo";
import { readServerEnvironment } from "@/lib/env";

const millimetersPerInch = 25.4;
const gramsPerOunce = 28.3495;

export type ShipmentProduct = {
  quantity: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  weightGrams: number;
};

export type AvailableBox = {
  id: string;
  innerWidthMm: number;
  innerHeightMm: number;
  innerDepthMm: number;
  maxWeightGrams: number | null;
};

export function selectShippingMargin(rates: CarrierRate[]) {
  const eligible = rates.filter(
    (rate) =>
      ["fedex", "ups", "usps"].includes(rate.carrier.toLowerCase()) &&
      rate.amountCents > 0 &&
      rate.currency.toLowerCase() === "usd",
  );
  if (!eligible.length) {
    throw new Error("No eligible FedEx, UPS, or USPS rates were returned.");
  }
  const purchasedRate = eligible.reduce((cheapest, rate) =>
    rate.amountCents < cheapest.amountCents ? rate : cheapest,
  );
  const chargedRate = eligible.reduce((highest, rate) =>
    rate.amountCents > highest.amountCents ? rate : highest,
  );
  return {
    chargedRate,
    purchasedRate,
    chargedCents: chargedRate.amountCents,
    purchasedCents: purchasedRate.amountCents,
    marginCents: chargedRate.amountCents - purchasedRate.amountCents,
  };
}

function volume(product: Pick<ShipmentProduct, "widthMm" | "heightMm" | "depthMm">) {
  return product.widthMm * product.heightMm * product.depthMm;
}

export function planShipment(products: ShipmentProduct[], boxes: AvailableBox[]) {
  const activeBoxes = [...boxes].sort(
    (left, right) =>
      left.innerWidthMm * left.innerHeightMm * left.innerDepthMm -
      right.innerWidthMm * right.innerHeightMm * right.innerDepthMm,
  );
  if (!activeBoxes.length) throw new Error("At least one active shipment box is required.");
  const units = products
    .flatMap((product) => Array.from({ length: product.quantity }, () => ({ ...product })))
    .sort((left, right) => volume(right) - volume(left));
  const planned: Array<{
    packageTypeId: string;
    usedVolumeMm3: number;
    weightGrams: number;
  }> = [];
  for (const unit of units) {
    const fittingBox = activeBoxes.find(
      (box) =>
        unit.widthMm <= box.innerWidthMm &&
        unit.heightMm <= box.innerHeightMm &&
        unit.depthMm <= box.innerDepthMm &&
        unit.weightGrams <= (box.maxWeightGrams ?? Number.POSITIVE_INFINITY),
    );
    if (!fittingBox) throw new Error("A gift does not fit any active shipment box.");
    const unitVolume = volume(unit);
    const existing = planned.find((box) => {
      if (box.packageTypeId !== fittingBox.id) return false;
      const capacity =
        fittingBox.innerWidthMm * fittingBox.innerHeightMm * fittingBox.innerDepthMm;
      return (
        box.usedVolumeMm3 + unitVolume <= capacity &&
        box.weightGrams + unit.weightGrams <=
          (fittingBox.maxWeightGrams ?? Number.POSITIVE_INFINITY)
      );
    });
    if (existing) {
      existing.usedVolumeMm3 += unitVolume;
      existing.weightGrams += unit.weightGrams;
    } else {
      planned.push({
        packageTypeId: fittingBox.id,
        usedVolumeMm3: unitVolume,
        weightGrams: unit.weightGrams,
      });
    }
  }
  return planned;
}

function toParcel(box: AvailableBox, weightGrams: number): ShippingParcel {
  return {
    lengthInches: box.innerDepthMm / millimetersPerInch,
    widthInches: box.innerWidthMm / millimetersPerInch,
    heightInches: box.innerHeightMm / millimetersPerInch,
    weightOunces: weightGrams / gramsPerOunce,
  };
}

function snapshotAddress(recipientName: string, snapshot: Prisma.JsonValue): ShippingAddress {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Shipping requires a package address snapshot.");
  }
  const address = snapshot as Record<string, Prisma.JsonValue>;
  return {
    name: recipientName,
    street1: String(address.line1 ?? ""),
    street2: address.line2 ? String(address.line2) : undefined,
    city: String(address.city ?? ""),
    state: String(address.region ?? ""),
    zip: String(address.postalCode ?? ""),
    country: String(address.countryCode ?? "US"),
  };
}

function organizationAddress(): ShippingAddress {
  const environment = readServerEnvironment();
  const required = [
    "SHIP_FROM_NAME",
    "SHIP_FROM_STREET1",
    "SHIP_FROM_CITY",
    "SHIP_FROM_STATE",
    "SHIP_FROM_ZIP",
  ] as const;
  for (const name of required) {
    if (!environment[name]) throw new Error(`Shipping provider requires ${name}.`);
  }
  return {
    name: environment.SHIP_FROM_NAME!,
    street1: environment.SHIP_FROM_STREET1!,
    street2: environment.SHIP_FROM_STREET2,
    city: environment.SHIP_FROM_CITY!,
    state: environment.SHIP_FROM_STATE!,
    zip: environment.SHIP_FROM_ZIP!,
    country: environment.SHIP_FROM_COUNTRY ?? "US",
  };
}

async function loadPackagePlan(
  prisma: PrismaClient | Prisma.TransactionClient,
  packageId: string,
) {
  const packageRecord = await prisma.package.findUniqueOrThrow({
    where: { id: packageId },
    include: {
      fulfillmentMethod: true,
      order: { select: { seasonId: true } },
      lines: {
        include: {
          orderLine: { include: { product: true } },
        },
      },
    },
  });
  if (!packageRecord.isActive || !packageRecord.fulfillmentMethod.isShipping) {
    throw new Error("Only active shipping packages can use carrier labels.");
  }
  if (packageRecord.stage === "SENT" || packageRecord.stage === "PICKED_UP") {
    throw new Error("Fulfilled packages cannot change shipping labels.");
  }
  const packageTypes = await prisma.packageType.findMany({
    where: { seasonId: packageRecord.order.seasonId, isActive: true },
    orderBy: { innerDepthMm: "asc" },
  });
  const products = packageRecord.lines.map(({ quantity, orderLine }) => {
    const product = orderLine.product;
    if (!product.widthMm || !product.heightMm || !product.depthMm || !product.weightGrams) {
      throw new Error(`${product.name} needs dimensions and weight before shipping.`);
    }
    return {
      quantity,
      widthMm: product.widthMm,
      heightMm: product.heightMm,
      depthMm: product.depthMm,
      weightGrams: product.weightGrams,
    };
  });
  const plannedBoxes = planShipment(products, packageTypes);
  return {
    packageRecord,
    packageTypes,
    plannedBoxes,
    to: snapshotAddress(packageRecord.recipientName, packageRecord.addressSnapshot),
  };
}

export async function quotePackage(
  prisma: PrismaClient,
  provider: ShippingProvider,
  packageId: string,
) {
  const plan = await loadPackagePlan(prisma, packageId);
  const boxesById = new Map(plan.packageTypes.map((box) => [box.id, box]));
  const rates = await provider.getRates({
    from: organizationAddress(),
    to: plan.to,
    parcels: plan.plannedBoxes.map((box) =>
      toParcel(boxesById.get(box.packageTypeId)!, box.weightGrams),
    ),
  });
  const margin = selectShippingMargin(rates);
  await prisma.$transaction(async (transaction) => {
    await transaction.shippingQuote.deleteMany({ where: { packageId } });
    await transaction.shipmentBox.deleteMany({
      where: { packageId, shippingLabels: { none: {} } },
    });
    const priorBox = await transaction.shipmentBox.findFirst({
      where: { packageId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const sequenceOffset = priorBox?.sequence ?? 0;
    await transaction.shipmentBox.createMany({
      data: plan.plannedBoxes.map((box, index) => ({
        packageId,
        packageTypeId: box.packageTypeId,
        sequence: sequenceOffset + index + 1,
        weightGrams: box.weightGrams,
      })),
    });
    await transaction.shippingQuote.createMany({
      data: rates.map((rate) => ({
        packageId,
        provider: rate.carrier,
        serviceCode: rate.serviceCode,
        serviceName: rate.serviceName,
        amountCents: rate.amountCents,
        currency: rate.currency,
        providerQuoteId: rate.id,
        expiresAt: rate.expiresAt,
      })),
    });
    await transaction.packageAudit.create({
      data: {
        packageId,
        action: "shipping.quoted",
        metadata: {
          chargedRateId: margin.chargedRate.id,
          purchasedRateId: margin.purchasedRate.id,
          chargedCents: margin.chargedCents,
          purchasedCents: margin.purchasedCents,
          marginCents: margin.marginCents,
        },
      },
    });
  });
  return margin;
}

export async function buyPackageLabel(
  prisma: PrismaClient,
  provider: ShippingProvider,
  packageId: string,
  actorStaffId: string,
) {
  const result = await prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Package" WHERE "id" = ${packageId} FOR UPDATE
      `;
      await loadPackagePlan(transaction, packageId);
      const active = await transaction.shippingLabel.findFirst({
        where: { packageId, status: "PURCHASED" },
      });
      if (active) throw new Error("Void the active label before buying another.");
      const quotes = await transaction.shippingQuote.findMany({
        where: { packageId, expiresAt: { gt: new Date() }, providerQuoteId: { not: null } },
      });
      const margin = selectShippingMargin(
        quotes.map((quote) => ({
          id: quote.providerQuoteId!,
          carrier: quote.provider,
          serviceCode: quote.serviceCode,
          serviceName: quote.serviceName,
          amountCents: quote.amountCents,
          currency: quote.currency,
          expiresAt: quote.expiresAt,
        })),
      );
      const firstBox = await transaction.shipmentBox.findFirst({
        where: { packageId },
        orderBy: { sequence: "desc" },
      });
      let purchased;
      try {
        purchased = await provider.buyLabel(margin.purchasedRate.id);
      } catch (error) {
        const failureMessage =
          error instanceof Error ? error.message : "Label purchase failed.";
        const failed = await transaction.shippingLabel.create({
          data: {
            packageId,
            shipmentBoxId: firstBox?.id,
            provider: margin.purchasedRate.carrier,
            serviceCode: margin.purchasedRate.serviceCode,
            providerRateId: margin.purchasedRate.id,
            chargedCents: margin.chargedCents,
            purchasedCents: margin.purchasedCents,
            marginCents: margin.marginCents,
            status: "FAILED",
            failureMessage,
          },
        });
        await transaction.packageAudit.create({
          data: {
            packageId,
            actorStaffId,
            action: "shipping.label_purchase_failed",
            metadata: { labelId: failed.id, failureMessage },
          },
        });
        return { error };
      }
      const label = await transaction.shippingLabel.create({
        data: {
          packageId,
          shipmentBoxId: firstBox?.id,
          provider: margin.purchasedRate.carrier,
          serviceCode: margin.purchasedRate.serviceCode,
          providerRateId: margin.purchasedRate.id,
          providerTransactionId: purchased.transactionId,
          trackingNumber: purchased.trackingNumber,
          trackingStatus: purchased.trackingStatus,
          labelUrl: purchased.labelUrl,
          chargedCents: margin.chargedCents,
          purchasedCents: margin.purchasedCents,
          marginCents: margin.marginCents,
          purchasedAt: new Date(),
        },
      });
      await transaction.shippingQuote.updateMany({
        where: { packageId, providerQuoteId: margin.purchasedRate.id },
        data: { selectedAt: new Date() },
      });
      await transaction.packageAudit.create({
        data: {
          packageId,
          actorStaffId,
          action: "shipping.label_purchased",
          metadata: {
            labelId: label.id,
            chargedCents: label.chargedCents,
            purchasedCents: label.purchasedCents,
            marginCents: label.marginCents,
          },
        },
      });
      return { label };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 },
  );
  if ("error" in result) {
    throw result.error;
  }
  return result.label;
}

export async function voidPackageLabel(
  prisma: PrismaClient,
  provider: ShippingProvider,
  packageId: string,
  actorStaffId: string,
) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "Package" WHERE "id" = ${packageId} FOR UPDATE
    `;
    const packageRecord = await transaction.package.findUniqueOrThrow({
      where: { id: packageId },
    });
    if (packageRecord.stage === "SENT" || packageRecord.stage === "PICKED_UP") {
      throw new Error("A sent or picked-up package label cannot be voided.");
    }
    const label = await transaction.shippingLabel.findFirstOrThrow({
      where: { packageId, status: "PURCHASED" },
      orderBy: { createdAt: "desc" },
    });
    if (!label.providerTransactionId) {
      throw new Error("The active label has no provider transaction.");
    }
    await provider.voidLabel(label.providerTransactionId);
    const voided = await transaction.shippingLabel.update({
      where: { id: label.id },
      data: { status: "VOIDED", voidedAt: new Date() },
    });
    await transaction.packageAudit.create({
      data: {
        packageId,
        actorStaffId,
        action: "shipping.label_voided",
        metadata: { labelId: label.id },
      },
    });
    return voided;
  }, { timeout: 20_000 });
}

export async function refreshPackageTracking(
  prisma: PrismaClient,
  provider: ShippingProvider,
  packageId: string,
) {
  const label = await prisma.shippingLabel.findFirstOrThrow({
    where: { packageId, status: "PURCHASED", trackingNumber: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  const tracking = await provider.track(label.provider, label.trackingNumber!);
  return prisma.shippingLabel.update({
    where: { id: label.id },
    data: { trackingStatus: tracking.status, trackingRefreshedAt: new Date() },
  });
}

export async function validatePackageAddress(
  prisma: PrismaClient,
  provider: ShippingProvider,
  packageId: string,
  actorStaffId: string,
) {
  const packageRecord = await prisma.package.findUniqueOrThrow({ where: { id: packageId } });
  const validation = await provider.validateAddress(
    snapshotAddress(packageRecord.recipientName, packageRecord.addressSnapshot),
  );
  await prisma.packageAudit.create({
    data: {
      packageId,
      actorStaffId,
      action: "shipping.address_validated",
      metadata: {
        isValid: validation.isValid,
        messages: validation.messages,
        normalizedAddress: validation.normalizedAddress,
      },
    },
  });
  return validation;
}

export async function quoteDraftShipping(
  prisma: PrismaClient,
  provider: ShippingProvider,
  orderId: string,
) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      lines: {
        include: { product: true, recipientAddress: true },
        orderBy: { id: "asc" },
      },
    },
  });
  const packageTypes = await prisma.packageType.findMany({
    where: { seasonId: order.seasonId, isActive: true },
    orderBy: { innerDepthMm: "asc" },
  });
  const linesByAddress = new Map<string, typeof order.lines>();
  for (const line of order.lines) {
    if (!line.recipientAddressId || !line.recipientAddress) continue;
    const addressLines = linesByAddress.get(line.recipientAddressId) ?? [];
    addressLines.push(line);
    linesByAddress.set(line.recipientAddressId, addressLines);
  }
  const feesByAddressId: Record<string, number> = {};
  for (const [addressId, lines] of linesByAddress) {
    const address = lines[0]!.recipientAddress!;
    const plannedBoxes = planShipment(
      lines.map((line) => {
        const product = line.product;
        if (!product.widthMm || !product.heightMm || !product.depthMm || !product.weightGrams) {
          throw new Error(`${product.name} needs dimensions and weight before shipping.`);
        }
        return {
          quantity: line.quantity,
          widthMm: product.widthMm,
          heightMm: product.heightMm,
          depthMm: product.depthMm,
          weightGrams: product.weightGrams,
        };
      }),
      packageTypes,
    );
    const boxesById = new Map(packageTypes.map((box) => [box.id, box]));
    const rates = await provider.getRates({
      from: organizationAddress(),
      to: {
        name: address.recipientName,
        street1: address.line1,
        street2: address.line2 ?? undefined,
        city: address.city,
        state: address.region,
        zip: address.postalCode,
        country: address.countryCode,
      },
      parcels: plannedBoxes.map((box) =>
        toParcel(boxesById.get(box.packageTypeId)!, box.weightGrams),
      ),
    });
    feesByAddressId[addressId] = selectShippingMargin(rates).chargedCents;
  }
  return feesByAddressId;
}
