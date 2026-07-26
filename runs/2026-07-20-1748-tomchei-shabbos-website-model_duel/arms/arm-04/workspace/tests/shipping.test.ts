import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import type { Package, Product, Season } from '@prisma/client';

import { finalizeOrder } from '../src/lib/orders/order-service';
import { writeSetting } from '../src/lib/settings';
import { validatePackageAddress } from '../src/lib/shipping/address-check';
import { planParcels, type BoxType } from '../src/lib/shipping/bin-packing';
import { readCarriageCard } from '../src/lib/shipping/carriage-view';
import {
  buyLabelForPackage,
  CARRIER_REFUSED,
  LABEL_ALREADY_BOUGHT,
  LABEL_SETTLED,
  NO_LABEL,
  refreshTrackingForPackage,
  voidLabelForPackage,
} from '../src/lib/shipping/label-service';
import { allocateCustomerPrice, combineParcelRates, planMargin } from '../src/lib/shipping/margin';
import type { CarrierRate } from '../src/lib/shipping/provider';
import {
  createCustomer,
  createDraftOrder,
  createFulfillmentMethod,
  createProduct,
  createSeason,
  createStaffContext,
  db,
} from './fixtures';

after(() => db.$disconnect());

/**
 * Carriage (UR-003, R-055, R-081, R-173, R-176, R-177).
 *
 * The provider is the offline stand-in, which is the same code path as Shippo
 * with imaginary carriers behind it: rate shopping, the margin engine, the
 * two-step label claim and voiding are all exercised for real. What it prices is
 * a function of the destination and the weight, so the numbers below are
 * checked as relationships — cheapest, highest, the difference — rather than as
 * literals nobody could maintain.
 */
const SMALL_BOX: BoxType = {
  id: 'small',
  name: 'Small box',
  lengthMm: 320,
  widthMm: 240,
  heightMm: 140,
  maxWeightGrams: 5000,
};

const LARGE_BOX: BoxType = {
  id: 'large',
  name: 'Large box',
  lengthMm: 460,
  widthMm: 360,
  heightMm: 260,
  maxWeightGrams: 15000,
};

const ORIGIN = {
  name: 'Shipping room',
  line1: '1 Clifton Avenue',
  line2: '',
  city: 'Lakewood',
  state: 'NJ',
  postalCode: '08701',
  phone: '732-555-0100',
};

test('a box goes in the smallest carton it fits, and spills into more when it does not', () => {
  const one = planParcels(
    [{ quantity: 1, lengthMm: 300, widthMm: 220, heightMm: 120, weightGrams: 1400 }],
    [LARGE_BOX, SMALL_BOX],
  );

  assert.equal(one.length, 1);
  assert.equal(one[0].boxType.id, 'small', 'the large carton is not used for one small box');
  assert.equal(one[0].weightGrams, 1400);

  const many = planParcels(
    [{ quantity: 12, lengthMm: 300, widthMm: 220, heightMm: 120, weightGrams: 1400 }],
    [LARGE_BOX, SMALL_BOX],
  );

  assert.ok(many.length > 1, 'twelve boxes do not fit one carton');
  assert.ok(
    many.every((parcel) => parcel.boxType.id === 'large'),
    'the spill goes into the biggest carton stocked',
  );
  assert.equal(
    many.reduce((total, parcel) => total + parcel.unitCount, 0),
    12,
    'every item is planned into some parcel',
  );
  assert.ok(
    many.every((parcel) => parcel.weightGrams <= LARGE_BOX.maxWeightGrams),
    'no carton is planned over its weight limit',
  );

  assert.throws(() => planParcels([{ quantity: 1, lengthMm: null, widthMm: null, heightMm: null, weightGrams: null }], []));
});

