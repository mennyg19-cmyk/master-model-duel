# P8 Aggregate Review — arm-05 (blind)

**Phase:** P8 — Shipping: Shippo, rate margin, labels
**Inputs:** `P8-security-arm-05.md`, `P8-quality-arm-05.md`, `P8-rules-arm-05.md`, `P8-clean-code-arm-05.md`
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings.
**Severity mapping:** Critical/High-security → blocker; High/Medium → major; Low → minor; Info/Nit → nit.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 3 |
| Major | 20 |
| Minor | 17 |
| Nit | 0 |
| **Total** | **40** |

Raw input totals: security 8, quality 13, rules 14, clean-code 15 = 50 findings → 40 after dedupe (10 duplicates merged across 7 clusters).

Source tags: **[S]** security, **[Q]** quality, **[R]** rules, **[C]** clean-code.

---

## Prioritized fix list (single pass)

<!-- BLOCKERS -->

### Blocker — margin confidentiality & reconciliation

1. **Margin data leaked to customer via draft `wireFormat`** [S] — `lib/checkout.ts` `saveCheckoutDetails` (127–152); `lib/order-builder.ts` `serializeDraft` (379–390); `app/api/order/drafts/[draftId]/route.ts:12`
   - `shippingQuotes` (with `marginCents`, `purchasedRateCents`, `providerMode`) is written into `order.wireFormat.checkout` and returned unfiltered to the draft owner via `serializeDraft`. Defeats the UR-003 / G-006 confidentiality premise of the margin engine. Filter margin/provider fields before exposing `wireFormat` to customers/guests.

2. **Margin data leaked to customer via account orders** [S] — `lib/order-builder.ts` `getAccount` (329–339); `app/api/account/route.ts:5-7`
   - `getAccount` returns `orders` with no `select`, so every scalar on `Order` (including `wireFormat`) is returned to the signed-in customer. The HIGH-1 leak persists past finalization and remains customer-readable indefinitely. Strip `wireFormat` (or its margin fields) from the customer-facing account projection.

3. **Margin reconciliation broken: stored `chargedCents` on ShipmentBox does not equal what the customer paid** [S][Q] — `lib/shipping.ts` `quoteCheckoutShipping` (110–143) vs `parcelForPackage` (61–96), `createPackageLabel` (170–185); `lib/checkout.ts` `saveCheckoutDetails` (127–152)
   - Merged from quality C1 + security MEDIUM-3. The customer is charged the checkout-time quote (stored on `order.fulfillmentCents` and `order.wireFormat.checkout.shippingQuotes`), but `ShipmentBox.chargedCents` is taken from a *fresh* `selectMarginRate` call at label-purchase time. The two quotes use different parcel weights (checkout uses `packageType.maxWeightOunces`; label bin-packs actual summed contents weight) and may run against different Shippo rate tables. The persisted `marginCents = charge − cost` is therefore not a faithful margin, can go negative, and the P12 margin report will not reconcile against actual customer payments. Copy the checkout-time charge onto the ShipmentBox (or re-quote with the same parcel) and verify the two charges match before label purchase.

<!-- MAJORS -->

### Major — security & authz

4. **Admin order detail exposes margin to all `orders.read` staff** [S] — `app/api/admin/orders/[orderId]/route.ts` GET (8–27); `lib/permissions.ts:17-21`
   - `shipmentBoxes` are returned with no field selection, exposing `chargedCents`, `labelCostCents`, `marginCents` to MANAGER + STAFF. UR-003 / G-006 scope margin capture as internal reconciliation reported in P12. Restrict margin fields to roles that need the carrier-cost side.

5. **Package shipping summary exposes margin to all `orders.read` staff** [S] — `app/api/admin/packages/[packageId]/shipping/route.ts` GET (12–17); `lib/shipping.ts` `packageShippingSummary` (238–257)
   - The dedicated shipping summary endpoint explicitly selects `chargedCents`, `labelCostCents`, `marginCents` and returns them to any staff with `orders.read`. Same over-exposure as #4 on the per-package label surface. Gate margin fields behind a manager-only permission or strip them for STAFF.

6. **Unfiltered Shippo error detail surfaced to staff UI** [S] — `lib/shippo.ts` `requestShippo` (125–140); `app/api/admin/packages/[packageId]/shipping/route.ts:38-40`; `app/admin/orders/[orderId]/page.tsx:60`
   - Upstream Shippo `body.detail` is propagated unredacted into the staff-facing API response and rendered in the admin status line. Could expose provider-side diagnostic detail (rate IDs, account references, validation internals). Sanitize or replace with a generic operator-facing message; log the raw detail server-side.

