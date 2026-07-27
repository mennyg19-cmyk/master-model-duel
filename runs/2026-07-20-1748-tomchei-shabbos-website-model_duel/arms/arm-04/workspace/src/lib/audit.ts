import 'server-only';

import type {
  AddressCleanupKind,
  ExportDataset,
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
  /// R-057. Says what came across, what a replacement mapping swapped, and what
  /// could not be stood in for at all — because a repeat that quietly dropped a
  /// discontinued box is the complaint nobody can explain.
  'order.repeated': {
    sourceOrderId: string;
    copiedLines: number;
    swappedLines: number;
    skippedLines: string[];
    batchId?: string;
  };
  /// UR-007. The customer decided the swaps and the recipients themselves on the
  /// review page, so there is no member of staff on this row — only what they
  /// chose, and whether the order they repeated came out of the old system.
  'order.repeated_by_customer': {
    sourceOrderId: string;
    copiedLines: number;
    swappedLines: number;
    removedLines: number;
    fromImport: boolean;
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
  /// Money left the organisation at a carrier, and the spread the campaign keeps
  /// is part of the row (UR-003). The carrier's own transaction id is not: it is
  /// on the shipment box, behind the fulfillment permission.
  'shipping.label_purchased': {
    carrier: string;
    serviceCode: string;
    parcelCount: number;
    carrierCostCents: number;
    customerPriceCents: number;
    marginCents: number;
  };
  /// R-055, UR-004. A label cancelled before the box went out — usually because
  /// the box was rerouted onto a van — and whether the carrier has confirmed the
  /// refund yet.
  'shipping.label_voided': {
    carrier: string;
    parcelCount: number;
    reason: string;
    confirmed: boolean;
  };
  /// The carrier refused, or this database failed after it agreed. Either way
  /// nothing was left bought; the reason the carrier gave is on the box, not
  /// here, because it is the carrier's wording and not for wide reading.
  'shipping.label_failed': { carrier: string; parcelCount: number };
  'shipping.tracking_refreshed': { status: string; parcelCount: number };
  /// R-177. Somebody asked the carrier whether this address exists before a
  /// label was bought against it.
  'shipping.address_validated': { isValid: boolean; postalCode: string };
  /// UR-004, R-075. A van's afternoon: which boxes are on it and which day it is for.
  'route.created': { stopCount: number; deliveryDay: string | null; unplacedCount: number };
  'route.driver_assigned': { driverStaffUserId: string | null };
  /// The moment the recipients are told the box is coming today (G-023): the
  /// count is what went out, not what was on the route, because a second start
  /// notifies nobody.
  'route.started': { stopCount: number; notified: number };
  /// UR-015, G-025. A credential was handed to somebody who is not staff, so the
  /// row says which link and whether it needs a PIN — never the token itself.
  'route.link_issued': { linkId: string; hasPin: boolean; expiresAt: string };
  'route.link_revoked': { linkId: string };
  /// G-025: every Delivered tap, with the link that made it. `linkId` is null
  /// when the office marked it from the printed sheet, which is the difference
  /// between "the driver says so" and "the office says so".
  'route.stop_delivered': { routeId: string; linkId: string | null; source: 'driver_link' | 'office' };
  'route.completed': { stopCount: number };
  /// UR-002, G-005. The box changed how it travels and the customer's charge did
  /// not, which is the pair an auditor is checking.
  'package.method_switched': {
    fromMethodCode: string;
    toMethodCode: string;
    feeCents: number;
    labelVoided: boolean;
  };
  /// UR-004, G-027. A shipping box lifted onto a van because it was next door to
  /// a stop the driver was making anyway.
  'package.rerouted': { routeId: string; labelVoided: boolean; milesFromStop: number };
  /// UR-010, G-026. The counter told somebody their box is on the shelf, and
  /// when it stops waiting for them.
  'pickup.ready_notified': { expiresAt: string };
  'pickup.collected': never;
  /// R-182. The nightly sweep found a box past its holding date. The box stays
  /// on the shelf and stays collectable — this row is what turns it into a
  /// phone call, and it is written per box so the office can see which one.
  'pickup.expired': { expiresAt: string | null };
  /// G-021. The office set a delivery day and window over a stack of boxes at
  /// once; `customerCount` is how many people were written to, not how many boxes.
  'delivery.bulk_scheduled': {
    batchId: string;
    packageCount: number;
    customerCount: number;
    deliveryDay: string;
    deliveryWindow: string;
  };
  /// R-083. A letter went to the whole donor list, so the row says how many
  /// people it reached and how many were already written to — a rerun that
  /// mailed nobody is a row saying exactly that, which is the proof the
  /// idempotency held.
  'email.campaign_sent': { queued: number; alreadySent: number; recipientCount: number };
  /// R-086. The wording of a triggered email changed, or was switched off.
  /// Which key, not the new text: the row points at the template that holds it.
  'email.template_saved': { key: string; isEnabled: boolean };
  /// R-090. Somebody proved the mail account works. The address is kept
  /// because "who did we test against" is the first question when a test
  /// arrives nowhere.
  'email.test_sent': { destination: string; provider: string };
  'email.list_changed': { slug: string; change: 'created' | 'joined' | 'left' };
  'staff.invited': { email: string; role: StaffRole };
  'staff.role_changed': { from: StaffRole; to: StaffRole };
  'staff.confirmed': never;
  'staff.revoked': never;
  'staff.permission_override_changed': { permission: Permission; effect: PermissionEffect | 'INHERIT' };
  'staff.impersonation_started': { targetEmail: string };
  'staff.impersonation_stopped': never;
  'settings.store_open_changed': { open: boolean };
  'settings.changed': { key: string; summary: string };
  /// UR-008. Opening a season puts the shop live and closing it stops the year,
  /// so both are named rows rather than a settings edit. `scheduled` separates
  /// the manager's own switch from the cron sweep acting on their calendar.
  'season.status_changed': { year: number; to: 'OPEN' | 'CLOSED'; scheduled: boolean };
  'season.schedule_changed': { year: number; opensAt: string | null; closesAt: string | null };
  /// R-097. A new campaign year, and what the wizard carried into it.
  'season.created': {
    year: number;
    copiedFromYear: number | null;
    productCount: number;
    addOnCount: number;
    replacementLinkCount: number;
  };
  /// A prior-year order staged by the import hook so it can be repeated (S3).
  /// The full pipeline is P12; this row is what says where the order came from.
  'order.imported_prior_year': { reference: string; year: number; lineCount: number };
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
  /// R-092. A file of donors' names and addresses left the building. The row
  /// count is here because "somebody exported the deliveries" and "somebody
  /// exported all five thousand of them" are different events.
  'report.exported': { dataset: ExportDataset; seasonYear: number; rowCount: number };
  /// R-186, G-029. The dry run reads the legacy export and writes nothing; the
  /// commit writes it in chunks. `resumedFromChunk` is non-zero when the commit
  /// picked up a run that had died partway through.
  'migration.dry_run': {
    fileName: string;
    seasonYear: number;
    rowCount: number;
    invalidCount: number;
    needsMappingCount: number;
  };
  'migration.committed': {
    fileName: string;
    seasonYear: number;
    resumedFromChunk: number;
    ordersWritten: number;
    customersWritten: number;
  };
  'migration.discarded': { fileName: string; rowCount: number };
  /// A person decided which customer an ambiguous legacy row meant. Recorded
  /// because the import cannot be reproduced from the file alone afterwards.
  'migration.row_mapped': { runId: string; lineNumber: number };
  /// UR-014. What the address-book cleanup pass found, and what somebody
  /// decided about one of its findings.
  'cleanup.scanned': { flagged: number; reopened: number };
  'cleanup.resolved': { kind: AddressCleanupKind; status: 'MERGED' | 'KEPT' };
  /// R-101, R-129. Test mode changes what the whole deployment claims to be, so
  /// it is its own row rather than a settings edit.
  'settings.test_mode_changed': { on: boolean };
  /// R-014, R-103. Somebody pressed a destructive button in the test console.
  /// Only reachable while test mode is on, which is exactly why the row exists.
  'testing.console_ran': { action: 'seed' | 'reset' | 'wipe'; seasonYear: number | null };
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
