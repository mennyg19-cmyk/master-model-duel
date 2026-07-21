# P8 Clean-Code Review — arm-03 (blind label)

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Phase: P8 — Shipping: Shippo, rate margin, labels
Tree: `arms/arm-03/workspace/src`
Reviewer role: clean-code specialist (external)
Scope: duplication, naming, god files, pattern drift per `rules/clean-code.mdc`.
Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 4 |
| Medium | 6 |
| Low | 3 |
| **Total** | **13** |

P8 adds a clean, well-typed Shippo wrapper and a pure margin engine — the strongest new code in the arm. The debt is in how the new layer connects to existing patterns: a third error class, a second parcel resolver, a second `checkoutSnapshot` shape, and four new direct-`auditLog.create` sites that bypass the `writeAudit` helper P7 already flagged. No god files this phase; the largest new file (`labels.ts`, 288 lines) sits well under the 500-line threshold.

## Findings

| ID | Severity | Location | Claim |
|---|---|---|---|
| CC-P8-01 | High | `src/lib/shipping/labels.ts:16-23` (`LabelError`); `src/lib/result.ts` (`Result`/`err`); `src/lib/auth.ts` (`AuthError`); P7 `src/lib/packages/actions.ts` (`ActionError`) | A third domain-error class. The project already has `Result<T,E>` with `err(code,message)` and `AuthError`; P7 added `ActionError`; P8 adds `LabelError extends Error { status = 409 }`. Routes branch on `instanceof LabelError` before `apiErrorResponse`. Four error-signaling patterns now coexist (`Result`, `AuthError`, `ActionError`, `LabelError`). The `LabelError` could be `err("label_conflict", msg)` from inside the transaction, or folded into `apiErrorResponse`'s switch like `AuthError`. |
| CC-P8-02 | High | `src/lib/shipping/checkout-rates.ts:41-46` (`DEFAULT_PARCEL`) vs `src/lib/shipping/labels.ts:84-97` (`planToParcel` + `fallbackParcel`) | Two parcel-resolution paths for the same `quoteMargin` call. Checkout uses a hardcoded `DEFAULT_PARCEL = {12,9,6,48}`; label purchase uses `planToParcel(plan, fallbackParcel)` where `fallbackParcel` is a 12,9,6 box with weight-from-items. Both produce a `ShippoParcel` for `quoteMargin` from different sources with no shared resolver. The checkout default and the label fallback are both 12×9×6 — duplicated dims. |
| CC-P8-03 | High | `src/lib/checkout/session.ts:369-377` vs `459-464` | Two `checkoutSnapshot` shapes. `prepareCheckout` writes `{ fees, liveShip, shipQuotes, subtotalCents, donationCents, expectedTotalCents, capturedAt }`; `createHostedCheckoutSession` writes `{ fees, subtotalCents, donationCents, expectedTotalCents }`. No shared `buildCheckoutSnapshot()` helper. The `liveShip`/`shipQuotes`/`capturedAt` keys appear in one snapshot and not the other. |
| CC-P8-04 | High | `src/lib/shipping/labels.ts:127-161,179-206,233-250,266-277` vs `src/lib/audit.ts:6` (`writeAudit`) | Four new direct `tx.auditLog.create` / `db.auditLog.create` sites bypass the centralized `writeAudit` helper. P7 flagged the same drift (CC-03-09: ~12 sites bypass `writeAudit`). P8 adds 4 more: label-purchased, label-failed, label-voided, tracking-refreshed. The helper exists; new code ignores it. The audit `meta` shapes are also hand-built per site (no shared `labelAuditMeta(label, extra)` helper). |
| CC-P8-05 | Medium | `src/lib/shipping/bin-packing.ts:156-187` (`planPackageShipment`) | Planning function with a hidden write. `planPackageShipment` returns a `ShipmentPlan` but also does `db.package.update({ data: { shipmentPlan: plan } })` as a side effect. The name says "plan", the body says "plan + persist". `createLabelForPackage` calls it for its return value; the persist is an undeclared side effect. Either rename to `planAndPersistPackageShipment` or split the persist out. |
| CC-P8-06 | Medium | `src/lib/shipping/labels.ts:25-43` (`toAddress`) vs `src/lib/shippo/client.ts:311-322` (`toShippoAddress`) vs `src/lib/shipping/checkout-rates.ts:94-101` (inline address build) | Three address-shape conversions to `ShippoAddress`. `labels.ts:toAddress` maps a Package to a `ShippoAddress`-shaped object; `client.ts:toShippoAddress` maps `ShippoAddress` to the Shippo API shape; `checkout-rates.ts:94-101` builds a `ShippoAddress` inline from a `CheckoutLineForFees`. The Package→`ShippoAddress` and CheckoutLineForFees→`ShippoAddress` mappings are two copies of the same domain mapping with different source types. |
| CC-P8-07 | Medium | `src/lib/shipping/labels.ts:255-279` (`refreshTracking`) vs `127-163` (`createLabelForPackage`), `233-251` (`voidLabelForPackage`), `179-207` (`recordFailedLabel`) | `refreshTracking` is the only label-state mutation not wrapped in `db.$transaction`. The other three all use `db.$transaction` for their write+audit pair. `refreshTracking` does `db.shippingLabel.update` then a separate `db.auditLog.create`. Inconsistent transactional pattern within the same file. |
| CC-P8-08 | Medium | `src/lib/shippo/client.ts:98-100` (`mintId`); `src/lib/shippo/client.ts:215` (`1ZMOCK...`); `src/lib/shippo/client.ts:120,128` (`org_fedex_mock`/`org_ups_mock`) | Mock-id generation is scattered. `mintId(prefix)` mints `rate_*` ids; the tracking number is built inline as `1ZMOCK${randomBytes(6).toString("hex").toUpperCase()}`; the provider-account fallbacks are inline string literals `org_fedex_mock`/`org_ups_mock`. Three mock-id patterns in one file. A single `mockId(kind, ...)` helper would cover all three. |
| CC-P8-09 | Medium | `src/lib/shipping/margin.ts:9-21` (`GROUND_SERVICES`) | `GROUND_SERVICES` lists both snake_case and SCREAMING_SNAKE tokens for the same services (`FEDEX_GROUND` + `fedex_ground`, `UPS_GROUND` + `ups_ground`, `PRIORITY` + `usps_priority`, `ParcelSelect` + `PARCEL_SELECT`). The set is followed by an `upper.includes("GROUND")` fallback that makes most of the explicit tokens redundant. Either trust the fallback or list the tokens; doing both is "just in case" code. |
| CC-P8-10 | Medium | `src/lib/shipping/bin-packing.ts:31-39` (`BoxType`) vs `src/lib/shipping/bin-packing.ts:14-24` (`BoxAssignment`) vs `prisma/schema.prisma:797` (`PackageType`) | Three near-identical box-shape types. `BoxType` is a local type mirroring the `PackageType` prisma model; `BoxAssignment` is the output type; `PackableItem` is the input type. `BoxType` could be `Pick<PackageType, ...>` instead of a hand-maintained copy. The local `BoxType` will drift from the prisma model if the model gains a field. |
| CC-P8-11 | Low | `src/lib/shipping/labels.ts:85-96` (`fallbackParcel`) | `fallbackParcel` is built inline with a magic `12,9,6` box and a per-item `weightOz ?? 16` default. The same `12,9,6` dims appear in `checkout-rates.ts:41` `DEFAULT_PARCEL` and in `bin-packing.ts:139` fallback `SMALL` box. Three copies of the "default small box" dims. |
| CC-P8-12 | Low | `src/lib/shipping/labels.ts:281-287` (`stubAssignLabelToRoute`) | P9 hook stub exported with no app callers (only smoke calls it). Per Rule of 2, a stub for a future phase with one smoke-only call site is "boilerplate for later". Ship it when P9 wires it. |
| CC-P8-13 | Low | `src/lib/shippo/client.ts:196-251` (`buyLabel` live branch) | Live `buyLabel` returns `amountCents: 0, carrier: "", serviceLevel: ""` — discarding the transaction's actual amount and carrier. The return type `ShippoTransaction` declares these fields as required non-optional values, but the live branch leaves them empty. The type claims a fully-populated transaction; the code returns a half-empty one. |

