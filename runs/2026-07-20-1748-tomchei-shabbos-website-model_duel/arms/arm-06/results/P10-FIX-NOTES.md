# P10 Fix Pass — arm-06

**Date:** 2026-07-29 · **Source of truth:** `results/AGGREGATE-REVIEW-P10.md` (0B / 13M / 23m)
**Result:** 13/13 majors fixed, 21/23 minors fixed, 2 minors deferred (justified below). All gates green; smoke S1–S3 + new legs 59/59.

## Majors — all 13 fixed

| # | Fix |
|---|---|
| M1 | `resolveDraftLines` now takes the draft `seasonId` and rejects any product outside that season or `active:false` with `DomainRuleError`; both `saveDraft` callers pass it. Domain pins: wrong-season + inactive rejects. |
| M2 | Lineage idempotency is DB-enforced: partial unique index `(repeatedFromOrderId, seasonId) WHERE status <> 'DISCARDED'` (migration `20260729170000_p10_fix_pass`); `createDraftFromRepeat` maps `P2002` on `repeatedFromOrderId` → `DomainRuleError("already repeated")`. Covers bulk, one-click, review paths. |
| M3 | `buildRepeatPlan` requires `FINALIZED` — one gate for all three entry points; both repeat pages 404 non-finalized orders. Domain pin. |
| M4 | Wizard copies media: `copyObject` (new in `lib/media/storage.ts`) duplicates bytes under a fresh `storedName`, so copied assets own their bytes (delete-safe). Smoke asserts media count on the wizard season. |
| M5 | `repeat-review.tsx` uses `import type` from `lib/repeat/plan.ts` / `matcher.ts` — hand-copied interfaces deleted. |
| M6 | `replacementChainPreview` no longer duplicates the start product (walk hops carry it). Domain pin. |
| M7 | Forward-only replacement compares season `createdAt`, not name strings — in the PATCH route (400 reject) and the editor's option filter. Smoke pins both directions (same-season 400, newer-season 200). |
| M8 | One-click staff repeat posts an empty body to `POST /api/admin/orders/[orderId]/repeat`, which auto-confirms server-side — cross-season, off the open-season-scoped bulk path. Smoke S2c pins create + lineage refusal. |
| M9 | Legacy import computes `totalCents` from created line totals inside the import tx. Domain pin. |
| M10 | `stubProduct` runs on the transaction client — stub, order, recipients, lines commit or roll back together. |
| M11 | `createSeasonWizard` is fully transactional (season + copies + audit); intra-run slug-collapse and inter-run slug-taken guards throw `DomainRuleError` up front. Domain pins. |
| M12 | `createDraftFromRepeat` accepts an optional pre-built plan; one-click and bulk-history pass theirs (one plan build per order). Domain pin on plan mismatch. |
| M13 | Dead `planRepeat` / `RepeatPlan` / `RepeatCatalog` deleted from `lib/orders/repeat.ts` along with the stale `test-p6.mts` section; `RepeatSourceOrder` re-export dropped (m12). |

## Minors — 21 fixed

