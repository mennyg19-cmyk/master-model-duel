import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { getOpenSeason } from "@/lib/season";
import { findActiveDraft, posDraftOwner } from "@/lib/order-builder/draft-store";
import { loadRepeatableOrder, loadRepeatCatalog, repeatOrderIntoPosDraft } from "@/lib/repeat";

// Keeps one request's blast radius sane; rerun for the next batch.
const BULK_LIMIT = 200;

const bulkSchema = z.object({
  sourceSeasonId: z.string().min(1),
});

/**
 * Bulk repeat (R-058): for every customer who placed a FINALIZED order in the
 * source season, copy their most recent one into a POS draft in the open
 * season. Customers who already have an ACTIVE POS draft are skipped —
 * a bulk run must never clobber an order a staffer is mid-way through.
 */
export async function POST(request: Request) {
  const gate = await requirePermissionApi("orders.manage");
  if ("response" in gate) return gate.response;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed — open a season first" }, { status: 409 });

  const parsed = bulkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "sourceSeasonId is required" }, { status: 400 });
  if (parsed.data.sourceSeasonId === season.id) {
    return Response.json({ error: "Pick a prior season — the open season is the repeat target" }, { status: 400 });
  }

  // Latest finalized order per customer in the source season.
  const sourceOrders = await db.order.findMany({
    where: { seasonId: parsed.data.sourceSeasonId, status: "FINALIZED" },
    orderBy: [{ finalizedAt: "desc" }, { id: "desc" }],
    select: { id: true, customerId: true, orderNumber: true },
  });
  const latestByCustomer = new Map<string, { id: string; orderNumber: number | null }>();
  for (const order of sourceOrders) {
    if (!latestByCustomer.has(order.customerId)) {
      latestByCustomer.set(order.customerId, { id: order.id, orderNumber: order.orderNumber });
    }
  }

  const entries = [...latestByCustomer.entries()].slice(0, BULK_LIMIT);
  let drafted = 0;
  let skippedLines = 0;
  const skippedCustomers: { customerId: string; reason: string }[] = [];
  const failedCustomers: { customerId: string; reason: string }[] = [];
  // One catalog fetch for the whole run instead of one per customer.
  const catalog = await loadRepeatCatalog();

  for (const [customerId, source] of entries) {
    // Each customer is independent: their draft write is atomic inside
    // repeatOrderIntoPosDraft, and a failure is recorded instead of aborting
    // the run — the audit row below always lands, listing any failures.
    try {
      // Cheap fast-path only; the race-safe skip is `ifDraftExists: "skip"`
      // inside the atomic append itself.
      const existingPosDraft = await findActiveDraft(season.id, posDraftOwner(customerId));
      if (existingPosDraft) {
        skippedCustomers.push({ customerId, reason: "already has a POS draft in progress" });
        continue;
      }
      const order = await loadRepeatableOrder(source.id);
      if (!order) continue;
      const outcome = await repeatOrderIntoPosDraft(order, season, { catalog, ifDraftExists: "skip" });
      if (outcome.skippedExistingDraft) {
        skippedCustomers.push({ customerId, reason: "already has a POS draft in progress" });
        continue;
      }
      if (outcome.added === 0) {
        skippedCustomers.push({ customerId, reason: "no line could map to a product this season" });
        continue;
      }
      drafted += 1;
      skippedLines += outcome.skipped.length;
    } catch (error) {
      failedCustomers.push({ customerId, reason: error instanceof Error ? error.message : "unexpected failure" });
    }
  }

  const summary = {
    customersConsidered: latestByCustomer.size,
    drafted,
    skippedCustomers: skippedCustomers.length,
    failedCustomers: failedCustomers.length,
    skippedLines,
    truncated: latestByCustomer.size > BULK_LIMIT,
  };
  await writeAudit(gate.staff, {
    action: "order.repeat.bulk",
    targetType: "Season",
    targetId: parsed.data.sourceSeasonId,
    detail: { ...summary, failed: failedCustomers },
  });
  return Response.json({ ok: true, ...summary, skipped: skippedCustomers, failed: failedCustomers });
}
