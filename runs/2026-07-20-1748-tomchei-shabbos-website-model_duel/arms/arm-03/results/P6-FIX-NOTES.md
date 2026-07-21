# P6 Fix Notes — arm-03 (single fix pass)

**Input:** `arms/arm-03/results/AGGREGATE-REVIEW-P6.md`  
**Scope:** blockers B1–B8 + trivial majors M3 (normalized search). Minors / DECISION-LOG deferred.  
**Smoke:** `npm run smoke:p6` → **28/28 PASS** — `workspace/.scratch/PHASE-P6-SMOKE.md`

## Blockers

| # | Fix | Where |
|---|---|---|
| B1 | `refundPayment` requires `orderId`; ownership checked before any Stripe/DB money write. Route returns 400 on mismatch without refunding. | `lib/ops/refunds.ts`, `api/.../refund/route.ts` |
| B2 | DB-first claim under `Payment` `FOR UPDATE` + baseline version check; Stripe uses stable `Idempotency-Key` (`sha256(paymentId:baseline:amount)`); Stripe failure compensates (decrement + audit + recalc). | `lib/ops/refunds.ts` |
| B3 | Shared `listAudit({ orderId?, limit, actions? })` filters `meta.orderId` / `sourceOrderId` / bulk arrays in Postgres — no 250-row global window + JS filter. Order detail + audit page both use it. | `lib/audit.ts`, `api/.../orders/[id]/route.ts`, `admin/audit/page.tsx` |
| B4 | Single `attach-customer` API accepts `customerId` **or** create fields; `attachOrCreatePosCustomer` finds/creates + attaches in one transaction. POS panel uses one request. | `lib/ops/customers.ts`, `api/.../attach-customer`, `pos-customer-panel.tsx` |
| B5 | Commit re-checks duplicates inside the tx; colliding rows → `SKIPPED` (batch continues); `P2002` handled per-row and outer; preserves original email casing + `emailNorm`. | `lib/ops/import.ts` |
| B6 | `bulkUpdateOrderStatus` calls `assertOrderTransition` per item; illegal transitions → skipped with reason. | `lib/ops/repeat.ts` |
| B7 | Bulk repeat/status use `lockOrderForUpdate` + `updateMany` guarded by `expectedVersion`. | `lib/ops/repeat.ts` |
| B8 | `writeAudit` accepts optional tx client; import stage/commit, customer create, POS attach, bulk actions, and single repeat write audit inside the mutation transaction. | `lib/audit.ts` + ops libs |

## Trivial majors

| # | Fix |
|---|---|
| M3 | Customer list + POS search also match `emailNorm` / `phoneNorm`. |

## Deferred

Majors M1–M2, M4–M15 (except M3) and minors m1–m21 — out of single-pass blocker scope. No DECISION-LOG entries.

## Verification

- Typecheck PASS  
- `npm run smoke:p6` → 28/28 PASS  
