import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { finalizeOrder, discardOrder } from "@/lib/domain/finalize";

const BULK_LIMIT = 200;

const bulkSchema = z.object({
  action: z.enum(["finalize", "discard"]),
  ids: z.array(z.string().min(1)).min(1).max(BULK_LIMIT),
});

/**
 * Bounded, conflict-aware bulk order actions (G-024). Ids are de-duped and
 * processed in sorted order, each in its own guarded transaction, so two
 * racing bulk requests produce deterministic reports: every order lands in
 * exactly one request's `done` and the other's `skipped` with the reason.
 */
export async function POST(request: Request) {
  const gate = await requirePermissionApi("orders.manage");
  if ("response" in gate) return gate.response;

  const parsed = bulkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { action } = parsed.data;
  const ids = [...new Set(parsed.data.ids)].sort();
  const done: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of ids) {
    try {
      // Per-order audit row (with targetId) commits inside the same guarded
      // transaction as the transition, so every bulk money-adjacent state
      // change stays individually auditable.
      await db.$transaction(async (tx) => {
        const finalized =
          action === "finalize" ? await finalizeOrder(id, gate.staff.realUser.id, tx) : await discardOrder(id, tx);
        await writeAudit(
          gate.staff,
          {
            action: action === "finalize" ? "order.finalize" : "order.discard",
            targetType: "Order",
            targetId: id,
            detail: { via: "bulk", ...(action === "finalize" ? { orderNumber: finalized.orderNumber } : {}) },
          },
          tx
        );
      });
      done.push(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      // Prisma's findUniqueOrThrow failure reads like machinery; report it plainly.
      skipped.push({ id, reason: message.includes("No Order found") ? "Order not found" : message });
    }
  }

  await writeAudit(gate.staff, {
    action: `orders.bulk_${action}`,
    targetType: "Order",
    detail: { requested: ids.length, done, skipped },
  });

  return Response.json({ ok: true, action, done, skipped });
}
