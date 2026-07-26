import type { FulfillmentKind } from '@prisma/client';

import { normalizeName } from '../core/normalize';

/**
 * What a "filing group" is (UR-005, and open question 2 in the merged plan).
 *
 * It is the pile a printed slip gets filed into, so it has to match how the
 * boxes are actually worked: everything in one group leaves the building the
 * same way, on the same day, from the same place. Two people can then print,
 * file and pack two groups at once without touching each other's paper.
 *
 * - Pickup boxes group by pickup counter — that is the shelf they wait on.
 * - Delivery boxes group by method and by the day the recipient chose, because
 *   Tuesday's run and Wednesday's run are two separate drives (UR-009).
 * - Shipping boxes are one group per method: the carrier collects them together.
 *
 * Boxes inside a group are filed by the recipient's last name. Staff looking for
 * one box are looking for a person, not an order number, which is why the order
 * number is only the tiebreak.
 */
export type FilingSubject = {
  methodCode: string;
  methodLabel: string;
  methodKind: FulfillmentKind;
  methodSortOrder: number;
  pickupLocationId: string | null;
  pickupLocationName: string | null;
  deliveryDay: string | null;
  recipientName: string;
  orderNumber: number | null;
  draftReference: string;
};

export type FilingGroup = { filingKey: string; label: string; methodSortOrder: number };

const UNSCHEDULED = 'unscheduled';

export function filingGroupOf(subject: FilingSubject): FilingGroup {
  const bucket = filingBucket(subject);

  return {
    filingKey: bucket === null ? subject.methodCode : `${subject.methodCode}:${bucket.key}`,
    label: bucket === null ? subject.methodLabel : `${subject.methodLabel} — ${bucket.label}`,
    methodSortOrder: subject.methodSortOrder,
  };
}

function filingBucket(subject: FilingSubject): { key: string; label: string } | null {
  if (subject.methodKind === 'PICKUP') {
    return {
      key: subject.pickupLocationId ?? UNSCHEDULED,
      label: subject.pickupLocationName ?? 'no counter chosen',
    };
  }

  if (subject.methodKind === 'DELIVERY') {
    return {
      key: subject.deliveryDay ?? UNSCHEDULED,
      label: subject.deliveryDay ?? 'no day chosen',
    };
  }

  return null;
}

/**
 * Filing order inside a group. Padded rather than compared numerically because
 * it is stored as text on the batch row: the pile has to come out of a reprint
 * in the same order it went into the drawer.
 */
export function filingSortKey(subject: FilingSubject): string {
  const normalized = normalizeName(subject.recipientName);
  const words = normalized.split(' ').filter(Boolean);
  const lastName = words.at(-1) ?? normalized;
  const number = subject.orderNumber === null ? subject.draftReference : String(subject.orderNumber);

  return `${lastName}|${normalized}|${number.padStart(10, '0')}`;
}

/**
 * Sorts the groups the way the printer should hand them over: methods in the
 * order the office arranged them, then the buckets inside a method by label, so
 * Tuesday comes before Wednesday whichever order the boxes were read in.
 */
export function orderFilingGroups(groups: FilingGroup[]): FilingGroup[] {
  return [...groups].sort(
    (left, right) =>
      left.methodSortOrder - right.methodSortOrder || left.label.localeCompare(right.label),
  );
}
