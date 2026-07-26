# P8 Aggregate Review — arm-04 (blind)

**Phase:** P8 — Shipping (Shippo wrapper, margin engine, bin packing, labels, live checkout rates)
**Inputs:** P8-security, P8-quality, P8-rules, P8-clean-code specialist reviews
**Method:** Union + dedupe by (location, claim). Security blockers always survive. No new findings.

## Counts after dedupe

| Tier | Count |
|---|---|
| Blockers | 0 |
| Majors | 4 |
| Minors | 15 |
| Informational (not in fix list) | 2 |

## Severity mapping

- Security Critical/High → blocker/major. None present this phase.
- Security Medium (PII in logs) → major.
- Quality High (correctness regression vs EXPECTED, latent under deterministic stand-in) → major (not a true blocker: no data loss, no security impact, smoke passes).
- Rules/clean-code Medium → major when structural (duplication across 8 sites, pattern drift across a folder); minor when localized.
- Informational security notes (I1, I2) kept out of the fix list.

## Prioritized fix list

### Majors (4)

1. **M-MAJ-1 — Margin recorded from fresh quote, not the frozen customer fee** (quality F1; UR-003/G-006 regression)
   - `src/lib/shipping/label-service.ts:347` (`claimParcels` → `allocateCustomerPrice(quote.customerPriceCents ...)`)
   - `box.fulfillmentFeeCents` is never read in `label-service.ts`; `ShipmentBox.customerPriceCents`/`marginCents` and the `shipping.label_purchased` audit record a spread the org did not keep once a real carrier's rate table moves between checkout and buy. Smoke S1c cannot catch this because the local stand-in is deterministic. Anchor `customerPriceCents` to `box.fulfillmentFeeCents`; recompute `marginCents = fulfillmentFeeCents - carrierCostCents`.

2. **M-MAJ-2 — Recipient address written to stderr on carrier quote failure** (security M1; PII in logs)
   - `src/lib/shipping/quote-service.ts:194-199` (`console.error` includes `subject.key` and the Shippo error payload, which echoes `address_to`/`address_from`)
   - Narrows the data exposure beyond the app's own audit trail (`audit.ts:130-133` logs only `postalCode`). Redact or hash the subject key and strip the carrier payload before logging; keep only status + a short message.

3. **M-MAJ-3 — Address-shape mapping duplicated across 8 sites with drifting defaults** (clean-code M1, with m2/m6 folded in)
   - Inside `shipping/`: `src/lib/shipping/quote-service.ts:226-240` (`destinationOf`), `src/lib/shipping/address-check.ts:50-59`.
   - Outside: `cart.ts:192-197`, `grouping.ts:77-91` and `:104-114`, `staff-orders.ts:159-166`, `customer-orders.ts:190-197`, `checkout-summary.ts:233-241`, `package-board.ts:247-255`.
   - `country` default drifts: `?? 'US'` in `quote-service.ts:237` and `address-check.ts:57`, `?? ''` in six other sites, `null` in the `QuoteSubject.address` type. `name || 'Shipping department'` and `phone` defaults are written twice. Introduce one `toShippingAddress(row): ShippingAddress` (or `address-mapping.ts`) and a single documented `country` default; collapse all eight call sites.

4. **M-MAJ-4 — DB-access pattern drift inside `shipping/`** (clean-code M2)
   - `src/lib/shipping/quote-service.ts` takes `client: DbClient` on every export (injected, transaction-scoped). `src/lib/shipping/label-service.ts:7` (`db` at `:169,:237,:293,:351`), `src/lib/shipping/address-check.ts:5` (`db` at `:25,:61`), `src/lib/shipping/carriage-view.ts:5` (`db` at `:73`) all import the `db` singleton directly. Pick one pattern per `clean-code.mdc` Consistency; convert the three singleton files to `DbClient` injection (or document why they cannot be).

### Minors (15)

