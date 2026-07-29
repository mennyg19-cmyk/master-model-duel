# Aggregate Review — P12 — arm-06

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-06 (late join)
**Phase:** P12 — Reporting, exports, Stripe reconciliation, legacy import, test ops, scale dress rehearsal, help/tours, cron auth
**Inputs:** P12-security, P12-quality, P12-rules, P12-clean-code (arm-06, all blind)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings. Mixed-severity clusters resolve to the highest severity (Blocker > Major > Minor).

## Counts

| Severity | Count |
|---|---|
| Blocker | 2 |
| Major | 9 |
| Minor | 21 |
| **Total** | **32** |

Source totals (pre-dedupe): security 4 (1B/1M/2m), quality 8 (1B/1M/6m), rules 11 (0B/2M/9m), clean-code 12 (0B/6M/6m) = 35. 3 clusters merged (M2: quality Major 1 + rules Major 2 → Major; m8: quality Minor 6 + rules Minor 2 → Minor; m13: rules Minor 6 + clean-code Minor 6 → Minor) → 3 duplicates removed → net 32 unique. Both Blockers are single-source and survive (security B1 on the `APP_ENV` default; quality B1 on the missing G-029 typed-phrase gate — different locations, different claims, both kept).

## Blockers (2)

### B1 — `APP_ENV` defaults to `"test"`, fail-opening the destructive test-ops gate
**Sources:** security Blocker 1
**Location:** `lib/env-spec.ts:57`; `lib/testops/guard.ts:7-11`; `lib/testops/actions.ts:111` (TRUNCATE); `app/(admin)/admin/test-ops/page.tsx:14`
**Claim:** `env.APP_ENV` is loaded via `z.enum(["test","production"]).default("test")`. A production deployment that omits `APP_ENV` gets the default `"test"`, so `requireTestEnv()` passes and the wipe/clear/reset endpoints become callable by any manager (`settings.manage`). `runTestOps` then issues `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` against the full domain schema (`orders`, `payments`, `customers`, `seasons`, `settings`). The test-ops console page reads the same default and renders live buttons. A destructive gate must fail closed; the default must be `"production"` so forgetting the env var leaves the destructive routes disabled. As written, the safe path requires an explicit positive action and the dangerous path is what you get for doing nothing. A misconfigured production deploy is one manager click away from a total data wipe.

### B2 — G-029 typed-phrase confirmation gate is missing; status doc claims it ships
**Sources:** quality Blocker 1
**Location:** `app/api/admin/imports/[batchId]/commit/route.ts`; `app/(admin)/admin/imports/[batchId]/import-preview.tsx:71-73`; `lib/imports/engine.ts` (`commitImport`); `PHASE-P12-STATUS.md` row G-029
**Claim:** G-029 is a primary P12 ID (plan § P12: "import pipeline … staged atomic commits + audit (R-186, G-029)"). The status doc states the commit throws HTTP 422 "unless the operator types the exact phrase shown by the dry-run summary." The commit route accepts a bare `POST` with no body, no `confirmPhrase`/`typedPhrase` field, and no comparison against any dry-run summary token. The preview UI fires commit on a single button click — no text input. `commitImport` only refuses a `batch.dryRun === true` (the 422 the smoke catches in S3a); there is no typed-phrase parameter on the function signature, the route body, the Zod schema, or the UI. A repo-wide search for `confirmPhrase|typedPhrase|exact phrase|confirmText|typeToConfirm|confirm-phrase` returns zero matches. The intended safety gate — prove the operator saw the dry-run ledger before any write — is absent. The only protection is the `dryRun` boolean refusal, a different weaker guarantee (it stops re-committing a dry-run batch; it does not stop an unverified commit of a real batch). The status doc misrepresents a missing safety control as shipped — the worst class of doc/code drift because downstream gates read "G-029 ✓" and stop looking. Smoke S3a asserts the dry-run-refusal 422 but no step exercises a typed-phrase gate, so the gap is invisible to the run.

## Majors (9)

