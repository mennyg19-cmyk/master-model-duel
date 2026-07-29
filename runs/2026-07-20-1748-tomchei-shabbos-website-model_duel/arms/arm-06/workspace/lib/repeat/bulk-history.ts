/**
 * P10 (UR-008 / R-058): staff bulk repeat of CUSTOMER HISTORY — repeat
 * prior-season finalized orders into the open season in one bounded batch.
 *
 * Distinct from P6 runBulkOrderAction (lib/orders/bulk.ts), which scopes to
 * the OPEN season's orders. This module only acts on CLOSED-season sources
 * and is idempotent: an order that already has a non-discarded repeat draft
 * in the open season is a skipped row, so a re-run never double-creates.
 */
import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { getOpenSeason } from "@/lib/seasons/queries";
import { buildRepeatPlan } from "@/lib/repeat/plan";
import { autoConfirmPlan, createDraftFromRepeat } from "@/lib/repeat/create";
import { BULK_ACTION_LIMIT, BulkItemResult } from "@/lib/orders/bulk";

export interface BulkHistoryRow {
  orderId: string;
  orderNumber: number | null;
  customerId: string;
  customerName: string;
  customerEmail: string;
  seasonName: string;
  lineCount: number;
  totalCents: number;
  placedAt: Date;
  alreadyRepeated: boolean;
}

/** Candidate prior-season orders for the picker page, newest seasons first. */
export async function listBulkHistoryCandidates(input: {
  sourceSeasonId?: string;
  customerIds?: string[];
}): Promise<{ rows: BulkHistoryRow[]; sourceSeasons: { id: string; name: string }[] }> {
  const open = await getOpenSeason();
  if (!open) throw new DomainRuleError("No open season to repeat history into");

  const sourceSeasons = await prisma.season.findMany({
    where: { id: { not: open.id } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  const sourceSeasonId = input.sourceSeasonId ?? sourceSeasons[0]?.id;
  if (!sourceSeasonId) return { rows: [], sourceSeasons };

  const orders = await prisma.order.findMany({
    where: {
      seasonId: sourceSeasonId,
      status: "FINALIZED",
      ...(input.customerIds?.length ? { customerId: { in: input.customerIds } } : {}),
    },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      lines: { select: { id: true } },
      // Idempotency marker: a live repeat draft in the open season.
      repeats: {
        where: { seasonId: open.id, status: { not: "DISCARDED" } },
        select: { id: true },
      },
    },
    orderBy: [{ customer: { name: "asc" } }, { orderNumber: "asc" }],
    take: 500,
  });

  return {
    sourceSeasons,
    rows: orders.map((order) => ({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customer.id,
      customerName: order.customer.name,
      customerEmail: order.customer.email,
      seasonName: sourceSeasons.find((s) => s.id === sourceSeasonId)?.name ?? "",
      lineCount: order.lines.length,
      totalCents: order.totalCents,
      placedAt: order.createdAt,
      alreadyRepeated: order.repeats.length > 0,
    })),
  };
}

export interface BulkHistoryReport {
  results: BulkItemResult[];
  counts: { succeeded: number; skipped: number };
}

export async function runBulkHistory(input: {
  orderIds: string[];
  ctx: AuditContextLike;
}): Promise<BulkHistoryReport> {
  if (input.orderIds.length > BULK_ACTION_LIMIT) {
    throw new DomainRuleError(
      `Bulk history repeat takes at most ${BULK_ACTION_LIMIT} orders per call; got ${input.orderIds.length}`,
    );
  }
  const open = await getOpenSeason();
  if (!open) throw new DomainRuleError("No open season to repeat history into");

  const results: BulkItemResult[] = [];
  const seen = new Set<string>();
  for (const raw of input.orderIds) {
    const orderId = raw.trim();
    if (!orderId) continue;
    if (seen.has(orderId)) {
      results.push({ orderId, outcome: "skipped", reason: "duplicate in batch" });
      continue;
    }
    seen.add(orderId);

    const source = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        seasonId: true,
        repeats: { where: { seasonId: open.id, status: { not: "DISCARDED" } }, select: { id: true } },
      },
    });
    if (!source || source.status !== "FINALIZED") {
      results.push({ orderId, outcome: "skipped", reason: "not a finalized order" });
      continue;
    }
    if (source.seasonId === open.id) {
      results.push({ orderId, outcome: "skipped", reason: "already in the open season — use bulk repeat" });
      continue;
    }
    if (source.repeats.length > 0) {
      results.push({ orderId, outcome: "skipped", reason: "already repeated into the open season" });
      continue;
    }

    try {
      const plan = await buildRepeatPlan(orderId);
      const { draft } = await createDraftFromRepeat(autoConfirmPlan(plan));
      const dropped = plan.unmappedCount;
      results.push({
        orderId,
        outcome: "repeated",
        draftRef: draft.draftRef ?? undefined,
        reason: dropped > 0 ? `${dropped} discontinued line${dropped === 1 ? "" : "s"} dropped` : undefined,
      });
    } catch (error) {
      if (error instanceof DomainRuleError) {
        results.push({ orderId, outcome: "skipped", reason: error.message });
      } else {
        throw error;
      }
    }
  }

  const report = {
    results,
    counts: {
      succeeded: results.filter((r) => r.outcome !== "skipped").length,
      skipped: results.filter((r) => r.outcome === "skipped").length,
    },
  };
  await recordAudit({
    ctx: input.ctx,
    action: "repeat_bulk_history",
    targetType: "Season",
    targetId: open.id,
    metadata: {
      requested: input.orderIds.length,
      succeeded: report.counts.succeeded,
      skipped: report.counts.skipped,
    },
  });
  return report;
}
