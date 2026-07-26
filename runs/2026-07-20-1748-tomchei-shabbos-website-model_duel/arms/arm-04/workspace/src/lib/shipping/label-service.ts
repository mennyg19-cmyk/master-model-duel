import 'server-only';

import type { Prisma, ShipmentBox } from '@prisma/client';

import { recordAudit, type AuditActor } from '../audit';
import type { DbClient } from '../core/db-client';
import { failure, ok, type Result } from '../core/result';
import { boardScopeWhere } from '../fulfillment/channel-summary';
import { abort, runInTransaction } from '../transaction';
import { ACTIVE_LABEL_STATUSES, isActiveLabel, isLabelVoidable } from './label-status';
import { allocateCustomerPrice } from './margin';
import { getShippingProvider, type ShippingProvider } from './provider';
import { quoteShippingBoxes, recordQuote, type ShipmentQuote } from './quote-service';

/**
 * Buying and cancelling carriage for one box (R-055, R-173, R-175).
 *
 * Buying a label spends the org's money at a carrier, so it is the one action
 * here that cannot simply be retried. Three rules keep it safe:
 *
 * 1. The box is claimed as PENDING in this database *before* the carrier is
 *    called, so two people pressing Buy cannot both buy.
 * 2. If the carrier issues a label and this database then fails, the label is
 *    cancelled at the carrier before the error is raised — nobody is charged for
 *    a label no row knows about.
 * 3. A carrier refusal leaves a FAILED row with what it said, which is the only
 *    record of the attempt anybody could act on.
 */
export const NOT_SHIPPABLE = 'package_not_shippable';
export const LABEL_ALREADY_BOUGHT = 'label_already_bought';
export const NO_LABEL = 'no_label_to_void';
export const LABEL_SETTLED = 'label_settled';
export const CARRIER_REFUSED = 'carrier_refused';

/**
 * How much of a carrier's refusal is kept on the box. It is free text from
 * outside, it is shown to staff, and the useful part is always the first
 * sentence — a carrier that answers with a page of XML must not become a row
 * nobody can read past.
 */
const MAX_CARRIER_MESSAGE_LENGTH = 500;

export type LabelPurchase = {
  packageId: string;
  carrier: string;
  serviceLabel: string;
  parcelCount: number;
  carrierCostCents: number;
  customerPriceCents: number;
  marginCents: number;
  trackingNumbers: string[];
};

const SHIPPABLE_PACKAGE_INCLUDE = {
  fulfillmentMethod: { select: { kind: true } },
  lines: { select: { productId: true, quantity: true } },
  shipmentBoxes: true,
} satisfies Prisma.PackageInclude;

type ShippablePackage = Prisma.PackageGetPayload<{ include: typeof SHIPPABLE_PACKAGE_INCLUDE }>;

export async function buyLabelForPackage(
  client: DbClient,
  actor: AuditActor,
  input: { packageId: string; seasonId: string },
): Promise<Result<LabelPurchase>> {
  const box = await readShippable(client, input);
  if (!box.ok) return box;

  const quote = await quoteFor(client, box.value);
  if (!quote.ok) return quote;

  const plan = quote.value;
  const purchase = plan.purchase;

  // Rate ids belong to the parcels they were quoted for, so a plan that lost one
  // between the quote and the claim cannot be bought against.
  if (purchase === null || purchase.rateIds.length !== plan.parcels.length) {
    return failure(
      CARRIER_REFUSED,
      'No carrier priced every parcel of this box, so no label can be bought yet.',
    );
  }

  const claimed = await claimParcels(input, plan);
  if (!claimed.ok) return claimed;

  const { rows, customerPriceCents } = claimed.value;
  const provider = getShippingProvider();
  const bought: { row: ShipmentBox; transactionId: string }[] = [];

  for (const [index, row] of rows.entries()) {
    try {
      const label = await provider.buyLabel(purchase.rateIds[index]);
      bought.push({ row, transactionId: label.transactionId });

      await client.shipmentBox.update({
        where: { id: row.id },
        data: {
          status: 'PURCHASED',
          providerTransactionId: label.transactionId,
          trackingNumber: label.trackingNumber,
          labelUrl: label.labelUrl,
          purchasedAt: new Date(),
        },
      });
    } catch (error) {
      // Everything already bought for this box goes back to the carrier —
      // including the label from this very attempt, which is in `bought` before
      // its row is written precisely so that a database failure after a
      // successful purchase is cleaned up too (R-175).
      await compensate(client, provider, bought, input.packageId);
      const said = error instanceof Error ? error.message : 'no reason was given';

      await client.shipmentBox.updateMany({
        where: { id: { in: rows.map((candidate) => candidate.id) }, status: 'PENDING' },
        data: { status: 'FAILED', failureMessage: said.slice(0, MAX_CARRIER_MESSAGE_LENGTH) },
      });

      await recordAudit(
        actor,
        {
          action: 'shipping.label_failed',
          entityType: 'Package',
          entityId: input.packageId,
          detail: { carrier: purchase.carrier, parcelCount: rows.length },
        },
        client,
      );

      return failure(
        CARRIER_REFUSED,
        `This box could not be labelled with ${purchase.carrier}. The reason is on the box and nothing was left bought at the carrier.`,
      );
    }
  }

  const totals = {
    carrierCostCents: purchase.costCents,
    customerPriceCents,
    marginCents: customerPriceCents - purchase.costCents,
  };

  await recordAudit(
    actor,
    {
      action: 'shipping.label_purchased',
      entityType: 'Package',
      entityId: input.packageId,
      detail: { carrier: purchase.carrier, serviceCode: purchase.serviceCode, parcelCount: rows.length, ...totals },
    },
    client,
  );

  const purchased = await client.shipmentBox.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    orderBy: { parcelIndex: 'asc' },
  });

  return ok({
    packageId: input.packageId,
    carrier: purchase.carrier,
    serviceLabel: purchase.serviceLabel,
    parcelCount: rows.length,
    ...totals,
    trackingNumbers: purchased.map((row) => row.trackingNumber ?? ''),
  });
}