### M1 — Dev-auth bypass and dev fixture doubles are guarded solely by `VERCEL_ENV`
**Sources:** security Major 1
**Location:** `lib/env.ts:32-34`; `app/api/dev-auth/route.ts:17-43`; `app/api/dev/stripe-fixture/route.ts`, `app/api/dev/shippo-fixture/route.ts`, `app/api/dev/email-fixture/route.ts`, `app/api/dev/outbox/route.ts`
**Claim:** `isDevAuthBypass` keys off `VERCEL_ENV`, a variable Vercel injects. On any non-Vercel host (self-hosted, container, another platform) `VERCEL_ENV` is `undefined`, so `vercelEnv !== "production"` and `vercelEnv !== "preview"` are both `true` and the bypass is active whenever `DEV_AUTH_BYPASS=true`. When active: `POST /api/dev-auth` logs the caller in as any active staff user by ID, no password, no rate limit, no second factor — a complete authentication subversion; the `dev/*` fixture routes accept arbitrary payment-intent state injection and expose provider doubles; `GET /api/dev/outbox` returns every outbox row. The merged plan pins hosting to Vercel, so under the stated assumption this is local-dev-only and safe. The risk is the assumption breaking silently: a Docker/preview deploy on another platform, a migration off Vercel, or a CI matrix that runs `next start` without `VERCEL_ENV` all turn `DEV_AUTH_BYPASS=true` into a full auth bypass on a reachable URL. The guard should also fail closed on a platform-agnostic signal (`NODE_ENV === "production"` or an explicit `IS_DEPLOYED` flag), not a Vercel-only one. Major rather than Blocker because the plan's Vercel-only assumption currently holds; it becomes a Blocker the moment that assumption changes without re-reviewing this guard.

### M2 — Method drill-down "Shipping charged" includes VOIDED labels; margin rollup and year-metrics export exclude them; the comment claims they match
**Sources:** quality Major 1, rules Major 2
**Location:** `lib/reports/seasons.ts:103-107` (`getMethodDrilldown`), `lib/reports/seasons.ts:88-90` (comment); `lib/reports/margin.ts:85-88` (`getMarginRollup`); `lib/exports/datasets.ts:180-182` (`yearMetrics`)
**Claim:** `getMethodDrilldown` groups `Shipment` by `status: { in: ["PURCHASED", "VOIDED"] }` and sums `chargedCents` across both, exposing the total as `shippedChargedCents` on the SHIPPED row. `getMarginRollup` filters `status: "PURCHASED"` only — VOIDED labels are excluded because "a void returns the margin." `yearMetrics` also aggregates `status: "PURCHASED"` only. The `getMethodDrilldown` comment says "the shipped column books what customers were charged for labels (the margin ledger's charged side)" — i.e. it claims parity with the margin ledger. That is false: the margin ledger's charged side is PURCHASED-only, so for any season with a voided label the method drilldown's "Shipping charged" is strictly higher than the margin rollup's "Charged" for the same season. The dress rehearsal creates exactly this situation: S5h reroutes a SHIPPED package (label voided); S5m checks the margin ledger but never compares the method drill-down's SHIPPED "Shipping charged" against the margin rollup's "Charged" for the same season, so the smoke does not catch the discrepancy. The domain test only asserts `Number.isFinite(row.shippedChargedCents)` — it does not assert VOIDED-exclusion. The margin ledger is the money truth (PURCHASED-only is correct — a void returns the spread); the method drill-down is wrong. At crunch scale with frequent reroutes, the overstatement compounds. Violates: consistency / anti-hallucination (claim vs behavior).

### M3 — Resolve-review comment claims an "edit first" workflow the admin UI never exposes
**Sources:** rules Major 1
**Location:** `app/api/admin/customers/[customerId]/addresses/[addressId]/resolve-review/route.ts:7-8`; `app/(admin)/admin/customers/[customerId]/page.tsx:82-99`; `components/admin/customer-editor.tsx`; `components/admin/book-cleanup.tsx`; `app/api/admin/customers/[customerId]/addresses/[addressId]/route.ts`; `components/order-builder/edit-saved-address-dialog.tsx`
**Claim:** The resolve-review route comment states: "a flagged (needsReview) address is resolved by a human confirming or correcting it — the flag clears, audited. Corrections go through the normal address PATCH first, then this clears the flag." The cleanup UI does not expose that PATCH path. The customer page renders the address book as a read-only `<li>` list with a "needs review" badge; `CustomerEditor` edits only name/phone. `BookCleanup` offers exactly two actions: merge duplicates, and "Confirm" (clear the flag). The staff PATCH route exists and is audited, but no admin component calls it — the only `EditSavedAddressDialog` lives in `components/order-builder/`, the storefront order builder, not the cleanup console. A staff member facing a flagged address with a bad ZIP can either clear the flag (leaving the poisoned value) or merge it away — the "correct the value then confirm" path the comment describes is unreachable from the cleanup UI. The comment is an unverified claim about a workflow that does not exist in the surface it documents. Violates: anti-hallucination / UR-014 workflow gap.

### M4 — Auth pattern drift on the export route
**Sources:** clean-code Major 1
**Location:** `app/api/admin/export/[dataset]/route.ts:19-22` (auth), `:54-60` (audit); contrast `app/api/admin/imports/route.ts`, `app/api/admin/test-ops/route.ts`, `app/api/admin/reconciliation/run/route.ts`
**Claim:** Every other P12 admin route uses `requireApiPermission(perm)` → `{ ok, response, ctx }` and passes `gate.ctx` to `recordAudit`. The export route is the only one that drops to `getAuthContext()` + `hasPermission()` and hand-builds the audit context inline (`ctx: { staff: { id, email }, impersonator: ... }`). The hand-built object duplicates the shape `AuditContextLike` already guarantees via `gate.ctx`. The dataset's `permission` field is already declared for exactly this. Clean-code rule "one auth pattern per project" is violated. The export route should use `requireApiPermission(dataset.permission)` like its siblings.

