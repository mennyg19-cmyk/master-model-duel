import 'server-only';

import type { Order } from '@prisma/client';
import { z } from 'zod';

import { recordAudit } from '../audit';
import { normalizeEmail } from '../core/normalize';
import { normalizePhone } from '../core/phone';
import { failure, ok, type Result } from '../core/result';
import { survivorOf } from '../customers';
import { db } from '../db';
import { queuePaymentLink } from '../email/transactional';
import { env } from '../env';
import { findOwnedOrder, type DraftOwner } from '../orders/draft-access';
import { finalizeOrder, transitionOrder } from '../orders/order-service';
import { getPaymentGateway } from '../payments/gateway';
import { readCheckoutSummary } from './checkout-summary';

/**
 * Turning a cart into a placed order and a payment page (R-035, R-166).
 *
 * The order is placed before the customer is sent to the hosted page, because
 * placing is what reserves the stock: a page that takes a card for the last
 * three boxes on the shelf has to have taken those boxes off the shelf first.
 * The consequence is an order that exists and is unpaid while the customer is
 * on the provider's page, which is why payment can be resumed and why the
 * webhook — not this module — is what says money arrived.
 */
/** There is no cart on this browser at all — a different failure from a cart that is not payable yet. */
export const CHECKOUT_NO_DRAFT = 'checkout_no_draft';
export const CHECKOUT_NOT_READY = 'checkout_not_ready';
export const CHECKOUT_TOTAL_CHANGED = 'checkout_total_changed';
export const CHECKOUT_CONTACT_REQUIRED = 'checkout_contact_required';
export const ORDER_NOT_PAYABLE_NOW = 'order_not_payable_now';

export type StartedCheckout = { orderId: string; hostedUrl: string };

const contactSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name.').max(120),
  email: z.email('Enter an email address we can send the receipt to.'),
  phone: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .refine((value) => value === null || normalizePhone(value) !== null, {
      message: 'Enter a 10-digit US phone number, or leave it blank.',
    }),
});

export type CheckoutContactInput = z.input<typeof contactSchema>;

export async function startCheckout(
  owner: DraftOwner,
  seasonId: string,
  input: { expectedTotalCents: number; contact: CheckoutContactInput | null },
): Promise<Result<StartedCheckout>> {
  const summary = await readCheckoutSummary(owner, seasonId);
  if (!summary) return failure(CHECKOUT_NO_DRAFT, 'Your order was not found on this browser.');

  if (!summary.isPayable) {
    return failure(CHECKOUT_NOT_READY, blockingReason(summary.conflicts.length, summary));
  }

  // R-034: the number the customer clicked "pay" under is the number the form
  // was rendered with. Anything else — a re-priced product, a hand-edited
  // hidden field — stops here rather than being charged.
  if (input.expectedTotalCents !== summary.totalCents) {
    return failure(
      CHECKOUT_TOTAL_CHANGED,
      'The total changed while you were checking out. Look it over and try again.',
    );
  }

  if (summary.isGuest) {
    const attached = await attachGuestCustomer(summary.orderId, summary.draftReference, input.contact);
    if (!attached.ok) return attached;
  }

  const placed = await finalizeOrder(summary.orderId, null);

  // The claim above made this draft match that account's own owner filter, so a
  // placement that failed — closed season, sold-out box, lost race — would leave
  // the abandoned basket, recipients and greetings included, waiting for whoever
  // next signs in with that address.
  if (!placed.ok) {
    if (summary.isGuest) {
      await db.order.update({ where: { id: summary.orderId }, data: { customerId: null } });
    }
    return placed;
  }

  // Finalize prices the packages with the same fee engine the summary quoted
  // with, so a difference here is a bug, not a customer's stale page. The order
  // is put back rather than charged at a price nobody agreed to.
  if (placed.value.totalCents !== input.expectedTotalCents) {
    await transitionOrder(summary.orderId, 'CANCELLED', null);
    return failure(
      CHECKOUT_TOTAL_CHANGED,
      'The total changed while you were checking out. Look it over and try again.',
    );
  }

  const order = await db.order.findUniqueOrThrow({ where: { id: summary.orderId } });
  return ok(await openHostedSession(order));
}

/**
 * Paying for an order that was placed but never paid — the customer closed the
 * provider's page, or their card was declined. A fresh session is opened for the
 * same order rather than a second order being built, so the stock stays reserved
 * against the one they already placed.
 */