### Major — label purchase / void robustness

7. **Race condition: two concurrent `createPackageLabel` calls can buy two active labels for one package** [Q][R] — `lib/shipping.ts` `createPackageLabel` (150–209)
   - Merged from quality H2 + rules HIGH-1. The active-label guard runs before the transaction and before `buyLabel`; two concurrent invocations can both pass the guard, both buy external labels, and both commit `ShipmentBox` rows. `externalLabelId @unique` does not help because Shippo returns distinct transaction IDs. Add a row lock / `SELECT ... FOR UPDATE` on the package, re-check inside the transaction, or use a unique partial index on `(packageId, active)`.

8. **Label-failure compensation can silently lose a purchased label (R-175)** [Q][R][C] — `lib/shipping.ts` `createPackageLabel` catch block (204–208)
   - Merged from quality H3 + rules MEDIUM-1 + clean-code H1. The compensation `voidLabel(label.id).catch(() => undefined)` swallows any void failure, the thrown message asserts compensation succeeded regardless, and no `ShipmentBox` row is created in the failure path — so the orphaned `label.id` is not persisted anywhere for later reconciliation. R-175 expects label-failure compensation. Persist a `ShipmentBox` row marked as orphaned/void-failed, surface the void outcome, and add an audit row.

9. **`voidPackageLabel` has no optimistic lock, no idempotency, and no compensation on transaction failure** [Q][R] — `lib/shipping.ts` `voidPackageLabel` (211–221)
   - Merged from quality M3 + rules MEDIUM-2. `voidLabel` is called against Shippo before the local `ShipmentBox.labelVoidedAt` update runs in a transaction; if the transaction fails, the label is voided externally but still marked active locally — the inverse of #7's orphan, with no compensating retry or audit. No version guard on the box, no idempotency key on the refund request. Reverse the order (local row marked voiding → external void → commit) or add a compensating retry; add an idempotency key.

10. **`parcelForPackage` mutates `package.packageTypeId` outside a transaction and without audit/version bump** [Q][R][C] — `lib/shipping.ts` `parcelForPackage` (61–96, esp. 83–85)
    - Merged from quality M1 + rules MEDIUM-3 + clean-code L7. When the selected box differs from the current `packageTypeId`, the code does a bare `prisma.package.update` with no transaction, no optimistic version check, and no `PackageAudit` entry. A concurrent `splitPackage`/`regroupPackages` (which do version-bump and audit) could collide, and the package-type change is invisible to the audit trail. Move the update inside the label-purchase transaction and write a `PackageAudit` row.

### Major — margin engine correctness

11. **"Bin packing" is a single-box volume-sum selection, not bin packing (R-081)** [Q] — `lib/shipping.ts` `parcelForPackage` (61–96)
    - R-081 requires "Bin packing + shipment planning against package types/boxes." The implementation sums all product line volumes into one scalar and picks the smallest active `PackageType` whose box volume `>=` total volume. It ignores individual product dimensions (a 20" product is accepted into a 10"×10"×10" box as long as 1000 >= 1000), never splits a package across multiple boxes, and creates exactly one `ShipmentBox` per `createPackageLabel` call. Smoke `smoke-p8.ts` uses one product × quantity 1, so the volume check trivially passes. Add per-axis dimension checks and multi-box split support.

12. **`quoteCheckoutShipping` has no fallback when Shippo returns no eligible ground rates** [Q] — `lib/shipping.ts` `quoteCheckoutShipping` (110–143); `selectMarginRate` (98–109)
    - For `SHIP` recipients, checkout unconditionally calls `selectMarginRate`, which throws `"Shippo returned no eligible ground-equivalent carrier rates."` if no rate passes the filter. No fallback to a configured flat rate, no graceful degradation, no per-recipient error isolation (one bad address aborts the whole checkout via `Promise.all`). The plan's risk #3 flags provider outages; this turns a transient Shippo failure into a hard checkout block. Isolate per-recipient failures and provide a fallback.

13. **Ground-equivalent regex matches non-ground service names** [S] — `lib/shippo.ts` `isGroundEquivalent` (94–96) used by `selectMarginRate` (98–109)
    - `/ground|home delivery|standard/i` matches any service whose name contains "standard" (e.g., "Standard Overnight", "Priority Mail Express Standard") and treats it as a ground-equivalent rate. A premium/expedited rate could be selected as the `charge` (highest) or `purchase` (lowest), corrupting the margin spread and potentially purchasing a non-ground label under a ground margin policy. Tighten the regex or use an explicit service-level allowlist.

