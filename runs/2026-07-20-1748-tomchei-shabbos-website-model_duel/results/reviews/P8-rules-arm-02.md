# P8 Rules review — arm-02

Reviewer: Rules specialist (blind to model name).
Scope: `arms/arm-02/workspace/` P8 changes (Shippo wrapper, margin engine, bin packing, labels, checkout live rates).
Rules graded: ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol.
Method: findings only, no fixes. Evidence cited as `path:line`.

## Severity counts

- Critical: 0
- High: 1
- Medium: 3
- Low: 5
- Info: 1

## Findings

### H1 — Void / tracking failures surface as 500, not a human error
`lib/shipping/labels.ts:157` calls `voidLabel(shipment.shippoTransactionId)` and `:186` calls `trackShipment(...)`; both throw `ShippoError` (a plain `Error` subclass, not `ActionError`) when Shippo refuses. The routes (`app/api/admin/shipments/[id]/void/route.ts:25-30`, `.../tracking/route.ts:18-23`) only special-case `ActionError` and rethrow everything else → Next.js returns a generic 500 with no message. The buy path (`labels.ts:100-115`) carefully wraps its Shippo call and compensates (R-175); void and tracking do not, so the same money-adjacent action fails opaquely. Clean-code (one error-handling approach per project; "error messages say what went wrong AND what the expected state was").

### M1 — Live mode silently drops USPS; docstring claims "all eligible carriers"
`lib/shipping/shippo.ts:78` sends `carrier_accounts: [SHIPPO_FEDEX_ACCOUNT_ID, SHIPPO_UPS_ACCOUNT_ID]` only, so live mode never returns a USPS quote even when `mockRates` would (`mock-rates.ts:38,51`). The header comment at `shippo.ts:62` says "Quote all eligible carriers for the given parcels (R-173)" and the phase EXPECTED §2 names "+USPS where applicable." Mock and live disagree on the eligible-carrier set for the same input. Clean-code (consistency: one carrier-selection pattern) + anti-hallucination (claim diverges from behavior).

### M2 — Shipment is never linked to the ShippingQuote it was bought from
`lib/shipping/labels.ts:78-80` calls `quoteShipping(...)` which persists a `ShippingQuote` row and returns `quoteId` (`lib/shipping/quotes.ts:52-69`), but `buyLabelForPackage` discards `quoteId` and stores only `quotedRates` JSONB on the `Shipment`. The quote row is left orphaned (anchored to `packageId` only) and P12 reconciliation has no FK from label back to the quote the customer was charged against. Phase EXPECTED §2: "record spread for reconciliation." Clean-code (type/schema drift — no single source of truth for the quote→label link) + workflow (never silently choose business logic: the reconciliation tie was dropped without a DECISION-LOG entry).

### M3 — Missing P8 smoke evidence file
Phase EXPECTED (`shared/phases/PHASE-P8-EXPECTED.md:21`) names `arms/{id}/workspace/.scratch/PHASE-P8-SMOKE.md` as the evidence path for S1–S3; glob of `workspace/.scratch/` found no such file (no `.scratch/` dir at all). Workflow gate discipline: "an expectation checklist item is unchecked or lacks evidence" — the smoke checks (margin math, void+rebuy, unshipped-label guard) have no recorded evidence the running app was exercised.

### L1 — `ShipmentSummary.status` duplicates the Prisma `ShipmentStatus` enum
`components/admin/shipment-actions.tsx:14` hand-maintains the union `"PURCHASED" | "VOIDED" | "FAILED"` instead of importing `ShipmentStatus` from `@prisma/client`. If the enum gains a member (e.g. a `REFUNDED` state) the UI type silently narrows it. Clean-code (type/schema drift: single source of truth).

### L2 — Shipment→ShipmentSummary mapping is duplicated and inconsistent
`app/(admin)/admin/packages/page.tsx:119-132` hand-maps every field onto a fresh object; `app/(admin)/admin/orders/[id]/page.tsx:216-220` passes the raw `pkg.shipments[0]` row through, relying on structural compatibility (extra fields like `shippoRateId`, `failureReason` leak into the component). Two patterns for one concern, one per call site. Clean-code (duplicated logic + inconsistent patterns).

### L3 — Magic truncation lengths on error payloads
`lib/shipping/shippo.ts:45` slices the Shippo error body to `300` chars and `lib/shipping/labels.ts:105` slices the failure reason to `500`. Both are unnamed magic numbers. Clean-code (magic values).

### L4 — `shippoFetch` swallows the JSON-parse failure
`lib/shipping/shippo.ts:43` does `await response.json().catch(() => ({}))`. If the error response is non-JSON (e.g. a 502 HTML page from Shippo's edge), the body is silently replaced with `{}` and the thrown message stringifies `{}` — the operator loses the real cause. Clean-code (no swallowed errors).

### L5 — `Math.random()` generates a `@unique` transaction id
`lib/shipping/shippo.ts:98` builds mock `transactionId` from `Date.now().toString(36) + Math.random().toString(36).slice(2,8)`, and `Shipment.shippoTransactionId` is `@unique` (`prisma/schema.prisma:606`). Non-deterministic key for a uniqueness-constrained column; collision is improbable but the pattern is clever-over-boring for a keyed field. Ponytail (boring over clever).

### I1 — `quoteShippingDestinations` awaits destinations sequentially
`lib/checkout/quote.ts:108-114` loops `await quoteShipping(...)` per destination rather than `Promise.all`. For a handful of destinations this is negligible and may even spare Shippo rate limits — informational, not a defect. Ponytail (minimum code) — noted only because the sequential choice is unstated.

## What passed cleanly

- Margin engine is a pure function with exact unit tests (`lib/shipping/margin.ts`, `tests/shipping-margin.test.ts`) — S1 math (highest charge, cheapest buy, exact spread) is correct and reproducible.
- Fail-closed money path: a shipping destination without a live rate returns `{ error }`, never a guessed charge (`lib/checkout/fees.ts:117-123`, tested `tests/checkout-fees.test.ts:120-130`).
- R-175 compensation is correct: a carrier refusal writes a `FAILED` Shipment + `PackageAudit` and leaves package stage and customer money untouched (`labels.ts:100-115`); retry is unblocked because the buy guard only blocks on `PURCHASED` (`labels.ts:61-63`).
- Env fail-closed guard refuses live Shippo without both org carrier accounts — R-183/R-184 (`lib/env.ts:63-70`).
- No new dependencies: the Shippo wrapper uses native `fetch` (ponytail ladder rung 2/3).
- Bin packing is pure, deterministic, never drops a unit (oversized items ship as their own parcel), and tested (`lib/shipping/bin-packing.ts`, `tests/bin-packing.test.ts`).
- `ShipmentBox` seeded (`prisma/seed.ts:112-120`) and `shipping.origin` setting declared with a typed schema + default (`lib/settings.ts:29-46`).
