import 'server-only';

import type {
  ImportKind,
  OrderStatus,
  PackageStage,
  PaymentMethod,
  PermissionEffect,
  StaffRole,
} from '@prisma/client';

import { db } from './db';
import type { DbClient } from './core/db-client';
import type { Permission } from './auth/permissions';
import type { StaffContext } from './auth/staff';

/**
 * The audit trail is read by staff and kept for years, so what may be written
 * into `detail` is declared here rather than decided by each caller. A new
 * action adds a line to this map first, which is the point at which someone
 * notices they were about to log a check number or a Stripe intent id.
 *
 * `never` means the action carries no detail at all.
 */
type AuditDetails = {
  'order.finalized': { orderNumber: number; packageCount: number; totalCents: number };
  /// `batchId` is set when the move came from a bulk sweep rather than from one
  /// person on one order, and is the only thing that ties the per-order rows of
  /// a batch together (G-024).
  'order.status_changed': { from: OrderStatus; to: OrderStatus; batchId?: string };
  'order.draft_claimed': { draftReference: string };
  /// R-057. Says what came across and what could not, because a repeat that
  /// quietly dropped a discontinued box is the complaint nobody can explain.
  'order.repeated': {
    sourceOrderId: string;
    copiedLines: number;
    skippedLines: string[];
    batchId?: string;
  };
  /// G-024. One summary row for the whole batch: a hundred separate rows would
  /// bury the individual edits staff make by hand, which are the interesting
  /// ones. The orders themselves are found by `batchId` on their own rows, which
  /// is one join for the whole sweep whatever action it ran.
  'orders.bulk_action': {
    batchId: string;
    action: string;
    applied: number;
    skipped: number;
    conflicts: number;
    droppedCount: number;
  };
  /// UR-014 and G-019: a staff member editing somebody else's address book is
  /// the row an auditor comes looking for. The same edit made by the customer is
  /// logged as "system", which is how the two are told apart.
  'customer.address_saved': { customerId: string; created: boolean };
  'customer.address_archived': { customerId: string };
  'customer.profile_updated': { changedPhone: boolean };
  /// R-060. A record created by somebody at the counter rather than by the
  /// person themselves, which is the one to look at when two accounts turn out
  /// to be the same family.
  'customer.created_at_counter': { email: string };
  /// Money rows never carry the instrument that moved it — no check number, no
  /// Stripe intent id, no card detail. Those live on the payment row, which is
  /// behind a permission; the audit trail is read far more widely.
  'payment.posted': { method: PaymentMethod; amountCents: number };
  'payment.voided': { method: PaymentMethod; amountCents: number; reason: string };
  'payment.refunded': { amountCents: number; reason: string };
  /// R-126: the charge did not match what the order says it costs, so it was
  /// handed straight back rather than kept while somebody worked out why.
  'payment.auto_refunded': { chargedCents: number; expectedCents: number };
  /// R-061. The counter placed the order and then could not take the cash for
  /// it. Without this row the order is simply unpaid on the desk and nothing
  /// says a member of staff had money in their hand when it happened.
  'pos.sale_unpaid': { orderNumber: number; method: PaymentMethod; code: string };
  'package.created': { orderId: string; recipientName: string; lineCount: number };
  /// `batchId` is set when the move came from a sweep of the package board
  /// rather than from one person on one box, the same way orders record it.
  'package.stage_changed': { from: PackageStage; to: PackageStage; batchId?: string };
  /// G-003. Staff overruling the grouping engine: which lines left which box.
  /// The old box keeps its fee, so the split cannot re-price the order (G-028).
  'package.split': { orderId: string; fromPackageId: string; lineCount: number };
  'package.regrouped': { orderId: string; fromPackageId: string; lineCount: number };
  /// The last line left a box, so the box went with it. Kept as its own action
  /// because "where did that package go" is otherwise unanswerable.
  'package.emptied': { orderId: string; recipientName: string };
  'packages.bulk_stage': {
    batchId: string;
    stage: PackageStage;
    applied: number;
    skipped: number;
    conflicts: number;
    droppedCount: number;
  };
  /// UR-005. Which boxes were filed into which groups tonight. A reprint is a
  /// new batch naming the one it supersedes, never an edit of it.
  'print.batch_created': {
    kind: 'NIGHTLY' | 'REPRINT';
    packageCount: number;
    groupCount: number;
    /** Null on a reprint of boxes that have never been filed before. */
    supersedesBatchId?: string | null;
  };
  /// Paper came out of the printer. This row is the *only* thing printing
  /// changes: no stage moves, nothing is marked shipped (G-002, G-004).
  'print.rendered': { artifact: string; scope: 'group' | 'order'; packageCount: number };
  'staff.invited': { email: string; role: StaffRole };
  'staff.role_changed': { from: StaffRole; to: StaffRole };
  'staff.confirmed': never;
  'staff.revoked': never;
  'staff.permission_override_changed': { permission: Permission; effect: PermissionEffect | 'INHERIT' };
  'staff.impersonation_started': { targetEmail: string };
  'staff.impersonation_stopped': never;
  'settings.store_open_changed': { open: boolean };
  'settings.changed': { key: string; summary: string };
  'catalog.product_saved': { slug: string; seasonYear: number; created: boolean };
  'catalog.replacement_linked': { slug: string; replacedByProductId: string | null };
  'catalog.addon_saved': { slug: string; seasonYear: number; created: boolean };
  'media.uploaded': { pathname: string; contentType: string; sizeBytes: number };
  /// R-143. Staging and committing are two rows because they are two decisions:
  /// somebody uploaded a file, and somebody later read the preview and accepted
  /// it. The file name is kept; the contents are on the batch.
  'import.staged': {
    kind: ImportKind;
    fileName: string;
    rowCount: number;
    validCount: number;
    duplicateCount: number;
    invalidCount: number;
  };
  'import.committed': { kind: ImportKind; createdCount: number; updatedCount: number };
  'import.discarded': { kind: ImportKind; rowCount: number };
};

export type AuditAction = keyof AuditDetails;

type AuditInput<TAction extends AuditAction> = {
  action: TAction;
  entityType: string;
  entityId: string;
  detail?: AuditDetails[TAction];
  ipAddress?: string | null;
};

/** Null for anything a customer or a cron job did: those rows are logged as "system". */
export type AuditActor = Pick<StaffContext, 'actor' | 'acting' | 'isImpersonating'> | null;

/**
 * Audit rows name the real signed-in person even during impersonation, so
 * "who actually did this" survives an impersonated action.
 */
export async function recordAudit<TAction extends AuditAction>(
  context: AuditActor,
  input: AuditInput<TAction>,
  client: DbClient = db,
) {
  return client.auditEvent.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      detail: input.detail ?? {},
      actorStaffUserId: context?.actor.id ?? null,
      actorLabel: context ? `${context.actor.fullName} <${context.actor.email}>` : 'system',
      impersonatedStaffUserId: context?.isImpersonating ? context.acting.id : null,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
