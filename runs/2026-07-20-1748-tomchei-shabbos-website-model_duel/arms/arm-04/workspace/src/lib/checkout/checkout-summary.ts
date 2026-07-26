import 'server-only';

import type { FulfillmentKind, Prisma } from '@prisma/client';

import { addressSummary } from '../addresses/address-summary';
import { sumCents } from '../core/money';
import { db } from '../db';
import { findOwnedDraft, type DraftOwner } from '../orders/draft-access';
import {
  groupLinesIntoPackages,
  recipientDestinationKey,
  type PackageGroup,
} from '../orders/grouping';
import { isLineAssigned, lineTotalWithAddOns, type AssignedLine } from '../orders/lines';
import { readRateRules } from '../orders/order-service';
import { readSetting } from '../settings';
import { feeSubjectsFrom } from './fee-subjects';
import { resolveFulfillmentFees } from './fees';
import { findCheckoutConflicts, type CheckoutConflict } from './validation';

/**
 * Everything the checkout screen shows, priced the way the order will be
 * charged (R-037).
 *
 * Boxes are grouped twice on the way here, for two different reasons. Fees are
 * quoted per package, because a second card to the same person is a second box
 * and a carrier charges for it. Questions — the greeting, the delivery day — are
 * asked per recipient, because that is who the customer is thinking about.
 */
export type CheckoutLine = {
  id: string;
  name: string;
  quantity: number;
  totalCents: number;
};

export type CheckoutRecipient = {
  key: string;
  recipientName: string;
  methodLabel: string;
  methodKind: FulfillmentKind;
  addressSummary: string | null;
  pickupLocationName: string | null;
  boxCount: number;
  lines: CheckoutLine[];
  itemsCents: number;
  feeCents: number;
  feeExplanation: string;
  /** Null when the boxes for this recipient currently carry different cards. */
  greetingMessage: string | null;
  hasMixedGreetings: boolean;
  deliveryDay: string | null;
  needsDeliveryDay: boolean;
  /** What this recipient's card said last season, offered as the default (G-020). */
  suggestedGreeting: string | null;
};

export type CheckoutSummary = {
  orderId: string;
  draftReference: string;
  isGuest: boolean;
  defaultGreeting: string | null;
  recipients: CheckoutRecipient[];
  itemsCents: number;
  donationCents: number;
  fulfillmentFeeCents: number;
  totalCents: number;
  conflicts: CheckoutConflict[];
  deliveryDayChoices: string[];
  unassignedCount: number;
  missingDeliveryDayCount: number;
  isPayable: boolean;
};

const CHECKOUT_LINE_INCLUDE = {
  product: { select: { kind: true } },
  fulfillmentMethod: { select: { label: true, kind: true } },
  pickupLocation: { select: { name: true } },
  customerAddress: { select: { lastGreeting: true } },
  addOns: true,
} satisfies Prisma.OrderLineInclude;

type CheckoutLineRow = Prisma.OrderLineGetPayload<{ include: typeof CHECKOUT_LINE_INCLUDE }>;
type AssignedLineRow = AssignedLine<CheckoutLineRow>;

