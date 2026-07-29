# P12 Fix Pass — arm-06

**Date:** 2026-07-29 · **Source of truth:** `results/AGGREGATE-REVIEW-P12.md` (2B / 9M / 21m)
**Result:** both blockers fixed, all 9 majors fixed, 18/21 minors fixed, 3 minors deferred (justified below). All gates green (typecheck, lint, unit 13/13 files, domain 13/13 suites, migration-guard ok, build); smoke S1–S5 re-run **34/34 PASS, 0 failures**.

## Blockers — both fixed

| # | Fix |
|---|---|
| B1 | `APP_ENV` now fails closed: `lib/env-spec.ts` parses `APP_ENV` with `.default("production")`, so a deployment that omits the variable gets production and `requireTestEnv()` refuses the destructive test-ops actions. The local `.env` declares `APP_ENV=test` explicitly; the admin test-ops page and every guard read the same parsed value. Domain pin: the spec default parses to `"production"` while the test process pins `APP_ENV=test`. |
| B2 | G-029 typed-phrase gate shipped end to end: `lib/imports/commit-phrase.ts` (`expectedCommitPhrase(validRows)` → `commit N row(s)`), `commitImport` in `lib/imports/engine.ts` throws `DomainRuleError` on a missing/wrong phrase before anything writes, the commit route requires `confirmPhrase` in the body (Zod), and the preview UI renders the exact phrase with a text input that must match before commit is enabled. Domain pins: a wrong phrase refuses the commit with zero writes; the correct phrase commits. All smoke commit steps (S3b/S3f/S3g) send the phrase; S3a still pins the dry-run 422. STATUS row G-029 now describes what actually ships. |

## Majors — all 9 fixed

