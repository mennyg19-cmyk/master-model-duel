import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { planParcels, BoxSpec, PackItem, Parcel } from "@/lib/shipping/packing";
import {
  GROUND_SERVICE_TOKENS,
  MarginResolution,
  normalizeRates,
  resolveMargin,
  RateOption,
} from "@/lib/shipping/margin";
import {
  createShipmentWithRates,
  getShippoConfig,
  ShippoAddress,
  ShippoNotConfiguredError,
} from "@/lib/shipping/shippo";

// Quote engine: recipient/package contents → bin-packed parcels → live Shippo
// rates → the UR-003 margin resolution, persisted as an expiring
// ShippingQuote row (R-155). Both checkout (order scope) and label purchase
// (package scope) run through this one path.

export const QUOTE_TTL_MINUTES = 30;

export interface ShippingQuoteResult {
  options: RateOption[];
  margin: MarginResolution;
  parcels: Parcel[];
  expiresAt: Date;
  // The carrier-side shipment object the rates came from — persisted on the
  // Shipment row at label buy for traceability.
  shippoShipmentId: string;
}

export class ShippingUnavailableError extends Error {
  constructor(reason: string) {
    super(`Carrier shipping is unavailable: ${reason}`);
    this.name = "ShippingUnavailableError";
  }
}

async function loadBoxes(db: Prisma.TransactionClient | typeof prisma): Promise<BoxSpec[]> {
  const boxes = await db.shipmentBox.findMany({ where: { active: true } });
  return boxes.map((box) => ({
    name: box.name,
    lengthMm: box.lengthMm,
    widthMm: box.widthMm,
    heightMm: box.heightMm,
    tareWeightGrams: box.tareWeightGrams,
  }));
}

async function fallbackPackageType(db: Prisma.TransactionClient | typeof prisma) {
  const types = await db.packageType.findMany({ where: { active: true } });
  if (types.length === 0) {
    throw new DomainRuleError("No active package types configured; expected package types to plan shipments (R-157)");
  }
  // Conservative fallback: the largest type by volume, so a product missing
  // dims never under-declares a parcel.
  return types.sort((a, b) => b.lengthMm * b.widthMm * b.heightMm - a.lengthMm * a.widthMm * a.heightMm)[0];
}

interface LineWithProduct {
  qty: number;
  parentLineId: string | null;
  product: { lengthMm: number | null; widthMm: number | null; heightMm: number | null; weightGrams: number | null } | null;
}

export async function packItemsForLines(
  db: Prisma.TransactionClient | typeof prisma,
  lines: LineWithProduct[],
): Promise<PackItem[]> {
  const fallback = await fallbackPackageType(db);
  const items: PackItem[] = [];
  for (const line of lines) {
    // Add-on lines ride inside their parent product's parcel allowance (a
    // card, a ribbon) — they don't pack separately.
    if (line.parentLineId !== null) continue;
    const dims = line.product;
    const hasDims = dims && dims.lengthMm && dims.widthMm && dims.heightMm && dims.weightGrams;
    items.push({
      lengthMm: hasDims ? dims.lengthMm! : fallback.lengthMm,
      widthMm: hasDims ? dims.widthMm! : fallback.widthMm,
      heightMm: hasDims ? dims.heightMm! : fallback.heightMm,
      weightGrams: hasDims ? dims.weightGrams! : fallback.weightGrams,
      qty: line.qty,
    });
  }
  return items;
}

export async function planParcelsForLines(
  db: Prisma.TransactionClient | typeof prisma,
  lines: LineWithProduct[],
): Promise<Parcel[]> {
  const [items, boxes] = await Promise.all([packItemsForLines(db, lines), loadBoxes(db)]);
  return planParcels(items, boxes);
}

async function loadOrigin(db: Prisma.TransactionClient | typeof prisma): Promise<ShippoAddress> {
  const origin = await getSetting("shipping.origin");
  if (!origin) {
    throw new DomainRuleError("shipping.origin setting is missing; run the seed before buying labels");
  }
  return origin;
}

// The one live-quote path. `scope` persists the quote against an order
// (checkout) or a package (label purchase); both callers must treat any
// stored quote past expiresAt as dead (R-155) — this engine never reads
// stored quotes, it always prices fresh.
export async function quoteShipping(input: {
  db?: Prisma.TransactionClient | typeof prisma;
  parcels: Parcel[];
  destination: ShippoAddress;
  scope: { orderId: string } | { packageId: string };
  persist?: boolean;
}): Promise<ShippingQuoteResult> {
  const config = getShippoConfig();
  if (!config) throw new ShippoNotConfiguredError();
  const db = input.db ?? prisma;

  const shipment = await createShipmentWithRates({
    origin: await loadOrigin(db),
    destination: input.destination,
    parcels: input.parcels,
  });
  const options = normalizeRates(shipment.rates);
  // Ground-comparable eligibility is operator-tunable (org-negotiated service
  // levels change); the setting falls back to the code default list.
  const groundTokens = (await getSetting("shipping.groundServiceTokens")) ?? GROUND_SERVICE_TOKENS;
  const margin = resolveMargin(options, config.includeUsps, groundTokens);
  if (!margin) {
    throw new ShippingUnavailableError(
      options.length === 0
        ? "no carrier rates came back for this address"
        : "no ground-comparable services came back for this address",
    );
  }

  const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000);
  if (input.persist !== false) {
    await db.shippingQuote.create({
      data: {
        ...("orderId" in input.scope ? { orderId: input.scope.orderId } : { packageId: input.scope.packageId }),
        options: {
          rates: options,
          charge: margin.charge,
          buy: margin.buy,
          parcels: input.parcels,
          shippoShipmentId: shipment.object_id,
        } as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
    });
  }
  return { options, margin, parcels: input.parcels, expiresAt, shippoShipmentId: shipment.object_id };
}

// Package contents → parcels, for the label-purchase path (R-081).
export async function planParcelsForPackage(
  db: Prisma.TransactionClient | typeof prisma,
  packageId: string,
): Promise<Parcel[]> {
  const packageLines = await db.packageLine.findMany({
    where: { packageId },
    include: {
      orderLine: {
        select: {
          qty: true,
          parentLineId: true,
          product: { select: { lengthMm: true, widthMm: true, heightMm: true, weightGrams: true } },
        },
      },
    },
  });
  if (packageLines.length === 0) {
    throw new NotFoundError("Package contents", packageId);
  }
  return planParcelsForLines(
    db,
    packageLines.map((line) => ({
      qty: line.qty,
      parentLineId: line.orderLine.parentLineId,
      product: line.orderLine.product,
    })),
  );
}
