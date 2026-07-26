import { PrismaClient } from '@prisma/client';

import { DATABASE_URL, TEST_DATABASE_URL } from './db-server';
import { parseForms, Session, type ParsedForm } from './http-form';
import { envWithoutDatabaseUrl, runCommand, runTests, SmokeRun } from './smoke-harness';
import { cartLines, dollars, formWith, noticeOf, redirectOf } from './smoke-p4-helpers';
import { signStripePayload } from '../src/lib/payments/stripe-signature';

/**
 * Phase P5 smoke run: checkout, delivery fees, hosted payment, the webhook, the
 * cash drawer and the order lifecycle — driven over HTTP against the running
 * app, with the database read afterwards to check what actually happened.
 *
 * Expects `npm run dev` up on 3104 against the seeded database.
 */
const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3104';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

const MANAGER_EMAIL = 'manager@tomchei.example';
const DRIVER_EMAIL = 'driver@tomchei.example';

const CLASSIC = 'classic-mishloach-manos';
const BASKET = 'deluxe-wine-basket';

/** In the seeded delivery area (08701, 08753, 10952) and well outside it. */
const IN_AREA = {
  line1: '412 Forest Avenue',
  line2: '',
  city: 'Lakewood',
  state: 'NJ',
  postalCode: '08701',
  phone: '',
  label: '',
};
const SECOND_DOOR = { ...IN_AREA, line1: '88 Yeshiva Lane', city: 'Monsey', state: 'NY', postalCode: '10952' };
const OUT_OF_AREA = { ...IN_AREA, line1: '30 Bedford Avenue', city: 'Brooklyn', state: 'NY', postalCode: '11211' };

const TEST_FILES = ['tests/checkout.test.ts', 'tests/payments.test.ts', 'tests/env-spec.test.ts'];

const db = new PrismaClient({ datasourceUrl: DATABASE_URL });

const run = new SmokeRun('P5', [
  `Run at ${new Date().toISOString()} against ${BASE_URL} (web 3104, db 4104).`,
  'Every check is a real HTTP request against the running app, a server action',
  'replayed from the HTML it rendered, a signed webhook posted to the live',
  'endpoint, a database read, or a named unit test.',
]);

const record = run.record.bind(run);
const expect = run.expect.bind(run);
const expectTest = run.expectTest.bind(run);

