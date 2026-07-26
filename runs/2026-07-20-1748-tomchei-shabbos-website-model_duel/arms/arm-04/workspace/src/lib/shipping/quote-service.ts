import 'server-only';

import type { Prisma, ShippingQuoteSource } from '@prisma/client';

import type { AddressColumns } from '../addresses/address-mapping';
import type { LiveShippingRate } from '../checkout/fees';
import type { DbClient } from '../core/db-client';
import { DEFAULT_ADDRESS_COUNTRY } from '../core/normalize';
import type { PackageDestination } from '../orders/grouping';
import { readSetting } from '../settings';
import { toShippingAddress } from './address-mapping';
import { planParcels, type BoxType, type PackableItem, type PlannedParcel } from './bin-packing';
import { combineParcelRates, planMargin, type ShippingOption } from './margin';
import { carrierAccounts, CarrierRequestError, getShippingProvider, type ShippingAddress } from './provider';

/**
 * What a box costs to ship, worked out the moment somebody needs the number
 * (R-155, UR-003).
 *
 * Two callers: checkout, which shows the price, and finalize, which charges it.
 * Both go through here so the customer cannot be shown one carrier's rate and
 * billed another's, and finalize re-asks rather than trusting a quote the
 * browser has been sitting on.
 *
 * A carrier outage is not allowed to close the store during Purim week, so
 * anything that goes wrong comes back as a FALLBACK quote and the settings flat
 * rate from P5 prices the box instead. The row says which of the two happened.
 */
const QUOTE_TTL_MS = 30 * 60 * 1000;

export type QuotableLine = { productId: string | null; quantity: number };

export type QuoteSubject = {
  /** The caller's own identifier for the box: a grouping key, or a package id. */
  key: string;
  recipientName: string;
  address: AddressColumns;
  lines: QuotableLine[];
};

export type ShipmentQuote = {
  key: string;
  source: ShippingQuoteSource;
  /** Null on a fallback: nothing was quoted, so the settings rate prices the box. */
  customerPriceCents: number | null;
  options: ShippingOption[];
  purchase: ShippingOption | null;
  parcels: PlannedParcel[];
  destinationPostalCode: string;
  billableWeightGrams: number;
  expiresAt: Date;
  /** Plain English for the checkout line, or the reason there is no live rate. */
  explanation: string;
};

/** A box as both callers hold it: their own key, where it is going, what is in it. */
export type QuotableBox = {
  key: string;
  destination: PackageDestination;
  lines: QuotableLine[];
};

/**
 * Quotes the shipping boxes out of a mixed set. Delivery and pickup boxes are
 * not carrier business and are simply absent from the answer, which is what
 * makes the fee engine fall through to its own rules for them.
 */
export async function quoteShippingBoxes(
  client: DbClient,
  boxes: QuotableBox[],
): Promise<Map<string, ShipmentQuote>> {
  if (boxes.length === 0) return new Map();

  const shippingMethodIds = new Set(
    (
      await client.fulfillmentMethod.findMany({
        where: {
          kind: 'SHIPPING',
          id: { in: [...new Set(boxes.map((box) => box.destination.fulfillmentMethodId))] },
        },
        select: { id: true },
      })
    ).map((method) => method.id),
  );

  return quoteShipments(
    client,
    boxes
      .filter((box) => shippingMethodIds.has(box.destination.fulfillmentMethodId))
      .map((box) => ({
        key: box.key,
        recipientName: box.destination.recipientName,
        address: box.destination,
        lines: box.lines,
      })),
  );
}

/** What the fee engine needs out of a quote: the price, and whose rate it is. */
export function liveRatesFrom(quotes: Map<string, ShipmentQuote>): Map<string, LiveShippingRate> {
  const live = new Map<string, LiveShippingRate>();

  for (const [key, quote] of quotes) {
    if (quote.customerPriceCents === null) continue;
    live.set(key, { customerPriceCents: quote.customerPriceCents, carrierLabel: quote.explanation });
  }

  return live;
}

