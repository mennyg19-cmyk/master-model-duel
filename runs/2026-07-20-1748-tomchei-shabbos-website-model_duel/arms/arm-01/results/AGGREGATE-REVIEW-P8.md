# Aggregate review — P8, arm-01

**Phase:** P8 — Shipping: Shippo, rate margin, labels
**Tree:** `arms/arm-01/workspace/`
**Inputs:** `results/reviews/P8-{security,quality,rules,clean-code}-arm-01.md`
**Method:** Union + dedupe by location+claim (highest severity wins). Security findings survive. No new findings.
**Severity mapping:** High → blocker · Medium → major · Low/Info → minor.

## Counts

| Blocker | Major | Minor | Total |
|---|---|---|---|
| 3 | 13 | 12 | 28 |

## Blockers

### B1 — `buyPackageLabel` check→buy→insert is not atomic; concurrent buys double-charge
`src/domain/shipping.ts:261-290` (guard `:267-269`), `prisma/migrations/20260721043000_p8_shipping/migration.sql:29-31`
The "no active PURCHASED label" guard runs outside any transaction, then `provider.buyLabel` (a real, non-idempotent Shippo `/transactions/` charge) is called *before* the DB transaction that records the label (`:289-308`). No `SELECT ... FOR UPDATE`, no optimistic-version check, and the migration's only unique index is on `providerTransactionId` (which differs per purchase). Two concurrent `orders:manage` POSTs with `action: "buy"` for the same `packageId` both pass the guard, both charge Shippo, and both insert PURCHASED rows — duplicate carrier charges and two active labels for one package on a money path.
Sources: sec M1, quality H2.

### B2 — Org FedEx + UPS carrier accounts never sent to Shippo (R-173, R-183, R-184)
`src/lib/shippo.ts:71-72,94,199-203`, `src/lib/env.ts:7-8,26-27`, `.env.example:23-24`
`ShippoProvider`'s constructor takes only `SHIPPO_API_TOKEN`; `getShippingProvider()` passes only that token. `SHIPPO_FEDEX_ACCOUNT_ID` and `SHIPPO_UPS_ACCOUNT_ID` are declared in `env.ts` and documented in `.env.example` / `generate-env-example.mjs` but never read, and the `/shipments/` POST body (`shippo.ts:101-113`) has no `carrier_accounts` field. EXPECTED #1 requires the wrapper to operate "with org FedEx + UPS accounts" with typed optional-provider env handling (R-183, R-184); the IDs are dead config, so live quotes/labels are not bound to the org's negotiated carrier accounts.
Sources: quality H1, clean-code H2, rules L3.

### B3 — Fulfillment-fee logic duplicated between client and server
`src/components/checkout-form.tsx:77-95`, `src/domain/checkout.ts:40`
`checkout-form.tsx` re-implements `calculateFulfillmentFees` in the browser: the same `chargedGroups` Set, the same group key (`fulfillmentCode:orderLineId` for `PACKAGE_DELIVERY`, else `fulfillmentCode:addressId`), and the same SHIPPING-from-`shippingFeesByAddressId` lookup with the `fulfillmentFees[code]` fallback. The server function is already pure (no Prisma, no I/O) and shareable as-is. Two implementations of the pricing rule will drift the moment one side changes a group key or fallback; the live total shown to the customer can silently diverge from the cents actually charged by `prepareCheckout`.
Sources: clean-code H1.

## Majors

### M1 — `voidPackageLabel` voids at the provider before the DB transaction; partial-failure drift
`src/domain/shipping.ts:347-378` (`:362`), `src/lib/shippo.ts:152-160`
`voidPackageLabel` calls `provider.voidLabel(label.providerTransactionId)` (a real Shippo `/refunds/` POST) before opening the DB transaction that flips the row to `VOIDED` (`:362-377`). If Shippo accepts the refund as `REFUND_PENDING` it is treated as success, but any other response throws and the local row stays `PURCHASED` — even though the carrier may have already started the refund. No `PackageAudit` row and no failure record is written on the throw path; the `REFUND_PENDING`-but-accepted state is never persisted. Provider/DB state drift on a refund path with no compensation.
Sources: sec M2, quality M1.

