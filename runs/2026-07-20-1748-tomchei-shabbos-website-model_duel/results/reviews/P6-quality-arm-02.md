# P6 Quality review — arm-02

Reviewer specialist: Quality. Phase: P6 (Admin operations hub & POS).
Scope: `arms/arm-02/workspace/` vs `shared/phases/PHASE-P6-EXPECTED.md`.
Findings only, no fixes. Blind to model name.

Smoke evidence: `arms/arm-02/workspace/.scratch/PHASE-P6-SMOKE.md` — S1–S4 42/42 PASS, CI green (lint, typecheck, migration guard, 45/45 tests, build 53/53).

## Medium

1. **POS checkout posts payment before finalize; on finalize failure the draft stays live and can be re-checked-out.** `app/api/admin/pos/checkout/route.ts` posts the cash/check payment (lines 73–85) and only then calls `finalizeOrder` (line 90). If finalize throws (stock conflict, concurrent discard), the order is left DRAFT with a POSTED payment, `completeDraft` is never called (line 98 only runs on success), and a `pos.payment.post` audit row exists with no matching `pos.checkout`. The POS cart remains active, so a staff retry hits `/api/admin/pos/checkout` again and mints a SECOND order + SECOND payment for the same cart. The code comment acknowledges the stuck-DRAFT case ("staff resolves it from the order detail page") but not the duplicate-checkout / orphan-payment / half-audited outcome. No smoke covers the finalize-failure path.

2. **Stripe refund endpoint refunds only the single most-recent Stripe payment.** `app/api/admin/orders/[id]/refund/route.ts` picks the payment with `findFirst({ orderBy: { receivedAt: "desc" } })` (lines 23–26) but computes `alreadyRefunded` by summing ALL negative stripe rows on the order (lines 31–34). For an order with two Stripe payments (partial charge + later charge), the older payment can never be refunded through this endpoint, and `refundable = latestPayment + allRefunds` misstates the remaining amount once any refund lands. Single-payment orders (the common case) work; multi-payment orders are silently capped.

3. **External Stripe call is issued before the DB record write — retry race can double-refund.** Same refund route, lines 44–52: `gateway.createRefund(...)` runs before `recordRefund(...)` (its own transaction) and `writeAudit`. If `recordRefund` throws after the Stripe call succeeds, the ledger has no row for that refund. `recordRefund` is idempotent on `stripeRefundId` and the Stripe webhook (`app/api/webhooks/stripe/route.ts`) backstops the missing record, but a staff retry before the webhook lands re-evaluates `refundable` from `alreadyRefunded` (which still excludes the unrecorded refund), sees the full amount, and issues a SECOND `createRefund`. Narrow race, real money.

## Low

4. **Customer directory page applies `normalizePhone(q)` to every query with no "looks-like-phone" guard.** `app/(admin)/admin/customers/page.tsx` line 21 always normalizes; the sibling API route `app/api/admin/customers/route.ts` line 19 guards with a `looksLikePhone` regex first. A name/email query containing digits (e.g. "Apt 5") can produce false-positive phone matches on the page that the API would not return. Two surfaces, two contracts.

5. **Audit log page is hard-capped at the latest 100 entries — no pagination, no filter.** `app/(admin)/admin/audit/page.tsx` line 7 (`take: 100`). At P6 scale (1200+ orders, multiple audit rows each) staff cannot reach older entries. EXPECTED P6 #1 calls for "audit views"; this is a view but not a navigable one.

6. **CSV parser silently drops a legitimate single-empty-field row.** `lib/csv.ts` `pushRecord` (line 21) skips any record where `record.length <= 1 && record[0]?.trim() === ""`. A row that is genuinely a single empty quoted field (`""`) is indistinguishable from a blank line and is dropped without warning. Edge case, but lossy for unusual import data.

7. **POS checkout accepts arbitrary `amountCents` with no upper-bound check.** `app/api/admin/pos/checkout/route.ts` line 73 — `input.payment.amountCents` is optional and unbounded; a $5000 entry on a $50 order posts a $5000 POSTED cash payment and `recalcPaymentStatus` marks the order PAID with the overage as unattributed credit. No validation against `result.totalCents`. May be intentional for overpayment, but unstated and unguarded.

8. **Bulk action audit row carries no `targetId` and no per-id detail.** `app/api/admin/orders/bulk/route.ts` lines 45–49 writes one `orders.bulk_${action}` audit entry with only `requested/done/skipped` counts. The ids actually touched (done + skipped with reasons) are not in the audit detail, so the trail cannot reconstruct which orders a given bulk call affected — only the counts. Reporting gap at scale.

## Severity counts

- High: 0
- Medium: 3
- Low: 5
- Total: 8