test('the customer pays the highest quote and the label is bought on the cheapest', () => {
  const options = combineParcelRates([
    [rate('USPS', 900), rate('FedEx', 1200), rate('UPS', 1100)],
    [rate('USPS', 900), rate('FedEx', 1200)],
  ]);

  const ups = options.find((option) => option.carrier === 'UPS');
  assert.equal(ups?.isEligible, false, 'a carrier that priced one parcel of two cannot ship the box');

  const plan = planMargin(options);
  assert.ok(plan);
  assert.equal(plan.purchase.carrier, 'USPS', 'the cheapest eligible carrier gets the label');
  assert.equal(plan.purchase.costCents, 1800, 'both parcels are paid for');
  assert.equal(plan.customerPriceCents, 2400, 'the customer pays the highest eligible carrier');
  assert.equal(plan.marginCents, 600);
  assert.equal(plan.purchase.rateIds.length, 2, 'one rate id per parcel, in parcel order');

  assert.equal(planMargin([]), null, 'no carrier is a refusal, not a price of zero');
  assert.equal(
    planMargin(options.filter((option) => !option.isEligible)),
    null,
    'and neither is a carrier that cannot take the box',
  );
});

test('money split across parcels still adds up to the cent', () => {
  assert.deepEqual(allocateCustomerPrice(1000, 1), [1000]);
  assert.deepEqual(allocateCustomerPrice(1000, 3), [333, 333, 334]);
  assert.equal(
    allocateCustomerPrice(2401, 7).reduce((total, share) => total + share, 0),
    2401,
  );
});

test('checkout charges the carrier quote, and the quote is filed with the order', async () => {
  const { order, box, season } = await shippedOrder();

  const quote = await db.shippingQuote.findFirstOrThrow({
    where: { orderId: order.id },
    include: { options: { orderBy: { carrierCostCents: 'asc' } } },
  });

  assert.equal(quote.source, 'LIVE');
  assert.equal(quote.packageId, box.id);
  assert.equal(quote.destinationPostalCode, '08701');
  assert.ok(quote.options.length > 1, 'more than one carrier was asked');

  const cheapest = quote.options[0];
  const dearest = quote.options[quote.options.length - 1];

  assert.equal(
    box.fulfillmentFeeCents,
    dearest.carrierCostCents,
    'the customer is charged the highest carrier, not the one the label is bought on',
  );
  assert.equal(quote.customerPriceCents, box.fulfillmentFeeCents);
  assert.equal(cheapest.isSelected, true, 'the cheapest is the one the label goes on');
  assert.ok(cheapest.carrierCostCents < dearest.carrierCostCents, 'the carriers really differ');
  assert.ok(
    quote.options.every((option) => option.providerRateId !== null),
    'every option keeps the rate id a label would be bought against',
  );

  const placed = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(placed.fulfillmentFeeCents, box.fulfillmentFeeCents);

  // The board reads the same numbers back.
  const carriage = await readCarriageCard(db, season.id, box.id);
  assert.equal(carriage?.quote?.customerPriceCents, box.fulfillmentFeeCents);
  assert.equal(carriage?.parcels.length, 0, 'quoting buys nothing');
});

test('an unconfigured origin prices shipping at the flat rate instead of closing the store', async () => {
  await writeSetting('shipping.origin', { ...ORIGIN, line1: '', city: '', state: '', postalCode: '' });
  await writeSetting('shipping.baseRateCents', 1500);

  try {
    const { box } = await shippedOrder({ skipOrigin: true });

    assert.equal(box.fulfillmentFeeCents, 1500, 'the administrator’s rate, not a guess');

    const quote = await db.shippingQuote.findFirst({ where: { packageId: box.id } });
    assert.equal(quote?.source, 'FALLBACK');
    assert.equal(quote?.customerPriceCents, 0, 'nothing was quoted, so no carrier price is claimed');
  } finally {
    await writeSetting('shipping.baseRateCents', 0);
  }
});

test('buying a label spends once, records the spread, and cannot be done twice', async () => {
  const { box, season } = await shippedOrder();
  const staff = await createStaffContext(['fulfillment.manage']);

  const bought = await buyLabelForPackage(db, staff, { packageId: box.id, seasonId: season.id });
  assert.equal(bought.ok, true);
  assert.ok(bought.ok);

  const label = bought.value;
  assert.equal(label.parcelCount, 1);
  assert.equal(label.marginCents, label.customerPriceCents - label.carrierCostCents);
  assert.ok(label.marginCents > 0, 'the spread is what the campaign keeps');
  assert.equal(label.customerPriceCents, box.fulfillmentFeeCents, 'the box was charged what it costs');

  const parcels = await db.shipmentBox.findMany({ where: { packageId: box.id } });
  assert.equal(parcels.length, 1);
  assert.equal(parcels[0].status, 'PURCHASED');
  assert.equal(parcels[0].carrier, label.carrier);
  assert.ok(parcels[0].providerTransactionId, 'the void handle is kept');
  assert.ok(parcels[0].trackingNumber);
  assert.equal(parcels[0].marginCents, label.marginCents);

  const audit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'shipping.label_purchased', entityId: box.id },
  });
  assert.equal(audit.actorStaffUserId, staff.actor.id);
  assert.deepEqual(audit.detail, {
    carrier: label.carrier,
    serviceCode: parcels[0].serviceCode,
    parcelCount: 1,
    carrierCostCents: label.carrierCostCents,
    customerPriceCents: label.customerPriceCents,
    marginCents: label.marginCents,
  });

  const again = await buyLabelForPackage(db, staff, { packageId: box.id, seasonId: season.id });
  assert.equal(again.ok === false && again.code, LABEL_ALREADY_BOUGHT, 'no box is paid for twice');
});

