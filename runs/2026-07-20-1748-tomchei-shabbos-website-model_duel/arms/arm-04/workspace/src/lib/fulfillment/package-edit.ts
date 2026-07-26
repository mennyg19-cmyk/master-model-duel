import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Package, Prisma } from '@prisma/client';

import { recordAudit, type AuditActor } from '../audit';
import { failure, STALE_VERSION, type Result } from '../core/result';
import { PACKAGE_DESTINATION_FIELDS } from '../orders/grouping';
import { abort, runInTransaction } from '../transaction';
import { PACKAGE_NOT_FOUND } from './packages';

/**
 * Staff overruling the grouping engine (G-003, G-004).
 *
 * The engine puts lines that share a recipient, address, method and greeting in
 * one box. That is right almost always and wrong when the box will not close, so
 * the packing table can split one box into two and put lines back together
 * again.
 *
 * Two rules hold this together:
 *
 * - **Money does not move.** The fee was frozen at checkout (G-028) and stays on
 *   the box it was charged against; the new box is charged nothing. Splitting a
 *   box is a packing decision, and the customer has already paid for the drive.
 * - **A box that has left cannot be re-packed.** Sent and picked-up boxes are
 *   out of the building; editing their contents would be editing history.
 */
export const SPLIT_NEEDS_LINES = 'split_needs_lines';
export const SPLIT_NEEDS_REMAINDER = 'split_needs_remainder';
export const LINES_NOT_IN_PACKAGE = 'lines_not_in_package';
export const PACKAGES_DIFFER = 'packages_differ';
export const PACKAGE_ALREADY_GONE = 'package_already_gone';

export function splitPackage(
  input: { packageId: string; expectedVersion: number; lineIds: string[] },
  actor: AuditActor,
): Promise<Result<Package>> {
  return runInTransaction(async (tx) => {
    const source = await readEditablePackage(tx, input.packageId);
    const moving = movingLines(source.lines, input.lineIds);

    if (moving.length === source.lines.length) {
      abort(
        failure(
          SPLIT_NEEDS_REMAINDER,
          'Leave at least one item behind, or there is nothing to split from.',
        ),
      );
    }

    await claimPackageVersion(tx, input.packageId, input.expectedVersion);

    const split = await tx.package.create({
      data: {
        orderId: source.orderId,
        // The engine's key describes a destination, and this box has the same
        // one. A suffix keeps the per-order unique index honest and marks the
        // box as one a person made rather than one the grouping rule produced.
        groupingKey: `${source.groupingKey}:split:${randomUUID().slice(0, 8)}`,
        ...destinationFieldsOf(source),
        fulfillmentFeeCents: 0,
      },
    });

    await tx.orderLine.updateMany({
      where: { id: { in: moving.map((line) => line.id) } },
      data: { packageId: split.id },
    });

    await recordAudit(
      actor,
      {
        action: 'package.split',
        entityType: 'Package',
        entityId: split.id,
        detail: { orderId: source.orderId, fromPackageId: source.id, lineCount: moving.length },
      },
      tx,
    );

    return split;
  });
}

/**
 * Puts lines back into another box on the same order (G-003).
 *
 * The target's destination wins: the box goes where the box says it goes, and a
 * line moved into it is in that box now. Only boxes on the same order are
 * offered, because a line belongs to the order that paid for it.
 */