### M5 — `KIND_LABEL` duplicated across three import UI files with label drift
**Sources:** clean-code Major 2
**Location:** `app/(admin)/admin/imports/page.tsx`; `app/(admin)/admin/imports/[batchId]/page.tsx:11-17`; `app/(admin)/admin/imports/import-upload.tsx:13-19`
**Claim:** Three separate `KIND_LABEL: Record<string, string>` declarations for the same five `ImportKind` values. The two page files use bare labels (`"Legacy customers"`); the upload component appends `"(old system)"`. Three real call sites, identical domain enum — Rule of 2 clearly satisfied. The `"(old system)"` suffix is a display concern of the upload form, not a different label. Should be one exported map next to `IMPORT_PERMISSION` / `IMPORT_HANDLERS` in `lib/imports/kinds.ts`, with the upload's suffix applied at the call site if desired. Violates: duplicated logic / label drift.

### M6 — `slugify(year, name)` duplicated in two legacy import handlers under different names
**Sources:** clean-code Major 3
**Location:** `lib/imports/legacy/products.ts:21-23` (`slugify`); `lib/imports/legacy/orders.ts:157-159` (`stubSlug`)
**Claim:** Byte-identical bodies (`legacy-${year}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`), two different names. The naming drift is the symptom of the duplication. `lib/imports/legacy/normalize.ts` already exists as the shared legacy-normalization module — the helper belongs there. Violates: duplicated logic (Rule of 2 met).

### M7 — `EMAIL_SHAPE` regex duplicated across customer import handlers
**Sources:** clean-code Major 4
**Location:** `lib/imports/customers.ts:9`; `lib/imports/legacy/customers.ts:16`
**Claim:** Identical regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, two call sites. `normalizeEmail` already lives in `lib/text.ts`; the shape check should sit beside it (or be folded into a single `isValidEmail` helper) so the validation rule has one home. Violates: duplicated logic / pattern drift.

### M8 — Customer "email vs phone mismatch" resolution rule duplicated
**Sources:** clean-code Major 5
**Location:** `lib/imports/legacy/customers.ts:110-116` (`commitLegacyCustomerRows`); `lib/imports/legacy/orders.ts:138-142` (`resolveCustomer`)
**Claim:** Both implement the same domain invariant: look up by email, look up by phone, if both hit *different* existing customers → reject with a "merge those customers first" error; otherwise pick `byEmail ?? byPhone` and create if missing. The error string is identical. This is a non-trivial domain rule (the "never guess a merge" law from G-029) expressed twice. The customers handler additionally does address-book work on top, but the resolution core — lookup, mismatch check, pick-or-create — should be one `resolveLegacyCustomer(tx, head)` helper used by both. The legacy-phone synthetic email (`legacy-phone-…@legacy.local`) is also duplicated in both create branches. Violates: duplicated logic / domain-rule drift.

### M9 — Money-parsing drift across import handlers
**Sources:** clean-code Major 6
**Location:** `lib/imports/products.ts` (`dollarsToCents` from `lib/money.ts`); `lib/imports/legacy/products.ts` (inline `Math.round(price * 100)`); `lib/imports/legacy/orders.ts:53-60` (local `parseMoney`)
**Claim:** Three different string→cents paths in the import libs. `lib/imports/products.ts` uses `dollarsToCents` from `lib/money.ts` — rejects fractional cents. `lib/imports/legacy/products.ts` uses `Math.round(price * 100)` inline — silently rounds fractional cents. `lib/imports/legacy/orders.ts` defines a local `parseMoney` that strips `$` and rounds — silently rounds fractional cents. The legacy paths are deliberately looser for messy exports, but the choice is implicit. The local `parseMoney` (orders) and the inline `Math.round` (legacy products) are functionally the same. One legacy-money helper with the "looser than `dollarsToCents` on purpose" intent called out once would remove the drift and the local re-implementation. Violates: pattern drift / magic values.

## Minors (21)

### m1 — Import preview/commit/discard leak batch existence via 404-vs-403 ordering
**Sources:** security Minor 1
**Location:** `app/api/admin/imports/[batchId]/route.ts:10-16`; identical pattern in `commit/route.ts:12-18` and `discard/route.ts:12-18`
**Claim:** The batch is fetched before the permission check. A caller without the batch's kind-permission gets `403` for an existing ID and `404` for a non-existent one — an existence oracle across import batches. The batch payload is not returned on the 403, so this is existence-only disclosure; combined with cuid batch IDs the practical risk is low. The permission check should precede the fetch (or the not-found and forbidden branches should return the same status). Same pattern in three routes.

