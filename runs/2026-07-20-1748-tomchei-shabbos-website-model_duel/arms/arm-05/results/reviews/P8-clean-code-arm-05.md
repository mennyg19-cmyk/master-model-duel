# P8 Clean-code review — arm-05

Reviewer: clean-code specialist (blind — no model names).
Scope: P8 deliverables only — `lib/shippo.ts`, `lib/shipping.ts`, `app/api/admin/packages/[packageId]/shipping/route.ts`, P8 touch-ups in `lib/checkout.ts` (`quoteCheckoutShipping` wiring), `app/admin/packages/page.tsx` and `app/admin/orders/[orderId]/page.tsx` (shipping action UI), `prisma/schema.prisma` (ShippingQuote / ShipmentBox additions), `scripts/smoke-p8.ts`.
Rules: `arms/arm-05/.cursor/rules/clean-code.mdc`.
Format: severity · location · claim · evidence. Findings only — no fixes.

---

## High

### H1 — Swallowed compensation error in `createPackageLabel`
- Location: `lib/shipping.ts:204-208`.
- Claim: When the local persistence transaction fails after a label is purchased, the compensation `voidLabel` call is wrapped in `.catch(() => undefined)`, silently discarding any void failure. `clean-code.mdc` Error Handling: "No swallowed errors (empty catch blocks)." A failed void leaves a purchased carrier label (real money spent) with no signal to the operator or the audit trail — the thrown error only describes the persistence failure, not that a label remains live.
- Evidence: `await quoted.client.voidLabel(label.id).catch(() => undefined);` followed by `throw new Error(\`The label purchase was compensated because its local record could not be saved: ${message}\`);` — the void outcome (success or failure) is never recorded or surfaced.

## Medium

### M1 — Duplicated "active shipment box" lookup across 3 sites (Rule of 2)
- Location: `lib/shipping.ts:154` (`createPackageLabel`), `lib/shipping.ts:214` (`voidPackageLabel`), `lib/shipping.ts:225` (`refreshPackageTracking`).
- Claim: `packageRecord.shipmentBoxes.find((box) => box.externalLabelId && !box.labelVoidedAt)` is repeated verbatim in all three label operations. Rule of 2 is met (3 call sites now); extract one `activeShipmentBox(packageRecord)` helper.
- Evidence: identical `find` predicate at lines 154, 214, and 225, each followed by the same "no active label" guard with slightly different wording.

### M2 — `getDeliveryRules()` called N+1 times in `saveCheckoutDetails`
- Location: `lib/checkout.ts:113` (inside the recipients loop) and `lib/checkout.ts:118` (after the loop).
- Claim: The same async getter is awaited once per recipient inside the loop (line 113) and then again outside it (line 118). Each call issues its own `prisma.appSetting.findUnique` (plus a possible legacy-zip lookup). This is a duplicated data-fetch and an N+1-style DB pattern in a single function. Fetch once before the loop and reuse.
- Evidence: line 113 `!((await getDeliveryRules()).allowedZipCodes.includes(address.postalCode.slice(0, 5)))` runs per recipient; line 118 `const rules = await getDeliveryRules();` re-fetches the same settings.

### M3 — `lib/checkout.ts` mixes checkout, Stripe, offline payments, refunds, and signature validation
- Location: `lib/checkout.ts:1-402` (403 lines).
- Claim: `clean-code.mdc` Abstraction Discipline: "Split files by concern … split when >500 lines, mixed concerns, or a refactor command." This file is under 500 lines but mixes five concerns: checkout orchestration (`startCheckout`/`saveCheckoutDetails`/`completeCheckout`), Stripe session creation (`createProviderCheckout`), offline POS payments (`postOfflinePayment`/`createPosOrder`/`voidOfflinePayment`), Stripe refunds (`refundStripePayment`/`refundSafetyPayment`), and webhook signature validation (`isValidStripeSignature`). P8 added the `quoteCheckoutShipping` wiring here, deepening the mix. Payment operations belong in a `lib/payments.ts`.
- Evidence: `quoteCheckoutShipping` import and `shippingQuotes` block at lines 6, 132-134 sit alongside Stripe `fetch` calls at lines 175 and 190 and the offline-payment section at lines 316-366.