export async function readCheckoutSummary(
  owner: DraftOwner,
  seasonId: string,
): Promise<CheckoutSummary | null> {
  const draft = await findOwnedDraft(owner, seasonId);
  if (!draft) return null;

  const [rows, deliveryDayChoices, rules, conflicts] = await Promise.all([
    db.orderLine.findMany({
      where: { orderId: draft.id },
      include: CHECKOUT_LINE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    }),
    readSetting('delivery.dayChoices'),
    readRateRules(),
    findCheckoutConflicts(draft.id),
  ]);

  const assigned = rows.filter(isLineAssigned);
  const itemsCents = sumCents(assigned.map(lineTotalWithAddOns));

  const packages = groupLinesIntoPackages(assigned);
  const subjects = await feeSubjectsFrom(
    db,
    packages.map((group) => ({ key: group.groupingKey, destination: group.destination })),
  );
  const fees = resolveFulfillmentFees(subjects, rules, itemsCents);
  const feeByPackage = new Map(fees.lines.map((line) => [line.key, line]));

  const recipients = buildRecipients(packages, feeByPackage, deliveryDayChoices);
  const missingDeliveryDayCount = recipients.filter(
    (recipient) => recipient.needsDeliveryDay && recipient.deliveryDay === null,
  ).length;

  return {
    orderId: draft.id,
    draftReference: draft.draftReference,
    isGuest: draft.customerId === null,
    defaultGreeting: draft.defaultGreeting,
    recipients,
    itemsCents,
    donationCents: sumCents(
      assigned.filter((line) => line.product.kind === 'SPONSORSHIP').map(lineTotalWithAddOns),
    ),
    fulfillmentFeeCents: fees.totalCents,
    totalCents: itemsCents + fees.totalCents,
    conflicts,
    deliveryDayChoices,
    unassignedCount: rows.length - assigned.length,
    missingDeliveryDayCount,
    isPayable:
      assigned.length > 0 &&
      rows.length === assigned.length &&
      conflicts.length === 0 &&
      missingDeliveryDayCount === 0,
  };
}

type CheckoutPackage = PackageGroup<AssignedLineRow>;

function buildRecipients(
  packages: CheckoutPackage[],
  feeByPackage: Map<string, { feeCents: number; explanation: string }>,
  deliveryDayChoices: string[],
): CheckoutRecipient[] {
  const recipients = new Map<string, CheckoutRecipient>();

  for (const group of packages) {
    const first = group.lines[0];
    const fee = feeByPackage.get(group.groupingKey);
    const key = recipientDestinationKey(group.destination);
    const existing = recipients.get(key);

    if (existing) {
      mergePackageIntoRecipient(existing, group, fee?.feeCents ?? 0);
      continue;
    }

    recipients.set(key, {
      key,
      recipientName: first.recipientName,
      methodLabel: first.fulfillmentMethod?.label ?? 'Fulfillment',
      methodKind: first.fulfillmentMethod?.kind ?? 'PICKUP',
      addressSummary: summarizeAddress(first),
      pickupLocationName: first.pickupLocation?.name ?? null,
      boxCount: 1,
      lines: group.lines.map(toCheckoutLine),
      itemsCents: sumCents(group.lines.map(lineTotalWithAddOns)),
      feeCents: fee?.feeCents ?? 0,
      feeExplanation: fee?.explanation ?? '',
      greetingMessage: first.greetingMessage,
      hasMixedGreetings: false,
      deliveryDay: first.deliveryDay,
      needsDeliveryDay:
        first.fulfillmentMethod?.kind === 'DELIVERY' && deliveryDayChoices.length > 0,
      suggestedGreeting: first.customerAddress?.lastGreeting ?? null,
    });
  }

  return [...recipients.values()];
}

function mergePackageIntoRecipient(
  recipient: CheckoutRecipient,
  group: CheckoutPackage,
  feeCents: number,
): void {
  recipient.boxCount += 1;
  recipient.lines.push(...group.lines.map(toCheckoutLine));
  recipient.itemsCents += sumCents(group.lines.map(lineTotalWithAddOns));
  recipient.feeCents += feeCents;

  const greeting = group.lines[0].greetingMessage;
  if (greeting !== recipient.greetingMessage) {
    recipient.hasMixedGreetings = true;
    recipient.greetingMessage = null;
  }

  if (group.lines[0].deliveryDay !== recipient.deliveryDay) recipient.deliveryDay = null;
}

function toCheckoutLine(line: AssignedLineRow): CheckoutLine {
  return {
    id: line.id,
    name: line.productNameSnapshot,
    quantity: line.quantity,
    totalCents: lineTotalWithAddOns(line),
  };
}

function summarizeAddress(line: CheckoutLineRow): string | null {
  if (line.addressLine1 === null) return null;

  return addressSummary({
    line1: line.addressLine1,
    line2: line.addressLine2,
    city: line.addressCity ?? '',
    state: line.addressState ?? '',
    postalCode: line.addressPostalCode ?? '',
  });
}
