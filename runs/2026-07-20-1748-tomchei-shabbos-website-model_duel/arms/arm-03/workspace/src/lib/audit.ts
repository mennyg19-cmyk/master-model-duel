import { AuditAction, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export async function writeAudit(input: {
  action: AuditAction;
  actorId?: string | null;
  targetId?: string | null;
  meta?: Prisma.InputJsonValue;
}) {
  return db.auditLog.create({
    data: {
      action: input.action,
      actorId: input.actorId ?? null,
      targetId: input.targetId ?? null,
      meta: input.meta ?? Prisma.JsonNull,
    },
  });
}
