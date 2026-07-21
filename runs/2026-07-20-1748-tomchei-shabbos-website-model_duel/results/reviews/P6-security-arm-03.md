# P6 Security Review — arm-03

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Workspace: `arms/arm-03/workspace/`
Expected: `shared/phases/PHASE-P6-EXPECTED.md`
Scope: admin operations hub, order list/detail + money actions + Stripe refund, POS (cash/check, no public POS payments), customer directory + find-or-create, staged atomic CSV import, settings hub, bounded list queries + bulk actions.
Findings only — no fixes.

## Severity summary

| Sev | Count |
|---|---|
| High | 2 |
| Medium | 3 |
| Low | 5 |
| Informational | 2 |

## High

### H1 — Refund route validates `paymentId` belongs to `orderId` AFTER the refund is executed
`src/app/api/admin/orders/[id]/refund/route.ts:20-31`, `src/lib/ops/refunds.ts:14-101`

```ts
const result = await refundPayment({
  paymentId: body.paymentId,
  amountCents: body.amountCents,
  staffId: staff.effectiveStaff.id,
  reason: body.reason,
});
if (!result.ok) { ... }
if (result.value.payment.orderId !== orderId) {
  return NextResponse.json({ ok: false, error: "Payment does not belong to this order." }, { status: 400 });
}
```

`refundPayment` runs the full money path (Stripe `refunds.create` in live mode, then `db.$transaction` that increments `refundedCents`, writes `PAYMENT_REFUNDED` audit, and recalcs cached payment status) and only after that does the route compare `result.value.payment.orderId !== orderId`. The path `id` is decorative: a staff member with `admin.access` can POST another order's `paymentId` to `/api/admin/orders/{anyOrderId}/refund` and the refund commits; the route then returns 400 "Payment does not belong to this order" while the refund already happened. The caller is misled into believing nothing occurred, and there is no rollback. The `paymentId → orderId` binding must be asserted before any Stripe or DB write.

### H2 — Stripe refund is created outside the DB transaction with no compensation on DB failure
`src/lib/ops/refunds.ts:60-99`

```ts
const refund = await stripe.refunds.create({ amount: input.amountCents, ... });
stripeRefundId = refund.id;
...
const result = await db.$transaction(async (tx) => {
  const updated = await tx.payment.update({ ... refundedCents: { increment: input.amountCents } });
  await tx.auditLog.create({ ... });
  const paymentStatus = await recalcOrderPaymentStatus(payment.orderId, tx);
  return { payment: updated, paymentStatus, stripeRefundId };
});
```

`stripe.refunds.create` runs before `db.$transaction`. If the transaction throws (DB connection blip, serialization failure, `recalcOrderPaymentStatus` error, version conflict), real money has already been returned to the customer but `refundedCents` is never incremented, no audit row is written, and `recalcOrderPaymentStatus` never runs — the ledger says PAID while the customer was refunded. There is no saga/compensation to reverse the Stripe refund when the DB write fails. Combined with H1's post-hoc 400, a single failed refund can diverge Stripe and the local ledger with no signal to operators. Either persist a `refundId` idempotency row first, or create the Stripe refund inside the transaction with an out-of-band reconciliation job.

## Medium

### M1 — `bulkUpdateOrderStatus` bypasses the order state machine
`src/lib/ops/repeat.ts:216-296`, `src/lib/orders/state-machine.ts:3-18`

The bulk path only skips DRAFT/DISCARDED and checks `version`, then writes `status: input.toStatus` directly. It never calls `assertOrderTransition`. The state machine allows `PLACED → {PAID, CANCELLED}` and `PAID → {FULFILLING, CANCELLED, COMPLETED}`; the bulk path accepts `toStatus = FULFILLING | COMPLETED | CANCELLED` from any non-draft status, so a PLACED (unpaid) order can be marked COMPLETED, or PLACED → FULFILLING, neither of which the single-order paths permit. A staff member with `admin.access` can close out unpaid orders in bulk, defeating the payment-gated transition that single-order flows enforce. Apply `assertOrderTransition(order.status, input.toStatus)` per item and report illegal transitions as conflicts/skips.

### M2 — CSV import has no row cap and does N+1 DB lookups per row
`src/lib/ops/import.ts:86-128, 142-187`, `src/app/api/admin/imports/route.ts:10`

`stageImport` accepts up to 2 MB of CSV (`csvText: z.string().min(1).max(2_000_000)`) with no row limit. `classifyCustomerRows`/`classifyProductRows` issue one `db.customer.findFirst`/`db.product.findFirst` per row inside a sequential loop — no `findMany` batch. A 2 MB CSV can be tens of thousands of rows, each issuing a sequential DB query in a single request, pinning a server worker and saturating the connection pool. `settings.write` is privileged, but one insider/compromised account can DoS the admin plane and starve checkout. Cap rows (e.g. 5k) and batch the existence checks with a single `findMany({ where: { OR: [...] } })`.

