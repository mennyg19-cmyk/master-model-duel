import type { FeeBasis, FulfillmentKind } from '@prisma/client';

import { sumCents } from '../core/money';

/**
 * What each package costs to get where it is going (UR-009, R-032).
 *
 * Pure on purpose: checkout quotes with it before anything is charged, and
 * finalize charges with it again inside the transaction that creates the
 * packages. Two callers, one rule — a quote the customer accepted cannot differ
 * from the amount the order is built with.
 *
 * Carrier rates are asked for outside this function and handed in by key
 * (`liveShipping`), so the rule stays pure and testable while the price on a
 * shipping box is a real quote. A box with no live rate — no carrier answered,
 * or shipping is not configured — falls back to the settings rate.
 */
export type FeeMethod = {
  id: string;
  label: string;
  kind: FulfillmentKind;
  feeBasis: FeeBasis;
  baseFeeCents: number;
};

export type FeeSubject = {
  /** Whatever the caller uses to identify one package; echoed back on the fee. */
  key: string;
  method: FeeMethod;
  /** The address, or the pickup counter. Bulk delivery bills once per one of these. */
  destinationKey: string;
};

export type RateRules = {
  shippingBaseRateCents: number;
  /** Zero means the org is not running a free-shipping offer. */
  freeShippingThresholdCents: number;
};

export type FeeLine = { key: string; feeCents: number; explanation: string };
export type FeeBreakdown = { lines: FeeLine[]; totalCents: number };

/** What the margin engine decided this box costs the customer, and on whose rate. */
export type LiveShippingRate = { customerPriceCents: number; carrierLabel: string };

export function resolveFulfillmentFees(
  subjects: FeeSubject[],
  rules: RateRules,
  subtotalCents: number,
  liveShipping: Map<string, LiveShippingRate> = new Map(),
): FeeBreakdown {
  const billedDestinations = new Set<string>();

  const lines = subjects.map((subject) => ({
    key: subject.key,
    ...feeFor(subject, rules, subtotalCents, billedDestinations, liveShipping.get(subject.key)),
  }));

  return { lines, totalCents: sumCents(lines.map((line) => line.feeCents)) };
}

function feeFor(
  subject: FeeSubject,
  rules: RateRules,
  subtotalCents: number,
  billedDestinations: Set<string>,
  live: LiveShippingRate | undefined,
): { feeCents: number; explanation: string } {
  const { method } = subject;

  if (method.feeBasis === 'NONE') {
    return { feeCents: 0, explanation: `${method.label} — no charge` };
  }

  if (method.feeBasis === 'PER_DESTINATION') {
    // One drive, one fee, however many boxes come off the van at that door.
    const stop = `${method.id}:${subject.destinationKey}`;
    if (billedDestinations.has(stop)) {
      return { feeCents: 0, explanation: `${method.label} — already billed for this destination` };
    }

    billedDestinations.add(stop);
    return { feeCents: method.baseFeeCents, explanation: `${method.label} — one fee per destination` };
  }

  if (method.kind === 'SHIPPING') return shippingFee(method, rules, subtotalCents, live);

  return { feeCents: method.baseFeeCents, explanation: `${method.label} — one fee per recipient` };
}

/**
 * A carrier quote when there is one, the administrator's flat rate when there
 * is not (UR-003, G-006).
 *
 * The free-shipping offer is checked first either way: it is the org's own
 * promise to the customer, and a carrier price cannot override it.
 */
function shippingFee(
  method: FeeMethod,
  rules: RateRules,
  subtotalCents: number,
  live: LiveShippingRate | undefined,
): { feeCents: number; explanation: string } {
  if (rules.freeShippingThresholdCents > 0 && subtotalCents >= rules.freeShippingThresholdCents) {
    return { feeCents: 0, explanation: `${method.label} — free over the order threshold` };
  }

  if (live) {
    return { feeCents: live.customerPriceCents, explanation: `${method.label} — ${live.carrierLabel}` };
  }

  const rate = rules.shippingBaseRateCents > 0 ? rules.shippingBaseRateCents : method.baseFeeCents;
  return { feeCents: rate, explanation: `${method.label} — flat rate per package` };
}
