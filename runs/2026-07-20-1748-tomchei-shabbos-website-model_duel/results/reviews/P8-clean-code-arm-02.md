# P8 Clean-code review — arm-02

Reviewer specialist, blind to model name. Scope: the P8 shipping surface in `arms/arm-02/workspace/` — `lib/shipping/{shippo,margin,quotes,bin-packing,mock-rates,labels}.ts`, `lib/checkout/{fees,quote}.ts` deltas, `lib/env.ts` + `lib/settings.ts` + `lib/packages/board.ts` deltas, `components/admin/{shipment-actions,package-board}.tsx`, `app/(admin)/admin/{orders/[id],packages}/page.tsx` deltas, `app/api/admin/{packages/[id]/label,shipments/[id]/{void,tracking}}/route.ts`, `prisma/schema.prisma` + `prisma/seed.ts` deltas, `prisma/migrations/2026072*`, and the `tests/{bin-packing,shipping-margin,checkout-fees}.test.ts` deltas. Findings only, no fixes.

## MEDIUM

### M1. Shipping domain types live in the mock module
`CarrierRate`, `Parcel`, and `ShipAddress` are defined in `lib/shipping/mock-rates.ts` (lines 10–32) and re-exported by `lib/shipping/shippo.ts` (line 12). Every live-mode consumer (`margin.ts`, `bin-packing.ts`, `quotes.ts`, `labels.ts`) imports these domain types transitively from the mock module. `mock-rates.ts` is the mock-mode fixture file; `CarrierRate`/`Parcel`/`ShipAddress` are the shipping domain vocabulary, not mock-specific. The live REST wrapper depending on the mock module for shared types inverts the dependency (live depends on mock), and the single source of truth for domain types sits inside a file whose name promises "fixtures only." Type/schema-drift category — the domain types should own their own module (or live in `shippo.ts`), with `mock-rates.ts` importing them.

## MINOR

### m1. `PackItem` field-mapping duplicated across label and checkout paths
`lib/shipping/labels.ts:packItems` (lines 38–47) maps `pkg.lines` → `PackItem` (name, quantity, lengthCm, widthCm, heightCm, weightGrams from the joined product). `lib/checkout/quote.ts` (lines 86–100) maps `recipient.lineIds` → priced line → product → the same six `PackItem` fields. The field-by-field mapping from a `{name, quantity} + {lengthCm, widthCm, heightCm, weightGrams}` pair is identical; only the lookup path differs (joined product vs. `productById` map). Rule of 2 is met — a `packItemFromProduct(name, quantity, product)` helper would collapse the shared core.

### m2. Small-action-button class string duplicated 4×
`"rounded-md border border-border px-2 py-0.5 text-xs hover:bg-brand-soft disabled:opacity-50"` appears in `components/admin/shipment-actions.tsx:54`, `components/admin/package-board.tsx:180` and `:193`, and `components/admin/fulfillment-actions.tsx:62`. P8's `shipment-actions.tsx` introduced a local `const button = …` rather than tokenizing the shared class. Four real call sites for the same "small admin action button" style — a class token or a `<SmallButton>` component is the Rule-of-2 extraction the clean-code rule calls out (repeated class strings → tokenize or componentize).

### m3. `loadShipmentBoxes` / `loadOrigin` exported without a second caller
`lib/shipping/quotes.ts:20` and `:24` are `export async function`, but each has exactly one call site — `quoteShipping` (line 38). No other module imports them. Rule of 2 says don't expose a helper for "might be useful later"; these can be module-local `async function`s. Over-eager export surface.

### m4. `shipment-actions.tsx` — redundant `!active` guard
Line 71: `{shipment?.status === "VOIDED" && !active && <p>…</p>}`. `active` is `shipment?.status === "PURCHASED" ? shipment : null` (line 53), so when `status === "VOIDED"` `active` is already `null` and `!active` is always `true`. The `&& !active` clause is "just in case" code the rule set bans — it reads as a guard against a state the surrounding condition already precludes.

### m5. `ShippoError` is an empty `Error` subclass never discriminated
`lib/shipping/shippo.ts:26` `export class ShippoError extends Error {}` adds no fields and is never caught with `instanceof`. Both catch sites (`lib/shipping/quotes.ts:48` and `lib/shipping/labels.ts:102`) cast the caught value as `Error` and read `.message`. The subclass buys nothing — a plain `throw new Error("Shippo …")` (or carrying structured fields if discrimination is ever wanted) would do. AI-tic: a named subclass for the appearance of typed errors without the discrimination that justifies it.

## Notes (not findings)

- The three new admin routes (`label`, `void`, `tracking`) repeat the `requirePermissionApi` → `getOpenSeason` 409 → `try { … } catch (error) { if (error instanceof ActionError) …; throw error }` scaffolding. This is **not** a finding: it matches the established error-handling pattern across all eight existing admin routes (`packages/split`, `packages/regroup`, `packages/stage`, `print-batches`, `orders/packing-slip`, …). Following the one-pattern-per-concern rule is correct here; extracting a `withShipmentAction` wrapper would fork the convention.
- `Shipment.quotedRates` (JSON) duplicates the per-carrier comparison set that `ShippingQuote` + `ShippingQuoteOption` rows also store. Justified denormalization: the `ShippingQuote` row has a 20-min TTL (`QUOTE_TTL_MS`) and is meant for checkout preview, while the `Shipment` row is the permanent audit record of what a purchased label was decided from — the two stores have different lifetimes, so the snapshot must live on the shipment.
- `lib/env.ts` P8 additions are clean: `SHIPPO_API_TOKEN` optional, `SHIPPO_FEDEX_ACCOUNT_ID` / `SHIPPO_UPS_ACCOUNT_ID` optional, with a `superRefine` that refuses the half-configured live state (token set, carrier accounts missing) — matches the existing Stripe fail-closed guard style.
- `lib/shipping/bin-packing.ts` and `mock-rates.ts` keep magic values named (`DEFAULT_ITEM_DIMS`, `DEFAULT_BOX`, `USABLE_VOLUME_RATIO`, `MOCK_SURCHARGE_CENTS`, `MOCK_USPS_MAX_PARCEL_GRAMS`); comments explain intent (first-fit decreasing, ZIP-parity surcharge, USPS weight eligibility), not narration.
- `resolveMargin` is a pure function over `CarrierRate[]` and is fully covered by `tests/shipping-margin.test.ts` (highest/cheapest, flip-by-ZIP, single-carrier zero margin, empty error). `planParcels` likewise by `tests/bin-packing.test.ts`. The money path fails closed in both `computeFees` and `quoteShipping` — no guessed shipping amount.

## Counts

| Severity | Count |
|---|---|
| Medium | 1 |
| Minor | 5 |
| **Total** | **6** |
