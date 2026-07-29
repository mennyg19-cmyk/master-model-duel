import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type AuditAction =
  | "bootstrap_manager"
  | "staff_create"
  | "staff_confirm"
  | "role_change"
  | "permission_override"
  | "staff_revoke"
  | "impersonation_start"
  | "impersonation_stop"
  | "session_login"
  | "client_error"
  | "product_create"
  | "product_update"
  | "addon_create"
  | "addon_update"
  | "media_upload"
  | "media_update"
  | "media_delete"
  | "settings_update"
  | "address_create"
  | "address_update"
  | "address_delete"
  | "order_finalize"
  | "order_discard"
  | "payment_post"
  | "payment_void"
  | "payment_auto_refund"
  | "payment_refund"
  | "customer_create"
  | "customer_update"
  | "import_stage"
  | "import_commit"
  | "import_discard"
  | "bulk_action"
  | "package_split"
  | "package_regroup"
  | "print_batch_run"
  | "print_batch_reprint"
  // P8 label lifecycle, kept in lockstep with PackageEventAction's P8 members
  // (lib/packages/stages.ts) so auditing any label event type-checks.
  | "label_buy"
  | "label_failed"
  | "label_void"
  | "label_void_rejected"
  | "tracking_refresh"
  | "address_validate"
  // P9 route/method lifecycle.
  | "route_create"
  | "route_reassign"
  | "route_link_create"
  | "route_reroute"
  | "method_switch"
  | "bulk_schedule"
  // m25: kept in lockstep with PackageEventAction's P9 members
  // (lib/packages/stages.ts) so auditing any P9 package event type-checks —
  // the same discipline the P8 members above already follow.
  | "reroute"
  | "delivered"
  | "pickup_ready"
  | "pickup_expired"
  // P10 season lifecycle + repeat flows. The cron flip gets its own action
  // (not "season_schedule") so manager schedule edits and system flips are
  // separable in the audit log.
  | "season_create"
  | "season_open"
  | "season_close"
  | "season_schedule"
  | "season_flip_cron"
  | "repeat_create"
  | "repeat_bulk_history"
  | "legacy_import"
  // P11 email platform. Hub edits (templates/triggered/lists/subscriber
  // management) share one action with the edited kind in metadata; campaign
  // sends, payment-link emails, and the settings test sender get their own.
  | "email_hub_update"
  | "email_campaign_send"
  | "email_test_send"
  | "payment_link_email"
  // P12: export center, reconciliation, address-book cleanup, test console.
  | "export_csv"
  | "reconcile_run"
  | "address_merge"
  | "address_review"
  | "testops_seed"
  | "testops_reset"
  | "testops_wipe"
  | "testops_clear";

// Minimal shape of AuthContext this module needs (avoids importing lib/auth,
// which pulls in next/headers).
export interface AuditContextLike {
  staff: { id: string; email: string };
  impersonator: { id: string; email: string } | null;
}

export interface AuditEntry {
  // Request-scoped context: the impersonator is the real actor; the target
  // is recorded as impersonatedAs in metadata.
  ctx?: AuditContextLike;
  // Explicit actor for self-initiated events (bootstrap, login, invite confirm).
  actor?: { id: string; email: string } | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
}

// Pass a tx client when the audit row must commit in the same transaction as
// the mutation it records (payment verbs) — a crash between commit and audit
// would otherwise leave a payment mutation with no durable trail.
export async function recordAudit(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
  const actor = entry.actor ?? (entry.ctx ? (entry.ctx.impersonator ?? entry.ctx.staff) : null);
  const impersonatedAs = entry.ctx?.impersonator
    ? { id: entry.ctx.staff.id, email: entry.ctx.staff.email }
    : undefined;

  const metadata =
    entry.metadata === undefined
      ? impersonatedAs
        ? { impersonatedAs }
        : Prisma.DbNull
      : impersonatedAs
        ? { ...(entry.metadata as Record<string, unknown>), impersonatedAs }
        : entry.metadata;

  await (tx ?? prisma).auditLog.create({
    data: {
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata,
    },
  });
}
