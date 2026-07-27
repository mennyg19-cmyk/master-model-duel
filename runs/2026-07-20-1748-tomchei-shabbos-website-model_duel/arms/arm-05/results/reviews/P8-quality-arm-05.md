# P8 Quality Review — arm-05 (blind)

**Phase:** P8 — Shipping: Shippo, rate margin, labels
**Scope:** margin engine correctness, bin packing, label void/rebuy, checkout live rates vs fixtures, EXPECTED S1–S3
**Mode:** findings only — no fixes

## Summary counts

- Critical: 1
- High: 3
- Medium: 5
- Low: 4
- Total: 13

---

## Critical

### C1 — Margin reconciliation broken: stored `chargedCents` on ShipmentBox may not equal what the customer paid

- **Severity:** Critical
- **Location:** `lib/shipping.ts` `quotePackage` / `createPackageLabel` (lines 98–108, 170–185); `lib/checkout.ts` `saveCheckoutDetails` (lines 127–152)
- **Claim:** The customer is charged the checkout-time quote (stored on `order.fulfillmentCents` and `order.wireFormat.checkout.shippingQuotes`), but the `ShipmentBox.chargedCents` is taken from a *fresh* `selectMarginRate` call at label-purchase time. The two quotes use different parcel weights (checkout uses `packageType.maxWeightOunces`; label uses actual summed contents weight) and may run at different times against different Shippo rate tables. UR-003 requires the spread to be recorded "for internal reconciliation" and P12 builds a margin report on `chargedCents` vs `labelCostCents` per package. Because `chargedCents` on the box is the label-time charge, not the checkout-time charge, the P12 margin report will not reconcile against actual customer payments.
- **Evidence:**
  - `quoteCheckoutShipping` (shipping.ts:125–130) sets `parcel.weightOunces = Number(packageType.maxWeightOunces)`.
  - `parcelForPackage` (shipping.ts:63–94) sums real product weights into `packageDimensions.weight`.
  - `createPackageLabel` (shipping.ts:151–156) calls `quotePackage` → `selectMarginRate` on the actual-weight quote and persists `chargedCents = quoted.selection.charge.amountCents` (line 177), ignoring the checkout-time `shippingQuotes` already stored on the order.
  - `saveCheckoutDetails` (checkout.ts:132–134) stores `fulfillmentCents` from the checkout-time `quoteCheckoutShipping` result; this is what the customer pays.
  - No code path copies the checkout-time charge onto the ShipmentBox, and no code path verifies the two charges match.

---

## High

### H1 — "Bin packing" is a single-box volume-sum selection, not bin packing (R-081)

- **Severity:** High
- **Location:** `lib/shipping.ts` `parcelForPackage` (lines 61–96)
- **Claim:** R-081 requires "Bin packing + shipment planning against package types/boxes." The implementation sums all product line volumes into one scalar and picks the smallest active `PackageType` whose box volume `>=` total volume and whose `maxWeightOunces >=` total weight. This is single-box selection, not bin packing: it ignores individual product dimensions (a 20" product is accepted into a 10"×10"×10" box as long as 1000 >= 1000), never splits a package across multiple boxes, and the `ShipmentBox` model is created one-per-label rather than one-per-physical-box. The plan's risk #1 (package↔inventory coupling) and R-081 both expect real geometric planning.
- **Evidence:**
  - `parcelForPackage` (shipping.ts:73) `volume: dimensions.volume + length * width * height * packageLine.quantity` — pure scalar sum.
  - Box filter (shipping.ts:80) `boxVolume(box) >= packageDimensions.volume && Number(box.maxWeightOunces) >= packageDimensions.weight` — no per-axis dimension check, no multi-box split.
  - `createPackageLabel` (shipping.ts:170–185) creates exactly one `ShipmentBox` per call; nothing in P8 ever creates a second box for the same package.
  - Smoke `smoke-p8.ts` uses one product × quantity 1, so the volume check trivially passes and never exercises multi-item or overflow scenarios.