### M4 — Duplicated "replace_me" sentinel logic across two modules (Rule of 2)
- Location: `lib/shippo.ts:68-71` (`optionalEnvironmentValue`) and `lib/env.ts:15-16` (`isClerkConfigured`).
- Claim: Both modules treat the literal substring `"replace_me"` as the "env var not really set" sentinel. Rule of 2 is met; the sentinel check should be one shared helper (e.g. `isPlaceholderEnvValue(value)`), so the convention lives in one place.
- Evidence: `lib/shippo.ts:70` `return value && !value.includes("replace_me") ? value : undefined;`; `lib/env.ts:15-16` `&& !publishableKey.includes("replace_me") && !secretKey.includes("replace_me")`.

## Low

### L1 — `runShippingAction` duplicated across two admin pages with divergent fetch patterns
- Location: `app/admin/packages/page.tsx:96-101` and `app/admin/orders/[orderId]/page.tsx:52-65`.
- Claim: Both pages define a `runShippingAction(packageId, action)` that POSTs `{ action }` to `/api/admin/packages/{id}/shipping`, sets a status message, and reloads. The packages page routes through its `postJson` helper; the order-detail page inlines `fetch`. Two patterns for the same admin POST concern. Extract one shared client helper.
- Evidence: packages page line 97 `const response = await postJson(...)`; order-detail page lines 53-57 hand-rolls the same `fetch` with `headers`/`body` and the same success message at line 63.

### L2 — `Shipment` shape redeclared in two admin pages (type/schema drift)
- Location: `app/admin/orders/[orderId]/page.tsx:5-16` (`type Shipment`) and `app/admin/packages/page.tsx:15` (inline `shipmentBoxes` object type).
- Claim: Both pages describe the same backend `ShipmentBox` projection by hand. There is no shared client type for the shipping summary, so the two copies can drift from the schema and from each other. Centralize one `ShipmentSummary` type (the API route at `app/api/admin/packages/[packageId]/shipping/route.ts` already returns this shape).
- Evidence: order-detail page enumerates 10 fields; packages page enumerates 6 fields inline — same model, two hand-written shapes.

### L3 — Stale user-facing claims: "Live carrier rates arrive in the shipping phase" / "in P8"
- Location: `app/components/checkout-flow.tsx:102` and `app/admin/settings/page.tsx:39`.
- Claim: P8 landed live Shippo quotes at checkout (per `PHASE-P8-STATUS.md` and `quoteCheckoutShipping`), but both UI strings still tell the user that live carrier rates are future work. `clean-code.mdc` Anti-Hallucination: do not make claims that contradict the running system. These are user-visible falsehoods now.
- Evidence: checkout-flow line 102 `Live carrier rates arrive in the shipping phase.`; settings line 39 `Checkout uses these ZIP and date rules now. Live carrier rates arrive in P8.`

### L4 — `reversesCarriers` boolean name is a statement, not a yes/no question
- Location: `lib/shippo.ts:82`.
- Claim: `clean-code.mdc` Naming: "Boolean names read as yes/no questions (`isActive`, `hasPermission`)." `reversesCarriers` reads as a verb phrase. Prefer `shouldReverseCarriers` or `carriersReversed`.
- Evidence: `const reversesCarriers = Number.parseInt(postalCode.at(-1) ?? "0", 10) % 2 === 0;`

### L5 — `selectMarginRate` does two reduce passes (max + min) over the same array
- Location: `lib/shippo.ts:106-108`.
- Claim: `clean-code.mdc` Anti-AI-Tics: "No over-verbose code that does in 10 lines what could be done in 3." The charge (max) and purchase (min) are computed in two separate `reduce` calls over `availableRates`. A single pass tracking both extremes is shorter and scans once.
- Evidence: `const charge = availableRates.reduce((highest, rate) => rate.amountCents > highest.amountCents ? rate : highest);` then `const purchase = availableRates.reduce((lowest, rate) => rate.amountCents < lowest.amountCents ? rate : lowest);`.