| # | Fix |
|---|---|
| M1 | `isDevAuthBypass` (`lib/env.ts`) now requires the platform-agnostic `APP_ENV === "test"` class on top of the Vercel guards: `DEV_AUTH_BYPASS=true` is inert on any host that didn't explicitly opt into the test environment (default production, per B1). A Docker/CI/non-Vercel deploy no longer opens the bypass just because `VERCEL_ENV` is unset. |
| M2 | `getMethodDrilldown` groups shipments `status: "PURCHASED"` only — exact parity with `getMarginRollup` and the year-metrics export (a voided label returns its margin; its charge never counts). The false parity comment was rewritten to state the real rule. Domain pin (rerun-safe): fixture PURCHASED ($5.00) + VOIDED ($7.00) shipments in Legacy 2024; the drill's SHIPPED charged equals the PURCHASED-only ground truth while a nonzero VOIDED charge exists. |
| M3 | The edit-first resolve-review path is now reachable in the cleanup UI: each flagged address row in `BookCleanup` has an **Edit** button that opens the inline `FlaggedEditor` (line1/line2/city/region/postal), saves through the audited staff address PATCH, then the same row's **Confirm** clears the flag — exactly the workflow the route comment describes. |
| M4 | `app/api/admin/export/[dataset]/route.ts` uses the same auth pattern as every other P12 admin route: `requireApiPermission(dataset.permission)` → `gate.ctx` flows into `recordAudit`; the hand-built `getAuthContext()` + inline audit-context shape is gone. |
| M5 | One `KIND_LABEL: Record<ImportKind, string>` in `lib/imports/kinds.ts` beside `IMPORT_PERMISSION`/`IMPORT_HANDLERS`; both pages and the upload component consume it (the upload's `(old system)` suffix is applied at its call site). |
| M6 | `legacySlug(year, name)` lives once in `lib/imports/legacy/normalize.ts`; `products.ts` (`slugify`) and `orders.ts` (`stubSlug`) both use it. |
| M7 | `isValidEmail` lives in `lib/text.ts` beside `normalizeEmail`; both customer import handlers validate through it (a malformed email fails the row at stage). |
| M8 | New `lib/imports/legacy/resolve-customer.ts` owns the email-vs-phone resolution rule once: `resolveLegacyCustomer` (both-hit-different-customers → row error "merge those customers first"; pick `byEmail ?? byPhone`; create with the `legacy-phone-…@legacy.local` synthetic email when phone-only). Both legacy handlers use it. |
| M9 | `parseLegacyMoney(raw, column)` in `normalize.ts` is the single legacy string→cents path (strips `$`, rejects empty/negative/non-numeric with a column-named error, rounds once — deliberately looser than `dollarsToCents`, intent documented); legacy products and orders both use it. |

## Minors — 18 fixed

- **m1** import preview/commit/discard routes: a caller without the batch's kind-permission now gets the same 404 as an unknown id — existence is not an oracle (all three routes).
- **m3** STATUS corrected: `/admin/help` ships 6 static tour cards; the phantom "7 `?tour=` targets" deep-link claim is gone.
- **m4** STATUS corrected: the export center is one page at `/admin/export` with the audit history table on it, and the API is `/api/admin/export/[dataset]` (singular).
- **m5** STATUS wording corrected: the reconciler paginates the full payment-intent list — no "window".
- **m6** `lib/reconcile/matcher.ts`: fixture mode with an empty dev double no longer flags every local mirror `STALE_MIRROR` (only a populated Stripe-side list — or live mode — can convict a mirror).
- **m7** year-end export labels a `PAID` order with zero posted payments as `REFUNDED` (the legacy refunded terminal state) instead of showing "PAID / $0.00 / full balance".
- **m8** deliveries export package-stage lookup matches on recipient name **and** address (line1 + postalCode, via `Package.recipientAddress`), falling back to name-only; two same-name recipients at different addresses no longer share the first package's stage.
- **m9** `getMarginRows` fetches one row past the cap and returns `{ rows, take, truncated }`; the reports page prints "Showing the newest 200 shipments — this list is capped…" under the ledger when truncated.
- **m10** legacy orders commit caches the season catalog per season (`Map<seasonId, Map<name, Product>>`) instead of one full `findMany` per order group; stubs created mid-commit are written back into the cache.
- **m11** `findLegacyCustomerMatches` does one batched lookup (`findMany` by email/phone sets) per commit; both legacy handlers resolve customers through it — no per-row `findUnique` pairs holding the transaction open.
- **m13** `WIPE_TABLES`/`CLEAR_TABLES` are exported and pinned by unit checks against `prisma/schema.prisma`: every listed name is a real `@@map` table, no duplicates, the four identity/audit survivors stay out, every non-survivor `@@map` table is in WIPE, CLEAR ⊆ WIPE. Drift is now a failing test, not a silent half-wipe.
- **m15** lapsed-customers column renamed `lifetime_order_total_dollars` with a comment reserving "revenue" for POSTED payments — the vocabulary no longer overloads the word across exports.
- **m16** `.scratch/` phase artifacts (SMOKE/STATUS per phase, logs) exist and are refreshed this pass; `.gitignore` now lists `.scratch/`.
- **m17** `lib/exports/datasets.ts` and the reports page both use the shared `CHANNEL_LABELS` from `lib/packages/fulfillment.ts`; local maps deleted (SHIPPED label unified to "Carrier shipping"; smoke assertion updated).
- **m18** the legacy handler's dedupe helper is renamed `markLegacyProductDuplicates` — no more name collision with the non-legacy `markProductDuplicates`.
- **m19** the export route wraps `recordAudit` in try/catch: an audit DB blip is logged server-side and the stream still closes cleanly, instead of truncating a download after rows were sent.
- **m20** the `seasonPerformanceRows` private wrapper is inlined into `getSeasonPerformance` (the indirection had exactly one caller).
- **m21** `IMPORT_ROW_LIMIT` is passed to the upload component and shown in the form's helper text ("At most 2000 data rows per file") before the user picks a file.

## Deferred — 3 minors

- **m2 (export audit only on completed download):** audit-on-completion is deliberate (an abandoned download leaves no fake success trail — the review agrees the intent is desirable). Closing the partial-download bypass needs a start-of-stream audit row updated on completion — an audit metadata-flow change, not a fix-pass repair. Noted for the launch-readiness abuse review.
- **m12 (testops `clear` leaves `onHand` stale):** `clear` keeps the catalog by design, and post-finalization `onHand` cannot be reconstructed without snapshotting pre-order inventory. `reset` (wipe + reseed) is the documented clean-slate path; making `clear` inventory-aware is a product decision.
- **m14 (`ReconciliationRun.actorId` dangling string):** no query reads the column (`actorEmail` is the display field; the audit log is the canonical actor trail). Adding the FK relation is a schema migration for dead surface — bundled into the next migration-touching phase rather than a fix pass that otherwise ships zero migrations.

## Environment seam note (required for the gates to stay honest)

The Stripe fixture keys (`STRIPE_SECRET_KEY`, `STRIPE_BASE_URL` loopback) moved from `.env` to `.env.local`: Next.js loads `.env.local` for the dev/prod server, but Prisma Client's automatic `.env` side-load does not — so DB test scripts keep their "no Stripe key in this process" seam (test-checkout's keyless assertions) while the server keeps the fixture-backed reconciliation. Verified by probe and by the full domain suite.

## Test + smoke pins added this pass

- **Domain (`scripts/test-p12-domain.mts`):** B1 spec-default pin; B2 wrong-phrase refusal (zero writes) + correct-phrase commit; M2 PURCHASED/VOIDED drill-down parity against ground truth. All `commitImport` callers (P6/P12 suites) now pass the expected phrase.
- **Unit (`scripts/test-p12.mts`):** five m13 pins locking WIPE/CLEAR table lists to the schema.
- **Smoke (`.scratch/smoke-p12.ps1`):** every import commit sends the typed phrase; the deliveries-CSV label assertion follows the shared channel map. Full re-run: **34 PASS / 0 FAIL** (`.scratch/smoke-p12.log`).

No schema migrations this pass.