### M3 — `store-settings` PATCH accepts arbitrary JSON for most keys
`src/app/api/admin/store-settings/route.ts:56-86`

Only `deliveryZips` is schema-validated. `shippingRates`, `shippingRules`, `emailFrom`, `emailReplyTo`, `developerNotes`, `storeStatus` are stored as `z.unknown()` with no per-key shape enforcement. `shippingRules`/`shippingRates` feed the shipping engine; arbitrary shapes can break checkout pricing or inject unexpected rules. `emailFrom`/`emailReplyTo` as arbitrary JSON can later break transactional email or redirect replies. `settings.write` is privileged, but server-side per-key schemas should be enforced (the client `SettingsHub` already sends structured values — the API should reject anything else).

## Low

### L1 — `attach-customer` POS route mutates the draft with no audit row
`src/app/api/admin/pos/attach-customer/route.ts:28-31`

```ts
await db.order.update({
  where: { id: order.id },
  data: { customerId: customer.id, version: { increment: 1 } },
});
```

Attaching a walk-in customer to a POS draft changes `customerId` and bumps `version` but writes no `AuditLog` entry. The customer-attach action (which binds an order to a customer identity) is not attributable. Other draft mutations in the codebase write audit; this one is missing.

### L2 — `requirePermission` 403 discloses the exact missing permission name
`src/lib/auth.ts:138, 150`

`throw new AuthError(403, \`Missing permission: ${permission}\`)` returns the required permission string (e.g. `payments.refund`, `settings.write`) to any authenticated-but-unauthorized caller. A generic "Forbidden" leaks less about the permission graph to a low-privileged insider probing routes.

### L3 — `getOrderDetail` over-returns PII and raw Stripe objects
`src/lib/ops/orders.ts:73-100`

The admin order detail payload includes the entire `customer` row (`emailNorm`, `phoneNorm`, `clerkUserId`, etc.) and full `stripeSessions`/`stripeIntents` rows. `admin.access` is broad; any staff holding it can read customer PII and Stripe object metadata (session URLs, intent IDs) that the admin UI does not render (the UI's `OrderDetail` type only consumes `id`, `displayName`, `email`). Select only the fields the admin UI needs.

### L4 — `listOrders`/`listCustomers` crash on NaN page/pageSize
`src/lib/ops/orders.ts:20-28`, `src/lib/ops/customers.ts:16-17`, `src/app/api/admin/orders/route.ts:24-25`

`Number(url.searchParams.get("page"))` and `Number("...pageSize")` can be NaN. In `clampPageSize`, `NaN < 1` is false so NaN flows to `Math.min(MAX, Math.floor(NaN))` = NaN; in `listOrders`, `Math.max(1, NaN)` = NaN. Prisma then receives `skip: NaN`/`take: NaN` and throws, surfacing as a 500. A caller with `admin.access` can trivially 500 either route. Coerce to integers with `Number.isFinite` guards.

### L5 — Import `filename` stored unsanitized up to 200 chars
`src/app/api/admin/imports/route.ts:11`, `src/lib/ops/import.ts:214`

`filename: z.string().max(200).optional()` is persisted verbatim to `ImportBatch.filename`. React escapes by default so there is no XSS, but no normalization means a 200-char junk/path-like filename is stored and shown as-is in admin surfaces. Low.

## Informational

### I1 — Bulk actions write one aggregate audit row, not per-order
`src/lib/ops/repeat.ts:195-207, 280-290`

`BULK_ACTION_APPLIED` writes a single audit row whose `meta` includes `created`/`updated`/`conflicts`/`skipped` arrays with order IDs — so per-order attribution is recoverable from the row's meta (better than a summary-only row). Still a single audit row for a multi-target money-adjacent action; if the meta shape ever changes, per-target attribution is lost. Noted for completeness.

### I2 — Admin mutation routes are not rate-limited
`src/app/api/admin/**` (bulk, refund, repeat, import, banner, store-settings)

`withPublicGuard`/rate limiting is applied to public endpoints only. Admin mutation routes rely on cookie auth + `admin.access`/`settings.write` and same-site=lax. A compromised staff session can hammer refund/import/bulk endpoints without throttling. Staff are trusted, so informational.

## Out of scope (noted, not scored)

- P7+ surfaces (package board, greeting cards, Shippo, driver magic links, repeat-order replacement) — not present in this tree.
- Real Stripe key handling — env guards in `lib/env.ts` are correct; no real keys in the harness.
- Webhook signature/idempotency concerns — covered in P5 review (H1/H3, M1/M2); not regressed by P6 code.