/**
 * Cancels the carriage on a box that has not gone out yet (R-055, UR-004).
 *
 * This is also the hook P9 calls when a manager reroutes a shipping box onto a
 * volunteer's van: the printed label has to die before the box is put on a
 * route, and it is only ever printed paper until somebody marks the box sent.
 */
export async function voidLabelForPackage(
  client: DbClient,
  actor: AuditActor,
  input: { packageId: string; seasonId: string; reason: string },
): Promise<Result<{ parcelCount: number; carrier: string; confirmed: boolean; note: string }>> {
  const box = await client.package.findFirst({
    where: { id: input.packageId, ...boardScopeWhere(input.seasonId) },
    include: { shipmentBoxes: { where: { status: 'PURCHASED' }, orderBy: { parcelIndex: 'asc' } } },
  });

  if (!box) {
    return failure(NOT_SHIPPABLE, 'That package is not on the packing board for this season.');
  }

  if (box.shipmentBoxes.length === 0) {
    return failure(NO_LABEL, 'There is no live label on this box to cancel.');
  }

  if (!isLabelVoidable(box.stage)) {
    return failure(
      LABEL_SETTLED,
      'This box has already gone out, so its label cannot be cancelled. Only a box still on the table can be.',
    );
  }

  const provider = getShippingProvider();
  const outcomes: string[] = [];
  let confirmed = true;

  for (const parcel of box.shipmentBoxes) {
    if (!parcel.providerTransactionId) continue;

    const outcome = await provider.voidLabel(parcel.providerTransactionId);
    confirmed = confirmed && outcome.confirmed;
    outcomes.push(outcome.note);

    await client.shipmentBox.update({
      where: { id: parcel.id },
      data: {
        status: outcome.confirmed ? 'VOIDED' : 'VOID_PENDING',
        voidedAt: new Date(),
        voidReason: input.reason,
        // The PDF behind this URL is a bearer token that the carrier does not
        // rotate on a refund, so the row stops handing it out. What the label
        // was is still on the row: carrier, service, tracking number.
        labelUrl: null,
      },
    });
  }

  const carrier = box.shipmentBoxes[0].carrier ?? 'the carrier';

  await recordAudit(
    actor,
    {
      action: 'shipping.label_voided',
      entityType: 'Package',
      entityId: input.packageId,
      detail: {
        carrier,
        parcelCount: box.shipmentBoxes.length,
        reason: input.reason,
        confirmed,
      },
    },
    client,
  );

  return ok({
    parcelCount: box.shipmentBoxes.length,
    carrier,
    confirmed,
    note: [...new Set(outcomes)].join(' '),
  });
}

/** Asks the carrier where the box is and writes down the answer (R-176). */
export async function refreshTrackingForPackage(
  client: DbClient,
  actor: AuditActor,
  input: { packageId: string; seasonId: string },
): Promise<Result<{ parcelCount: number; status: string }>> {
  const box = await client.package.findFirst({
    where: { id: input.packageId, ...boardScopeWhere(input.seasonId) },
    include: {
      shipmentBoxes: {
        where: { status: 'PURCHASED', trackingNumber: { not: null } },
        orderBy: { parcelIndex: 'asc' },
      },
    },
  });

  if (!box) {
    return failure(NOT_SHIPPABLE, 'That package is not on the packing board for this season.');
  }

  if (box.shipmentBoxes.length === 0) {
    return failure(NO_LABEL, 'This box has no tracking number yet, so there is nothing to ask about.');
  }

  const provider = getShippingProvider();
  const statuses: string[] = [];

  for (const parcel of box.shipmentBoxes) {
    const update = await provider.track(parcel.carrier ?? '', parcel.trackingNumber ?? '');
    statuses.push(update.status);

    await client.shipmentBox.update({
      where: { id: parcel.id },
      data: {
        trackingStatus: update.note ? `${update.status} — ${update.note}` : update.status,
        trackingCheckedAt: new Date(),
      },
    });
  }

  const status = [...new Set(statuses)].join(', ');

  await recordAudit(
    actor,
    {
      action: 'shipping.tracking_refreshed',
      entityType: 'Package',
      entityId: input.packageId,
      detail: { status, parcelCount: box.shipmentBoxes.length },
    },
    client,
  );

  return ok({ parcelCount: box.shipmentBoxes.length, status });
}

