import 'server-only';

import type { Prisma } from '@prisma/client';

import { db } from './db';
import type { StaffContext } from './auth/staff';

type AuditInput = {
  action: string;
  entityType: string;
  entityId: string;
  detail?: Prisma.InputJsonValue;
  ipAddress?: string | null;
};

/**
 * Audit rows name the real signed-in person even during impersonation, so
 * "who actually did this" survives an impersonated action.
 */
export async function recordAudit(
  context: Pick<StaffContext, 'actor' | 'acting' | 'isImpersonating'> | null,
  input: AuditInput,
  client: Prisma.TransactionClient | typeof db = db,
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