5. **M-MIN-1 — Carrier account ids not flagged as secrets in env-spec** (security L1) — `src/lib/env-spec.ts:142-155`. Add `secret: true` to `SHIPPO_FEDEX_ACCOUNT_ID` / `SHIPPO_UPS_ACCOUNT_ID` so `renderEnvExample()` annotates them.
6. **M-MIN-2 — Label URL is a long-lived bearer token, not rotated on void** (security L2) — `src/components/admin/carriage-card.tsx:195-204`, `src/lib/shipping/shippo-api.ts:134-138`, `src/lib/shipping/label-service.ts:200-207`. Void does not invalidate the PDF; URL persists on `VOIDED` rows. Add an origin check before rendering `href`; consider clearing/rotating `labelUrl` on void.
7. **M-MIN-3 — Unbounded free-text columns from form and carrier input** (security L3) — `src/app/(admin)/admin/fulfillment/actions.ts:220-232` (`reason`), `src/lib/shipping/shippo-api.ts:124-131,185-194` (`failureMessage`, `addressValidationNote`), `prisma/schema/fulfillment.prisma:112,190,200`. Cap length on the action side and add `@db.VarChar` limits.
8. **M-MIN-4 — `buyLabelForPackage` trusts rate ids without an explicit ownership check** (security L4, defense-in-depth) — `src/lib/shipping/label-service.ts:59-90`. Assert `purchase.rateIds[index]` was produced by this box's `quoteFor` call before the carrier buy.
9. **M-MIN-5 — `ShippingQuoteOption.providerRateId` stores only the first parcel's rate id** (quality F2). Multi-parcel option row drops the rest; recoverable from parcel rows but the reconciliation view is incomplete.
10. **M-MIN-6 — `validatePackageAddress` does not gate on `methodKind === 'SHIPPING'`** (quality F3, defense-in-depth). Pickup boxes return `ADDRESS_NOT_CHECKABLE` for the wrong reason; add the kind check.
11. **M-MIN-7 — `combineParcelRates` eligibility can mis-fire on duplicate service rates per parcel** (quality F4, latent). Add a one-line guard that `parcels.length` does not exceed `parcelRates.length`.
12. **M-MIN-8 — Defensive `?? purchase.costCents` for an impossible state** (rules M1) — `src/lib/shipping/label-service.ts:132-133, 347`. `quoteFor` already rejects `source === 'FALLBACK'`; the fallback would silently bill the customer the carrier cost (margin = 0). Let the null throw.
13. **M-MIN-9 — `codegraph` index never initialized** (rules L1) — `arms/arm-04/workspace/.codegraph/` absent. Run `codegraph init` once before further structural work (moot if the CLI was not on PATH in the contestant env).
14. **M-MIN-10 — Defensive `?? ''` for `trackingNumber` the `where` clause excludes** (rules L2) — `src/lib/shipping/label-service.ts:259`. Query filters `trackingNumber: { not: null }`; drop the `?? ''` for trackingNumber (keep it for `carrier`, which is genuinely nullable).
15. **M-MIN-11 — Magic constant `453.59237` (grams per pound) duplicated with divergent precision** (clean-code m1, deduped with rules M2) — `src/lib/shipping/shippo-api.ts:30` (`.toFixed(2)`), `src/components/admin/carriage-card.tsx:230-232` (`.toFixed(1)`). Add `core/units.ts` with `gramsToPounds(grams, decimals)` alongside `core/money.ts`.
16. **M-MIN-12 — `label-service.ts` is 423 lines with mixed concerns** (clean-code m3). Owns buy + claim + compensate, void, tracking, `isLabelVoidable`, `readShippable`, and the `VOIDABLE_STAGES`/`ACTIVE_LABEL_STATUSES` constants. The `db.package.findFirst({ where: { id, ...boardScopeWhere(seasonId) } })` lookup is repeated three times (`:169,:237,:292`) with three `include` shapes. Split into `label-buy.ts` / `label-void.ts` / `label-track.ts` + a shared `read-shippable.ts`.
17. **M-MIN-13 — `carrier` typed as `string` everywhere it could be a union** (clean-code m4) — `provider.ts:54`, `margin.ts:18`, `carriage-view.ts:22,39`, `local-provider.ts:35-39`. Introduce a `Carrier` union so the compiler catches `'FedEx'` vs `'Fedex'` casing drift.
18. **M-MIN-14 — `VOIDABLE_STAGES` private, `isLabelVoidable` exported, `carriage-view` re-derives the rule** (clean-code m5) — `label-service.ts:35,38,284`, `carriage-view.ts:120-121`. Export `isActiveLabel(status)` (or move both predicates to `label-status.ts`) so `carriage-view` does not hardcode `'PURCHASED'`.
19. **M-MIN-15 — Double `recordQuote` per shipping box (checkout + buy) with no canonical-row rule** (clean-code m7) — `order-service.ts:444-450`, `label-service.ts:390`. `carriage-view.ts:85-88` reads `orderBy: requestedAt desc, take: 1` (buy-time); `smoke-p8.ts:105-108` reads `findFirstOrThrow` (unspecified order, gets checkout-time). Document that the latest `requestedAt` is canonical and have the smoke read it that way, or stop writing the checkout row once a buy row exists.

### Informational (not in fix list)

- `voidLabelForPackage` silently skips parcels with no `providerTransactionId`; returned `parcelCount` can disagree with carrier calls made (security I1, `label-service.ts:193-208`).
- Local provider `buyLabel` only validates the rate-id prefix; weaker than Shippo's server-side refusal (security I2, `local-provider.ts:65-80`).

## Top fix targets

1. **M-MAJ-1** — Anchor `ShipmentBox.customerPriceCents` to `box.fulfillmentFeeCents` so recorded margin ties back to money (UR-003/G-006).
2. **M-MAJ-2** — Stop writing recipient address to stderr on carrier quote failure (PII).
3. **M-MAJ-3** — One `toShippingAddress` helper across all eight address-mapping sites; one documented `country` default.
4. **M-MAJ-4** — Convert `label-service` / `address-check` / `carriage-view` to `DbClient` injection to match `quote-service`.
