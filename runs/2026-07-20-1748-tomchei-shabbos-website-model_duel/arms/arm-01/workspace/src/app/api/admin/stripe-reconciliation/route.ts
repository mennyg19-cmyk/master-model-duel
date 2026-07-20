import { randomUUID } from "node:crypto";
import { reconcileStripePayments } from "@/domain/stripe-reconciliation";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST() {
  try {
    const session = await requirePermission("payments:manage");
    const run = await reconcileStripePayments(
      db,
      `manual:${new Date().toISOString()}:${randomUUID()}`,
      session.actor.id,
    );
    await db.auditLog.create({
      data: {
        actorStaffId: session.actor.id,
        action: "stripe_reconciliation.completed",
        targetType: "ReconciliationRun",
        targetId: run.id,
        metadata: {
          matchedCount: run.matchedCount,
          findingCount: run.findingCount,
        },
      },
    });
    return Response.json(run);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