### L6 — `parseLiveRates` unsafe `as Carrier | undefined` cast on provider string
- Location: `lib/shippo.ts:145`.
- Claim: `clean-code.mdc` Anti-AI-Tics: "No redundant type assertions the compiler already guarantees." This assertion is not guaranteed — it forces an arbitrary `provider` string (e.g. `"DHL"`) into `Carrier`. The subsequent `eligibleCarriers.has(carrier)` filter makes it safe at runtime, but the cast hides the "unknown carrier" case rather than modeling it. A typed guard would convey intent.
- Evidence: `const carrier = rawRate.provider?.toUpperCase() as Carrier | undefined;`

### L7 — `parcelForPackage` mutates `package.packageTypeId` outside a transaction
- Location: `lib/shipping.ts:83-85`.
- Claim: When the package's measured contents fit a different box than the stored `packageTypeId`, the code updates `Package.packageTypeId` in its own `prisma.package.update` before the label-purchase transaction begins. If the later `buyLabel` or the persistence transaction fails, the box assignment is already committed with no compensating action. Side effects that mutate domain state should sit inside the same transaction as the operation they support.
- Evidence: `if (packageRecord.packageTypeId !== selectedBox.id) { await prisma.package.update({ where: { id: packageId }, data: { packageTypeId: selectedBox.id } }); }` runs before `quotePackage` returns and before any transaction.

### L8 — `quoteCheckoutShipping` sends `packageType.maxWeightOunces` as the parcel weight
- Location: `lib/shipping.ts:125-130`.
- Claim: The checkout rate quote builds the parcel from the first active `PackageType` and passes `weightOunces: Number(packageType.maxWeightOunces)` — the box's maximum capacity, not the order's actual weight. The value sent to Shippo misrepresents the shipment and will over-quote for light orders. The per-package path in `parcelForPackage` correctly sums actual product weights; checkout does not.
- Evidence: line 129 `weightOunces: Number(packageType.maxWeightOunces)` vs `parcelForPackage`'s `dimensions.weight` accumulation at lines 63-76.

### L9 — `createShippoClient()` re-reads env and rebuilds the client on every shipping operation
- Location: `lib/shipping.ts:100` (`quotePackage`), `:123` (`quoteCheckoutShipping`), `:147` (`validatePackageAddress`), `:216` (`voidPackageLabel`), `:227` (`refreshPackageTracking`).
- Claim: Each shipping entry point calls `createShippoClient()` with no argument, which re-runs `getShippoEnvironment()` (three `process.env` reads + `trim` + `includes`) and reconstructs the client object. Within a single request the client is rebuilt multiple times. Construct once per request and pass it down (the `quotePackage` → `createPackageLabel` path already threads `quoted.client`; the others do not).
- Evidence: five bare `createShippoClient()` call sites; only `createPackageLabel` reuses the client via `quoted.client`.

### L10 — Magic values: hardcoded localhost URL and inline ZIP regex
- Location: `scripts/smoke-p8.ts:24` (`"http://localhost:3105/api/order/drafts"`) and `lib/shippo.ts:171` (fixture `validateAddress` ZIP regex).
- Claim: `clean-code.mdc` Refactor categories: "Magic values — named constants / enums." The smoke URL duplicates the drafts endpoint base used elsewhere, and the ZIP regex `/^\d{5}(?:-\d{4})?$/` is inlined into the fixture validator with no named constant. Minor, but both are the kind of literal that gets copied.
- Evidence: smoke line 24 literal URL; shippo line 171 `/^\d{5}(?:-\d{4})?$/.test(address.postalCode)`.

---

## Counts

- High: 1
- Medium: 4
- Low: 10
- Total: 15

## Theme

The dominant P8 theme is duplicated fetch/lookup logic: the "active shipment box" predicate (3 sites, M1), the `getDeliveryRules()` N+1 re-fetch (M2), and the `"replace_me"` sentinel (M4) all meet Rule of 2 and want a single helper. The single High is a swallowed compensation error (H1) — operationally risky because a failed void leaves a purchased label live with no audit signal. `lib/checkout.ts` (M3) is the only file approaching god-file territory by mixing five payment/checkout concerns, though it stays under the 500-line line count. Naming is mostly clean (no banned standalone names); the one exception is the boolean `reversesCarriers` (L4). Two user-facing strings now contradict the running system (L3). No narration or change-explanation comments were introduced in P8 additions — comment quality is good.