async function quoteShipments(
  client: DbClient,
  subjects: QuoteSubject[],
): Promise<Map<string, ShipmentQuote>> {
  const quotes = new Map<string, ShipmentQuote>();
  if (subjects.length === 0) return quotes;

  const [origin, boxTypes, items] = await Promise.all([
    readShipFromAddress(),
    readBoxTypes(client),
    readItemDimensions(client, subjects),
  ]);

  for (const subject of subjects) {
    quotes.set(subject.key, await quoteOne(subject, { origin, boxTypes, items }));
  }

  return quotes;
}

type QuoteContext = {
  origin: ShippingAddress | null;
  boxTypes: BoxType[];
  items: Map<string, PackableItem>;
};

async function quoteOne(subject: QuoteSubject, context: QuoteContext): Promise<ShipmentQuote> {
  const { origin } = context;
  const destination = toShippingAddress(subject.address, { name: subject.recipientName });
  const parcels =
    context.boxTypes.length === 0 ? [] : planParcels(itemsOf(subject, context.items), context.boxTypes);

  const shell = {
    key: subject.key,
    parcels,
    destinationPostalCode: subject.address.addressPostalCode ?? '',
    billableWeightGrams: parcels.reduce((total, parcel) => total + parcel.weightGrams, 0),
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
  };

  // Four ways a box cannot be quoted at all, each of which is an answer the
  // office can act on rather than an error the customer would see.
  if (!origin) {
    return { ...shell, ...fallback('No shipping origin is configured in Settings → Shipping.') };
  }
  if (context.boxTypes.length === 0) {
    return { ...shell, ...fallback('No box types are stocked, so nothing can be measured.') };
  }
  if (!destination) return { ...shell, ...fallback('This box has no complete shipping address.') };
  if (parcels.length === 0) return { ...shell, ...fallback('This box has nothing in it to ship.') };

  try {
    const provider = getShippingProvider();
    const accounts = carrierAccounts();

    const parcelRates = await Promise.all(
      parcels.map((parcel) =>
        provider.quote({ from: origin, to: destination, parcel, carrierAccounts: accounts }),
      ),
    );

    const plan = planMargin(combineParcelRates(parcelRates));
    if (!plan) return { ...shell, ...fallback('No carrier would price this box.') };

    return {
      ...shell,
      source: 'LIVE',
      customerPriceCents: plan.customerPriceCents,
      options: plan.options,
      purchase: plan.purchase,
      explanation: `${plan.purchase.serviceLabel} rate`,
    };
  } catch (error) {
    // Logged, not raised: the customer is still buying, and the flat rate is a
    // price an administrator set rather than a guess.
    //
    // Only the shape of the failure goes to the log. A carrier quotes the whole
    // shipment back inside its refusal — recipient name, street, everything —
    // and the server log is read far more widely than the audit trail, which
    // keeps a postal code and no more.
    console.error(`A carrier quote failed (${failureShape(error)}); the settings rate prices this box instead.`);
    return { ...shell, ...fallback('The carrier did not answer.') };
  }
}

/** The carrier's status where there is one, and otherwise the kind of error. */
function failureShape(error: unknown): string {
  if (error instanceof CarrierRequestError) return `carrier returned ${error.status}`;
  return error instanceof Error ? error.name : 'unknown error';
}

function fallback(explanation: string) {
  return {
    source: 'FALLBACK' as const,
    customerPriceCents: null,
    options: [] as ShippingOption[],
    purchase: null,
    explanation,
  };
}

function itemsOf(subject: QuoteSubject, dimensions: Map<string, PackableItem>): PackableItem[] {
  return subject.lines.map((line) => {
    const measured = line.productId === null ? undefined : dimensions.get(line.productId);

    return {
      quantity: line.quantity,
      lengthMm: measured?.lengthMm ?? null,
      widthMm: measured?.widthMm ?? null,
      heightMm: measured?.heightMm ?? null,
      weightGrams: measured?.weightGrams ?? null,
    };
  });
}

