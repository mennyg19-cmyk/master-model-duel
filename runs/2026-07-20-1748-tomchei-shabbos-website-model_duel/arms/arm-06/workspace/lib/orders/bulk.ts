import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { AuditContextLike } from "@/lib/audit";
import { discardOrder, IllegalTransitionError } from "@/lib/orders/state-machine";
import { repeatOrder } from "@/lib/orders/repeat";
import { getOpenSeason } from "@/lib/seasons/queries";

// G-024: bounded bulk actions with deterministic conflict reporting. One call
// processes at most BULK_ACTION_LIMIT ids, sequentially, in input order — the
// same batch always produces the same report, row for row. The batch scopes
// to the open season exactly like the order list does: ids from any other
// season (or no season at all) are skipped rows, never acted on.
export const BULK_ACTION_LIMIT = 100;

export type BulkOrderAction = "repeat" | "discard";

export interface BulkItemResult {
  orderId: string;
  outcome: "repeated" | "discarded" | "skipped";
  reason?: string;
  draftRef?: string;
}

export interface BulkActionReport {
  action: BulkOrderAction;
  results: BulkItemResult[];
  counts: { succeeded: number; skipped: number };
}

export async function runBulkOrderAction(input: {
  action: BulkOrderAction;
  orderIds: string[];
  ctx: AuditContextLike;
}): Promise<BulkActionReport> {
  if (input.orderIds.length > BULK_ACTION_LIMIT) {
    throw new DomainRuleError(
      `Bulk actions take at most ${BULK_ACTION_LIMIT} orders per call; got ${input.orderIds.length}`,
    );
  }

  const season = await getOpenSeason();
  if (!season) throw new DomainRuleError("No open season — bulk actions only act on the open season's orders");
  const candidateIds = [...new Set(input.orderIds.map((id) => id.trim()).filter((id) => id !== ""))];
  const scopedOrders = await prisma.order.findMany({
    where: { id: { in: candidateIds }, seasonId: season.id },
    select: { id: true },
  });
  const inScope = new Set(scopedOrders.map((order) => order.id));

  const results: BulkItemResult[] = [];
  const seen = new Set<string>();
  for (const raw of input.orderIds) {
    const orderId = raw.trim();
    if (!orderId) continue;
    if (seen.has(orderId)) {
      results.push({ orderId, outcome: "skipped", reason: "duplicate in batch — first occurrence already processed" });
      continue;
    }
    seen.add(orderId);
    if (!inScope.has(orderId)) {
      results.push({ orderId, outcome: "skipped", reason: "not an order in the open season" });
      continue;
    }
    try {
      if (input.action === "repeat") {
        const { draftRef } = await repeatOrder(orderId);
        results.push({ orderId, outcome: "repeated", draftRef });
      } else {
        await discardOrder(orderId, { ctx: input.ctx });
        results.push({ orderId, outcome: "discarded" });
      }
    } catch (error) {
      // IllegalTransitionError: discard/repeat on a terminal order is a
      // per-row conflict, never a batch-killing 500.
      if (
        error instanceof NotFoundError ||
        error instanceof DomainRuleError ||
        error instanceof IllegalTransitionError
      ) {
        results.push({ orderId, outcome: "skipped", reason: error.message });
      } else {
        throw error;
      }
    }
  }

  return {
    action: input.action,
    results,
    counts: {
      succeeded: results.filter((result) => result.outcome !== "skipped").length,
      skipped: results.filter((result) => result.outcome === "skipped").length,
    },
  };
}