### m2 — Export audit row is written only on stream completion; a mid-stream abort leaves no audit
**Sources:** security Minor 2
**Location:** `app/api/admin/export/[dataset]/route.ts:42-62`
**Claim:** `recordAudit` runs only after the row loop finishes and the stream closes cleanly. The comment (lines 11-13) frames this as "an abandoned download leaves no fake success trail" — true and desirable — but the same path also means a caller who reads rows off the stream and then aborts the connection before completion leaves no audit row at all, even though PII (customer emails, names, addresses, payment totals) was already transmitted. The export center's audit history (R-092) is bypassable for any partial download. Writing the audit row at start-of-stream (with `rows: null`, updated on completion) or recording on first-byte-sent would close the gap.

### m3 — Help center tour count and `?tour=` deep-linking misreported
**Sources:** quality Minor 1
**Location:** `app/(admin)/admin/help/page.tsx` (`TOURS` array, lines 9-75); `PHASE-P12-STATUS.md` row 6
**Claim:** The status doc claims "`/admin/help` + 7 `?tour=` targets." The help page renders 6 static tour cards and there is no `?tour=` query handling anywhere in the codebase (repo-wide search for `\?tour=` returns no matches). The help content is present and useful; the deep-link targeting and the count are wrong.

### m4 — Export center route names misreported
**Sources:** quality Minor 2
**Location:** `app/(admin)/admin/export/page.tsx`; `PHASE-P12-STATUS.md` row 2
**Claim:** Status doc claims "`/admin/exports` + `/admin/exports/history`" as separate routes. The actual surface is a single page at `/admin/export` (singular) with the audit history table rendered on the same page. No `/admin/exports/history` route exists. Functionality is complete (streamed downloads + audit row + history table all present); only the doc's URL inventory is wrong.

### m5 — "Intent-window matcher" wording overstates the design
**Sources:** quality Minor 3
**Location:** `lib/reconcile/matcher.ts` (`runReconciliation`); `lib/payments/stripe.ts` (`listPaymentIntents`); `PHASE-P12-STATUS.md` row 3
**Claim:** Status doc calls the reconciler an "intent-window matcher." `listPaymentIntents` pages through `/v1/payment_intents` with no `created`/`starting_after` time bound — it pulls the full intent list (paginated by `starting_after` cursor only). The matcher is correct and idempotent (it never writes payments; each run persists its own run + findings rows, so reruns reproduce the same finding set without duplicate adjustments — confirmed by S2c). The "window" label is inaccurate but not a behavior defect.

### m6 — STALE_MIRROR false positives in fixture mode with an empty dev double
**Sources:** quality Minor 4
**Location:** `lib/reconcile/matcher.ts:113-125`
**Claim:** In `fixture` mode, if the dev double returns an empty intent list (e.g., a payment was posted via the signed webhook but the fixture has no intents), the guard `mode === "fixture"` is still true, so every local mirror is flagged `STALE_MIRROR`. Live mode is correct (empty Stripe side ⇒ mirrors really are stale); capture mode correctly skips the loop. Smoke S2a uses a populated fixture, so the edge case is unexercised.

### m7 — Legacy refunded orders import as `paymentStatus: PAID` with no payment rows
**Sources:** quality Minor 5
**Location:** `lib/imports/legacy/orders.ts:252`, `:307-318`; `lib/exports/datasets.ts` (`yearEnd`)
**Claim:** A refunded legacy order lands as `paymentStatus: "PAID"` with zero posted payments. Reports correctly count $0 revenue (they aggregate `POSTED` payments, not the cached status), but the year-end CSV export emits `payment_status: PAID`, `paid_dollars: 0.00`, `balance_dollars: <total>` for such an order — an accountant reconciling the CSV will see a "PAID" order with a non-zero balance and no payment method. The tradeoff is documented in the entity map per the comment, but the cached status label is misleading at the export edge.

### m8 — Deliveries export package-stage lookup picks the first matching recipient name
**Sources:** quality Minor 6, rules Minor 2
**Location:** `lib/exports/datasets.ts:94`
**Claim:** `row.order.packages.find((candidate) => candidate.recipientName === row.name)` attaches the package stage to a delivery row. If two packages in the same order share a recipient name (different addresses — legal under the grouping key, which splits on recipient+address+method), `find` returns the first match and the second draft-recipient's `package_stage` cell reports the wrong stage. The grouping key (P2) includes recipient name, but a name collision within one order is still possible (e.g. two "Rivky Weiss" recipients at different addresses); the export does not deduplicate by the full grouping key. Edge case; not exercised by smoke. Violates: correctness.

