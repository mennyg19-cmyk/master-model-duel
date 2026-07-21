import { AuditAction, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type DbClient = Prisma.TransactionClient | typeof db;

export async function writeAudit(
  input: {
    action: AuditAction;
    actorId?: string | null;
    targetId?: string | null;
    meta?: Prisma.InputJsonValue;
  },
  client: DbClient = db,
) {
  return client.auditLog.create({
    data: {
      action: input.action,
      actorId: input.actorId ?? null,
      targetId: input.targetId ?? null,
      meta: input.meta ?? Prisma.JsonNull,
    },
  });
}

const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 100;

/** Shared audit listing — filters by meta.orderId in DB when provided (B3). */
export async function listAudit(input: {
  orderId?: string;
  limit?: number;
  actions?: AuditAction[];
}) {
  const take = Math.min(
    MAX_AUDIT_LIMIT,
    Math.max(1, input.limit ?? DEFAULT_AUDIT_LIMIT),
  );

  if (!input.orderId) {
    return db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        actor: { select: { displayName: true, email: true } },
        target: { select: { displayName: true, email: true } },
      },
    });
  }

  // JSON predicates in Postgres — no global take-then-filter window.
  const actionFilter =
    input.actions && input.actions.length > 0
      ? Prisma.sql`AND a.action::text IN (${Prisma.join(input.actions)})`
      : Prisma.empty;

  const rows = await db.$queryRaw<
    Array<{
      id: string;
      action: AuditAction;
      actorId: string | null;
      targetId: string | null;
      meta: Prisma.JsonValue;
      createdAt: Date;
      actorDisplayName: string | null;
      actorEmail: string | null;
    }>
  >`
    SELECT
      a.id,
      a.action,
      a."actorId",
      a."targetId",
      a.meta,
      a."createdAt",
      s."displayName" AS "actorDisplayName",
      s.email AS "actorEmail"
    FROM "AuditLog" a
    LEFT JOIN "StaffUser" s ON s.id = a."actorId"
    WHERE (
      a.meta->>'orderId' = ${input.orderId}
      OR a.meta->>'sourceOrderId' = ${input.orderId}
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(a.meta->'created') = 'array' THEN a.meta->'created'
            ELSE '[]'::jsonb
          END
        ) elem
        WHERE elem->>'sourceOrderId' = ${input.orderId}
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(a.meta->'updated') = 'array' THEN a.meta->'updated'
            ELSE '[]'::jsonb
          END
        ) elem
        WHERE elem#>>'{}' = ${input.orderId}
           OR elem->>'orderId' = ${input.orderId}
      )
    )
    ${actionFilter}
    ORDER BY a."createdAt" DESC
    LIMIT ${take}
  `;

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    targetId: row.targetId,
    meta: row.meta,
    createdAt: row.createdAt,
    actor: row.actorId
      ? { displayName: row.actorDisplayName, email: row.actorEmail }
      : null,
  }));
}