### M2 — `buyPackageLabel` skips the active/shipping/stage guards that `quotePackage` enforces
`src/domain/shipping.ts:261-290` vs `:153-196`
`quotePackage`/`loadPackagePlan` reject packages that are inactive, non-shipping, or already `SENT`/`PICKED_UP` (`:166-171`). `buyPackageLabel` does not call `loadPackagePlan` and has no equivalent check — it only blocks when an existing PURCHASED label exists. A manager can therefore buy a carrier label for an inactive, non-shipping, or already-sent package by POSTing `action: "buy"` with that `packageId`. Integrity bypass on the label-purchase money path; the label is also attached to a single `shipmentBox` (`findFirst orderBy sequence desc`, `:285-288`) without re-validating the plan.
Sources: sec M3.

### M3 — Unauthenticated checkout GET triggers uncapped per-address Shippo rate calls
`src/app/api/checkout/stripe/route.ts:41-101`, `src/domain/shipping.ts:421-484` (`:466-481`), `src/lib/public-request.ts:21-66`
The public `GET /api/checkout/stripe` handler calls `quoteDraftShipping`, which issues one live `POST /shipments/` to Shippo per recipient address with no caching and no throttle. Unlike the POST branch (`route.ts:105`), this GET is not covered by `guardPublicWrite`, so the IP-based 30/min limiter does not apply. Access is gated by `findAccessibleDraft` (guest token / customer auth / admin), so not fully anonymous, but a holder of a 30-day draft-access cookie can hammer the endpoint to exhaust the Shippo API quota / run cost, with no rate limit on the expensive external call and no deduplication across repeated loads.
Sources: sec M4.

### M4 — Secret/config read via `process.env` directly, bypassing the centralized env layer
`src/lib/shippo.ts:199-203` (`:200`), `src/domain/shipping.ts:131-151`, `src/lib/env.ts:1-29`
`getShippingProvider()` reads `SHIPPO_API_TOKEN` and `organizationAddress()` reads `SHIP_FROM_*` straight from `process.env` (with `!` assertions after a manual loop), even though `src/lib/env.ts` already declares `SHIPPO_API_TOKEN` behind `readServerEnvironment()` / `requireEnvironmentValue`. The secret and shipping config are accessed outside the validated/typed env layer, so the centralization and fail-fast guarantee do not cover the shipping integration. Two patterns for the same concern; the centralized reader is bypassed for every shipping config value.
Sources: sec L2, clean-code M7.

### M5 — Failed label purchase writes a `FAILED` row outside a transaction with no `actorStaffId` / no audit (R-175)
`src/domain/shipping.ts:328-344`
The `buyPackageLabel` catch path inserts the `FAILED` `ShippingLabel` via a standalone `prisma.shippingLabel.create` (no `$transaction`, no `actorStaffId`, no `PackageAudit`). The successful path writes a `shipping.label_purchased` audit row; the failure path — arguably more important to attribute — does not, and a failure during that insert silently loses the failure record. R-175's "label-failure compensation" is only partially met — the failure is recorded but neither audited nor compensated (no quote-state rollback, no staff-visible signal beyond the orphaned FAILED row).
Sources: sec I1, quality M2.

### M6 — Shippo `track` endpoint shape is wrong (R-176)
`src/lib/shippo.ts:162-165`
`ShippoProvider.track` POSTs to `/tracks/{carrier}/{trackingNumber}` with no body. Shippo's tracking API is `POST /tracks` with a `{ carrier, tracking_number }` body, or `GET /tracks/{carrier}/{tracking_number}`; the path used here is not a documented Shippo endpoint. `refreshPackageTracking` will fail against live Shippo, so R-176 (tracking refresh) is not actually satisfied in production despite the smoke stub asserting `IN_TRANSIT`.
Sources: quality M3.

### M7 — Missing smoke evidence file
`arms/arm-01/workspace/.scratch/PHASE-P8-SMOKE.md` (absent)
EXPECTED names the evidence path `.scratch/PHASE-P8-SMOKE.md`. No `.scratch/PHASE-P8*` file exists in the arm-01 workspace. The smoke driver (`scripts/p8-smoke.ts`) and `npm run smoke:p8` task exist, but no recorded PASS transcript was produced/committed, so the phase gate has no smoke evidence artifact.
Sources: quality M4.

### M8 — Multi-parcel label associated to only one `ShipmentBox`
`src/domain/shipping.ts:285-308`
`buyPackageLabel` attaches the label to `firstBox` (the highest-sequence box) only. For shipments planned into multiple `ShipmentBox` rows, the remaining boxes have no `shippingLabels` link, so the board/order-detail cannot show per-box label state and void/rebuy semantics for multi-parcel shipments are incomplete.
Sources: quality M5.