/** Null while nobody has told the office where carriers collect from. */
async function readShipFromAddress(): Promise<ShippingAddress | null> {
  const origin = await readSetting('shipping.origin');
  if (!origin.line1 || !origin.city || !origin.state || !origin.postalCode) return null;

  return {
    name: origin.name || 'Shipping department',
    line1: origin.line1,
    line2: origin.line2 || null,
    city: origin.city,
    state: origin.state,
    postalCode: origin.postalCode,
    country: DEFAULT_ADDRESS_COUNTRY,
    phone: origin.phone || null,
  };
}

function readBoxTypes(client: DbClient): Promise<BoxType[]> {
  return client.packageType.findMany({
    where: { isActive: true },
    select: { id: true, name: true, lengthMm: true, widthMm: true, heightMm: true, maxWeightGrams: true },
  });
}

async function readItemDimensions(
  client: DbClient,
  subjects: QuoteSubject[],
): Promise<Map<string, PackableItem>> {
  const productIds = [
    ...new Set(
      subjects.flatMap((subject) =>
        subject.lines.map((line) => line.productId).filter((id): id is string => id !== null),
      ),
    ),
  ];

  if (productIds.length === 0) return new Map();

  const products = await client.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, lengthMm: true, widthMm: true, heightMm: true, weightGrams: true },
  });

  return new Map(
    products.map((product) => [
      product.id,
      {
        quantity: 1,
        lengthMm: product.lengthMm,
        widthMm: product.widthMm,
        heightMm: product.heightMm,
        weightGrams: product.weightGrams,
      },
    ]),
  );
}

/**
 * Writes down what was quoted and what was chosen.
 *
 * The row is the receipt for the fee frozen on the package: reconciliation in
 * P12 reads it, and a customer asking why shipping cost what it did is answered
 * from it rather than from a rate that has since moved.
 *
 * A shipping box gets two of these — one when checkout priced it, one when the
 * label was bought against a fresh quote. **The latest `requestedAt` is the
 * canonical row**, because it is the one whose rates the label was actually
 * bought on. Both carry the same `customerPriceCents`, the fee frozen on the
 * package, since that is what the customer pays whichever rates moved since.
 */
export async function recordQuote(
  client: DbClient,
  input: { orderId: string; packageId?: string | null; groupingKey?: string | null; quote: ShipmentQuote },
): Promise<void> {
  const { quote } = input;

  await client.shippingQuote.create({
    data: {
      orderId: input.orderId,
      packageId: input.packageId ?? null,
      groupingKey: input.groupingKey ?? null,
      source: quote.source,
      destinationPostalCode: quote.destinationPostalCode,
      parcelCount: quote.parcels.length,
      billableWeightGrams: quote.billableWeightGrams,
      customerPriceCents: quote.customerPriceCents ?? 0,
      expiresAt: quote.expiresAt,
      options: { create: quote.options.map((option) => optionRow(option, quote)) },
    },
  });
}

function optionRow(option: ShippingOption, quote: ShipmentQuote): Prisma.ShippingQuoteOptionCreateWithoutQuoteInput {
  return {
    carrier: option.carrier,
    serviceCode: option.serviceCode,
    serviceLabel: option.serviceLabel,
    carrierCostCents: option.costCents,
    // Every eligible option carries the same customer price on purpose: it is
    // what this box costs the customer whichever carrier the label is bought
    // on, which is the whole shape of the margin rule.
    customerPriceCents: quote.customerPriceCents ?? 0,
    transitDays: option.transitDays,
    isSelected: quote.purchase?.serviceCode === option.serviceCode && quote.purchase.carrier === option.carrier,
    isEligible: option.isEligible,
    providerRateId: option.rateIds[0] ?? null,
  };
}