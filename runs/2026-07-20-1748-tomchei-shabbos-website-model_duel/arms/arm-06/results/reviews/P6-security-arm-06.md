# P6 Security Review — arm-06 (blind)

**Phase:** P6 — admin operations hub, POS, imports, bulk actions
**Scope:** `arms/arm-06/workspace/` — admin pages, `/api/admin/*` routes, `lib/orders/bulk.ts`, `lib/imports/*`, `lib/payments/*`, `lib/checkout/pos.ts`, `lib/permissions.ts`, `lib/auth.ts`, `middleware.ts`
**Output:** findings only, no fixes. Severity: Blocker / Major / Minor.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 4 |
| Minor | 5 |

The auth spine is solid: HMAC-signed session cookie, server-side `AuthSession` revocation/expiry check, permission-gated API (`requireApiPermission`) and pages (`requirePermission`), role-rank discipline on impersonation and staff writes, self-target blocks, optimistic-concurrency on staff mutations, anti-enumeration 404-on-miss for draft ownership, and tight upload validation (magic-byte sniff + size + extension match). The findings below are scoping and audit-trail gaps, not broken auth.

## Findings

### Major

#### M1. Bulk order action has no season/tenant scoping
`lib/orders/bulk.ts` `runBulkOrderAction` → `repeatOrder(orderId)` / `discardOrder(orderId)` operate on raw order ids with no season filter. The order *list* is scoped to the open season (`buildOrderWhere(openSeason.id, …)` in `app/(admin)/admin/orders/page.tsx`), but the bulk endpoint (`app/api/admin/orders/bulk/route.ts`) accepts any 100 order ids a `payments.manage` holder (which every STAFF role has) supplies. State-machine guards (DRAFT/FINALIZED) bound the damage, but a STAFF can repeat 100 finalized orders from any past season into the current open season, or discard drafts they cannot see in the list. Order ids are UUIDs (enumeration-resistant), so this is scoping leakage, not a direct break — but the bulk verb should scope the same way the list does.

#### M2. Bulk action audit does not record per-order outcomes
`app/api/admin/orders/bulk/route.ts` records a single `bulk_action` audit row with only `requested / succeeded / skipped` counts. The per-row report (which order was repeated vs. skipped and why) is returned to the client and discarded. For `discard` (releases stock, terminal state) and `repeat` (creates a new draft), an auditor cannot reconstruct *which* orders were affected from the audit log alone. A 100-row discard batch leaves one audit line with no target ids. This is an audit-trail gap for a destructive bulk verb.

#### M3. Refund on keyless host voids the payment without refunding the card
`lib/payments/refund.ts` `refundStripePayment`: when `getStripeConfig().secretKey` is null (the documented dev/keyless seam), the Stripe call is skipped and the payment is `voidPaymentTx`'d locally — flipping status to VOIDED and recomputing the order's `paymentStatus` as if the money were returned. The customer's card is still charged. The response honestly reports `stripeCalled: false` and tells staff to refund in the dashboard, but the *data state* (VOIDED + paymentStatus recomputed) is indistinguishable from a real refund to every downstream view (order detail, dashboard KPIs, customer history). A staff member relying on the UI could believe the refund completed. The local void should not happen until the Stripe refund succeeds (or the status should be a distinct `REFUND_PENDING` rather than VOIDED).

#### M4. Imports list leaks cross-permission batch metadata
`app/(admin)/admin/imports/page.tsx` fetches batches with `where: canCustomers ? {} : { kind: "PRODUCTS" }`. A STAFF holding only `customers.manage` (no `catalog.manage`) sees *all* PRODUCTS import batches in the recent-batches list — filename, row counts, status, committed count, actor email. The preview route (`app/api/admin/imports/[batchId]/route.ts`) correctly gates on `IMPORT_PERMISSION[batch.kind]`, so the rows cannot be opened, but the list itself exposes products-import metadata (filenames, volumes, who ran them) to a role not permitted to manage products. The list `where` should filter by the kinds the viewer can manage.