### M9 — Margin math duplicated across two UI pages with a different rule than the server
`src/app/(admin)/admin/orders/[orderId]/page.tsx:71-79`, `src/app/(admin)/admin/fulfillment/page.tsx:121-138`, `src/domain/shipping.ts:28-34`
Both pages compute `chargedCents = Math.max(...quoteAmounts)`, `purchasedCents = Math.min(...quoteAmounts)`, `marginCents = chargedCents - purchasedCents` inline. The server's `selectShippingMargin` first filters to eligible carriers (`fedex`/`ups`/`usps`), `amountCents > 0`, and `currency === "usd"` before reducing. The UI min/max runs over every stored quote with no eligibility filter, so a zero-amount, non-USD, or non-eligible-carrier quote would make the displayed charge/purchase/margin diverge from the values recorded on the label. Two copies of the rule plus a silent eligibility gap — extract `summarizeQuotes(quotes)` (or reuse `selectShippingMargin`'s output) for the UI.
Sources: rules M1, rules M2, clean-code M3.

### M10 — `planShipment` exceeds 3 levels of nesting (clean-code anti-AI-tics)
`src/domain/shipping.ts:57-104`
Reaches 4 levels: `for` → `planned.find(box => { if (...) { return (... && ...) } })`. Rule: "If a function has more than 3 levels of nesting, refactor it." The `existing` lookup callback is the deepest path.
Sources: rules M3.

### M11 — Duplicated product-to-shipment-product mapping / dimensions guard
`src/domain/shipping.ts:176-188` (`:178-180`), `:450-462` (`:452-454`)
Both `loadPackagePlan` and `quoteDraftShipping` map a line to `{ quantity, widthMm, heightMm, depthMm, weightGrams }` with the same `!product.widthMm || !product.heightMm || !product.depthMm || !product.weightGrams` guard and the same `${product.name} needs dimensions and weight before shipping.` error. Extract a `toShipmentProduct(product, quantity)` helper so the validation and message stay in one place.
Sources: rules L1, clean-code M5.