export function movePackageLines(
  input: {
    fromPackageId: string;
    toPackageId: string;
    expectedVersion: number;
    lineIds: string[];
  },
  actor: AuditActor,
): Promise<Result<{ movedCount: number; sourceRemoved: boolean }>> {
  return runInTransaction(async (tx) => {
    if (input.fromPackageId === input.toPackageId) {
      abort(failure(PACKAGES_DIFFER, 'Choose a different box to move these items into.'));
    }

    const source = await readEditablePackage(tx, input.fromPackageId);
    const target = await readEditablePackage(tx, input.toPackageId);

    if (source.orderId !== target.orderId) {
      abort(failure(PACKAGES_DIFFER, 'Items can only move between boxes on the same order.'));
    }

    const moving = movingLines(source.lines, input.lineIds);

    // Both boxes are written here — the target takes the lines and, if the
    // source empties, its fee as well — so both are claimed. The claim on the
    // target is the version it was just read at: a colleague who edited it
    // between that read and this write loses the race and is told, rather than
    // having their edit overwritten. Claiming in id order keeps two staff
    // moving lines in opposite directions from deadlocking on each other.
    const claims = [
      { packageId: input.fromPackageId, expectedVersion: input.expectedVersion },
      { packageId: target.id, expectedVersion: target.version },
    ].sort((left, right) => left.packageId.localeCompare(right.packageId));

    for (const claim of claims) {
      await claimPackageVersion(tx, claim.packageId, claim.expectedVersion);
    }

    await tx.orderLine.updateMany({
      where: { id: { in: moving.map((line) => line.id) } },
      data: { packageId: target.id },
    });

    await recordAudit(
      actor,
      {
        action: 'package.regrouped',
        entityType: 'Package',
        entityId: target.id,
        detail: { orderId: source.orderId, fromPackageId: source.id, lineCount: moving.length },
      },
      tx,
    );

    const sourceRemoved = moving.length === source.lines.length;

    if (sourceRemoved) {
      // An empty box is not a box. Its fee moves onto the box that took the
      // items so the order still adds up to what was charged.
      await tx.package.update({
        where: { id: target.id },
        data: { fulfillmentFeeCents: target.fulfillmentFeeCents + source.fulfillmentFeeCents },
      });
      await tx.package.delete({ where: { id: source.id } });

      await recordAudit(
        actor,
        {
          action: 'package.emptied',
          entityType: 'Package',
          entityId: source.id,
          detail: { orderId: source.orderId, recipientName: source.recipientName },
        },
        tx,
      );
    }

    return { movedCount: moving.length, sourceRemoved };
  });
}

const EDITABLE_INCLUDE = { lines: { select: { id: true } } } satisfies Prisma.PackageInclude;
type EditablePackage = Prisma.PackageGetPayload<{ include: typeof EDITABLE_INCLUDE }>;

async function readEditablePackage(
  tx: Prisma.TransactionClient,
  packageId: string,
): Promise<EditablePackage> {
  const box = await tx.package.findUnique({ where: { id: packageId }, include: EDITABLE_INCLUDE });

  if (!box) abort(failure(PACKAGE_NOT_FOUND, 'That package no longer exists.'));
  if (box.stage === 'SENT' || box.stage === 'PICKED_UP') {
    abort(
      failure(
        PACKAGE_ALREADY_GONE,
        `This box is already ${box.stage === 'SENT' ? 'sent' : 'picked up'}, so its contents cannot change.`,
      ),
    );
  }

  return box;
}

function movingLines(lines: { id: string }[], lineIds: string[]): { id: string }[] {
  const wanted = new Set(lineIds.filter((id) => id.trim() !== ''));
  if (wanted.size === 0) abort(failure(SPLIT_NEEDS_LINES, 'Tick the items you want to move first.'));

  const moving = lines.filter((line) => wanted.has(line.id));
  if (moving.length !== wanted.size) {
    abort(failure(LINES_NOT_IN_PACKAGE, 'Some of those items are no longer in this box. Reload.'));
  }

  return moving;
}

/**
 * The version claim is the lock: it matches only while the box still holds the
 * version the screen was drawn from, so the second person to press the button
 * is told rather than silently overwriting the first.
 */
async function claimPackageVersion(
  tx: Prisma.TransactionClient,
  packageId: string,
  expectedVersion: number,
): Promise<void> {
  const claimed = await tx.package.updateMany({
    where: { id: packageId, version: expectedVersion },
    data: { version: { increment: 1 } },
  });

  if (claimed.count === 0) {
    abort(
      failure(
        STALE_VERSION,
        'Someone else changed this package while you were looking at it. Reload and try again.',
      ),
    );
  }
}

/** Exactly the destination columns, so nothing else on the row rides along. */
function destinationFieldsOf(source: EditablePackage) {
  return Object.fromEntries(
    PACKAGE_DESTINATION_FIELDS.map((field) => [field, source[field]]),
  ) as Pick<Package, (typeof PACKAGE_DESTINATION_FIELDS)[number]>;
}