- **m1** legacy import audit now attributes each row (customer email + external key in metadata) — domain pin. The manager-trust-boundary half is by-design (manager is a trusted role; no privilege change).
- **m2** cron flip clears past-due stale schedules instead of re-evaluating forever — domain pin.
- **m3** `setSeasonSchedule` update + audit wrapped in one transaction.
- **m4** legacy dedup: partial unique index on `wireFormat LIKE 'legacy-import:%'` + check moved inside the tx with `P2002` → skip.
- **m5** server-side reject in the product save path (the review's sanctioned alternative to a schema constraint); no DB trigger — cross-row season comparison in a CHECK isn't Prisma-expressible, and the walker's visited-set already makes bad data safe (review agrees: "integrity outcome is safe").
- **m7** smoke S3 runs the imported order through the real customer review: book match, greeting prefill, swap confirm, draft asserts.
- **m8** smoke S2 bulk run batches two customers in one call, asserts two drafts on two distinct customers.
- **m9** recipient-less confirm verified end-to-end: draft saves with zero recipients, lines unassigned (smoke S1b + domain pin).
- **m10** cron flips audit as dedicated `season_flip_cron` with `targetId` — separable from manager schedule edits.
- **m11** cron flip opens exactly one season per tick (earliest due); the rest wait with schedules intact — domain pins.
- **m12** dead `RepeatSourceOrder` export removed (with M13).
- **m13/m15** dead, misnamed `targetName` variable removed from `applyConfirmations`.
- **m14** `replacementChainPreview` fetches the start product only for dead-end/missing cases.
- **m16** `suggestByPrice` queries bounded nearest-priced pools (overall + same-category) instead of the whole catalog.
- **m17** second wizard into the same year → clean `DomainRuleError` (domain pin), never a Prisma 500.
- **m19** banned name `result` renamed (`response`, `runRow`) in the two P10 pickers + new code.
- **m20** `CandidateRow` / `RunResult` / `SeasonRow` now `import type` from their server modules (`SeasonManagerRow` added to `lib/seasons/queries.ts`).
- **m21** `HISTORY_CANDIDATE_LIMIT = 500` named constant.
- **m22** `copiedSlug` strips any 4-digit year suffix (`/-\d{4}$/`).
- **m23** `targetSeason` lookup is a single ordered query.

## Deferred — 2 minors

- **m6 (auto-flip timezone is browser-local):** the plan's own open question #7 ("assumed org-local; confirm") — fixing it means choosing an org-timezone model and UI surfacing, a product decision, not a defect repair. No silent change made in a fix pass.
- **m18 (third copy of the bounded-bulk scaffold):** the review itself rates it Minor "because the three are stable and an honest abstraction needs generics over id type, error allow-list, and per-row step." Extracting `runBoundedBulkAction` in a fix pass would churn three stable modules (orders/packages/repeat bulk) for no behavior gain; scheduled for a refactor pass.

## Migration

`prisma/migrations/20260729170000_p10_fix_pass/` — two partial unique indexes: `orders_repeat_lineage_unique` (M2) and `orders_legacy_wireformat_unique` (m4). Deploying to the dev DB surfaced pre-fix duplicate lineage rows (crashed P6 test residue); the residue was deleted and the migration applied cleanly. A crashed domain suite had also left its ad-hoc TEST season OPEN (and 2026 closed), which hijacked the smoke's "open season" — `reset-smoke-p10` now self-heals the season state first, same pattern as `reset-smoke-p9`.

## Test + smoke pins added

- `test-p10-domain.mts` 40 → **55 checks**: M1 (×2), M2, M3, M4, M6, M9, M11, M12, m1, m2, m9, m10, m11, m17.
- `test-p6-domain.mts` 35 → **36 checks**: bulk repeat of an already-repeated order skips with the lineage reason (M2); bulk leg given its own untouched source order.
- Smoke `.scratch/smoke-p10.ps1` 40 → **59 checks**: S1b recipient-less confirm (m9), S2 two-customer bulk + per-customer draft ownership (m8), same-season reject + forward-save (M7), wizard media duplication (M4), S2c one-click staff repeat + lineage refusal (M8), S3 imported-order review round-trip with address-book + greeting resolution (m7). New `smoke-db.mts` verbs: `season-media-count`, `season-product-id`; `repeat-state` now reports `customerId` + line `recipientId`; `reset-smoke-p10` also wipes smoke media bytes/rows and audit rows on smoke products.

## Gates + smoke (all green, 2026-07-29)

`lint` ✓ · `typecheck` ✓ · `migration-guard` (18 migrations, DB in sync, no drift) ✓ · `test:unit` 11/11 ✓ · `test:domain` (11 suites; test-p10-domain 55, test-p6-domain 36) ✓ · `build` ✓ · smoke S1–S3 + new legs **59 PASS / 0 FAIL** against the production build on 3106 (transcript in `.scratch/PHASE-P10-SMOKE.md`).
