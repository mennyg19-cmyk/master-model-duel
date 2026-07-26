import 'server-only';

import type { OrderStatus, PackageStage, PermissionEffect, StaffRole } from '@prisma/client';

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
  'order.status_changed': { from: OrderStatus; to: OrderStatus };
  'package.created': { orderId: string; recipientName: string; lineCount: number };
  'package.stage_changed': { from: PackageStage; to: PackageStage };
  'staff.invited': { email: string; role: StaffRole };
  'staff.role_changed': { from: StaffRole; to: StaffRole };
  'staff.confirmed': never;
  'staff.revoked': never;
  'staff.permission_override_changed': { permission: Permission; effect: PermissionEffect | 'INHERIT' };
  'staff.impersonation_started': { targetEmail: string };
  'staff.impersonation_stopped': never;
  'settings.store_open_changed': { open: boolean };
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