async function main() {
  const season = await db.season.findFirstOrThrow({
    where: { status: 'OPEN' },
    orderBy: { year: 'desc' },
  });

  // Carts and half-finished payments from an earlier run would answer some of
  // these checks before this one builds anything.
  await db.order.deleteMany({ where: { status: 'DRAFT' } });

  const methods = await db.fulfillmentMethod.findMany({ where: { isActive: true } });
  const method = (code: string) => methods.find((row) => row.code === code)!.id;
  const pickup = await db.pickupLocation.findFirstOrThrow({ where: { isActive: true } });
  const days = await deliveryDays();

  // ------------------------------------------------- S1 hosted checkout, paid
  const buyer = new Session(BASE_URL);
  await addToCart(buyer, CLASSIC, { quantity: '1', 'option:Size': 'Standard' });
  await addToCart(buyer, CLASSIC, { quantity: '1', 'option:Size': 'Standard' });
  await addToCart(buyer, CLASSIC, { quantity: '1', 'option:Size': 'Standard' });

  const buyerLines = cartLines((await buyer.get('/order')).body);
  await assign(buyer, buyerLines[0].id, {
    target: 'self',
    recipientName: 'Yosef Guest',
    fulfillmentMethodId: method('pickup'),
    pickupLocationId: pickup.id,
  });
  await assign(buyer, buyerLines[1].id, {
    target: 'new',
    recipientName: 'Miriam Klein',
    fulfillmentMethodId: method('deliver'),
    greetingMessage: '',
    ...IN_AREA,
  }, { add: true });
  await assign(buyer, buyerLines[2].id, {
    target: 'new',
    recipientName: 'Rabbi Stein',
    fulfillmentMethodId: method('ship'),
    greetingMessage: '',
    ...SECOND_DOOR,
  }, { add: true });

  const firstLook = await buyer.get('/order/checkout');
  const openRecipients = recipientCards(firstLook.body);

  // P8 put a live carrier quote where this phase had a flat placeholder, so the
  // shipping figure is no longer a constant this run can name. What P5 owns is
  // still checked: one card per recipient, each priced by its own method, and
  // pickup free. The exact carrier number is proved by the P8 smoke.
  expect('S1a', 'Checkout lists every recipient with the fee its own method earns',
    firstLook.status === 200 &&
      openRecipients.length === 3 &&
      openRecipients.some((card) => card.method === 'PICKUP' && card.feeCents === 0) &&
      openRecipients.some((card) => card.method === 'DELIVERY' && card.feeCents === 500) &&
      openRecipients.some((card) => card.method === 'SHIPPING' && card.feeCents > 0),
    `${openRecipients.length} recipients: ${openRecipients.map((card) => `${card.method.toLowerCase()} ${dollars(card.feeCents)}`).join(', ')} — pickup free, the volunteer run at its own rate, shipping at the live carrier rate P8 replaced the placeholder with`);

  const blocked = await buyer.get('/order/checkout');
  expect('S1b', 'A delivery cannot be paid for until one of the manager\u2019s days is chosen',
    payableOf(blocked.body) === 'false' &&
      blocked.body.includes('data-testid="checkout-blocked"') &&
      days.length > 0 &&
      blocked.body.includes(days[0]),
    `checkout reports data-payable="false" while a delivery has no day; the picker offers ${days.length} manager-set days (${days.join(', ')})`);

  await chooseEveryDeliveryDay(buyer, days[0]);
  await saveDefaultGreeting(buyer, 'Freilichen Purim from the Guest family');

  const ready = await buyer.get('/order/checkout');
  const readyCards = recipientCards(ready.body);
  const quotedTotal = totalOf(ready.body);
  expect('S1c', 'The card and the day are saved on the boxes, and the page adds up',
    payableOf(ready.body) === 'true' &&
      quotedTotal === centsIn(ready.body, 'checkout-items') + centsIn(ready.body, 'checkout-fees') &&
      readyCards.reduce((total, card) => total + card.feeCents, 0) === centsIn(ready.body, 'checkout-fees'),
    `items ${dollars(centsIn(ready.body, 'checkout-items'))} + fulfillment ${dollars(centsIn(ready.body, 'checkout-fees'))} = ${dollars(quotedTotal)}; the three recipient cards sum to the same fulfillment total`);

  const payForm = formWith(ready.body, '/order/checkout', 'data-testid="checkout-pay"');
  const hostedUrl = redirectOf(
    await buyer.submit(payForm, {
      fullName: 'Yosef Guest',
      email: `guest-${Date.now()}@example.com`,
      phone: '',
    }),
    'paying',
  );

  const hostedPath = new URL(hostedUrl, BASE_URL).pathname;
  const hosted = await buyer.get(hostedPath);
  const order = await db.order.findFirstOrThrow({
    where: { seasonId: season.id, status: 'PLACED' },
    orderBy: { placedAt: 'desc' },
  });
  const attempt = await db.stripePaymentIntent.findFirstOrThrow({ where: { orderId: order.id } });

  expect('S1d', 'Paying places the order, reserves the stock and opens a hosted session for it',
    hosted.status === 200 &&
      hosted.body.includes('data-testid="hosted-pay"') &&
      order.orderNumber !== null &&
      order.totalCents === quotedTotal &&
      order.paymentStatus === 'UNPAID' &&
      attempt.status === 'open' &&
      attempt.amountCents === quotedTotal,
    `order #${order.orderNumber} placed at ${dollars(order.totalCents)}, unpaid, holding session ${attempt.stripeSessionId} for the same amount; the customer is on ${hostedPath}`);

  const packages = await db.package.findMany({ where: { orderId: order.id } });
  const reservations = await db.reservation.findMany({ where: { orderId: order.id } });
  expect('S1e', 'Every box carries the fee it was quoted, frozen at checkout',
    packages.length === 3 &&
      packages.reduce((total, row) => total + row.fulfillmentFeeCents, 0) === order.fulfillmentFeeCents &&
      reservations.length > 0 &&
      reservations.every((row) => row.status === 'HELD'),
    `${packages.length} packages carry ${packages.map((row) => dollars(row.fulfillmentFeeCents)).join(' + ')} = order fulfillment ${dollars(order.fulfillmentFeeCents)}; ${reservations.reduce((units, row) => units + row.quantity, 0)} units of stock held against the order`);

  const hostedForm = formWith(hosted.body, hostedPath, 'data-testid="hosted-pay"');
  const paidRedirect = redirectOf(await buyer.submit(hostedForm), 'confirming the payment');
  const paidOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  const payments = await db.payment.findMany({ where: { orderId: order.id } });

  expect('S1f', 'The provider callback is what marks the order paid, not the redirect',
    payments.length === 1 &&
      payments[0].method === 'STRIPE' &&
      paidOrder.paymentStatus === 'PAID' &&
      paidOrder.amountPaidCents === order.totalCents &&
      paidRedirect.includes(`/order/confirmation?order=${order.id}`),
    `one STRIPE payment of ${dollars(payments[0].amountCents)}; order reads ${paidOrder.paymentStatus}; browser landed on ${paidRedirect}`);

  // The same session pressed twice is the duplicate delivery Stripe is famous
  // for: same event id, so the claim row refuses it.
  await buyer.submit(hostedForm);
  const afterReplay = await db.payment.count({ where: { orderId: order.id } });
  const ordersForSession = await db.stripePaymentIntent.count({ where: { orderId: order.id } });
  const replayedReservations = await db.reservation.count({ where: { orderId: order.id } });
  expect('S1g', 'Replaying the callback posts nothing a second time',
    afterReplay === 1 &&
      ordersForSession === 1 &&
      replayedReservations === reservations.length &&
      (await db.order.count({ where: { id: order.id } })) === 1,
    `after a second identical callback: still 1 order, 1 payment, ${replayedReservations} reservation row(s), 1 hosted session`);

  const confirmation = await buyer.get(`/order/confirmation?order=${order.id}`);
  const stranger = await new Session(BASE_URL).get(`/order/confirmation?order=${order.id}`);
  expect('S1h', 'The confirmation is readable by the browser that owns the order and nobody else',
    confirmation.status === 200 &&
      confirmation.body.includes('data-payment-status="PAID"') &&
      stranger.status === 404,
    `owner -> 200 showing PAID; another browser with the same order id -> ${stranger.status} (same answer as an invented id)`);

  // ------------------------------------------------- S1 webhook authenticity
  const body = JSON.stringify({
    id: `evt_forged_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: attempt.stripeSessionId,
        payment_intent: 'pi_forged',
        amount_total: order.totalCents,
        payment_status: 'paid',
      },
    },
  });

  const unsigned = await postWebhook(body, null);
  const forged = await postWebhook(body, 't=1,v1=deadbeef');
  const stale = await postWebhook(body, signStripePayload(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600));
  const wrongSecret = await postWebhook(body, signStripePayload(body, 'a-different-signing-secret', Math.floor(Date.now() / 1000)));
  const fromABrowser = await postWebhook(
    body,
    signStripePayload(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000)),
    BASE_URL,
  );

  expect('S1i', 'The webhook endpoint answers only to a current signature made with our secret',
    unsigned.status === 400 && forged.status === 400 && stale.status === 400 &&
      wrongSecret.status === 400 && fromABrowser.status === 403 &&
      (await db.payment.count({ where: { orderId: order.id } })) === 1,
    `no signature -> ${unsigned.status}, forged -> ${forged.status}, an hour old -> ${stale.status}, wrong secret -> ${wrongSecret.status}, correctly signed but sent by a browser -> ${fromABrowser.status}; still 1 payment on the order`);

  const unknown = await postSignedWebhook({
    id: `evt_unknown_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_never_opened',
        payment_intent: 'pi_unknown',
        amount_total: 1000,
        payment_status: 'paid',
      },
    },
  });
  expect('S1j', 'A properly signed event for a session we never opened is accepted and ignored',
    unknown.status === 200 && unknown.outcome === 'unknown_session',
    `POST /api/webhooks/stripe -> ${unknown.status} {"outcome":"${unknown.outcome}"}, no payment written`);

  const foreign = await postReport({ origin: 'https://not-us.example', message: 'x' });
  const originless = await postReport({ origin: null, message: 'x' });
  const malformed = await postReport({ origin: BASE_URL, message: 'x'.repeat(900) });
  const ourOwn = await postReport({ origin: BASE_URL, message: 'Checkout page blew up' });

  expect('S1k', 'The other public endpoint takes reports only from our own pages, and only in shape',
    foreign.status === 403 && originless.status === 403 && malformed.status === 400 && ourOwn.status === 200,
    `POST /api/client-error: another origin -> ${foreign.status}, no origin at all -> ${originless.status}, an over-long message -> ${malformed.status}, our own page -> ${ourOwn.status}`);

  // --------------------------------------------- S2 delivery fees + zip block
  const zipTester = new Session(BASE_URL);
  await addToCart(zipTester, CLASSIC, { quantity: '1', 'option:Size': 'Standard' });
  const zipLine = cartLines((await zipTester.get('/order')).body)[0];
  const refusedDelivery = await assign(zipTester, zipLine.id, {
    target: 'new',
    recipientName: 'Out Of Area',
    fulfillmentMethodId: method('deliver'),
    greetingMessage: '',
    ...OUT_OF_AREA,
  }, { add: true });
  const shippedInstead = await assign(zipTester, zipLine.id, {
    target: 'new',
    recipientName: 'Out Of Area',
    fulfillmentMethodId: method('ship'),
    greetingMessage: '',
    ...OUT_OF_AREA,
  }, { add: true });
  const blockedLine = await db.orderLine.findUniqueOrThrow({ where: { id: zipLine.id } });

  expect('S2a', 'Volunteer delivery is refused outside the ZIP list, with no override anywhere',
    problemOf(refusedDelivery).includes('Volunteers do not drive') &&
      blockedLine.fulfillmentMethodId === method('ship'),
    `delivery to ${OUT_OF_AREA.postalCode} -> "${problemOf(refusedDelivery)}"; the same address ships instead (${noticeOf(shippedInstead).replaceAll('+', ' ')})`);

  const perPackage = await feeScenario(method('deliver'));
  const bulk = await feeScenario(method('deliver-bulk'));

  expect('S2b', 'Per-package delivery bills each box; bulk delivery bills each door',
    perPackage.fees.length === 2 &&
      perPackage.totalFeeCents === 1500 &&
      bulk.totalFeeCents === 1600 &&
      bulk.packages === 3 &&
      perPackage.packages === 3,
    `same three boxes to two doors: per-package ${perPackage.fees.map(dollars).join(' + ')} = ${dollars(perPackage.totalFeeCents)} (3 × $5.00); bulk ${bulk.fees.map(dollars).join(' + ')} = ${dollars(bulk.totalFeeCents)} (2 × $8.00, the second box on the same drive is free)`);

  // ------------------------------------------------- S3 stale prices and stock
  const staler = new Session(BASE_URL);
  await addToCart(staler, CLASSIC, { quantity: '1', 'option:Size': 'Standard' });
  const staleLine = cartLines((await staler.get('/order')).body)[0];
  await assign(staler, staleLine.id, {
    target: 'self',
    recipientName: 'Stale Cart',
    fulfillmentMethodId: method('pickup'),
    pickupLocationId: pickup.id,
  });

  const beforeChange = await staler.get('/order/checkout');
  const staleForm = formWith(beforeChange.body, '/order/checkout', 'data-testid="checkout-pay"');
  const oldTotal = totalOf(beforeChange.body);

  const product = await db.product.findFirstOrThrow({
    where: { slug: CLASSIC, seasonId: season.id },
  });
  await db.product.update({ where: { id: product.id }, data: { priceCents: product.priceCents + 500 } });

  const afterChange = await staler.get('/order/checkout');
  const refusedStale = await staler.submit(staleForm, {
    fullName: 'Stale Cart',
    email: `stale-${Date.now()}@example.com`,
  });
  const stillDraft = await db.order.findFirstOrThrow({ where: { id: orderIdOf(afterChange.body) } });

  expect('S3a', 'A price that moved under the cart is shown as a conflict and refuses the payment',
    afterChange.body.includes('data-testid="checkout-conflict"') &&
      afterChange.body.includes('data-kind="price"') &&
      payableOf(afterChange.body) === 'false' &&
      problemOf(redirectOf(refusedStale, 'paying a stale cart')).length > 0 &&
      stillDraft.status === 'DRAFT',
    `the page quoted ${dollars(oldTotal)}; after the catalogue moved to ${dollars(product.priceCents + 500)} it shows a price conflict, refuses to pay ("${problemOf(redirectOf(refusedStale, 'paying'))}") and leaves the cart a draft`);

  await db.product.update({ where: { id: product.id }, data: { priceCents: product.priceCents } });

  const repriced = await staler.get('/order/checkout');
  const goodForm = formWith(repriced.body, '/order/checkout', 'data-testid="checkout-pay"');
  const tampered = await staler.submit(goodForm, {
    expectedTotalCents: '1',
    fullName: 'Stale Cart',
    email: `tamper-${Date.now()}@example.com`,
  });
  const notPlaced = await db.order.findFirstOrThrow({ where: { id: orderIdOf(repriced.body) } });

  expect('S3b', 'A hand-edited total fails validation instead of being charged',
    problemOf(redirectOf(tampered, 'a tampered total')).includes('total changed') &&
      notPlaced.status === 'DRAFT' &&
      notPlaced.orderNumber === null,
    `posting expectedTotalCents=1 against a ${dollars(totalOf(repriced.body))} cart -> "${problemOf(redirectOf(tampered, 'a tampered total'))}"; the order is still a draft with no number`);

  // ------------------------------------------------------------- S4 POS money
  const walkIn = new Session(BASE_URL);
  const posOrder = await placeUnpaidOrder(walkIn, method('pickup'), pickup.id);

  const manager = new Session(BASE_URL);
  await signInStaff(manager, MANAGER_EMAIL);

  const desk = await manager.get(`/admin/orders/${posOrder.id}`);
  const postForm = formWith(desk.body, `/admin/orders/${posOrder.id}`, 'data-testid="pos-post"');
  await manager.submit(postForm, {
    method: 'CASH',
    amount: (posOrder.totalCents / 100).toFixed(2),
    reference: 'Drawer 2',
  });

  const cashPaid = await db.order.findUniqueOrThrow({ where: { id: posOrder.id } });
  const cashPayment = await db.payment.findFirstOrThrow({ where: { orderId: posOrder.id } });
  const postedAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'payment.posted', entityId: cashPayment.id },
  });

  expect('S4a', 'Staff take cash against a placed order, and the audit trail names them',
    cashPaid.paymentStatus === 'PAID' &&
      cashPayment.method === 'CASH' &&
      cashPayment.recordedByStaffUserId !== null &&
      postedAudit.actorLabel.includes(MANAGER_EMAIL),
    `${dollars(cashPayment.amountCents)} cash against order #${cashPaid.orderNumber} -> ${cashPaid.paymentStatus}; audit "${postedAudit.action}" by ${postedAudit.actorLabel}`);

  const withPayment = await manager.get(`/admin/orders/${posOrder.id}`);
  const voidForm = formWith(withPayment.body, `/admin/orders/${posOrder.id}`, 'data-testid="payment-void"');
  await manager.submit(voidForm, { reason: 'Rang it up twice' });

  const voided = await db.payment.findUniqueOrThrow({ where: { id: cashPayment.id } });
  const afterVoid = await db.order.findUniqueOrThrow({ where: { id: posOrder.id } });
  const voidAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'payment.voided', entityId: cashPayment.id },
  });

  expect('S4b', 'A void keeps the row, states the reason and takes the money back off the order',
    voided.state === 'VOIDED' &&
      voided.voidReason === 'Rang it up twice' &&
      afterVoid.paymentStatus === 'UNPAID' &&
      afterVoid.amountPaidCents === 0 &&
      voidAudit.actorStaffUserId !== null,
    `payment ${voided.id.slice(0, 8)} -> VOIDED ("${voided.voidReason}"); order back to ${afterVoid.paymentStatus} at ${dollars(afterVoid.amountPaidCents)}; audited by ${voidAudit.actorLabel}`);

  const customerAttempt = await walkIn.request(`/admin/orders/${posOrder.id}`);
  const anonymous = await new Session(BASE_URL).request(`/admin/orders/${posOrder.id}`);
  const driver = new Session(BASE_URL);
  await signInStaff(driver, DRIVER_EMAIL);
  const driverAttempt = await driver.get(`/admin/orders/${posOrder.id}`);
  const publicPost = await walkIn.submit(postForm, { method: 'CASH', amount: '1.00' });
  const publicPostTook = (publicPost.headers.get('location') ?? '').includes('notice=');
  const bounce = new URL(customerAttempt.headers.get('location') ?? BASE_URL, BASE_URL).pathname;

  expect('S4c', 'Cash and checks are staff-only: the storefront cannot reach them at all',
    customerAttempt.status === 307 &&
      anonymous.status === 307 &&
      bounce === '/sign-in' &&
      driverAttempt.status === 403 &&
      !publicPostTook &&
      (await db.payment.count({ where: { orderId: posOrder.id } })) === 1,
    `the buyer and a signed-out browser are turned away at the door (${customerAttempt.status} to ${bounce}); a signed-in DRIVER gets past the door and is refused the screen (${driverAttempt.status}); replaying the POS form from the storefront -> ${publicPost.status} with no payment added`);

  // -------------------------------------------------------- S5 order lifecycle
  const numbers = await db.order.findMany({
    where: { seasonId: season.id, orderNumber: { not: null } },
    orderBy: { orderNumber: 'asc' },
    select: { orderNumber: true },
  });
  const sequential = numbers.every((row, index) => index === 0 || row.orderNumber === (numbers[index - 1].orderNumber ?? 0) + 1);

  expect('S5a', 'Order numbers are sequential within the season and only placed orders have one',
    sequential &&
      (await db.order.count({ where: { status: 'DRAFT', orderNumber: { not: null } } })) === 0,
    `${numbers.length} placed orders numbered ${numbers.map((row) => row.orderNumber).join(', ')}; no draft holds a number`);

  const deskAgain = await manager.get(`/admin/orders/${posOrder.id}`);
  const transitionForm = formWith(deskAgain.body, `/admin/orders/${posOrder.id}`, 'data-testid="order-transition"');
  const forbidden = await manager.submit(transitionForm, { status: 'COMPLETED' });
  const afterForbidden = await db.order.findUniqueOrThrow({ where: { id: posOrder.id } });
  await manager.submit(transitionForm, { status: 'CANCELLED' });
  const cancelled = await db.order.findUniqueOrThrow({ where: { id: posOrder.id } });
  const released = await db.reservation.findMany({ where: { orderId: posOrder.id } });

  expect('S5b', 'The state machine allows the moves it should and refuses the rest',
    afterForbidden.status === 'PLACED' &&
      problemOf(redirectOf(forbidden, 'an illegal transition')).length > 0 &&
      cancelled.status === 'CANCELLED' &&
      released.every((row) => row.status === 'RELEASED'),
    `placed -> completed refused ("${problemOf(redirectOf(forbidden, 'an illegal transition'))}"); placed -> cancelled allowed, and the ${released.reduce((units, row) => units + row.quantity, 0)} units it was holding went back on the shelf`);

  const discarder = new Session(BASE_URL);
  await signInCustomer(discarder, `discard-${Date.now()}@example.com`, 'Changed Mind');
  await addToCart(discarder, CLASSIC, { quantity: '1', 'option:Size': 'Standard' });
  const discardLine = cartLines((await discarder.get('/order')).body)[0];
  await assign(discarder, discardLine.id, {
    target: 'self',
    fulfillmentMethodId: method('pickup'),
    pickupLocationId: pickup.id,
  });

  const discardId = orderIdOf((await discarder.get('/order/checkout')).body);
  const draftDetail = await discarder.get(`/account/orders/${discardId}`);
  await discarder.submit(formWith(draftDetail.body, `/account/orders/${discardId}`, 'data-testid="detail-cancel"'));

  const discarded = await db.order.findUniqueOrThrow({ where: { id: discardId } });
  const emptyAfterDiscard = await discarder.get('/order');

  expect('S5c', 'A cancelled draft is discarded rather than cancelled, and takes no order number with it',
    discarded.status === 'DISCARDED' &&
      discarded.orderNumber === null &&
      discarded.discardedAt !== null &&
      cartLines(emptyAfterDiscard.body).length === 0,
    `the customer cancelled ${discarded.draftReference} from their account: status ${discarded.status}, no order number, and /order comes back empty`);

  // A callback that disagrees with the order is the one case where money is
  // taken and handed straight back, so it is checked end to end.
  const mismatchBuyer = new Session(BASE_URL);
  const mismatchOrder = await placeUnpaidOrder(mismatchBuyer, method('pickup'), pickup.id);
  const mismatchAttempt = await db.stripePaymentIntent.findFirstOrThrow({
    where: { orderId: mismatchOrder.id },
  });

  const mismatch = await postSignedWebhook({
    id: `evt_mismatch_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: mismatchAttempt.stripeSessionId,
        payment_intent: `pi_mismatch_${Date.now()}`,
        amount_total: mismatchOrder.totalCents - 100,
        payment_status: 'paid',
      },
    },
  });

  const handedBack = await db.order.findUniqueOrThrow({ where: { id: mismatchOrder.id } });
  const mismatchPayment = await db.payment.findFirstOrThrow({
    where: { orderId: mismatchOrder.id },
    include: { refunds: true },
  });
  const autoAudit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'payment.auto_refunded', entityId: mismatchOrder.id },
  });

  expect('S5d', 'A charge for the wrong amount is written down, refunded in full and the order cancelled',
    mismatch.outcome === 'auto_refunded' &&
      mismatchPayment.amountCents === mismatchOrder.totalCents - 100 &&
      mismatchPayment.refunds.length === 1 &&
      handedBack.status === 'CANCELLED' &&
      handedBack.amountPaidCents === 0,
    `charged ${dollars(mismatchPayment.amountCents)} for a ${dollars(mismatchOrder.totalCents)} order -> ${mismatch.outcome}; refunded ${dollars(mismatchPayment.refunds[0].amountCents)}, order ${handedBack.status}, audit "${autoAudit.action}"`);

  const cardDesk = await manager.get(`/admin/orders/${order.id}`);
  const refundForm = formWith(cardDesk.body, `/admin/orders/${order.id}`, 'data-testid="payment-refund"');
  await manager.submit(refundForm, { amount: '5.00', reason: 'One box never made it' });
  const partlyRefunded = await db.order.findUniqueOrThrow({ where: { id: order.id } });

  expect('S5e', 'A staff refund moves the cached payment status the same way a provider refund does',
    partlyRefunded.amountPaidCents === order.totalCents - 500 &&
      partlyRefunded.paymentStatus === 'PARTIALLY_PAID',
    `$5.00 back on order #${order.orderNumber}: paid ${dollars(partlyRefunded.amountPaidCents)} of ${dollars(order.totalCents)}, cached status ${partlyRefunded.paymentStatus}`);

  // --------------------------------------------------------- unit test citations
  const testRun = runTests(TEST_FILES, TEST_DATABASE_URL);
  const passedTests = new Set(testRun.passed);

  expectTest('P5-1', 'Delivery rules and fee resolution are covered by unit tests', passedTests, [
    'per-package delivery bills every recipient, bulk bills every destination',
    'pickup is free and shipping follows the settings rate rules',
    'the quote a customer sees is the amount the order is placed at, frozen per box',
  ]);

  expectTest('P5-2', 'Checkout validation and greetings are covered by unit tests', passedTests, [
    'a total that does not match the page is refused, and nothing is placed',
    'checkout reports a re-price and a sold-out shelf, and refuses to charge',
    'a product taken off sale is a conflict, not a silent removal',
    'the order default fills empty cards and leaves overrides alone',
    "a recipient's card is saved on their address for next season",
    'a delivery day has to be one the manager opened, and is required before paying',
    'an order with a line nobody is receiving cannot be paid for',
  ]);

  expectTest('P5-3', 'Webhook authenticity, idempotency and refunds are covered by unit tests', passedTests, [
    'a signature is only good for its own body, its own secret and its own hour',
    'a paid session posts one payment, and a replay of it posts none',
    'a charge for the wrong amount is recorded, handed straight back, and the order cancelled',
    'a session that completes without money posts nothing',
    'a refund issued at the provider is synced once, then only the difference',
    'an event for a session we never opened changes nothing',
    'an event that fails part way is retried, not answered as a replay',
  ]);

  expectTest('P5-4', 'The offline payment policy is covered by unit tests', passedTests, [
    'cash and checks are staff-only, and a void takes the money back off the order',
    'a refund cannot exceed what is left of the payment',
    'a draft cannot be paid for at the counter',
    'the counter cannot overpay an order, or take money for a closed one',
    'the payment stand-in is loopback-only and the provider needs its keys',
  ]);

  record('P5-5', 'The P5 test files are green', testRun.failed.length === 0,
    `${testRun.passed.length} tests passed, ${testRun.failed.length} failed`);

  const ci = runCommand('npm', ['run', 'ci'], envWithoutDatabaseUrl());
  record('P5-6', 'Lint, typecheck, migration guard and the whole suite pass', ci.status === 0,
    ci.status === 0 ? 'npm run ci exited 0' : ci.output.trim().split('\n').slice(-6).join(' / '));

  run.write();
}

/**
 * Three boxes to two doors, priced by one method. Used twice — once with the
 * per-package rule and once with the bulk rule — so the two answers can be
 * compared on identical carts.
 */
async function feeScenario(
  fulfillmentMethodId: string,
): Promise<{ fees: number[]; totalFeeCents: number; packages: number }> {
  const session = new Session(BASE_URL);
  await addToCart(session, CLASSIC, { quantity: '1', 'option:Size': 'Standard' });
  await addToCart(session, CLASSIC, { quantity: '1', 'option:Size': 'Standard' });
  await addToCart(session, BASKET, { quantity: '1' });

  const lines = cartLines((await session.get('/order')).body);

  // Two boxes to the same door with different cards: one destination, two
  // packages, which is exactly where the two fee rules disagree.
  await assign(session, lines[0].id, {
    target: 'new',
    recipientName: 'Miriam Klein',
    fulfillmentMethodId,
    greetingMessage: 'From the family',
    ...IN_AREA,
  }, { add: true });
  await assign(session, lines[1].id, {
    target: 'new',
    recipientName: 'Miriam Klein',
    fulfillmentMethodId,
    greetingMessage: 'And one from the children',
    ...IN_AREA,
  }, { add: true });
  await assign(session, lines[2].id, {
    target: 'new',
    recipientName: 'Rabbi Stein',
    fulfillmentMethodId,
    greetingMessage: 'A gut yom tov',
    ...SECOND_DOOR,
  }, { add: true });

  const page = await session.get('/order/checkout');
  const orderId = orderIdOf(page.body);
  const lineRows = await db.orderLine.findMany({ where: { orderId } });
  const groupingKeys = new Set(
    lineRows.map((row) => `${row.recipientName}|${row.addressLine1}|${row.greetingMessage}`),
  );

  return {
    fees: recipientCards(page.body).map((card) => card.feeCents),
    totalFeeCents: centsIn(page.body, 'checkout-fees'),
    packages: groupingKeys.size,
  };
}

/** Builds a one-box order and takes it as far as the hosted page, unpaid. */
async function placeUnpaidOrder(
  session: Session,
  fulfillmentMethodId: string,
  pickupLocationId: string,
): Promise<{ id: string; totalCents: number; orderNumber: number | null }> {
  await addToCart(session, BASKET, { quantity: '1' });
  const line = cartLines((await session.get('/order')).body)[0];
  await assign(session, line.id, {
    target: 'self',
    recipientName: 'Counter Customer',
    fulfillmentMethodId,
    pickupLocationId,
  });

  const page = await session.get('/order/checkout');
  const form = formWith(page.body, '/order/checkout', 'data-testid="checkout-pay"');
  const orderId = orderIdOf(page.body);

  await session.submit(form, {
    fullName: 'Counter Customer',
    email: `counter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
  });

  const placed = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  return { id: placed.id, totalCents: placed.totalCents, orderNumber: placed.orderNumber };
}

async function deliveryDays(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: 'delivery.dayChoices' } });
  return Array.isArray(row?.value) ? (row.value as string[]) : [];
}

async function chooseEveryDeliveryDay(session: Session, day: string): Promise<void> {
  for (;;) {
    const page = await session.get('/order/checkout');
    const form = parseForms(page.body, '/order/checkout').find(
      (candidate) =>
        candidate.html.includes('data-testid="delivery-day-submit"') &&
        !page.body.includes(`data-chosen="${day}"`),
    );
    if (!form) return;

    await session.submit(form, { deliveryDay: day });
    if (!(await session.get('/order/checkout')).body.includes('data-testid="checkout-blocked"')) return;
  }
}

async function saveDefaultGreeting(session: Session, greeting: string): Promise<void> {
  const page = await session.get('/order/checkout');
  const form = formWith(page.body, '/order/checkout', 'data-testid="default-greeting-submit"');
  await session.submit(form, { greetingMessage: greeting });
}

type RecipientCard = { feeCents: number; boxCount: number; method: string };

function recipientCards(html: string): RecipientCard[] {
  return html
    .split('data-testid="checkout-recipient"')
    .slice(1)
    .map((chunk) => ({
      feeCents: Number(/data-fee-cents="(-?\d+)"/.exec(chunk)?.[1] ?? -1),
      boxCount: Number(/data-box-count="(\d+)"/.exec(chunk)?.[1] ?? -1),
      method: /data-method="([A-Z]+)"/.exec(chunk)?.[1] ?? '',
    }));
}

function payableOf(html: string): string {
  return /data-payable="([a-z]+)"/.exec(html)?.[1] ?? '';
}

function totalOf(html: string): number {
  return Number(/data-testid="checkout-total" data-cents="(\d+)"/.exec(html)?.[1] ?? -1);
}

/** Reads a money figure the page rendered, so the check reads what a human reads. */
function centsIn(html: string, testId: string): number {
  const shown = new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? '';
  return Math.round(Number(shown.replace(/[^0-9.]/g, '')) * 100);
}

function orderIdOf(html: string): string {
  return /name="orderId" value="([^"]+)"/.exec(html)?.[1] ?? '';
}

/** Redirect params are form-encoded, so a space arrives as `+`. */
function problemOf(location: string): string {
  return decodeURIComponent((/problem=([^&]*)/.exec(location)?.[1] ?? '').replaceAll('+', ' '));
}

async function postWebhook(body: string, signature: string | null, origin?: string) {
  return fetch(new URL('/api/webhooks/stripe', BASE_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'stripe-signature': signature } : {}),
      ...(origin ? { origin } : {}),
    },
    body,
  });
}

function postReport(report: { origin: string | null; message: string }): Promise<Response> {
  return fetch(new URL('/api/client-error', BASE_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(report.origin ? { origin: report.origin } : {}),
    },
    body: JSON.stringify({ message: report.message, path: '/order/checkout' }),
  });
}

async function postSignedWebhook(event: unknown): Promise<{ status: number; outcome: string }> {
  const body = JSON.stringify(event);
  const response = await postWebhook(
    body,
    signStripePayload(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000)),
  );

  const parsed = (await response.json()) as { outcome?: string };
  return { status: response.status, outcome: parsed.outcome ?? '' };
}

async function signInCustomer(session: Session, email: string, fullName: string) {
  const page = await session.get('/account/sign-in');
  const response = await session.submit(parseForms(page.body, '/account/sign-in')[0], { email, fullName });
  if (response.status !== 303) throw new Error(`Customer sign-in for ${email} returned ${response.status}`);
}

async function signInStaff(session: Session, email: string) {
  session.clearCookies();
  const page = await session.get('/sign-in');
  const response = await session.submit(parseForms(page.body, '/sign-in')[0], { email });
  if (response.status !== 303) throw new Error(`Staff sign-in for ${email} returned ${response.status}`);
}

async function addToCart(session: Session, slug: string, values: Record<string, string>): Promise<void> {
  const page = await session.get('/order');
  const form = parseForms(page.body, '/order').find((candidate) => candidate.fields.slug === slug);
  if (!form) throw new Error(`No add form for ${slug} on the builder`);

  redirectOf(await session.submit(form, values), `adding ${slug}`);
}

async function assign(
  session: Session,
  lineId: string,
  values: Record<string, string>,
  options: { add?: boolean } = {},
): Promise<string> {
  const path = `/order?assign=${lineId}${options.add ? '&add=1' : ''}`;
  const page = await session.get(path);
  const marker = options.add ? 'data-testid="add-recipient-submit"' : 'data-testid="assign-submit"';
  const form: ParsedForm = formWith(page.body, path, marker);

  return redirectOf(await session.submit(form, { lineId, ...values }), `assigning ${lineId}`);
}

main()
  .catch((error) => {
    console.error(`\nSmoke run stopped: ${error instanceof Error ? error.message : error}`);
    run.write();
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