### H2 — Race condition: two concurrent `createPackageLabel` calls can buy two active labels for one package

- **Severity:** High
- **Location:** `lib/shipping.ts` `createPackageLabel` (lines 150–208)
- **Claim:** The "active label exists" guard runs *before* the transaction and *before* the `buyLabel` call. Two concurrent invocations can both read no active label, both call `client.buyLabel`, and both insert `ShipmentBox` rows. `externalLabelId @unique` does not help because Shippo returns a distinct transaction ID per purchase. The result is two non-voided labels on one package with two real purchased labels at the carrier.
- **Evidence:**
  - Guard at shipping.ts:154 `const existingLabel = quoted.packageRecord.shipmentBoxes.find((box) => box.externalLabelId && !box.labelVoidedAt)` — read from `shippablePackage` (line 42) which is a plain `findFirst`, no `SELECT ... FOR UPDATE`.
  - `buyLabel` at shipping.ts:156 runs outside any transaction.
  - The `prisma.$transaction` at line 158 only wraps the local inserts; it does not re-check for a competing label or lock the package row.
  - No unique constraint or partial index prevents a second active `ShipmentBox` for the same `packageId`.

### H3 — Label-failure compensation can silently lose a purchased label (R-175)

- **Severity:** High
- **Location:** `lib/shipping.ts` `createPackageLabel` catch block (lines 204–208)
- **Claim:** When the local DB transaction fails, the code attempts `quoted.client.voidLabel(label.id).catch(() => undefined)` and then throws a message stating "The label purchase was compensated." If the void call itself fails (network, Shippo 5xx, already-voided), the `.catch(() => undefined)` swallows the error, the throw still claims compensation succeeded, and the purchased label is orphaned at the carrier with no local record of its ID. R-175 expects label-failure compensation; the current compensation is best-effort and lossy.
- **Evidence:**
  - shipping.ts:205 `await quoted.client.voidLabel(label.id).catch(() => undefined)` — failure discarded.
  - shipping.ts:207 `throw new Error(`The label purchase was compensated...`)` — message asserts success regardless of void outcome.
  - No `ShipmentBox` row is created in the failure path, so the orphaned `label.id` is not persisted anywhere for later reconciliation.

---

## Medium

### M1 — `parcelForPackage` mutates `package.packageTypeId` outside a transaction and without audit/version bump

- **Severity:** Medium
- **Location:** `lib/shipping.ts` `parcelForPackage` (lines 83–85)
- **Claim:** When the selected box differs from the package's current `packageTypeId`, the code calls `prisma.package.update({ where: { id: packageId }, data: { packageTypeId: selectedBox.id } })` with no transaction, no optimistic version check, and no `PackageAudit` entry. A concurrent `splitPackage`/`regroupPackages` (which do version-bump and audit) could collide, and the package-type change is invisible to the audit trail.
- **Evidence:**
  - shipping.ts:83–85 `if (packageRecord.packageTypeId !== selectedBox.id) { await prisma.package.update(...) }` — bare update.
  - Contrast `advancePackageStatus` (package-operations.ts:166–175) which uses `updateMany` with a version guard and writes a `packageAudit`.

### M2 — Checkout shipping quotes are not persisted to the `ShippingQuote` table; only label-time quotes are

- **Severity:** Medium
- **Location:** `lib/checkout.ts` `saveCheckoutDetails` (lines 127–135); `lib/shipping.ts` `createPackageLabel` (lines 159–169)
- **Claim:** At checkout, `quoteCheckoutShipping` returns quotes that are stored only inside `order.wireFormat.checkout.shippingQuotes` (JSON). The `ShippingQuote` table rows are created only at label-purchase time, after `deleteMany` for the package. There is no queryable record of what was quoted to the customer at checkout, so audit/reconciliation against the customer-paid charge requires parsing JSON. This compounds C1.
- **Evidence:**
  - checkout.ts:135 `const checkout = { ...parsed, rules: {...}, shippingQuotes }` — quotes live only in `wireFormat`.
  - shipping.ts:159–169 `shippingQuote.deleteMany` then `createMany` — only label-time quotes are in the table.