## Notes

- No god files this phase. `lib/shipping/labels.ts` (288 lines), `lib/shipping/bin-packing.ts` (187), `lib/shippo/client.ts` (333), `lib/shipping/checkout-rates.ts` (132), `lib/shipping/margin.ts` (93) all sit under the 500-line threshold. The pure functions (`selectMargin`, `packItems`, `planToParcel`, `isGroundEquivalent`) are tight and single-concern.
- Naming is strong: `selectMargin`, `planPackageShipment`, `voidLabelForPackage`, `refreshTracking`, `isVoidable`, `mockGroundRates` all describe what they do. Boolean `isVoidable`, `isGroundEquivalent` read as yes/no questions. Collections `quotes`, `eligible`, `boxes`, `unpackedItemIds` are plural.
- The `lib/shippo/` (carrier wrapper) vs `lib/shipping/` (domain) split is clean and does not repeat P7's `lib/ops/` vs `lib/<domain>/` drift. Keep this boundary.
- The `ShippingLabel` prisma model and its migration are consistent (`schema.prisma:748`, `migration.sql`). No schema drift between model and migration.
- `tsconfig.tsbuildinfo` is still committed (flagged in P7) — hygiene, not clean-code.

Output path: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/results/reviews/P8-clean-code-arm-03.md`
