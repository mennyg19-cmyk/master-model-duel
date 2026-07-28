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
  | "settings_update";

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

export async function recordAudit(entry: AuditEntry): Promise<void> {
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

  await prisma.auditLog.create({
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