### Major — checkout / rate lifecycle

14. **No rate-expiry enforcement between quote and payment** [R] — `lib/checkout.ts` `saveCheckoutDetails` (127–153); `lib/shippo.ts` rate `expiresAt` (86, 143); `lib/checkout.ts` `completeCheckout` (238–314)
    - Live Shippo quotes carry a 30-minute `expiresAt`, but `saveCheckoutDetails` stores `shippingQuotes` in the wire format and computes `fulfillmentCents` without re-checking expiry when the Stripe session is created or when the webhook finalizes. A customer who sits on the hosted checkout past the rate window pays a stale quote. Plan R-155 requires "shipping quotes with expiring options." Re-validate expiry at session creation and at webhook finalization.

15. **Checkout shipping quotes are not persisted to the `ShippingQuote` table; only label-time quotes are** [Q] — `lib/checkout.ts` `saveCheckoutDetails` (127–135); `lib/shipping.ts` `createPackageLabel` (159–169)
    - At checkout, quotes are stored only inside `order.wireFormat.checkout.shippingQuotes` (JSON). `ShippingQuote` table rows are created only at label-purchase time. There is no queryable record of what was quoted to the customer at checkout, so audit/reconciliation against the customer-paid charge requires parsing JSON. This compounds #3. Persist checkout-time quotes to the `ShippingQuote` table.

16. **No scheduled tracking refresh; R-176 only exercised manually** [Q] — `lib/shipping.ts` `refreshPackageTracking` (223–236); `app/api/admin/packages/[packageId]/shipping/route.ts`
    - R-176 lists "tracking refresh" under P8. The implementation provides only a staff-triggered `refresh_tracking` action. No cron/sweeper periodically refreshes tracking for in-transit labels, so tracking status staleness is unbounded unless staff manually refresh each package. Add a cron route (P11 owns cron registration, but the refresh worker belongs in P8 scope).

### Major — least privilege / process

17. **Least-privilege inverted on read-only shipping actions** [R] — `app/api/admin/packages/[packageId]/shipping/route.ts` (19–37)
    - All four shipping actions gate on `orders.write`, including `validate_address` and `refresh_tracking` which are read-only against Shippo. A staff member with only `orders.read` cannot validate an address or refresh tracking even though those operations mutate no local state. Gate read-only actions on `orders.read`.

18. **Silent business-logic choices with no DECISION-LOG entry** [R] — `lib/shippo.ts` `isGroundEquivalent` (94–96), `selectMarginRate` (98–109), fixture/live expiry (86, 143)
    - Three domain rules are hardcoded with no DECISION-LOG entry or flag: (a) which service levels count as "ground-equivalent" (regex `/ground|home delivery|standard/i`), (b) 30-minute rate expiry applied to both fixture and live quotes, (c) "charge highest eligible, buy cheapest eligible" without defining what makes a rate "eligible" beyond carrier + ground + non-negative + not-expired. `MERGED-BUILD-PLAN.md` § P8 open question #4 explicitly defers the service-level question. No `DECISION-LOG.md` exists in `workspace/`. Log each decision in `DECISION-LOG.md` and flag.

### Major — duplication / clean-code

19. **Duplicated "active shipment box" lookup across 3 sites (Rule of 2)** [C] — `lib/shipping.ts:154` (`createPackageLabel`), `lib/shipping.ts:214` (`voidPackageLabel`), `lib/shipping.ts:225` (`refreshPackageTracking`)
    - `packageRecord.shipmentBoxes.find((box) => box.externalLabelId && !box.labelVoidedAt)` is repeated verbatim in all three label operations, each followed by the same "no active label" guard with slightly different wording. Extract one `activeShipmentBox(packageRecord)` helper.

20. **`getDeliveryRules()` called N+1 times in `saveCheckoutDetails`** [C] — `lib/checkout.ts:113` (inside the recipients loop) and `lib/checkout.ts:118` (after the loop)
    - The same async getter is awaited once per recipient inside the loop and again outside it. Each call issues its own `prisma.appSetting.findUnique` (plus a possible legacy-zip lookup). Fetch once before the loop and reuse.

21. **`lib/checkout.ts` mixes checkout, Stripe, offline payments, refunds, and signature validation** [C] — `lib/checkout.ts:1-402` (403 lines)
    - Under 500 lines but mixes five concerns: checkout orchestration, Stripe session creation, offline POS payments, Stripe refunds, and webhook signature validation. P8 added the `quoteCheckoutShipping` wiring here, deepening the mix. Payment operations belong in a `lib/payments.ts`.