### M12 — Eligible-carrier list duplicated
`src/lib/shippo.ts:121`, `src/domain/shipping.ts:31`
`["fedex","ups","usps"]` is hard-coded in two places: the Shippo rate filter and `selectShippingMargin` eligibility. Two sources of truth for "eligible carriers"; the two filters also case-normalize differently (`rate.provider ?? ""`.toLowerCase()` in shippo vs `rate.carrier.toLowerCase()` in shipping). Adding/removing a carrier requires touching both. Extract one `ELIGIBLE_CARRIERS` constant (lower-cased) and a single `isEligibleRate` predicate.
Sources: rules L2, clean-code M4, quality L2.

### M13 — `domain/shipping.ts` is a mixed-concern file (485 lines, 5 concerns)
`src/domain/shipping.ts`
Margin selection (`selectShippingMargin`), bin-packing (`planShipment` / `volume` / `toParcel`), address mapping (`snapshotAddress` / `organizationAddress`), package-plan loading (`loadPackagePlan`), and the quote/buy/void/track/validate orchestration all live in one module. The arm rule says split when >500 lines **or mixed concerns**; this is the latter. Candidates: `shipping-margin.ts`, `shipping-planner.ts`, `shipping-ops.ts`. Splitting now is cheaper than after P9/P12 add reconciliation reporting.
Sources: clean-code M6.

## Minors

### m1 — Raw `error.message` (including Shippo `detail`) returned to client on shipping actions
`src/app/api/admin/shipping/route.ts:58-66`, `src/lib/shippo.ts:84-91`
The admin shipping route's catch-all returns `error.message` as the 409 body. Shippo errors are constructed from `payload.detail` (`shippo.ts:86-88`), so provider-side error text (which can include account/carrier context) is echoed to the caller. Manager-only endpoint, so impact is limited to internal-detail disclosure within a privileged role.
Sources: sec L1.

### m2 — `labelUrl` rendered as an unvalidated `href`; no scheme allow-list
`src/components/shipping-actions.tsx:95-99`, `src/lib/shippo.ts:148`
`labelUrl` is `String(payload.label_url)` from the Shippo response and rendered as `<a href={label.labelUrl}>`. No scheme validation (https-only). If the provider response is malformed or tampered (e.g. a `javascript:` or `data:` URL via a compromised/MitM Shippo response), the admin UI would render a clickable unsafe href. Admin-only and provider-sourced, so likelihood is low, but the sink is unguarded.
Sources: sec L3.

### m3 — `planShipment` is volume-only, not geometric bin packing (R-081)
`src/domain/shipping.ts:57-104`
The planner verifies each unit's dims ≤ box dims, then co-packs by cumulative volume + weight. Items whose volumes sum under box capacity but whose shapes do not geometrically fit are incorrectly co-packed. Acceptable as "shipment planning" but not true 3D bin packing.
Sources: quality L1.

### m4 — Checkout disables SHIPPING for all lines when one line fails rate quoting
`src/app/api/checkout/stripe/route.ts:77-93`, `src/components/checkout-form.tsx:198-200`
`isLiveShippingAvailable = false` if `quoteDraftShipping` throws for any address (e.g., one product missing dimensions), which disables the SHIPPING option for every line in the cart. One bad product suppresses live shipping for all recipients.
Sources: quality L3.

### m5 — `buyLabel` rejects any status other than `SUCCESS`
`src/lib/shippo.ts:141-143`
Treats `payload.status !== "SUCCESS"` as failure. Shippo sync transactions can return `QUEUED`/`PENDING` for some carriers; legitimate pending purchases would be rejected and recorded as `FAILED`, forcing a rebuy.
Sources: quality L4.

### m6 — `quoteDraftShipping` does not persist draft quotes
`src/domain/shipping.ts:232-243`
Only `quotePackage` writes `ShippingQuote` rows. Draft-stage quotes are recomputed on every checkout GET and POST and never stored, so there is no draft-stage reconciliation record for margin spread. Acceptable for P8 (reconciliation UI is P12) but worth noting.
Sources: quality L5.

### m7 — Magic values: rate TTL and stage strings
`src/lib/shippo.ts:131`, `src/components/shipping-actions.tsx:109`
`new Date(Date.now() + 20 * 60 * 1000)` is an unnamed 20-minute rate-expiry constant; `["SENT","PICKED_UP"].includes(packageRecord.stage)` hard-codes `PackageStage` values that already exist as a Prisma enum. Name the TTL (`RATE_TTL_MS`) and import the enum / a shared stage list for the void guard.
Sources: rules L4, clean-code L8.

### m8 — Flat 409 for all shipping-route failures
`src/app/api/admin/shipping/route.ts:58-66`
Maps every non-`AccessDeniedError` throw — Shippo 5xx, DB failure, "Void the active label before buying another", "A sent or picked-up package label cannot be voided", Prisma `P2025` not-found — to HTTP 409 with the original message. 409 implies conflict; a provider outage or missing row is not a conflict. This also loses status granularity vs. the `publicRequestErrorResponse` shape used by `api/checkout/stripe/route.ts`. Discriminate at least provider/validation (409) from infrastructure (500) errors.
Sources: rules L5, clean-code L11.

### m9 — Redundant DB sort in package-type queries
`src/domain/shipping.ts:174`, `:437`
Both query `packageType.findMany` with `orderBy: { innerDepthMm: "asc" }`, but `planShipment` (`:58`) immediately re-sorts the boxes by volume ascending. The DB ordering is dead — drop it or align the two sorts.
Sources: clean-code L9.

### m10 — Inline box-volume recompute in `planShipment`
`src/domain/shipping.ts:84-85`
Recomputes `fittingBox.innerWidthMm * fittingBox.innerHeightMm * fittingBox.innerDepthMm` inline while a `volume()` helper exists for products (it cannot accept a box shape). The `box.maxWeightGrams ?? Number.POSITIVE_INFINITY` fallback is also written twice (`:78`, `:89`). A `boxVolume(box)` helper (or widening `volume`) would remove the inconsistency and the duplicated fallback.
Sources: clean-code L10.

### m11 — `quoteDraftShipping` return type drifts from domain Map convention
`src/domain/shipping.ts:421-484`
Returns `Record<string, number>`; both callers wrap it via `new Map(Object.entries(...))` (`src/app/api/checkout/stripe/route.ts:141`, `scripts/p8-smoke.ts:262`). The rest of the domain passes `ReadonlyMap<string, number>`. Return a `Map` directly.
Sources: rules I1.

### m12 — `checkout-form.tsx` casts untrusted JSON
`src/components/checkout-form.tsx:61`
`const typedPayload = payload as CheckoutPayload;` is a compile-time assertion on `any` from `response.json()` with no runtime validation, while the project's established pattern is zod (used in the sibling route handler). One validation pattern per project.
Sources: rules I2.

## Notes

- No security finding was rated Blocker/High by the security specialist; the three blockers above are the union's highest-severity survivors (security M1 promoted to blocker via quality H2; the carrier-account and fulfillment-fee blockers are quality/clean-code Highs). All four security Mediums (M1–M4) and the env-bypass Low (L2) survive as B1/M2/M3/M4.
- No new findings introduced during aggregation.


