import 'server-only';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { abort, runInTransaction } from '../transaction';
import { createDraftReference } from './draft-reference';
import { ownerColumns } from './draft-access';
import { applyRepeatPlan, autoDecisions, unresolvedNames } from './repeat-apply';
import { buildRepeatPlan } from './repeat-plan';
import { REPEATABLE_STATUSES } from './repeatable';

/**
 * "Same as last time" at the counter (R-057).
 *
 * The resolution — which item is this now, who is it going to, what does the
 * card say — is `repeat-plan.ts`, shared with the customer's own review page so
 * a staff repeat and a self-serve repeat cannot drift apart. What is different
 * here is that nobody is being asked: anything the plan resolved is copied, and
 * anything it could not is left off and named in the notice, because a member of
 * staff on the phone can talk about "the wine basket is gone" but cannot be
 * shown a form mid-call.
 *
 * It is deliberately a draft. Last season's catalogue is not this season's,
 * prices move, and the person paying should see the new total first.
 */
export const REPEAT_NO_HISTORY = 'repeat_no_history';
export const REPEAT_TILL_BUSY = 'repeat_till_busy';

export type RepeatResult = {
  draftId: string;
  draftReference: string;
  customerId: string;
  copiedLines: number;
  /** Swapped for this season's item by a replacement mapping. */
  swappedLines: number;
  /** Products that were on the old order and have nothing to stand in for them. */
  skippedLines: string[];
};

export async function repeatOrderAtCounter(
  staff: StaffContext,
  sourceOrderId: string,
  seasonId: string,
  batchId?: string,
): Promise<Result<RepeatResult>> {
  const plan = await buildRepeatPlan(sourceOrderId, seasonId);
  if (!plan.ok) return plan;

  const skippedLines = unresolvedNames(plan.value);
  const customerId = plan.value.customerId;

  const applied = await runInTransaction(async (tx) => {
    // One till, one open cart per customer. A repeat that quietly merged into a
    // cart already on the screen would double somebody's order, and a staff
    // member double-clicking is exactly how that happens — so the look and the
    // create are the same transaction rather than two reads apart.
    const openCart = await tx.order.findFirst({
      where: { seasonId, status: 'DRAFT', posStaffUserId: staff.acting.id, customerId },
    });
    if (openCart) {
      abort(
        failure(
          REPEAT_TILL_BUSY,
          `Your till already has ${openCart.draftReference} open for this customer. Finish or discard it first.`,
        ),
      );
    }

    const written = await applyRepeatPlan(
      plan.value,
      autoDecisions(plan.value),
      {
        seasonId,
        draftReference: createDraftReference(),
        ...ownerColumns({ kind: 'pos', staffUserId: staff.acting.id, customerId }),
      },
      tx,
    );
    if (!written.ok) abort(written);

    await recordAudit(
      staff,
      {
        action: 'order.repeated',
        entityType: 'Order',
        entityId: written.value.draftId,
        detail: {
          sourceOrderId,
          copiedLines: written.value.copiedLines,
          swappedLines: written.value.swappedLines,
          skippedLines,
          batchId,
        },
      },
      tx,
    );

    return written.value;
  });

  if (!applied.ok) return applied;

  return ok({
    draftId: applied.value.draftId,
    draftReference: applied.value.draftReference,
    customerId,
    copiedLines: applied.value.copiedLines,
    swappedLines: applied.value.swappedLines,
    skippedLines,
  });
}

/**
 * The same thing starting from a person rather than an order (R-058).
 *
 * "Repeat their history" means their most recent real order, drafts and
 * discarded carts excluded: a customer who abandoned a basket last Tuesday is
 * not asking for that basket again.
 */
export async function repeatLatestOrderForCustomer(
  staff: StaffContext,
  customerId: string,
  seasonId: string,
  batchId?: string,
): Promise<Result<RepeatResult>> {
  const latest = await db.order.findFirst({
    where: {
      customerId,
      status: { in: [...REPEATABLE_STATUSES] },
      seasonId: { not: seasonId },
    },
    orderBy: [{ placedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  });

  if (!latest) {
    return failure(REPEAT_NO_HISTORY, 'Nothing to repeat: this customer has no order from an earlier season.');
  }

  return repeatOrderAtCounter(staff, latest.id, seasonId, batchId);
}
