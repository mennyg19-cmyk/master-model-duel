# P6 Quality review — arm-01

Reviewer specialist: Quality. Phase: P6 (Admin operations hub & POS).
Scope: `arms/arm-01/workspace/` vs `shared/phases/PHASE-P6-EXPECTED.md`.
Findings only, no fixes. Blind to model name.

Smoke evidence: `arms/arm-01/workspace/.scratch/PHASE-P6-SMOKE.md` — S1–S4 PASS, CI PASS, build PASS.

## High

1. **Stripe refund issued before DB transaction — double-refund / lost-record risk.** `src/app/api/admin/orders/[orderId]/refunds/route.ts` calls `stripe.refunds.create(...)` (lines 40–50) *before* the `$transaction` that records `refundedCents`. The transaction uses optimistic concurrency (`where: { id, refundedCents: payment.refundedCents }`) and returns `null` on concurrent change → 409. Two staff refunding different amounts from the same prior state each issue a real Stripe refund, but only one DB update succeeds; the losing request reports 409 while the customer was already refunded twice. Same hazard if the DB transaction throws after a successful Stripe call: money leaves, ledger never records it.

## Medium

2. **Bulk-repeat gated by `admin:view`, not a write permission.** `src/app/api/admin/orders/bulk-repeat/route.ts` only calls `requirePermission("admin:view")`, yet `repeatOrders` creates draft orders and audit entries. Any account with read-only `admin:view` (e.g. restricted Staff) can mint drafts via this endpoint. The orders list surfaces the button to every `admin:view` user.

3. **POS checkout hardcodes `deliveryDay: null` for every fulfillment method.** `src/components/pos-checkout-form.tsx` sends `deliveryDay: null` for all lines; `src/app/api/admin/pos/orders/[orderId]/checkout/route.ts` passes it through. POS orders selecting `BULK_DELIVERY` / `PACKAGE_DELIVERY` / `SHIPPING` will be finalized with no delivery day even though the storefront path requires one — a data gap that will surface in P7/P8 fulfillment.

4. **Refund form defaults to full `amountCents`, not remaining refundable.** `src/components/admin-order-actions.tsx` (line 106) sets the refund amount input to `payment.amountCents / 100`. For a partially refunded payment this exceeds `refundableCents` and the server returns 409 on submit; the form also renders for fully refunded payments (no `refundedCents < amountCents` guard), always 409.

## Low

5. **`getOperationsDashboard` mislabels all-time finalized revenue as "Season revenue".** `src/app/(admin)/admin/page.tsx` line 32 renders `formatCurrency(dashboard.grossCents)` under that label, but `getOperationsDashboard` aggregates every `FINALIZED` order regardless of season. Misleading KPI.

6. **Hardcoded greeting "Good evening".** `src/app/(admin)/admin/page.tsx` line 25 — not time-aware; cosmetic only.

7. **Today queue orders by `cachedPaymentStatus: "asc"` (alphabetical).** `src/lib/admin-operations.ts` line 94 → `PARTIALLY_PAID` < `PAID` < `REFUNDED` < `UNPAID`, so unpaid items sort last despite the page framing ("outstanding balances"). Inverted from intent.

8. **Admin sidebar has no active-link state.** `src/app/(admin)/admin/layout.tsx` hard-highlights Overview (line 62) and leaves every other nav link without an active variant, so the user never sees which page they are on.

9. **`getOrderDetail` over-fetches unused relations.** `src/lib/admin-operations.ts` includes `product`, `addOns`, `paymentIntents`, and `packages`; the detail page renders only `productNameSnapshot`, `recipientAddress`, `fulfillmentMethod`, and `payments`. Wasted queries per detail view.

10. **Import stage allows products when no current season is set.** `src/app/api/admin/imports/route.ts` derives `seasonId` from `current-season-id` and silently falls back to `""` for duplicate detection; commit then throws "Current season is required". Stage succeeds, commit fails — inconsistent preview/commit contract.

11. **Imported products created without inventory, options, or add-ons.** `src/app/api/admin/imports/[batchId]/commit/route.ts` builds packages with `kind: PACKAGE`, `isFinishedPackage: true`, no `inventoryItem` and no `options`/`allowedAddOns`. Storefront availability and builder will treat these as unavailable/incomplete.

12. **`stripePaymentIntent.updateMany` where-clause drops to order-wide when `reference` is null.** `refunds/route.ts` line 64 uses `stripePaymentIntentId: payment.reference ?? undefined`; a null reference would update every PI on the order. Edge case, but not the intended scope.

13. **Customer find-or-create endpoint gated by `admin:view`.** `src/app/api/admin/customers/route.ts` requires `admin:view`, so any read-only admin can mint customers directly (bypassing the `payments:manage`-gated POS page). Acceptable but broader than the POS entry point implies.

14. **Audit trail on order detail misses `Order`-targeted events for the source of a repeat.** `order.repeated` audit targets the new draft's id, so the source order's detail page never shows that it was repeated. Reporting gap, not a correctness bug.

## Severity counts

- High: 1
- Medium: 3
- Low: 10
- Total: 14