### Minor

#### m1. Impersonation stop does not re-check `staff.impersonate`
`app/api/admin/impersonation/stop/route.ts` uses `getAuthContext()` with no permission gate and only verifies the impersonator is still ACTIVE. It does not re-check that the impersonator still holds `staff.impersonate` (which could have been revoked via override while impersonation was active). Returning to your own identity is low-risk, but the permission that authorized the impersonation should still hold at stop time, consistent with the start route's gate.

#### m2. POS checkout `amountCents` is client-controlled with no upper bound
`app/api/admin/pos/checkout/route.ts` accepts `amountCents: z.number().int().positive().optional()`; `lib/payments/pos.ts` falls back to `finalized.totalCents`. A `payments.manage` holder can post an arbitrarily large cash/check/comp payment, driving the order to OVERPAID. Staff are trusted, but there is no sanity cap or relation-to-total check (e.g. reject amounts wildly exceeding the outstanding balance) to catch fat-finger or malicious input.

#### m3. Media upload does not verify product season
`app/api/admin/media/route.ts` checks the `productId` exists but not its season status. A `catalog.manage` holder can attach a photo to a product in a closed/CLOSED season. Low impact (catalog-manage is a manager-tier trust permission), but inconsistent with the open-season gates enforced everywhere ordering/imports touch a season.

#### m4. dev-auth route has no rate limit
`app/api/dev-auth/route.ts` is hard-disabled on any Vercel deploy (`isDevAuthBypass` requires `VERCEL_ENV` to be neither production nor preview), so this is local-dev hygiene only. In dev it accepts a `staffUserId` and issues a session with no rate limit and no attempt throttling, making local staff-id enumeration cheap. Gated by the env flag, so not production-relevant — flagged only for dev hygiene.

#### m5. Audit log page renders raw metadata without redaction
`app/(admin)/admin/audit/page.tsx` renders `JSON.stringify(entry.metadata)` (truncated to `max-w-xs`). Metadata includes PII: customer emails, phone numbers, addresses (address_update before/after), staff emails, impersonation targets. `audit.view` is MANAGER-default, so the audience is trusted, but the page has no pagination (bounded to 200 rows) and no redaction of PII fields — a screenshot or log scrape of the audit page exposes customer PII.

## Notes (no finding — confirmed good)

- Session cookie: HMAC-signed, httpOnly, sameSite=lax, secure in production, server-side `AuthSession` revocation/expiry re-checked every request (`lib/auth.ts`).
- Impersonation: reuses the actor's `authSessionId` (revoking it ends impersonation), target role rank ≤ actor role rank, self-target blocked, nested impersonation refused (`app/api/admin/staff/[id]/impersonate/route.ts`).
- Staff writes: role-rank check on target *and* assigned role, self-target blocked for role/override/revoke, optimistic concurrency via `version`, role change clears stale GRANTs (`app/api/admin/staff/[id]/route.ts`).
- Address IDOR: `before.customerId !== customerId` → 404 (`app/api/admin/customers/[customerId]/addresses/[addressId]/route.ts`).
- Upload path-traversal: strict `^[0-9a-f-]{36}\.(jpg|png|webp|gif)$` pattern + magic-byte sniff + size cap (`app/uploads/[name]/route.ts`, `lib/media/validation.ts`).
- Offline payment methods: server-side `access.staff` flag only constructible behind `requireApiPermission("payments.manage")`; public callers refused (`lib/checkout/submit.ts` `OfflinePaymentForbiddenError`).
- POS checkout refuses `card` method — card money only posts through the Stripe webhook (`app/api/admin/pos/checkout/route.ts`).
- Import commit: fresh duplicate re-check inside the commit transaction + `skipDuplicates` atomic backstop (`lib/imports/engine.ts`).
- CSV size capped at 2 MB, row count capped at 2000 (`lib/imports/engine.ts`).
- Webhook signature: timing-safe compare on raw body, 5-minute replay window (`lib/payments/stripe.ts`).