export async function resumePayment(
  owner: DraftOwner,
  orderId: string,
): Promise<Result<StartedCheckout>> {
  const order = await findOwnedOrder(owner, orderId);
  if (!order) return failure(ORDER_NOT_PAYABLE_NOW, 'That order no longer exists.');

  if (order.status !== 'PLACED' || order.paymentStatus === 'PAID') {
    return failure(ORDER_NOT_PAYABLE_NOW, 'That order is not waiting for a payment.');
  }

  return ok(await openHostedSession(order));
}

/**
 * Opens a hosted payment page and records the attempt (resolution 8b).
 *
 * The attempt row is written before the customer is sent anywhere, because the
 * webhook arrives keyed by session id and has to find the order it belongs to.
 * Its `status` is what this application knows, never what it hopes: `open`
 * until an event says otherwise.
 */
async function openHostedSession(order: Order): Promise<StartedCheckout> {
  const attempts = await db.stripePaymentIntent.count({ where: { orderId: order.id } });
  const customer = order.customerId
    ? await db.customer.findUnique({ where: { id: order.customerId } })
    : null;

  const session = await getPaymentGateway().createCheckoutSession({
    orderId: order.id,
    description: `Order #${order.orderNumber ?? order.draftReference}`,
    amountCents: order.totalCents,
    customerEmail: customer?.email ?? null,
    successUrl: confirmationUrl(order.id, null),
    cancelUrl: confirmationUrl(order.id, 'cancelled'),
    idempotencyKey: `checkout-${order.id}-${attempts}`,
  });

  await db.stripePaymentIntent.create({
    data: {
      orderId: order.id,
      stripeSessionId: session.sessionId,
      status: 'open',
      amountCents: order.totalCents,
    },
  });

  // R-087. The customer is on the page already; the email is for the one who
  // closes the tab, and it is keyed to this session so a resumed payment mails
  // the live link rather than the dead one.
  await queuePaymentLink(order, {
    sessionId: session.sessionId,
    amountDueCents: order.totalCents - order.amountPaidCents,
    paymentUrl: session.url,
  });

  return { orderId: order.id, hostedUrl: session.url };
}

function confirmationUrl(orderId: string, payment: 'cancelled' | null): string {
  const url = new URL('/order/confirmation', env.APP_URL);
  url.searchParams.set('order', orderId);
  if (payment) url.searchParams.set('payment', payment);
  return url.toString();
}

/**
 * A guest becomes a customer at the moment they pay (R-023). An address that has
 * ordered before is the same person — that is how last season's greetings and
 * addresses are theirs again — and a brand-new one gets a row with no auth link,
 * which the first sign-in claims by email.
 */
async function attachGuestCustomer(
  orderId: string,
  draftReference: string,
  input: CheckoutContactInput | null,
): Promise<Result<null>> {
  if (!input) return failure(CHECKOUT_CONTACT_REQUIRED, 'Tell us who the order is from.');

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return failure(CHECKOUT_CONTACT_REQUIRED, parsed.error.issues[0].message);

  const normalizedEmail = normalizeEmail(parsed.data.email);
  const existing = await survivorOf(await db.customer.findUnique({ where: { normalizedEmail } }));

  const customer =
    existing ??
    (await db.customer.create({
      data: {
        email: parsed.data.email.trim(),
        normalizedEmail,
        fullName: parsed.data.fullName,
        // A phone already on another account would collide with the unique
        // index, and the office merges those by hand (R-144). A guest order is
        // not the place to fail over a field the receipt does not need.
        ...(await phoneFieldsIfFree(parsed.data.phone)),
      },
    }));

  await db.order.update({ where: { id: orderId }, data: { customerId: customer.id } });
  await recordAudit(null, {
    action: 'order.draft_claimed',
    entityType: 'Order',
    entityId: orderId,
    detail: { draftReference },
  });

  return ok(null);
}

async function phoneFieldsIfFree(
  phone: string | null,
): Promise<{ phone?: string; normalizedPhone?: string }> {
  const normalizedPhone = phone === null ? null : normalizePhone(phone);
  if (phone === null || normalizedPhone === null) return {};

  const taken = await db.customer.findUnique({ where: { normalizedPhone } });
  return taken ? {} : { phone, normalizedPhone };
}

function blockingReason(
  conflictCount: number,
  summary: { unassignedCount: number; missingDeliveryDayCount: number; recipients: unknown[] },
): string {
  if (summary.recipients.length === 0) return 'There is nothing in your order yet.';

  if (summary.unassignedCount > 0) {
    return `${summary.unassignedCount} item${summary.unassignedCount === 1 ? ' is' : 's are'} still waiting for a recipient.`;
  }

  if (conflictCount > 0) return 'Something in your order changed. Check the notes above and try again.';

  return 'Choose a delivery day for every delivery before paying.';
}