test('the recorded margin is the fee the customer was charged, not a rate that moved since', async () => {
  const { box, season } = await shippedOrder();
  const staff = await createStaffContext(['fulfillment.manage']);

  // A carrier's table moving between checkout and Buy is the whole reason the
  // fee is frozen. Moving the frozen fee instead reproduces the same gap
  // against a stand-in whose prices are deliberately deterministic.
  const chargedCents = box.fulfillmentFeeCents + 500;
  await db.package.update({ where: { id: box.id }, data: { fulfillmentFeeCents: chargedCents } });

  const bought = await buyLabelForPackage(db, staff, { packageId: box.id, seasonId: season.id });
  assert.ok(bought.ok);

  const label = bought.value;
  assert.equal(label.customerPriceCents, chargedCents, 'the customer paid the frozen fee');
  assert.equal(label.marginCents, chargedCents - label.carrierCostCents, 'money in less money out');

  const parcel = await db.shipmentBox.findFirstOrThrow({ where: { packageId: box.id } });
  assert.equal(parcel.customerPriceCents, chargedCents);
  assert.equal(parcel.marginCents, chargedCents - parcel.carrierCostCents!);

  const audit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'shipping.label_purchased', entityId: box.id },
  });
  assert.equal((audit.detail as { customerPriceCents: number }).customerPriceCents, chargedCents);

  // Both quote rows answer "what did the customer pay" with the same number,
  // so the canonical latest row cannot contradict the money.
  const quotes = await db.shippingQuote.findMany({
    where: { packageId: box.id },
    orderBy: { requestedAt: 'asc' },
  });
  assert.equal(quotes.length, 2, 'checkout filed one quote and the buy filed another');
  assert.equal(quotes[1].customerPriceCents, chargedCents);
});

test('tracking is asked for, and a label can be cancelled until the box goes out', async () => {
  const { box, season } = await shippedOrder();
  const staff = await createStaffContext(['fulfillment.manage']);

  const before = await voidLabelForPackage(db, staff, {
    packageId: box.id,
    seasonId: season.id,
    reason: 'nothing to cancel',
  });
  assert.equal(before.ok === false && before.code, NO_LABEL);

  await buyLabelForPackage(db, staff, { packageId: box.id, seasonId: season.id });

  const tracked = await refreshTrackingForPackage(db, staff, { packageId: box.id, seasonId: season.id });
  assert.equal(tracked.ok, true);

  const afterTracking = await db.shipmentBox.findFirstOrThrow({ where: { packageId: box.id } });
  assert.ok(afterTracking.trackingStatus, 'the carrier’s answer is written down');
  assert.ok(afterTracking.trackingCheckedAt);

  // Printed paper is not a shipped box: a reroute may still cancel the label.
  await db.package.update({ where: { id: box.id }, data: { stage: 'PRINTED' } });

  const rerouted = await voidLabelForPackage(db, staff, {
    packageId: box.id,
    seasonId: season.id,
    reason: 'Rerouted onto a volunteer run',
  });

  assert.equal(rerouted.ok, true);
  assert.equal(rerouted.ok && rerouted.value.confirmed, true);

  const cancelled = await db.shipmentBox.findFirstOrThrow({ where: { packageId: box.id } });
  assert.equal(cancelled.status, 'VOIDED');
  assert.equal(cancelled.voidReason, 'Rerouted onto a volunteer run');
  assert.ok(cancelled.voidedAt);

  const audit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'shipping.label_voided', entityId: box.id },
  });
  assert.equal((audit.detail as { reason: string }).reason, 'Rerouted onto a volunteer run');

  // With the label dead the box is free to be labelled again, and once it has
  // gone out nothing may be cancelled.
  const rebought = await buyLabelForPackage(db, staff, { packageId: box.id, seasonId: season.id });
  assert.equal(rebought.ok, true);

  await db.package.update({ where: { id: box.id }, data: { stage: 'SENT' } });

  const gone = await voidLabelForPackage(db, staff, {
    packageId: box.id,
    seasonId: season.id,
    reason: 'too late',
  });
  assert.equal(gone.ok === false && gone.code, LABEL_SETTLED);
});