### m9 — `getMarginRows` hard-caps at 200 rows with no pagination or truncation indicator
**Sources:** rules Minor 1
**Location:** `lib/reports/margin.ts:76`; `app/(admin)/admin/reports/page.tsx:250-293`
**Claim:** `getMarginRows` defaults `take` to 200; the page calls `getMarginRows({ seasonId })` with no take, so the per-package ledger table silently truncates at 200 shipments. There is no "showing 200 of N" indicator and no pagination control. A season with >200 shipments renders a table that looks complete but is not — the page heading "Per-package ledger" implies exhaustiveness. Violates: anti-hallucination.

### m10 — `legacy/orders.ts` re-queries the full catalog per order group instead of caching per season
**Sources:** rules Minor 3
**Location:** `lib/imports/legacy/orders.ts:237`; contrast `lib/imports/legacy/products.ts:74-82`
**Claim:** Runs `tx.product.findMany({ where: { seasonId: season.id } })` inside the per-order-group loop. `legacyProductsImport` caches the season id by year; the orders handler does not cache the catalog by season. For a 2000-row import spread across many orders, this holds the commit transaction open with N full-catalog round-trips. Violates: ponytail § scale.

### m11 — `legacy/customers.ts` does two `findUnique` calls per row inside one transaction
**Sources:** rules Minor 4
**Location:** `lib/imports/legacy/customers.ts:110-111`
**Claim:** Runs `tx.customer.findUnique({ where: { email } })` and `tx.customer.findUnique({ where: { normalizedPhone } })` per row inside `commitLegacyCustomerRows`. For a 2000-row import that is up to 4000 round-trips holding the commit transaction open. A single `findMany({ where: { OR: [...] } })` up front with a Map would collapse the per-row queries. Violates: ponytail § scale.

### m12 — `testops/actions.ts` `clear` resets `reserved` but not `onHand`, leaving stale inventory
**Sources:** rules Minor 5
**Location:** `lib/testops/actions.ts:122-127`; `components/admin/test-ops-console.tsx:18-20`
**Claim:** Resets `inventoryItem.reserved = 0` and `season.lastOrderSeq/lastDraftSeq = 0` after truncating the transactional tables, but `inventoryItem.onHand` is left at its post-finalization value. The `clear` description says it "Keeps the season, catalog, customers, and settings" — inventory is part of the catalog, so it survives, but its `onHand` now reflects decrements from orders that no longer exist. A rehearsal act that finalizes 10 units then runs `clear` starts the next act with 10 units of phantom consumption. `reset` (wipe + reseed) fixes it; `clear` alone does not. Violates: correctness.

### m13 — `testops/actions.ts` WIPE/CLEAR table lists are hardcoded, manually synced to `@@map`, and untyped
**Sources:** rules Minor 6, clean-code Minor 6
**Location:** `lib/testops/actions.ts:15-100`
**Claim:** `WIPE_TABLES` and `CLEAR_TABLES` are `string[]` arrays hand-maintained against `prisma/schema.prisma` `@@map` values. The comment on line 14 acknowledges the sync ("Table names = @@map values in prisma/schema.prisma") but no test or guard enforces it. Both are `string[]`, so a typo in a table name would silently TRUNCATE the wrong table (or no-op) and only surface at runtime. A future migration adding a table would silently leave it un-wiped/un-cleared, so a `reset` would not actually restore a clean test season for that table. The migration-guard CI check does not cover this list. A `as const` tuple plus a check against Prisma's known `@@map` names (or a typed model-name union) would catch drift at compile time. Violates: latent footgun / untyped destructive ops.

### m14 — `ReconciliationRun.actorId` is a dangling string with no FK relation and no reader
**Sources:** rules Minor 7
**Location:** `prisma/schema.prisma:1275`; `lib/reconcile/matcher.ts:33`; `app/(admin)/admin/reconciliation/page.tsx:120`
**Claim:** `actorId String?` is declared with no `actor StaffUser? @relation(...)`. `lib/reconcile/matcher.ts:33` writes `actorId: input.ctx?.staff.id ?? null`; the page reads only `run.actorEmail`. No query joins `ReconciliationRun.actorId` to `StaffUser`. The audit log (`recordAudit` with the full ctx) is the canonical actor trail, so `actorId` on the run row is an orphaned string written but never read — same class as the P11 `EmailCampaign.createdById` finding, lower stakes because `actorEmail` is the display field. Violates: dead surface / type-schema drift.

### m15 — `lapsed-customers` export defines "revenue" from order totals while reports define it from POSTED payments
**Sources:** rules Minor 8
**Location:** `lib/exports/datasets.ts:269` (`lifetime_revenue_dollars`); `lib/reports/seasons.ts:4-7`; `lib/exports/datasets.ts:178` (`yearMetrics`)
**Claim:** `lifetime_revenue_dollars` is computed as `row.orders.reduce((sum, order) => sum + order.totalCents, 0)` over finalized order totals. Reports define revenue as "POSTED payments only — the payment ledger is the money truth, not order totals, so a refunded season stays honest." `yearMetrics` follows the reports' POSTED-payments definition. So "revenue" means one thing in reports + year-metrics and a different thing in lapsed-customers. A refunded lapsed customer shows higher `lifetime_revenue_dollars` in the export than their contribution to any season's `revenue_dollars` in reports. The term is overloaded across two exports of the same domain. Violates: consistency / vocabulary.