22. **Duplicated "replace_me" sentinel logic across two modules (Rule of 2)** [C] — `lib/shippo.ts:68-71` (`optionalEnvironmentValue`) and `lib/env.ts:15-16` (`isClerkConfigured`)
    - Both modules treat the literal substring `"replace_me"` as the "env var not really set" sentinel. Extract one shared helper (e.g. `isPlaceholderEnvValue(value)`) so the convention lives in one place.

23. **Inconsistent transaction patterns in one file** [R] — `lib/shipping.ts` (`createPackageLabel:158` interactive form vs `voidPackageLabel:217` / `refreshPackageTracking:228` array form)
    - Two transaction styles for the same concern (shipping mutations) in one module. Pick one and apply everywhere.

<!-- MINORS -->

### Minor — security / disclosure

24. **`providerMode` ("fixture" | "live") disclosed to customer** [S] — `lib/shipping.ts:140` → stored in `wireFormat.checkout.shippingQuotes` → exposed via #1 / #2 paths
    - The customer can observe whether the org is running Shippo in fixture or live mode, leaking shipping-provider configuration state to buyers. Strip `providerMode` from any customer-readable projection.

### Minor — fixture / smoke fidelity

25. **Fixture `validateAddress` is permissive; R-177 not meaningfully exercised** [Q] — `lib/shippo.ts` `createFixtureClient.validateAddress` (170–173)
    - Fixture validation only checks for non-empty name/line1/city/state and a 5-digit ZIP regex. R-177 (Shippo address validation) is not testable in fixture mode beyond the happy path; the smoke cannot exercise rejection of an invalid-but-well-formatted address.

26. **No USPS carrier-account env slot despite USPS being an eligible carrier** [Q] — `lib/shippo.ts` `ShippoEnvironment` (59–63), `createLiveClient` (177–199)
    - `eligibleCarriers` includes `USPS` and fixtures emit USPS rates, but `ShippoEnvironment` only carries `fedexCarrierAccountId` and `upsCarrierAccountId`. The live client only forwards FedEx/UPS account IDs. The asymmetry is undocumented; a live deployment that needs USPS negotiated rates has no env slot.

27. **Fixture tracking number inconsistent with purchased label** [R] — `lib/shippo.ts:169` (`refreshTracking` uses `labelId.slice(-12)`) vs `lib/shippo.ts:165` (`buyLabel` uses `rateId.slice(-12)`)
    - After a void/rebuy the second label's tracking number differs from the first, but a `refreshTracking` call on the first label would produce a tracking number derived from a different ID than `buyLabel` returned. Fixture data is internally inconsistent.

28. **Smoke S1 status wording overstates the end-to-end path** [Q] — `arms/arm-05/workspace/.scratch/PHASE-P8-STATUS.md:6`; `scripts/smoke-p8.ts:84-89`
    - The status says "fixture inputs reversed the high and low carriers" for S1, but the end-to-end `createPackageLabel` flow uses postal code `11201` (last digit `1` → odd → non-reversed), so the package-label assertions exercise the *non-reversed* fixture. Only the direct `selectMarginRate` unit checks use the reversed inputs. Documentation accuracy only.

### Minor — margin / rate edge cases

29. **`selectMarginRate` ties resolve by array order, which Shippo does not guarantee** [Q] — `lib/shippo.ts:106-108`
    - `charge` uses strict `>` and `purchase` uses strict `<`, so when two carriers quote the same amount, the first occurrence in the array wins. Shippo's rate array order is not contractually stable, so identical quotes can yield a zero spread on some runs and a non-zero spread on others. Not a correctness bug (charge >= purchase always holds), but margin is non-deterministic for tied rates.

30. **`selectMarginRate` does two reduce passes (max + min) over the same array** [C] — `lib/shippo.ts:106-108`
    - The charge (max) and purchase (min) are computed in two separate `reduce` calls over `availableRates`. A single pass tracking both extremes is shorter and scans once.

### Minor — naming / type tics

31. **`reversesCarriers` boolean name is a statement, not a yes/no question** [R][C] — `lib/shippo.ts:82`
    - Merged from rules LOW-1 + clean-code L4. `clean-code.mdc` Naming: booleans should read as yes/no questions (`isActive`, `hasPermission`). Prefer `shouldReverseCarriers` or `carriersReversed`.