### M3 — `voidPackageLabel` has no optimistic lock and no idempotency on the Shippo side

- **Severity:** Medium
- **Location:** `lib/shipping.ts` `voidPackageLabel` (lines 211–221)
- **Claim:** The function reads the package, finds the active box, calls Shippo `/refunds/`, then updates `labelVoidedAt` with no version check on the package or shipment box. Two concurrent voids both call Shippo; the second may fail (already refunded) and leave the local row un-voided while the carrier label is already cancelled. There is also no idempotency key on the Shippo refund request, so a retry after a network blip could create a second refund attempt.
- **Evidence:**
  - shipping.ts:216 `await createShippoClient().voidLabel(shipmentBox.externalLabelId)` — no idempotency key.
  - shipping.ts:217–220 `prisma.$transaction([ prisma.shipmentBox.update({ where: { id: shipmentBox.id }, data: { labelVoidedAt: new Date() } }), ... ])` — no version guard on the box.

### M4 — No scheduled tracking refresh; R-176 only exercised manually

- **Severity:** Medium
- **Location:** `lib/shipping.ts` `refreshPackageTracking` (lines 223–236); `app/api/admin/packages/[packageId]/shipping/route.ts`
- **Claim:** R-176 lists "tracking refresh" under P8. The implementation provides only a staff-triggered `refresh_tracking` action. There is no cron/sweeper that periodically refreshes tracking for in-transit labels, so tracking status staleness is unbounded unless staff manually refresh each package. The plan does not explicitly mandate a cron here, but R-176's "refresh" reads as ongoing, not one-shot.
- **Evidence:**
  - `refreshPackageTracking` exists but is only invoked from the POST `refresh_tracking` action.
  - No entry under `app/api/cron/` for tracking refresh (only the P5/P11 cron routes exist).

### M5 — `quoteCheckoutShipping` has no fallback when Shippo returns no eligible ground rates

- **Severity:** Medium
- **Location:** `lib/shipping.ts` `quoteCheckoutShipping` (lines 110–143); `selectMarginRate` (lines 98–109)
- **Claim:** For `SHIP` recipients, checkout unconditionally calls `selectMarginRate`, which throws `"Shippo returned no eligible ground-equivalent carrier rates."` if no rate passes the ground-equivalent + non-expired filter. There is no fallback to a configured flat rate, no graceful degradation, and no per-recipient error isolation (one bad address aborts the whole checkout via `Promise.all`). The plan's risk #3 flags provider outages; this path turns a transient Shippo failure into a hard checkout block.
- **Evidence:**
  - shipping.ts:105 `if (!availableRates.length) throw new Error("Shippo returned no eligible ground-equivalent carrier rates.")`.
  - shipping.ts:131 `return Promise.all(addresses.map(...))` — a throw in any one rejects the entire batch.

---

## Low

### L1 — Fixture `validateAddress` is permissive; R-177 not meaningfully exercised

- **Severity:** Low
- **Location:** `lib/shippo.ts` `createFixtureClient.validateAddress` (lines 170–173)
- **Claim:** Fixture validation only checks for non-empty name/line1/city/state and a 5-digit ZIP regex. It does not validate state codes, country, or any real address database. R-177 (Shippo address validation) is therefore not testable in fixture mode beyond the happy path; the smoke cannot exercise rejection of an invalid-but-well-formatted address.
- **Evidence:**
  - shippo.ts:171 `isValid: Boolean(address.name && address.line1 && address.city && address.state && /^\d{5}(?:-\d{4})?$/.test(address.postalCode))`.

### L2 — No USPS carrier-account env slot despite USPS being an eligible carrier