test('a box with no carrier rate is refused a label rather than sent unlabelled', async () => {
  const { box, season } = await shippedOrder({ skipOrigin: true });
  const staff = await createStaffContext(['fulfillment.manage']);

  const refused = await buyLabelForPackage(db, staff, { packageId: box.id, seasonId: season.id });
  assert.equal(refused.ok === false && refused.code, CARRIER_REFUSED);
  assert.equal(await db.shipmentBox.count({ where: { packageId: box.id } }), 0, 'nothing was claimed');
});

test('the carrier is asked whether the address exists, and the answer is advisory', async () => {
  const { box, season } = await shippedOrder();
  const staff = await createStaffContext(['fulfillment.manage']);

  const good = await validatePackageAddress(db, staff, { packageId: box.id, seasonId: season.id });
  assert.equal(good.ok && good.value.isValid, true);

  await db.package.update({ where: { id: box.id }, data: { addressLine1: 'Forest Avenue' } });

  const doubtful = await validatePackageAddress(db, staff, { packageId: box.id, seasonId: season.id });
  assert.equal(doubtful.ok && doubtful.value.isValid, false, 'a street with no number is not matched');

  const checked = await db.package.findUniqueOrThrow({ where: { id: box.id } });
  assert.equal(checked.addressIsValid, false);
  assert.ok(checked.addressValidationNote);
  assert.ok(checked.addressValidatedAt);

  const bought = await buyLabelForPackage(db, staff, { packageId: box.id, seasonId: season.id });
  assert.equal(bought.ok, true, 'a doubtful address does not block the label — the carrier is often wrong');
});

function rate(carrier: string, amountCents: number): CarrierRate {
  return {
    rateId: `${carrier}-${amountCents}`,
    carrier,
    serviceCode: `${carrier.toLowerCase()}_ground`,
    serviceLabel: `${carrier} Ground`,
    amountCents,
    transitDays: 3,
  };
}

/** One placed order with exactly one shipping box, quoted against real box types. */
async function shippedOrder(
  options: { skipOrigin?: boolean } = {},
): Promise<{ order: { id: string }; box: Package; season: Season; product: Product }> {
  const season = await createSeason();
  const customer = await createCustomer();
  const product = await measuredProduct(season);
  const method = await createFulfillmentMethod('SHIPPING', 1200);

  await stockBoxTypes();
  await writeSetting(
    'shipping.origin',
    options.skipOrigin ? { ...ORIGIN, line1: '', city: '', state: '', postalCode: '' } : ORIGIN,
  );

  const draft = await createDraftOrder({
    season,
    customer,
    lines: [{ product, fulfillmentMethodId: method.id, recipientName: 'Aaron Zimmer' }],
  });

  const placed = await finalizeOrder(draft.id, null);
  assert.equal(placed.ok, true);

  const box = await db.package.findFirstOrThrow({ where: { orderId: draft.id } });
  return { order: draft, box, season, product };
}

async function measuredProduct(season: Season): Promise<Product> {
  const product = await createProduct(season);

  return db.product.update({
    where: { id: product.id },
    data: { lengthMm: 300, widthMm: 220, heightMm: 120, weightGrams: 1400 },
  });
}

async function stockBoxTypes(): Promise<void> {
  for (const box of [SMALL_BOX, LARGE_BOX]) {
    await db.packageType.upsert({
      where: { name: box.name },
      create: {
        name: box.name,
        lengthMm: box.lengthMm,
        widthMm: box.widthMm,
        heightMm: box.heightMm,
        maxWeightGrams: box.maxWeightGrams,
      },
      update: {},
    });
  }
}