### m16 — No `.scratch/` phase plan, run-state, or smoke evidence; `.gitignore` does not list `.scratch/`
**Sources:** rules Minor 9
**Location:** `arms/arm-06/workspace/.scratch/` (missing); `arms/arm-06/workspace/.gitignore`
**Claim:** `workflow.mdc` (Expectation Files / Run checkpoint) requires a rolling `.scratch/phase-plan.md` with EXPECTED blocks before each todo and a `.scratch/run-state.md` updated on gate pass; `PHASE-P12-EXPECTED.md` names `arms/{id}/workspace/.scratch/PHASE-P12-SMOKE.md` as the smoke evidence path. None of these exist in `arms/arm-06/workspace/`, and `.gitignore` does not include `.scratch/` (so the folder is not even set up to be gitignored). The contestant relied on `scripts/test-p12-domain.mjs` for verification instead of the expectation-file discipline. The phase landed and tests pass, but the pre-committed self-review artifact trail the rule mandates is absent. Violates: workflow § expectation files.

### m17 — `CHANNEL_LABEL` duplicated between export lib and reports page
**Sources:** clean-code Minor 1
**Location:** `lib/exports/datasets.ts:47-52`; `app/(admin)/admin/reports/page.tsx:13-18`
**Claim:** Identical `CHANNEL_LABEL: Record<string, string>` content (`PICKUP`, `BULK_DELIVERY`, `PER_PACKAGE_DELIVERY`, `SHIPPED`), two call sites. Should be one shared constant (the fulfillment-channel enum already exists in Prisma; a label map beside it is the natural home). Violates: duplicated logic.

### m18 — `markProductDuplicates` name collision across two import handlers
**Sources:** clean-code Minor 2
**Location:** `lib/imports/products.ts`; `lib/imports/legacy/products.ts`
**Claim:** Both define a function named `markProductDuplicates` (locally scoped, not exported, so no compile error). The two implementations differ in shape — the non-legacy one marks per-row with `"a product already uses this slug"`; the legacy one uses a `Set` and a different reason template referencing `legacySeasonName(year)`. The identical name for two different dedupe strategies is confusing on read. Rename the legacy one to `markLegacyProductDuplicates`, or extract the shared "query existing slugs, mark rows whose slug is taken" shape. Violates: naming / pattern drift.

### m19 — `recordAudit` inside the stream `start` callback has a subtle failure mode
**Sources:** clean-code Minor 3
**Location:** `app/api/admin/export/[dataset]/route.ts:43-62`
**Claim:** The intent ("audit only on completed download") is correct. But if `recordAudit` throws (DB blip), the stream errors after rows were already sent — the client sees a truncated download with no audit trail, rather than a clean failure. A try/catch around `recordAudit` that logs without killing the stream, or a comment noting the trade-off, would make the choice explicit. (Minor — `recordAudit` is simple and unlikely to throw in practice.) Related-but-distinct from m2: m2 is the security concern (a client abort bypasses the audit); m19 is the clean-code concern (an internal throw truncates the stream after rows sent). Same code location, different failure modes.

### m20 — `seasonPerformanceRows` private wrapper adds nothing
**Sources:** clean-code Minor 4
**Location:** `lib/reports/seasons.ts:37-86`
**Claim:** The private function has exactly one caller (the export `getSeasonPerformance`), which just returns `seasonPerformanceRows(seasonIds)`. The indirection does no work — inline the body into `getSeasonPerformance` or drop the wrapper. Violates: anti-AI-tic (needless indirection).

### m21 — `IMPORT_ROW_LIMIT` (2000) not surfaced to the upload UI
**Sources:** clean-code Minor 5
**Location:** `lib/imports/engine.ts` (exports `IMPORT_ROW_LIMIT = 2000`); `app/(admin)/admin/imports/import-upload.tsx`
**Claim:** The limit is enforced server-side in `stageImport` and surfaced only after the POST fails. The upload component already lists `KIND_COLUMNS` per kind; the row cap is a sibling piece of information the user discovers too late. Not a clean-code violation per se, but the constant's reach ends at the server boundary — the UI that owns "tell the user what to expect" doesn't know it.

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| M2 | quality Major 1 ; rules Major 2 (Major + Major → Major) |
| m8 | quality Minor 6 ; rules Minor 2 (Minor + Minor → Minor) |
| m13 | rules Minor 6 ; clean-code Minor 6 (Minor + Minor → Minor) |

