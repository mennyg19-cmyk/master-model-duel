import { db } from "@/lib/db";
import type { StaffContext } from "@/lib/auth/current-user";
import type { Prisma } from "@prisma/client";

type AuditEntry = {
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Prisma.InputJsonValue;
};

// Pass the surrounding transaction client so the audit row commits atomically
// with the mutation it records (no audited action without its audit entry).
export async function writeAudit(
  staff: StaffContext | null,
  entry: AuditEntry,
  tx: Prisma.TransactionClient = db
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorStaffId: staff?.realUser.id ?? null,
      actorEmail: staff
        ? staff.isImpersonating
          ? `${staff.realUser.email} (impersonating ${staff.actingAs.email})`
          : staff.realUser.email
        : "system",
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      detail: entry.detail,
    },
  });
}