async function readShippable(
  client: DbClient,
  input: { packageId: string; seasonId: string },
): Promise<Result<ShippablePackage>> {
  const box = await client.package.findFirst({
    where: { id: input.packageId, ...boardScopeWhere(input.seasonId) },
    include: SHIPPABLE_PACKAGE_INCLUDE,
  });

  if (!box) {
    return failure(NOT_SHIPPABLE, 'That package is not on the packing board for this season.');
  }

  if (box.fulfillmentMethod.kind !== 'SHIPPING') {
    return failure(NOT_SHIPPABLE, 'This box is not going by carrier, so it needs no label.');
  }

  if (box.stage === 'SENT' || box.stage === 'PICKED_UP') {
    return failure(NOT_SHIPPABLE, 'This box has already left, so a new label would be for nothing.');
  }

  if (box.shipmentBoxes.some((parcel) => isActiveLabel(parcel.status))) {
    return failure(
      LABEL_ALREADY_BOUGHT,
      'This box already has a label. Cancel that one before buying another.',
    );
  }

  return ok(box);
}

async function quoteFor(client: DbClient, box: ShippablePackage): Promise<Result<ShipmentQuote>> {
  const quotes = await quoteShippingBoxes(client, [
    { key: box.id, destination: box, lines: box.lines },
  ]);

  const quote = quotes.get(box.id);

  if (!quote || quote.source === 'FALLBACK') {
    return failure(
      CARRIER_REFUSED,
      `No live carrier rate for this box: ${quote?.explanation ?? 'shipping is not configured.'}`,
    );
  }

  return ok(quote);
}

/**
 * Writes the PENDING rows and the quote they came from in one transaction, and
 * re-checks inside it that nobody else claimed the box first.
 *
 * What the customer pays is `fulfillmentFeeCents`, frozen on the package at
 * checkout (G-028) — never the fresh quote this buy was planned from. The two
 * agree while a rate table sits still, and the day one moves between checkout
 * and Buy, the recorded margin has to be the spread the organization actually
 * kept: money it was paid, less money it spent. The fee is read inside this
 * transaction, so it is the same number the rows are written against.
 */
async function claimParcels(
  input: { packageId: string; seasonId: string },
  quote: ShipmentQuote,
): Promise<Result<{ rows: ShipmentBox[]; customerPriceCents: number }>> {
  const purchase = quote.purchase;
  if (!purchase) return failure(CARRIER_REFUSED, 'No carrier could ship this box.');

  return runInTransaction(async (tx) => {
    const box = await tx.package.findFirst({
      where: { id: input.packageId, ...boardScopeWhere(input.seasonId) },
      include: { shipmentBoxes: { where: { status: { in: ACTIVE_LABEL_STATUSES } } } },
    });

    if (!box) abort(failure(NOT_SHIPPABLE, 'That package is no longer on the packing board.'));

    if (box.shipmentBoxes.length > 0) {
      abort(
        failure(
          LABEL_ALREADY_BOUGHT,
          'Somebody else bought a label for this box while you were looking at it.',
        ),
      );
    }

    const customerPriceCents = box.fulfillmentFeeCents;
    const shares = allocateCustomerPrice(customerPriceCents, quote.parcels.length);

    // The carrier cost split the same way, so each row's margin is its own two
    // numbers and the rows still add up to what the carrier charged.
    const parcelCosts = allocateCustomerPrice(purchase.costCents, quote.parcels.length);

    const rows = await Promise.all(
      quote.parcels.map((parcel, index) =>
        tx.shipmentBox.create({
          data: {
            packageId: box.id,
            packageTypeId: parcel.boxType.id,
            parcelIndex: index,
            weightGrams: parcel.weightGrams,
            carrier: purchase.carrier,
            serviceCode: purchase.serviceCode,
            serviceLabel: purchase.serviceLabel,
            providerRateId: purchase.rateIds[index],
            carrierCostCents: parcelCosts[index],
            customerPriceCents: shares[index],
            marginCents: shares[index] - parcelCosts[index],
          },
        }),
      ),
    );

    await recordQuote(tx, {
      orderId: box.orderId,
      packageId: box.id,
      quote: { ...quote, customerPriceCents },
    });

    return { rows, customerPriceCents };
  });
}

async function compensate(
  client: DbClient,
  provider: ShippingProvider,
  bought: { row: ShipmentBox; transactionId: string }[],
  packageId: string,
): Promise<void> {
  for (const label of bought) {
    try {
      await provider.voidLabel(label.transactionId);
      await client.shipmentBox.update({
        where: { id: label.row.id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidReason: 'Cancelled automatically: a later parcel of the same box could not be labelled.',
          labelUrl: null,
        },
      });
    } catch (error) {
      // Nothing else can be done here, and the failure must not hide the one
      // that started the compensation. The row keeps its transaction id, which
      // is what an operator needs to cancel it by hand.
      console.error(
        `Could not cancel label ${label.transactionId} while compensating package ${packageId}`,
        error,
      );
    }
  }
}