All other aggregate IDs are single-source. No new findings introduced.

Related-but-distinct pairs kept separate:
- **B1 vs B2** (security + quality): both are P12 blockers but on different surfaces. B1 is the `APP_ENV` fail-open default that unlocks the destructive test-ops gate. B2 is the missing G-029 typed-phrase confirmation on import commit. Different locations, different claims, both kept.
- **M1 vs B1** (security): both touch destructive/dev surfaces. B1 is the env-default fail-open. M1 is the `VERCEL_ENV`-only dev-bypass guard. Different guards, different code, different escalation paths.
- **M2 vs m7 vs m15** (quality/rules + quality + rules): all touch report/export totals. M2 is the VOIDED-vs-PURCHASED charged divergence between method drill-down and margin rollup. m7 is the refunded-legacy-order `paymentStatus: PAID` with no payment rows (export-edge label). m15 is the "revenue" definition drift between lapsed-customers (order totals) and reports/year-metrics (POSTED payments). Different defects in adjacent totals code.
- **m2 vs m19** (security + clean-code): same code location (`export/[dataset]/route.ts:42-62`). m2 is the security concern (client abort bypasses audit). m19 is the clean-code concern (internal `recordAudit` throw truncates the stream). Different failure modes.
- **m12 vs m13** (rules + rules/clean-code): both touch `lib/testops/actions.ts`. m12 is the `clear` action leaving `onHand` stale. m13 is the hardcoded/untyped WIPE/CLEAR table list. Different defects.
- **M5 vs M6 vs M7 vs M8 vs M9** (clean-code): all are import-handler duplication. M5 is `KIND_LABEL` (UI), M6 is `slugify`/`stubSlug`, M7 is `EMAIL_SHAPE`, M8 is the email-vs-phone resolution rule, M9 is money parsing. Different duplicated concerns, each with its own shared home.
- **m10 vs m11** (rules): both are legacy-import transaction-span scale issues. m10 is per-order-group catalog re-query. m11 is per-row dual `findUnique`. Different handlers, different queries.

## Pass notes (not counted)

