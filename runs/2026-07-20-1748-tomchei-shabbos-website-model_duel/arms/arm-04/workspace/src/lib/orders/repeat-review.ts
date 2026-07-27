import 'server-only';

import { recordAudit } from '../audit';
import { failure, ok, type Result } from '../core/result';
import { readStoreState } from '../store-state';
import { abort, runInTransaction } from '../transaction';
import { findOwnedOrder } from './draft-access';
import { createDraftReference } from './draft-reference';
import {
  applyRepeatPlan,
  undecidedLineFailure,
  type AppliedRepeat,
  type RepeatDecision,
} from './repeat-apply';
import { buildRepeatPlan, type RepeatPlan } from './repeat-plan';
import { isRepeatable } from './repeatable';

/**
 * The customer's own repeat, and the middle page that makes it safe (UR-007,
 * G-011, G-012).
 *
 * Loading the review page writes nothing. The plan is worked out fresh on every
 * request and again when the form is posted, so a catalogue that changed while
 * somebody had the page open cannot be confirmed away — the decision is checked
 * against the season as it is at the moment of the write, not as it was when the
 * page rendered.
 */
export const REPEAT_SEASON_CLOSED = 'repeat_season_closed';
export const REPEAT_NOT_YOURS = 'repeat_not_yours';
export const REPEAT_CART_OPEN = 'repeat_cart_open';
export const REPEAT_NOT_CONFIRMED = 'repeat_not_confirmed';

export type RepeatReview = { plan: RepeatPlan; seasonId: string };

/** The plan a signed-in customer may see for one of their own past orders. */
export async function readRepeatReview(
  customerId: string,
  sourceOrderId: string,
): Promise<Result<RepeatReview>> {
  const owned = await findOwnedOrder({ kind: 'customer', customerId }, sourceOrderId);
  if (!owned) return failure(REPEAT_NOT_YOURS, 'That order is not one of yours.');
  if (!isRepeatable(owned.status)) {
    return failure(
      REPEAT_NOT_YOURS,
      owned.status === 'DRAFT'
        ? 'That order is still a cart. Open it instead of repeating it.'
        : `That order was ${owned.status.toLowerCase()}, so there is nothing to order again.`,
    );
  }

  const store = await readStoreState();
  if (!store.season || !store.seasonIsOpen) {
    return failure(REPEAT_SEASON_CLOSED, 'Ordering is not open yet, so there is nothing to repeat into.');
  }

  const plan = await buildRepeatPlan(owned.id, store.season.id);
  if (!plan.ok) return plan;

  return ok({ plan: plan.value, seasonId: store.season.id });
}

export type RepeatConfirmation = {
  decisions: Map<string, RepeatDecision>;
  replacementsConfirmed: boolean;
  recipientsConfirmed: boolean;
};

/**
 * The value the review page's product select carries for "do not send this one".
 * It lives beside the confirmation it belongs to rather than in the action file,
 * because a `'use server'` module may only export functions.
 */
export const REMOVE_CHOICE = 'remove';

/**
 * Both ticks, every line decided, then one draft.
 *
 * The ticks are not decoration: the whole point of the middle page is that a
 * repeat is checked by the person paying before it exists, and a form posted
 * without them is a form that skipped the page.
 */
export async function confirmRepeat(
  customerId: string,
  sourceOrderId: string,
  confirmation: RepeatConfirmation,
): Promise<Result<AppliedRepeat>> {
  const review = await readRepeatReview(customerId, sourceOrderId);
  if (!review.ok) return review;

  if (!confirmation.replacementsConfirmed || !confirmation.recipientsConfirmed) {
    return failure(
      REPEAT_NOT_CONFIRMED,
      confirmation.replacementsConfirmed
        ? 'Tick to say the recipients are right before we build the order.'
        : 'Tick to say the swaps are right before we build the order.',
    );
  }

  const { plan, seasonId } = review.value;

  // The items are asked about before the recipients, because that is the order
  // the review page puts them in and the order the two ticks repeat.
  const undecided = undecidedLineFailure(plan, confirmation.decisions);
  if (undecided) return undecided;

  const missingAddress = plan.lines.find(
    (line) =>
      line.recipient.state === 'address_missing' &&
      !confirmation.decisions.get(line.sourceLineId)?.removed &&
      !confirmation.decisions.get(line.sourceLineId)?.customerAddressId,
  );
  if (missingAddress) {
    return failure(
      REPEAT_NOT_CONFIRMED,
      `${missingAddress.recipient.name} is not in your address book any more. Pick where "${missingAddress.sourceName}" should go, or take it off.`,
    );
  }

  const applied = await runInTransaction(async (tx) => {
    // A second cart in the same season is how a customer ends up paying twice
    // for one Purim. The check and the create share a transaction so two taps on
    // Confirm cannot both find nothing.
    const openCart = await tx.order.findFirst({
      where: { seasonId, status: 'DRAFT', customerId, posStaffUserId: null },
    });
    if (openCart) {
      abort(
        failure(
          REPEAT_CART_OPEN,
          'You already have an order on the go. Finish or cancel it, then repeat this one.',
        ),
      );
    }

    const written = await applyRepeatPlan(
      plan,
      confirmation.decisions,
      { seasonId, draftReference: createDraftReference(), customerId },
      tx,
    );
    if (!written.ok) abort(written);

    return written.value;
  });

  if (!applied.ok) return applied;

  await recordAudit(null, {
    action: 'order.repeated_by_customer',
    entityType: 'Order',
    entityId: applied.value.draftId,
    detail: {
      sourceOrderId,
      copiedLines: applied.value.copiedLines,
      swappedLines: applied.value.swappedLines,
      removedLines: applied.value.removedLines,
      fromImport: plan.wasImported,
    },
  });

  return ok(applied.value);
}
