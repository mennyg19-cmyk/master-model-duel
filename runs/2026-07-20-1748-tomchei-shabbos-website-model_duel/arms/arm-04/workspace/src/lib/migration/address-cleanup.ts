import 'server-only';

import type { AddressCleanupKind, Prisma } from '@prisma/client';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { addressProblem } from '../core/addresses';
import { normalizeName } from '../core/normalize';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { runInTransaction } from '../transaction';

/**
 * The address book after a decade of other people's data (UR-014).
 *
 * The import does not stop for a bad address — a box did go to that person, and
 * refusing the row would lose the history the repeat feature runs on. So the
 * mess arrives, and this is the queue that works through it afterwards, at a
 * pace the office chooses.
 *
 * Three findings, and the reason each one is separate:
 *
 * - `UNUSABLE_ADDRESS` — no street, no city, or a state or ZIP that is not one
 *   (`addressProblem`, shared with the import so the two cannot disagree).
 *   Nothing can be done automatically; somebody has to phone the family or
 *   decide the entry stands as the only record there is.
 * - `DUPLICATE_ADDRESS` — one household written twice in one customer's book.
 *   `normalizeAddressKey` already catches the spelling variants, so what is left
 *   here is a *looser* match: same street number and ZIP, different apartment
 *   line. That is often two real doors in one building, which is exactly why it
 *   is a question and not an automatic merge.
 * - `DUPLICATE_CUSTOMER` — the same person under two logins, found by the email
 *   aliases mail providers treat as one address. Two accounts is two "same as
 *   last year" histories, and the family sees only one of them.
 *
 * A rescan never overrules a person. A finding somebody looked at and marked
 * KEPT stays kept; only a MERGED flag whose problem is still visible comes back,
 * because that means the merge did not take.
 */
export const CLEANUP_FLAG_NOT_FOUND = 'cleanup_flag_not_found';
export const CLEANUP_FLAG_SETTLED = 'cleanup_flag_settled';
export const CLEANUP_NOT_MERGEABLE = 'cleanup_not_mergeable';

export type CleanupScanSummary = { flagged: number; reopened: number; cleared: number; openCount: number };

type Finding = {
  fingerprint: string;
  kind: AddressCleanupKind;
  customerId: string;
  addressId: string | null;
  duplicateOfAddressId: string | null;
  duplicateOfCustomerId: string | null;
  note: string;
};

