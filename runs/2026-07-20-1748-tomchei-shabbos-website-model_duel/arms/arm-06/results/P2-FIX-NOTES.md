# P2 FIX NOTES — arm-06

Single fix pass over AGGREGATE-REVIEW-P2. All 11 majors fixed; all 26 minors fixed; nothing deferred.
Migration `20260728182000_p2_fix_pass` carries every schema change; `npm run ci` green end-to-end (evidence: `workspace/.scratch/smoke-p2/transcript.log`).

## Majors (11/11 fixed)

| # | Fix |
|---|---|
| A-M1 | `Customer.normalizedPhone` is now `@unique` (migration). `findOrCreateCustomer` keeps the fast-path `findFirst`, then creates; on P2002 (either unique arm) it re-fetches the winner's row — concurrent signups sharing a phone collapse onto one customer. Unique index + create-with-fallback is the actual race guard (a find-then-create inside one READ COMMITTED transaction would still race); comment rewritten to claim only what holds. |
| A-M2 | `discardOrder` now mirrors `finalizeOrder`: conditional `updateMany({ where: { id, status: "DRAFT" } })`; row count 0 → `OrderConcurrencyError` → rollback. A discard racing a finalize can no longer clobber FINALIZED → DISCARDED. |
| A-M3 | `createDraftOrder` rewritten as the trust boundary: input is catalog ids + qty only. The engine batch-loads products/option-values/add-ons (fabricated id → `NotFoundError`), snapshots `basePriceCents`/`priceDeltaCents`/`priceCents` + names server-side, enforces exactly-one-of productId/addOnId, positive integer qty, option-belongs-to-product, add-on-has-parent + `ProductAddOn` restriction. `OrderLine.productId/optionValueId/addOnId` are now real FKs (RESTRICT — catalog rows with order history can't be deleted). Seed + tests updated to the new contract; injection/rejection covered in `test-order-numbers.mts`. |
| A-M4 | `postPayment` (and `voidPayment`) require the order `FINALIZED` via `requireFinalizedOrder` inside the transaction; DRAFT/DISCARDED → `DomainRuleError`. Tested. |
| A-M5 | `OrderLine.parentLineId` self-FK is `ON DELETE CASCADE` (schema + migration); constraint probe verifies a parent delete removes its add-on lines. |
| A-M6 | All four wired with DB-integration tests: `postPayment`/`voidPayment` (`scripts/test-payments.mts`, 15 checks), `advancePackageStage`/`getOpenSeason` (`scripts/test-package-stages.mts`, 12 checks). Both run in `test:domain` → `npm run ci`. |
| A-M7 | One error discipline across the P2 engine: shared typed `NotFoundError`/`DomainRuleError` (`lib/errors.ts`); domain classes stay colocated. Every plain `Error` in create-draft/state-machine/reserve/stages/payments replaced. |
| A-M8 | Race loser in `finalizeOrder` (and the new discard guard) throws `OrderConcurrencyError` — "Order \<id\> was changed concurrently; reload and retry" — mirroring `PackageConcurrencyError`. No more `FINALIZED → FINALIZED` misnomer. |
| A-M9 | `PackageEventAction` typed union added in `lib/packages/stages.ts` (mirrors `AuditAction` discipline); the `"stage_advance"` write goes through it. |
| A-M10 | Consolidated: `lib/seasons/year.ts` (`getSeasonYear`) + `lib/seasons/queries.ts` (`getOpenSeason`); `lib/season.ts` and `lib/seasons.ts` deleted; storefront import updated. |
| A-M11 | `reloadOrThrow(reload, entity, id)` helper in `lib/db.ts`; all three update→re-fetch sites (finalize, stage advance, voidPayment) use it — a vanished row throws `NotFoundError` instead of an `as` cast. |

## Minors (26/26 fixed)

- **A-m1** grouping key is `JSON.stringify([...])` — no delimiter can collide.
- **A-m2** `normalizePhone` enforces plausibility (10 digits → US default; 11–15 → as-is; else `null` — garbage never becomes a dedupe key).
- **A-m3** email match now fills `phone`/`normalizedPhone` when the existing row has none (never overwrites; unique conflict leaves the number with its owner).
- **A-m4** folded into A-M3: positive-integer qty enforced; prices come from the catalog, never the caller.
- **A-m5** `finalizeOrder` re-checks `season.status === "OPEN"` (same gate as create); tested both directions.
- **A-m6** partial unique index `seasons_single_open` (hand-added SQL); probe rejects a second OPEN season; DB tests close/restore open seasons via `test-db-helpers.mts`.
- **A-m7** CHECK `order_lines_line_kind` (exactly one of product/addon; add-on needs parent; product line must not have one) + real FKs; probes in ci.
- **A-m8** `Package.recipientAddressId` → `ON DELETE RESTRICT` (groupingKey can't go stale).
- **A-m9** `StripePaymentIntent.clientSecret` column dropped; `raw` documented as redact-before-persist.
- **A-m10** `parseMethodStages` validate-or-throw on the Json column (names the method, lists valid stages); used by `advancePackageStage`; pure-tested.
- **A-m11** smoke doc recounts corrected (S2 = 10, S3 = 15 checks).
- **A-m12** STATUS doc notes the tier wording: concurrent-finalization is DB-integration → `test:domain`; `ci` runs both tiers.
- **A-m13** `npm run ci` executed inside the re-smoke; full summary captured in `transcript.log` and cited from PHASE-P2-SMOKE.md.
- **A-m14** CHECK `shipping_quotes_target_xor` (exactly one of orderId/packageId); probed.
- **A-m15** `.scratch/check-xor.mts` promoted to `scripts/test-constraints.mts` (all CHECKs + partial index) and wired into `test:domain`/ci.
- **A-m16** migration-guard no longer trusts `--exit-code` numerics (drift code differs across prisma versions); it diffs with `--script` and treats anything but the empty-diff marker as drift, printing the diff. Verified live against the in-sync DB.
- **A-m17** line total computed once per resolved line in the rewrite (single expression, reduced into the order total).
- **A-m18** `PICKUP_ADDRESS_SENTINEL` named constant.
- **A-m19** `WIRE_FORMAT_PREFIX`/`DRAFT_REF_PREFIX` exported from `numbers.ts`; tests import them.
- **A-m20** duplicate `@prisma/client` import merged in `post.ts`.
- **A-m21** address upserts on new `@@unique([customerId, label])`; the draft-order count-then-create keeps a comment explaining why it diverges (no natural unique key).
- **A-m22** `classifyPaymentStatus(paidCents, totalCents)` helper replaces the nested ternary; pure-tested.
- **A-m23** `assertPositiveQty` dedupes the reserve/release guard (typed `DomainRuleError`).
- **A-m24** resolved with A-M1 (unique index + rewritten comment).
- **A-m25** resolved with A-m2 (`normalizePhone` returns `null`; `|| null` follow-up gone).
- **A-m26** `WIRE_FORMAT_PREFIX` carries the "MM = Mishloach Manot" comment.

## Deferred

Nothing.

## Notes for later phases

- Checkout/admin routes must call `createDraftOrder` with catalog ids only — prices are snapshotted engine-side (A-M3). `postPayment` rejects any non-FINALIZED order.
- DB tests that need an OPEN season must use the close/restore helpers (`scripts/test-db-helpers.mts`) because of `seasons_single_open`.
- tsx loads `lib/*.ts` (CJS) and `scripts/*.mts` (ESM) through different loaders, so a shared error class can exist as two class objects in one process — test scripts match error types by `error.name` (see `expectThrow`); `instanceof` remains valid in the Next runtime.
- Re-smoke: S1–S5 all PASS + ci PASS; see `workspace/.scratch/PHASE-P2-SMOKE.md` + `.scratch/smoke-p2/transcript.log`.
