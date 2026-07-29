import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { buildRepeatPlan } from "@/lib/repeat/plan";
import { autoConfirmPlan, createDraftFromRepeat } from "@/lib/repeat/create";

// R-057: staff single-order one-click repeat — chain-aware since P10 (the
// P6-era pure planner is gone; buildRepeatPlan + autoConfirmPlan + the P4
// draft engine are the one pipeline). Discontinued lines come back as skips.
export interface RepeatSkip {
  productName: string;
  reason: string;
}

export async function repeatOrder(orderId: string): Promise<{ draftRef: string; skipped: RepeatSkip[] }> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
  if (!order) throw new NotFoundError("Order", orderId);
  if (order.status !== "FINALIZED") {
    throw new DomainRuleError(`Order ${orderId} is ${order.status}; expected FINALIZED to repeat`);
  }

  // Lines whose chain dead-ends are reported as skips; everything else lands
  // in the new draft at current catalog prices. The plan is built once and
  // handed to the create step — no double chain walk.
  const plan = await buildRepeatPlan(orderId);
  const { draft } = await createDraftFromRepeat(autoConfirmPlan(plan), plan);
  const skipped: RepeatSkip[] = plan.lines
    .filter((line) => line.status === "unmapped")
    .map((line) => ({ productName: line.sourceName, reason: "discontinued with no replacement mapped" }));
  return { draftRef: draft.draftRef!, skipped };
}