export async function scanAddressBook(staff: StaffContext | null): Promise<CleanupScanSummary> {
  const addresses = await db.customerAddress.findMany({
    where: { isArchived: false },
    select: {
      id: true,
      customerId: true,
      recipientName: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
      addressKey: true,
      needsReview: true,
      reviewNote: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const customers = await db.customer.findMany({
    select: { id: true, email: true, fullName: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const findings = [
    ...unusableAddresses(addresses),
    ...duplicateAddresses(addresses),
    ...duplicateCustomers(customers),
  ];

  const summary = await applyFindings(findings);

  await recordAudit(staff, {
    action: 'cleanup.scanned',
    entityType: 'AddressCleanupFlag',
    entityId: 'scan',
    detail: { flagged: summary.flagged, reopened: summary.reopened },
  });

  return summary;
}

export function readCleanupFlags(status: 'OPEN' | 'ALL' = 'OPEN', take = 200) {
  return db.addressCleanupFlag.findMany({
    where: status === 'OPEN' ? { status: 'OPEN' } : {},
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    take,
  });
}

export function countOpenCleanupFlags(): Promise<number> {
  return db.addressCleanupFlag.count({ where: { status: 'OPEN' } });
}

export async function resolveCleanupFlag(
  staff: StaffContext,
  input: { flagId: string; decision: 'MERGED' | 'KEPT' },
): Promise<Result<{ kind: AddressCleanupKind }>> {
  const flag = await db.addressCleanupFlag.findUnique({ where: { id: input.flagId } });
  if (!flag) return failure(CLEANUP_FLAG_NOT_FOUND, 'That cleanup item is no longer here.');
  if (flag.status !== 'OPEN') return failure(CLEANUP_FLAG_SETTLED, 'Somebody has already decided this one.');

  if (input.decision === 'MERGED' && flag.kind === 'UNUSABLE_ADDRESS') {
    return failure(
      CLEANUP_NOT_MERGEABLE,
      'A broken address has nothing to merge into. Fix it on the customer, or keep it as it stands.',
    );
  }

  const applied = await runInTransaction(async (tx) => {
    if (input.decision === 'MERGED' && flag.kind === 'DUPLICATE_ADDRESS' && flag.addressId) {
      await mergeAddress(tx, flag.addressId, flag.duplicateOfAddressId);
    }

    if (input.decision === 'MERGED' && flag.kind === 'DUPLICATE_CUSTOMER' && flag.duplicateOfCustomerId) {
      await mergeCustomer(tx, flag.customerId, flag.duplicateOfCustomerId);
    }

    // Keeping a flagged address is a decision, so the badge on the customer
    // screen comes off: it has been looked at and it is what it is.
    if (input.decision === 'KEPT' && flag.kind === 'UNUSABLE_ADDRESS' && flag.addressId) {
      await tx.customerAddress.update({
        where: { id: flag.addressId },
        data: { needsReview: false },
      });
    }

    await tx.addressCleanupFlag.update({
      where: { id: flag.id },
      data: {
        status: input.decision,
        resolvedAt: new Date(),
        resolvedByStaffUserId: staff.acting.id,
      },
    });
  });

  if (!applied.ok) return applied;

  await recordAudit(staff, {
    action: 'cleanup.resolved',
    entityType: 'AddressCleanupFlag',
    entityId: flag.id,
    detail: { kind: flag.kind, status: input.decision },
  });

  return ok({ kind: flag.kind });
}

/** The duplicate's history moves to the survivor before the duplicate is filed away. */
async function mergeAddress(
  tx: Prisma.TransactionClient,
  duplicateId: string,
  survivorId: string | null,
): Promise<void> {
  if (survivorId) {
    await tx.orderLine.updateMany({
      where: { customerAddressId: duplicateId },
      data: { customerAddressId: survivorId },
    });
  }

  await tx.customerAddress.update({
    where: { id: duplicateId },
    data: { isArchived: true, needsReview: false },
  });
}

/**
 * The duplicate account's orders and address book move across; the record
 * itself stays. Deleting it would cascade through the addresses that past order
 * lines still point at, and an empty shell of a customer is a much smaller
 * problem than an order whose recipient rows have gone.
 */
async function mergeCustomer(
  tx: Prisma.TransactionClient,
  duplicateId: string,
  survivorId: string,
): Promise<void> {
  await tx.order.updateMany({ where: { customerId: duplicateId }, data: { customerId: survivorId } });

  const [moving, existing] = await Promise.all([
    tx.customerAddress.findMany({
      where: { customerId: duplicateId },
      select: { id: true, addressKey: true },
    }),
    tx.customerAddress.findMany({
      where: { customerId: survivorId },
      select: { addressKey: true },
    }),
  ]);

  const held = new Set(existing.map((address) => address.addressKey));

  for (const address of moving) {
    // The survivor already has this door in their book, so the copy is filed
    // away rather than moved onto a key that is taken.
    await tx.customerAddress.update({
      where: { id: address.id },
      data: held.has(address.addressKey)
        ? { isArchived: true }
        : { customerId: survivorId },
    });
  }
}

type ScannedAddress = {
  id: string;
  customerId: string;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  addressKey: string;
  needsReview: boolean;
  reviewNote: string | null;
};

function unusableAddresses(addresses: ScannedAddress[]): Finding[] {
  return addresses.flatMap((address) => {
    const problem = addressProblem(address) ?? (address.needsReview ? address.reviewNote : null);
    if (problem === null) return [];

    return [
      {
        fingerprint: `UNUSABLE_ADDRESS:${address.id}`,
        kind: 'UNUSABLE_ADDRESS' as const,
        customerId: address.customerId,
        addressId: address.id,
        duplicateOfAddressId: null,
        duplicateOfCustomerId: null,
        note: `${address.recipientName}: ${problem}`,
      },
    ];
  });
}

/**
 * Same street number and ZIP, different book entry. The first one written is
 * the survivor: it is the one older orders already point at.
 */
function duplicateAddresses(addresses: ScannedAddress[]): Finding[] {
  const seen = new Map<string, ScannedAddress>();
  const findings: Finding[] = [];

  for (const address of addresses) {
    const key = `${address.customerId}|${looseAddressKey(address)}`;
    const first = seen.get(key);

    if (!first) {
      seen.set(key, address);
      continue;
    }

    findings.push({
      fingerprint: `DUPLICATE_ADDRESS:${first.id}:${address.id}`,
      kind: 'DUPLICATE_ADDRESS',
      customerId: address.customerId,
      addressId: address.id,
      duplicateOfAddressId: first.id,
      duplicateOfCustomerId: null,
      note: `"${address.recipientName}, ${describe(address)}" looks like "${first.recipientName}, ${describe(first)}".`,
    });
  }

  return findings;
}

function looseAddressKey(address: ScannedAddress): string {
  const streetNumber = /^\s*(\d+)/.exec(address.line1)?.[1] ?? address.line1.trim().toLowerCase();
  return `${streetNumber}|${address.postalCode.trim().slice(0, 5)}`;
}

function describe(address: ScannedAddress): string {
  return [address.line1, address.line2, address.city].filter(Boolean).join(', ');
}

/**
 * `sara.klein+shul@example.com` and `saraklein@example.com` are one mailbox at
 * every provider that offers either convention, and after a legacy import they
 * are routinely two customer records.
 */
function duplicateCustomers(
  customers: { id: string; email: string; fullName: string; createdAt: Date }[],
): Finding[] {
  const seen = new Map<string, { id: string; email: string; fullName: string }>();
  const findings: Finding[] = [];

  for (const customer of customers) {
    const key = canonicalEmail(customer.email);
    const first = seen.get(key);

    if (!first) {
      seen.set(key, customer);
      continue;
    }

    const sameName = normalizeName(first.fullName) === normalizeName(customer.fullName);

    findings.push({
      fingerprint: `DUPLICATE_CUSTOMER:${first.id}:${customer.id}`,
      kind: 'DUPLICATE_CUSTOMER',
      customerId: customer.id,
      addressId: null,
      duplicateOfAddressId: null,
      duplicateOfCustomerId: first.id,
      note: `${customer.email} reaches the same mailbox as ${first.email}${sameName ? '' : ', though the names differ'}.`,
    });
  }

  return findings;
}

function canonicalEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  return `${local.split('+')[0].replaceAll('.', '')}@${domain}`;
}

async function applyFindings(findings: Finding[]): Promise<CleanupScanSummary> {
  const existing = await db.addressCleanupFlag.findMany({
    select: { id: true, fingerprint: true, status: true },
  });
  const byFingerprint = new Map(existing.map((flag) => [flag.fingerprint, flag]));

  let flagged = 0;
  let reopened = 0;

  for (const finding of findings) {
    const previous = byFingerprint.get(finding.fingerprint);

    if (!previous) {
      await db.addressCleanupFlag.create({ data: finding });
      flagged += 1;
      continue;
    }

    // A merge that was recorded but did not remove the problem is worth saying
    // again. "Keep it" is a decision, and a rescan does not argue with it.
    if (previous.status === 'MERGED') {
      await db.addressCleanupFlag.update({
        where: { id: previous.id },
        data: { status: 'OPEN', resolvedAt: null, resolvedByStaffUserId: null, note: finding.note },
      });
      reopened += 1;
    }
  }

  const found = new Set(findings.map((finding) => finding.fingerprint));
  const stale = existing.filter((flag) => flag.status === 'OPEN' && !found.has(flag.fingerprint));

  // An open finding whose problem has gone was fixed on the customer screen
  // rather than from the queue. Leaving it would make the queue a list of
  // things that used to be wrong.
  const cleared = await db.addressCleanupFlag.deleteMany({
    where: { id: { in: stale.map((flag) => flag.id) } },
  });

  return {
    flagged,
    reopened,
    cleared: cleared.count,
    openCount: await countOpenCleanupFlags(),
  };
}