32. **Unsafe `as Carrier` cast on provider string** [R][C] — `lib/shippo.ts:145`
    - Merged from rules LOW-2 + clean-code L6. `rawRate.provider?.toUpperCase() as Carrier | undefined` forces an arbitrary provider string (e.g. `"DHL"`) into `Carrier`. The subsequent `eligibleCarriers.has(carrier)` filter makes it safe at runtime, but the cast hides the "unknown carrier" case rather than modeling it. Use a typed guard.

33. **`numberValue` helper name is vague** [R] — `lib/shipping.ts:38-40`
    - `numberValue` describes its return type, not what it does. It converts a Prisma `Decimal | null` to `number | null`. A reader has to look at the body to know it handles `null` and calls `Number()`.

### Minor — magic values / consistency

34. **Magic values: `"SHIP"` and `30 * 60 * 1000` repeated** [R] — `lib/shipping.ts:44` (`fulfillmentMethod: { code: "SHIP" }`); `lib/shippo.ts:86, 143` (`30 * 60 * 1000`)
    - The fulfillment method code `"SHIP"` is a literal in `shippablePackage` while `lib/checkout.ts` defines a `deliveryModes` const tuple. Rate expiry `30 * 60 * 1000` is duplicated in fixture and live paths with no named constant. Extract named constants.

35. **Magic values: hardcoded localhost URL and inline ZIP regex** [C] — `scripts/smoke-p8.ts:24` (`"http://localhost:3105/api/order/drafts"`); `lib/shippo.ts:171` (`/^\d{5}(?:-\d{4})?$/`)
    - The smoke URL duplicates the drafts endpoint base used elsewhere, and the ZIP regex is inlined into the fixture validator with no named constant. Minor, but both are the kind of literal that gets copied.

36. **Redundant `apiToken` override at live-client construction** [R] — `lib/shippo.ts:243`
    - `createLiveClient({ ...environment, apiToken: environment.apiToken })` spreads `environment` then overrides `apiToken` with the same field. The override is a no-op; the spread already carries `apiToken`.

### Minor — admin UI drift

37. **`runShippingAction` duplicated across two admin pages with divergent fetch patterns** [C] — `app/admin/packages/page.tsx:96-101` and `app/admin/orders/[orderId]/page.tsx:52-65`
    - Both pages define a `runShippingAction(packageId, action)` that POSTs `{ action }` to `/api/admin/packages/{id}/shipping`, sets a status message, and reloads. The packages page routes through its `postJson` helper; the order-detail page inlines `fetch`. Extract one shared client helper.

38. **`Shipment` shape redeclared in two admin pages (type/schema drift)** [C] — `app/admin/orders/[orderId]/page.tsx:5-16` (`type Shipment`) and `app/admin/packages/page.tsx:15` (inline `shipmentBoxes` object type)
    - Both pages describe the same backend `ShipmentBox` projection by hand. No shared client type for the shipping summary, so the two copies can drift from the schema and from each other. Centralize one `ShipmentSummary` type.

39. **Stale user-facing claims: "Live carrier rates arrive in the shipping phase" / "in P8"** [C] — `app/components/checkout-flow.tsx:102`; `app/admin/settings/page.tsx:39`
    - P8 landed live Shippo quotes at checkout, but both UI strings still tell the user that live carrier rates are future work. Anti-Hallucination: do not make claims that contradict the running system. Update the copy.

40. **`createShippoClient()` re-reads env and rebuilds the client on every shipping operation** [C] — `lib/shipping.ts:100, 123, 147, 216, 227`
    - Each shipping entry point calls `createShippoClient()` with no argument, re-running `getShippoEnvironment()` (three `process.env` reads + `trim` + `includes`) and reconstructing the client. Within a single request the client is rebuilt multiple times. Construct once per request and pass it down (the `quotePackage` → `createPackageLabel` path already threads `quoted.client`; the others do not).

---

## Notes

- 3 blockers: two customer-facing margin confidentiality leaks (#1, #2) and the checkout-vs-label margin reconciliation break (#3, merged from quality C1 + security MEDIUM-3). All three must be fixed before any phase gate.
- 10 duplicates merged across 7 clusters: (a) margin reconciliation / parcel mismatch — quality C1 + security MEDIUM-3; (b) label-purchase race — quality H2 + rules HIGH-1; (c) swallowed compensation error — quality H3 + rules MEDIUM-1 + clean-code H1; (d) `parcelForPackage` hidden mutation — quality M1 + rules MEDIUM-3 + clean-code L7; (e) `voidPackageLabel` robustness — quality M3 + rules MEDIUM-2; (f) `reversesCarriers` boolean name — rules LOW-1 + clean-code L4; (g) unsafe `as Carrier` cast — rules LOW-2 + clean-code L6.
- No new findings introduced during aggregation.