- **Severity:** Low
- **Location:** `lib/shippo.ts` `ShippoEnvironment` (lines 59–63), `createLiveClient` (lines 177–199)
- **Claim:** `eligibleCarriers` includes `USPS` and fixtures emit USPS rates, but `ShippoEnvironment` only carries `fedexCarrierAccountId` and `upsCarrierAccountId`. The live client only forwards FedEx/UPS account IDs to Shippo. The plan says "+USPS where applicable," so this may be intentional (USPS often doesn't need an account), but the asymmetry is undocumented and a live deployment that needs USPS negotiated rates has no env slot for it.
- **Evidence:**
  - shippo.ts:66 `eligibleCarriers = new Set<Carrier>(["FEDEX", "UPS", "USPS"])`.
  - shippo.ts:178 `carrierAccounts = [environment.fedexCarrierAccountId, environment.upsCarrierAccountId].filter(...)` — USPS absent.

### L3 — `selectMarginRate` ties resolve by array order, which Shippo does not guarantee

- **Severity:** Low
- **Location:** `lib/shippo.ts` `selectMarginRate` (lines 98–109)
- **Claim:** `charge` uses strict `>` and `purchase` uses strict `<`, so when two carriers quote the same amount, the first occurrence in the array wins. Shippo's rate array order is not contractually stable, so identical quotes can yield a zero spread on some runs and a non-zero spread on others. Not a correctness bug (charge >= purchase always holds), but it makes margin non-deterministic for tied rates.
- **Evidence:**
  - shippo.ts:106 `availableRates.reduce((highest, rate) => rate.amountCents > highest.amountCents ? rate : highest)`.
  - shippo.ts:107 `availableRates.reduce((lowest, rate) => rate.amountCents < lowest.amountCents ? rate : lowest)`.

### L4 — Smoke S1 status wording overstates the end-to-end path

- **Severity:** Low
- **Location:** `arms/arm-05/workspace/.scratch/PHASE-P8-STATUS.md` line 6; `scripts/smoke-p8.ts` lines 84–89
- **Claim:** The status says "fixture inputs reversed the high and low carriers" for S1, but the end-to-end `createPackageLabel` flow uses postal code `11201` (last digit `1` → odd → non-reversed), so the package-label assertions (`chargedCents=2050`, `labelCostCents=1495`) exercise the *non-reversed* fixture. Only the direct `selectMarginRate` unit checks (`reversedSelection`) use the reversed inputs. The status conflates the two. Not a code defect; documentation accuracy only.
- **Evidence:**
  - smoke-p8.ts:59 `postalCode: "11201"` → fixture (shippo.ts:82) `Number.parseInt("1", 10) % 2 === 0` is false → non-reversed amounts `{ FEDEX: 2050, UPS: 1495, USPS: 1710 }`.
  - smoke-p8.ts:44–50 uses synthetic rates directly, not the fixture client.

---

## EXPECTED S1–S3 coverage notes

- **S1 (margin math):** Direct `selectMarginRate` unit checks pass for both orientations (smoke-p8.ts:44–50). End-to-end label purchase asserts `chargedCents=2050`, `labelCostCents=1495`, `marginCents=555` for the non-reversed fixture (smoke-p8.ts:86–88). The math is correct for the tested path, but see C1 — the stored `chargedCents` is not reconciled against the checkout-time charge.
- **S2 (void + rebuy):** Void then rebuy produces a new label with a distinct ID (smoke-p8.ts:91–93). Checkout for a `SHIP` recipient uses the fixture quote (`fulfillmentCents=2050`, smoke-p8.ts:114). The "P5 placeholder" replacement claim in the status is not verifiable because `lib/checkout.ts` has no placeholder code path — it always calls `quoteCheckoutShipping`. S2 passes as written but does not prove a migration occurred.
- **S3 (unshipped label guard):** Tracking refresh returns `IN_TRANSIT` (smoke-p8.ts:118). A `PRINTED` package's label remains voidable (smoke-p8.ts:119–124). The guard `if (packageRecord.status === "SENT") throw` (shipping.ts:213) enforces the "unshipped" requirement. S3 passes. Note: the P9 reroute hook is not yet present (out of scope), so the "P9 hook stub acceptable" clause in EXPECTED is unverified but not required.