- **Cron auth** (security PASS): constant-time SHA-256 comparison of both sides; refuses every caller when `CRON_SECRET` unset (no config-state leak, no length oracle). All eight cron routes go through `cronRoute`.
- **Reconciliation matcher** (security PASS): never writes payments — only flags. Reruns idempotent (findings keyed by `kind:intentId:orderId`). Cron path passes no actor ctx; run row and audit row both record `actor: null`, correct for an unattended run.
- **Import engine** (security PASS): staged/atomic; duplicates re-checked inside the commit transaction; dry-run batches refuse commit (G-029's other half — the dryRun boolean refusal — works; B2 is the missing typed-phrase half). `commitRows`/`markDatabaseDuplicates` use parameterized Prisma calls. `truncateAll` uses `$executeRawUnsafe` but the table list is hardcoded constants — no injection surface.
- **CSV parsing** (security PASS): RFC-4180 quoted-field parser; values flow into Prisma `create`/`update`/`upsert` (parameterized). `stubSlug` builds a slug from user input but is used in a parameterized `where: { slug }`, not raw SQL.
- **Address merge IDOR** (security PASS): verifies `keep.customerId === customerId` and every dropped address belongs to the same customer; rejects `keepId ∈ dropIds`; blocks merges of addresses referenced by shipped packages (RESTRICT). No cross-customer merge path.
- **Customer merge (legacy import)** (security PASS): email/phone pointing at different existing customers is flagged invalid for human resolution — the import never guesses a merge.
- **Export authz** (security PASS): each dataset declares a `permission`; route checks `hasPermission` before streaming. `seasonId` from the query string is used in parameterized Prisma queries; the data model has no per-season authz (seasons are org-global), so no IDOR. (M4 is the auth-pattern drift on the same route, raised separately.)
- **Reconciliation run button** (security PASS): `payments.manage` required. Cron twin uses bearer auth via `cronRoute`.
- **Reports page** (security PASS): `payments.manage` required; server-rendered read-only ledger.
- **Help/tours** (security PASS): `requireStaff()` only; lives under the admin layout which requires `admin.access` (drivers lack it), so drivers cannot reach it.
- **Test-ops destructive gating** (security PASS aside from B1): permission is `settings.manage` (manager-only), audit is recorded, `audit_logs` and `staff_users` survive every wipe action.
- **Import preview payload authz** (security PASS): GET returns `batch.payload` only after the kind-permission check passes, so a `customers.manage` user cannot read `LEGACY_ORDERS` batch payloads. (m1 is the 404-vs-403 ordering on the same routes, raised separately.)
- **Import list page** (security PASS): filters batches by the viewer's permitted kinds server-side; no unfiltered list API.
- **Smoke honesty** (quality PASS for what ran): the log matches the code paths (33 PASS / 0 FAIL is credible — each PASS maps to a real assertion in `smoke-p12.ps1`/`smoke-db.mts`). The two material gaps (M2 voided-charge comparison, B2 typed-phrase gate) are gaps in *what* the smoke asserts, not gaps in *whether* the asserted steps ran.
- **Scale dress rehearsal** (quality PASS): deterministic PRNG, real domain shapes, real order-number claiming, real grouping key, real nightly-batch/route-builder/concurrency probes. 1002 orders / 5004 packages reconciles with the log. The "nightly over 5k" evidence (S5p, 75ms / 0 filed) is the idempotent rerun after the probe already filed 4450 — accurately described in the status doc's "deferred gaps" section.
- **Cron registration** (rules PASS): `vercel.json` registers 8 crons (nightly-print, outbox-sweep, payment-reminders, pickup-expiry, season-flip, shipping-maintenance, email-log-purge, reconcile-stripe), all routed through `lib/cron-route.ts` → `isCronAuthorized`. The plan text says "all 5 Vercel crons" — the implementation exceeds that count; every cron has secret auth. Not a violation.
- **Phase coverage** (rules PASS): all five P12 EXPECTED "must be true" items have code + a domain test (`scripts/test-p12-domain.mjs`, 30+ assertions) plus the smoke path. The findings are rule-adherence defects, not missing features. (m16 is the missing `.scratch/` artifact trail, raised separately.)
- **Ponytail ladder** (rules PASS): no new packages added in P12. Reconciliation, exports, reports, imports, and test-ops are all built on existing Prisma + native `fetch` + the existing `lib/csv` engine. The ladder rungs are honored.
- **Ponytail anti-slop** (rules PASS): comments across `lib/reconcile/matcher.ts`, `lib/exports/datasets.ts`, `lib/reports/{seasons,margin}.ts`, `lib/imports/legacy/*`, and `lib/testops/*` are non-obvious intent (one-claim law, capture-mode honesty, order-number repair rationale, terminal-state choice for refunded orders), not narration. No sycophancy or stock vocab in code comments.
- **Vocabulary rule** (rules PASS): no refactor/tidy/rebuild commands in scope this phase; "add" (new reports/exports/reconciliation/import kinds/test console) followed existing patterns.
- **Dependency Discipline** (clean-code PASS): no new deps; versions already pinned from earlier phases.
- **UI Consistency** (clean-code PASS): the new admin pages (reports, export, reconciliation, imports, test-ops, help) reuse the existing admin shell, header, sidebar, `BackLink`, Badge, and stone/brand token palette. No rogue styling.
- **No swallowed errors** (clean-code PASS): the sweep/purge catch blocks record `lastError`/`message` and rethrow; per-message catches record and continue where intentional.

## Bottom line

Two Blockers, both single-source. B1 (security) is the `APP_ENV` fail-open default — a production deploy that omits the env var gets `"test"` and unlocks `TRUNCATE ... CASCADE` on the full domain schema for any manager; the safe default must be `"production"`. B2 (quality) is the missing G-029 typed-phrase confirmation gate on import commit — the status doc claims it ships, the code has no `confirmPhrase`/`typedPhrase` field anywhere, and the smoke never exercises it; the only protection is the weaker `dryRun` boolean refusal. The 9 Majors cluster on: the `VERCEL_ENV`-only dev-bypass guard (M1 — becomes a Blocker the moment hosting leaves Vercel), the VOIDED-vs-PURCHASED "Shipping charged" divergence between method drill-down and margin rollup with a comment that falsely claims parity (M2), the unreachable "edit first" resolve-review workflow the route comment describes (M3), the export route's auth-pattern drift (M4), and a tail of cross-module duplication that the Rule of 2 says should be centralized: `KIND_LABEL` (M5), `slugify`/`stubSlug` (M6), `EMAIL_SHAPE` (M7), the email-vs-phone resolution rule (M8), and money-parsing drift (M9). The 21 Minors are existence-oracle ordering (m1), audit-on-completion gaps (m2, m19), status-doc misreports (m3, m4), matcher wording/edge cases (m5, m6), refunded-legacy-order export label (m7), deliveries name-collision lookup (m8), silent truncation (m9), import-transaction scale (m10, m11), test-ops `clear`/WIPE-list defects (m12, m13), dangling `actorId` (m14), "revenue" vocabulary drift (m15), missing `.scratch/` artifact trail (m16), and a tail of duplication/naming/indirection/constant-reach (m17–m21). B1 is the most urgent P12 fix — a misconfigured production deploy is one click from a total data wipe; B2 is the most urgent doc/code-drift fix because downstream gates will read "G-029 ✓" and stop looking. M1 + M2 + M3 are the launch-readiness hardening to bundle with the Blockers before P12 can gate.




