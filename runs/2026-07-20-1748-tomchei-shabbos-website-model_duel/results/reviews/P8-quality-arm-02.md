# P8 Quality review — arm-02

**Phase:** P8 — Shipping: Shippo, rate margin, labels
**Scope:** `arms/arm-02/workspace/` (lib/shipping/*, lib/checkout/*, app/api/admin/{packages/[id]/label, shipments/[id]/{void,tracking}}, components/admin/shipment-actions.tsx, prisma migrations 20260721001503 + 20260721110000, tests/{bin-packing,shipping-margin,checkout-fees}.test.ts)
**Reviewer:** Quality specialist (blind to model name)
**Reference:** `shared/phases/PHASE-P8-EXPECTED.md`, `kit/prompts/reviewer/review-quality.md`
**Mode:** Findings only — no fixes proposed.

Smoke (`.scratch/PHASE-P8-SMOKE.md`) reports 16/16 pass in mock mode; CI + `next build` pass. Findings below are from reading the implementation, not from re-running smoke.

## Findings

### M1 — Concurrent label purchase can double-charge the carrier (Medium)
`lib/shipping/labels.ts:55` `buyLabelForPackage` guards against an existing active label with an in-memory check (`pkg.shipments.some(s => s.status === "PURCHASED")`, line 61) and then calls `buyLabel` + inserts the `Shipment` row. There is no DB-level uniqueness guard for "one PURCHASED per package" (schema has `@@index([packageId, createdAt])` and `@@index([status, createdAt])` but no partial unique constraint on `(packageId, status='PURCHASED')`), and the buy path does not use the `Package.version` optimistic lock that the stage-advance path uses. Two simultaneous POSTs to `/api/admin/packages/[id]/label` (two staff, or two tabs — the client `busy` flag only protects one browser) can both pass the check, both call Shippo `/transactions/` for real money, and both insert PURCHASED rows. Result: two paid labels for one package and a margin/audit trail that doesn't reflect one of them.

### M2 — Live `getRates` never quotes USPS (Medium)
`lib/shipping/shippo.ts:78` sends `carrier_accounts: [env.SHIPPO_FEDEX_ACCOUNT_ID, env.SHIPPO_UPS_ACCOUNT_ID]` only. EXPECTED §2 requires "quote eligible carriers (+USPS where applicable)". The USPS eligibility path (`mock-rates.ts` `MOCK_USPS_MAX_PARCEL_GRAMS`, `shipping-margin.test.ts` "mock USPS drops out for heavy parcels") exists only in mock fixtures; in live mode USPS is never requested, so the live carrier set is silently narrower than the plan and narrower than what the unit tests assert. The margin engine's "charge highest / buy cheapest" comparison is mock-only across three carriers; live runs compare at most two.

### M3 — Remote void before DB write, no idempotency (Medium)
`lib/shipping/labels.ts:157` `voidShipmentById` calls `voidLabel` (Shippo `/refunds/`) BEFORE the `$transaction` that marks the row VOIDED, and ignores the refund response. If the DB transaction fails after the remote refund succeeds, the carrier label is refunded but the DB still shows `PURCHASED` — staff see an "active, voidable" label that is already voided remotely. A retry calls `/refunds/` again with no idempotency key. Same ordering issue is absent from the buy path (buy creates the row first, then it's active), but void is the destructive direction where the inconsistency bites.

### L1 — Dead/misleading admin control for `shipping.rates` (Low)
`components/admin/settings/shipping-tab.tsx:52-81` still renders a "Delivery rates" card with an "Add row / Save rates" editor for `shipping.rates`, and the helper copy reads "Placeholder rates until live carrier quotes land (P8)" — present tense. Per `DECISION-LOG.md` DECISION-P8-3, `shipping.rates` no longer feeds checkout (SHIPPING now uses live margin-engine quotes); the setting is a relic. A manager can edit a control that has zero effect on the store and is told it's a placeholder for a phase that has already shipped.

### L2 — ShippingQuote not linked back from Shipment; duplicated quote data (Low)
`lib/shipping/quotes.ts:52` creates a `ShippingQuote` (+ `ShippingQuoteOption` rows from `decision.perCarrierBest`) on every purchase, but `lib/shipping/labels.ts:82-95` writes the same comparison set into `Shipment.quotedRates` (JSON) with no `quoteId` foreign key from `Shipment` to `ShippingQuote`. Two sources of truth for the same data, and no way for P12 reconciliation to walk `Shipment → ShippingQuote → options` without matching on timestamps/values.

### L3 — Silent quote failure in checkout preview; misleading retry message (Low)
`lib/checkout/quote.ts:108-114` `quoteShippingDestinations` drops any destination whose `quoteShipping` returns `{ error }` from the `rates` map; `lib/checkout/fees.ts:119-122` then emits "Live shipping rates are unavailable for X — try again in a moment". The message assumes a transient failure, but the underlying cause may be permanent (bad address, no origin, empty parcel plan). The customer is told to retry something that will keep failing.

### L4 — FAILED Shipment row stores realized-looking margin figures (Low)
`lib/shipping/labels.ts:106-109` writes a `FAILED` Shipment with the full `shipmentBase` including `chargedCents`, `costCents`, and `marginCents` from the margin decision, even though no label was bought and no margin was captured. P12 margin reconciliation must exclude `status='FAILED'` rows (or treat their `marginCents` as 0) or realized-margin totals will be overstated. The schema doesn't distinguish "planned" vs "realized" margin on a row.

### L5 — No unit tests for the label/quote orchestration (Low)
P8 unit coverage is only the pure helpers (`tests/bin-packing.test.ts`, `tests/shipping-margin.test.ts`, `tests/checkout-fees.test.ts`). The state machine in `lib/shipping/labels.ts` (buy → FAILED compensation → void guard → tracking refresh) and the `quoteShipping` persistence in `lib/shipping/quotes.ts` are exercised only by the mock smoke harness (`.scratch/p8-smoke.ts`), not by any repeatable unit test. A regression in the orchestration would be caught only by re-running smoke.

### L6 — Checkout quote preview leaks ShippingQuote rows (Low)
`app/api/checkout/quote/route.ts` → `buildCheckoutQuote` → `quoteShippingDestinations` → `quoteShipping` persists a `ShippingQuote` + N `ShippingQuoteOption` rows on every preview call. A customer cycling method choices on the checkout page creates many rows per session; the 20-min `expiresAt` exists but no reaping job is registered in this phase, so expired quotes accumulate.

## Severity summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 3 |
| Low | 6 |
| **Total** | **9** |

## Notes

- No broken flows or stubs found: all five EXPECTED items have working implementations and the checkout money path now uses live quotes (P5 placeholder retired per DECISION-P8-3). Smoke S1–S3 + failure paths pass in mock mode.
- All findings are correctness/quality issues that mock smoke cannot catch (M1, M3 are concurrency/remote-ordering; M2 is mock/live parity; L1–L6 are data-model, UX, and test-coverage gaps).
- No regressions vs. EXPECTED detected in the read path.
