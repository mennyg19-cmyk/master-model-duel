# Aggregate Review — P7 — arm-06

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-06 (late join)
**Phase:** P7 — Package engine live (board, print batches, greeting cards)
**Inputs:** P7-security, P7-quality, P7-rules, P7-clean-code (arm-06, all blind)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings. Mixed-severity clusters resolve to the highest severity (Blocker > Major > Minor).

## Counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 5 |
| Minor | 20 |
| **Total** | **26** |

Source totals (pre-dedupe): security 4, quality 8, rules 9, clean-code 10 = 31. 4 clusters merged (M3: 2 src; M5: 3 src; m1: 2 src; m7: 2 src) → net 26 unique. No security blockers were raised by the security specialist; the single Blocker comes from quality (UI correctness) and survives aggregation.

## Blockers (1)

### B1 — Absorbing regroup 404s the package detail page
**Sources:** quality B1
**Location:** `lib/packages/moves.ts:207`; `app/(admin)/admin/packages/[packageId]/package-actions.tsx:111-124`; `app/(admin)/admin/packages/[packageId]/page.tsx:45`
**Claim:** `regroupPackage` deletes the source package when all lines move out. The detail page's client action calls `router.refresh()` on success without checking `absorbed`; the server component runs `notFound()` when the package is gone, so a successful "move everything" regroup lands the user on the 404 page instead of the board. Smoke S1c only splits (never fully absorbs via the UI), so this path is unexercised. Fix: on `absorbed === true`, `router.push("/admin/packages")` before/instead of `router.refresh()`.

## Majors (5)

### M1 — Reprint `filingGroup` is unvalidated and flows into a PDF header
**Sources:** security M1
**Location:** `app/api/admin/fulfillment/print-batches/reprint/route.ts`; `lib/packages/print-batches.ts:170`; `app/api/admin/fulfillment/print-batches/[batchId]/pdf/route.ts:26`
**Claim:** Reprint accepts `filingGroup: z.string().min(1).optional()` with no constraint to the channel enum (`PICKUP` / `BULK_DELIVERY` / `PER_PACKAGE_DELIVERY`) the nightly batch derives via `filingGroupForChannel`. The value is written verbatim into `PrintBatch.filingGroup` and interpolated into the `Content-Disposition` filename. A staff member with `fulfillment.manage` can create batches with arbitrary `filingGroup` strings (data pollution) and a value containing `"` or control characters breaks the quoted filename header. The dashboard form only offers the three channel keys, but the API does not enforce that. Constrain the Zod schema to the channel enum and sanitize the header value.

### M2 — Production summary "to print" ignores batch membership
**Sources:** quality M1
**Location:** `lib/packages/fulfillment.ts:86` (vs. `awaitingBatch` at line 81)
**Claim:** `loadFulfillmentSummary` counts `production.toPrint` for every `NEW` package whose method includes `PRINTED`, without consulting the `batched` set it already built. After the nightly run files a batch, those packages are still `NEW` (printing never advances stage, by design), so "to print" stays unchanged while `awaitingBatch` drops to 0 — two dashboard numbers that should agree diverge. Staff reading the dashboard post-batch see a stale "to print" backlog. The `awaitingBatch` count correctly excludes batched packages; the production buckets should do the same for the print bucket.

### M3 — `pdf-lib` declared with a floating (caret) range
**Sources:** rules M1, clean-code M2
**Location:** `arms/arm-06/workspace/package.json:26` — `"pdf-lib": "^1.17.1"`
**Claim:** clean-code.mdc § Dependency Discipline: "Pin versions — no floating ranges." Every other dependency in this file is exact-pinned (`next: "15.5.22"`, `react: "19.2.8"`, `@prisma/client: "6.19.3"`, …). `pdf-lib` is the only caret range. The ponytail ladder justifies the *addition* (no stdlib/native/existing dep covers PDF generation), so the dep is fine — only the version spec violates the rule. Re-pin to an exact version and regenerate the lockfile entry.

### M4 — Terminal-stages list hardcoded three ways
**Sources:** clean-code M1
**Location:** `lib/packages/print-batches.ts:20` (`const TERMINAL_STAGES = ["SENT", "PICKED_UP"] as const;`, used twice); `app/(admin)/admin/fulfillment/page.tsx:15` (`const TERMINAL: PackageStage[] = ["SENT", "PICKED_UP"];`); `lib/packages/fulfillment.ts:81` (inline `pkg.stage !== "SENT" && pkg.stage !== "PICKED_UP"`)
**Claim:** `["SENT", "PICKED_UP"]` is spelled out in three independent places with three different shapes, while the schema already carries a data-driven `FulfillmentMethod.terminalStage` that `lib/packages/moves.ts` and the package detail page use correctly. `lib/packages/stages.ts` already owns the `PACKAGE_STAGES` enum list; the terminal set belongs there too (or derived from the enum). The hardcoded list silently breaks the moment a future method declares a different `terminalStage`, and the three copies can drift from each other. Violates: magic values, duplicated logic, one-pattern-per-concern.

### M5 — Filing sort duplicated in `lib/print/pdf.ts` with dropped tiebreaker
**Sources:** quality m2, rules m2, clean-code M3
**Location:** `lib/packages/print-batches.ts:26-33` (`sortForFiling`: recipientName → orderNumber → id); `lib/print/pdf.ts:101-105` (inline `packages.sort`: recipientName → orderNumber, **no `id` tiebreaker**)
**Claim:** `sortForFiling` breaks recipient/orderNumber ties with `a.id.localeCompare(b.id)`, but the PDF re-sort omits the id tiebreaker. Split packages (same recipient, same order) end up in non-deterministic page order in the slips/labels PDF and may not match the filing order persisted in `PrintBatchItem`. The nightly batch's stated contract is "the same batch always produces the same report, row for row." Two call sites, same intent — export `sortForFiling` and reuse it. Severity resolves to Major (clean-code rates Major; quality/rules rate Minor — highest wins).

## Minors (20)

### m1 — Cron bearer compared with non-constant-time `!==`
**Sources:** security m1, rules m6
**Location:** `app/api/cron/nightly-print/route.ts:14`
**Claim:** `if (auth !== \`Bearer ${env.CRON_SECRET}\`)` is a direct string compare that leaks the secret's length and a byte-by-byte prefix over many timed requests. Use `crypto.timingSafeEqual` over equal-length buffers (after a length check) so the comparison time is independent of the secret's contents. Low risk (cron secret, low request rate); noted for completeness.

### m2 — Cron config check precedes the auth check
**Sources:** security m2
**Location:** `app/api/cron/nightly-print/route.ts:10-16`
**Claim:** The route returns `503 "Cron is not configured — set CRON_SECRET"` before verifying the bearer. An unauthenticated caller can therefore probe whether `CRON_SECRET` is configured on the deployment. Check the bearer first; only then surface the "not configured" state.

### m3 — Single-package mutations are not season-scoped
**Sources:** security m3
**Location:** `lib/packages/moves.ts` (`splitPackage` / `regroupPackage`); `lib/packages/stages.ts` (`advancePackageStage`); cf. `lib/packages/bulk.ts:40-43` (`runBulkPackageAdvance` does scope)
**Claim:** The single-package verbs load the package by `id` alone — no `order: { seasonId }` guard. The bulk path scopes to the open season. A staff member with `fulfillment.manage` can therefore split/regroup/advance a package from a past season by guessing its `id`, which the board never surfaces. Apply the same season guard the bulk path uses to keep the single-package verbs consistent and prevent cross-season mutations.

### m4 — Order-reprint `supersedesId` crosses scopes
**Sources:** quality m1
**Location:** `lib/packages/print-batches.ts:156-165`
**Claim:** `reprintBatch({ orderId })` sets `supersedesId` to the latest batch containing *any* of the order's packages — typically a nightly, multi-order batch. That nightly batch is not actually superseded (it still validly covers other orders), so the FK is a traceability pointer dressed as a supersession. Group reprints are fine (same scope); order reprints produce a misleading chain. The domain test asserts filing group/trigger/count but never asserts `supersedesId`, so this is unverified.

### m5 — Status doc misstates card dimensions and slip granularity
**Sources:** quality m3
**Location:** `.scratch/PHASE-P7-STATUS.md` row 5
**Claim:** The status doc claims "5x7 card-stock page" and "one packing slip per package"; the code renders `CARD = [432, 288]` = 6in×4in (`lib/print/pdf.ts:144`) and one slip page *per order* with all packages listed (`renderSlipsPdf`, `pdf.ts:249-265`). The EXPECTED spec says "per-order packing slip", so the code is right and the status doc is wrong — but the doc is what reviewers/operators read.

### m6 — Status doc misstates PICKUP stage list
**Sources:** quality m4
**Location:** `.scratch/PHASE-P7-STATUS.md` row 2; cf. `prisma/seed.ts:214`, `lib/packages/stages.ts`
**Claim:** The status doc says "PICKUP runs NEW->PICKED_UP"; the seed defines PICKUP stages as `["NEW","PACKED","PICKED_UP"]`, so PICKUP actually runs NEW→PACKED→PICKED_UP. The code is data-driven and correct; only the doc is wrong.

### m7 — `reprintBatch` reads packages and predecessor outside the transaction
**Sources:** quality m5, rules m4
**Location:** `lib/packages/print-batches.ts:141-165` (snapshot before `prisma.$transaction` at 168-184)
**Claim:** A concurrent nightly run or reprint between the snapshot and the create can change membership or insert a newer predecessor; the reprint then files a stale package set and points `supersedesId` at an already-superseded batch. No advisory lock guards reprints (unlike `runNightlyPrintBatch`). Low likelihood, low impact (both batches remain valid), but the supersession chain can become non-monotonic / fork (one parent, two children).

### m8 — `renderLabelsPdf` pagination counter is fragile
**Sources:** quality m6
**Location:** `lib/print/pdf.ts:272-296`
**Claim:** The function forces a new page every 4 packages (`packagesOnPage % 4 === 0`) independently of the `line()` helper's own page-break-on-overflow. A label whose content overflows mid-page triggers an inner `addPage`, after which the outer counter still pushes a new page at the next multiple of 4, producing mostly-empty pages. No correctness impact on the printed data, just paper waste and inconsistent layout.

### m9 — `pdfText` helper duplicated across three files
**Sources:** rules m1
**Location:** `scripts/test-p7.mts:129`; `scripts/test-p7-domain.mts`; `.scratch/smoke-db.mts:21`
**Claim:** The ~20-line inflate + hex-decode helper is copy-pasted in three places (two committed). clean-code.mdc § Abstraction Discipline (Rule of 2) calls for extraction at 2+ real call sites; this is 3. The STATUS even calls it out but leaves it. A shared `scripts/lib/pdf-text.ts` would satisfy the rule without net line growth. Test-only code, so Minor.

### m10 — `.env.example` is stale
**Sources:** rules m3
**Location:** `arms/arm-06/workspace/.env.example` (header: "Generated by `npm run gen:env-example`"); cf. `lib/env-spec.ts` (adds `CRON_SECRET`)
**Claim:** `lib/env-spec.ts` adds the `CRON_SECRET` entry (P7), but `.env.example` was not regenerated/committed and still ends at `BLOB_READ_WRITE_TOKEN`. workflow.mdc § Security Basics: "`.env.example` with placeholders for every secret." The source of truth has it; the committed example doesn't. The generator script fixes it in one run.

### m11 — `runNightlyPrintBatch` creates `CronRun` outside the transaction
**Sources:** rules m5
**Location:** `lib/packages/print-batches.ts:67`
**Claim:** The `CronRun` row is created before the advisory-locked transaction. A crash between the create and the tx commit leaves an orphan `CronRun` with no `OK`/`FAILED` status. The tx itself is correct (FAILED is written on catch). Minor (durability gap).

### m12 — STATUS doc inaccuracies (migration name + schema bullet)
**Sources:** rules m7
**Location:** `.scratch/PHASE-P7-STATUS.md`
**Claim:** (a) The doc names the migration `20260729023014_p7_packages_print`; the actual migration directory is `20260729130000_p7_package_engine_live`. (b) The "Schema" bullet claims the P7 migration added `Package.groupingKey`/`greeting`/`version`, `PackageEvent`, and the `PackageStage` enum — those pre-exist from earlier phases; this migration only adds `channel`/`deliveryDay`, `PackageLine`, `PrintBatch`/`PrintBatchItem`, and the `PrintBatchTrigger` enum (verified against `migration.sql` + `schema.prisma` diff). Distinct from m5/m6 (different STATUS rows). Minor (status doc, not shipped code).

### m13 — `loadFulfillmentSummary` loads all `printBatchItem` rows globally
**Sources:** rules m8
**Location:** `lib/packages/fulfillment.ts:53`
**Claim:** `prisma.printBatchItem.findMany({ select: { packageId: true }, distinct: ["packageId"] })` has no season filter (the table has no `seasonId` column; it lives on `PrintBatch`). Every batched package across all seasons is loaded to build the `batched` set, then only open-season packages are checked against it. Correct (`awaitingBatch` only counts open-season packages), but unbounded memory as prior seasons accumulate. Minor.

### m14 — Bulk-action scaffold duplicated between orders and packages
**Sources:** clean-code m1
**Location:** `lib/packages/bulk.ts` (`runBulkPackageAdvance`) vs `lib/orders/bulk.ts` (`runBulkOrderAction`)
**Claim:** `runBulkPackageAdvance` is a near-verbatim structural copy of `runBulkOrderAction`: limit check → open-season check → trim/dedupe candidate ids → scoped `findMany` → `seen` set loop → per-row try/catch with an instanceof error allow-list → count by outcome. Differences are the action type, the extra `PackageConcurrencyError` in the catch list, and the outcome labels. A shared `runBoundedBulkAction` helper (generic over id type, error list, and per-row step) would remove ~80 lines of duplication. Left as Minor because the two are stable and the abstraction needs generics/callbacks to stay honest.

### m15 — Cron nightly-print route skips the try/`mapDomainError` pattern
**Sources:** clean-code m2
**Location:** `app/api/cron/nightly-print/route.ts`
**Claim:** The route calls `runNightlyPrintBatch()` with no try/catch, while every staff POST route in P7 (`bulk`, `print-batches`, `reprint`, `advance`, `split`, `regroup`) wraps the call in `try { … } catch (error) { const mapped = mapDomainError(error); if (mapped) return mapped; throw error; }`. A `DomainRuleError` ("No open season…") from the cron path becomes a raw 500 instead of a mapped response. `runNightlyPrintBatch` does record a FAILED `CronRun` before rethrowing, so the audit trail is intact, but the error-mapping discipline is inconsistent. Distinct from m11 (durability) — this is the error-mapping gap.

### m16 — Banned standalone names (`data`, `item`, `result`)
**Sources:** clean-code m3
**Location:** `lib/print/pdf.ts` (`data: BatchPrintData` in `renderSlipsPdf`/`renderLabelsPdf`/`renderCardsPdf`/`renderBatchPdf`); `lib/packages/fulfillment.ts:60` (`(item) => item.packageId`); `lib/print/pdf.ts:75` (`(item) => ({…})`); `app/(admin)/admin/packages/[packageId]/page.tsx:111` (`(item) => (…)`); `lib/packages/bulk.ts:83-84` (`results.filter((result) => result.outcome === …)`)
**Claim:** The clean-code rule bans `data`, `result`, `info`, `temp`, `val`, `item`, `thing` as standalone names. P7 introduces several `data`, `item`, and `result` standalone names. Rename to domain nouns (`batch`, `batchItem`, `row` / `r`).

### m17 — Undocumented magic numbers
**Sources:** clean-code m4
**Location:** `app/(admin)/admin/fulfillment/page.tsx:47` (`take: 10`); `app/(admin)/admin/packages/[packageId]/page.tsx:38` (`take: 25`); `lib/print/pdf.ts` (`36` margin guard + wrap width vs `MARGIN = 54`; `size * 0.48` char-width, `size * 1.35` line spacing, `size * 1.5` centered spacing)
**Claim:** `take: 10` and `take: 25` have no named constant, no comment. In `pdf.ts`, `centered` uses `36` for both the margin guard (`this.y < 36`) and the wrap width (`this.pageSize[0] - 2 * 36`), while `line` uses `MARGIN = 54`. Two margin constants for the same page is drift; pick one or name both. `wrap` uses `size * 0.48` (char-width estimate), `line` uses `size * 1.35` (line spacing), `centered` uses `size * 1.5`. None are named or commented; they're load-bearing for layout.

### m18 — Defensive `?? []` for a method that cannot be missing
**Sources:** clean-code m5
**Location:** `lib/packages/fulfillment.ts:84`
**Claim:** `const stages = methodStages.get(pkg.fulfillmentMethodId) ?? [];`. `methodStages` is built from `prisma.fulfillmentMethod.findMany({})` (no filter), and `Package.fulfillmentMethodId` is a non-nullable FK, so every package's method is in the map. The fallback silently reclassifies a phantom package into "to pack" instead of "to print." The rule: "No defensive code for conditions that can't happen." Throw or drop the `?? []`.

### m19 — `PrintBatch.createdById` is a loose string, no relation to `StaffUser`
**Sources:** clean-code m6
**Location:** `prisma/schema.prisma` (`PrintBatch.createdById String?`)
**Claim:** The schema adds `createdById String?` on `PrintBatch` with no `@relation` to `StaffUser`, while the rest of the schema models staff attribution via relations (e.g. `Order` / audit rows). The staff POST routes populate it with `gate.ctx.staff.id`, but nothing enforces referential integrity. Either add the relation or document why this denormalization is intentionally loose.

### m20 — Batch timestamp formatting duplicated
**Sources:** clean-code m7
**Location:** `app/(admin)/admin/fulfillment/page.tsx:146`; `app/(admin)/admin/packages/[packageId]/page.tsx:115` (and again at line 159 for the event trail)
**Claim:** `createdAt.toISOString().slice(0, 16).replace("T", " ")` appears in `fulfillment/page.tsx:146` and `packages/[packageId]/page.tsx:115` (and the same page's event trail uses the same expression again at line 159). Extract a `formatBatchTimestamp(date)` helper next to `CHANNEL_LABELS` / the batch read model.

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| M3 | rules M1 ; clean-code M2 |
| M5 | quality m2 ; rules m2 ; clean-code M3 |
| m1 | security m1 ; rules m6 |
| m7 | quality m5 ; rules m4 |

All other aggregate IDs are single-source. No new findings introduced.

## Pass notes (not counted)

- **Print-never-ships invariant** (rules PASS): `print-batches.ts`/`pdf.ts` write `print` events only; stage mutation lives solely in `stages.ts` behind `expectedVersion`. Verified across all print paths.
- **Data-driven stage lists** (rules PASS): `parseMethodStages` validates the JSON column on read and throws loudly with the method code; `canAdvanceStage` is forward-only within the method's list.
- **Optimistic concurrency** (rules PASS): `advancePackageStage`/`splitPackage`/`regroupPackage` all use `updateMany` with `version: expectedVersion` → 409 on stale. Consistent.
- **Error handling consistency** (rules PASS, with m15 gap): one `mapDomainError` ladder; `IllegalStageTransitionError` extends `DomainRuleError` (422, not 500). The cron route is the one outlier (m15).
- **Naming / comments** (rules PASS, with m16 gap): no vague standalone names in lib code; comments carry intent (e.g. the `groupingKey` JSON-encoding rationale, the `$executeRaw` vs `$queryRaw` note). The `data`/`item`/`result` cases in m16 are the exceptions.
- **UI consistency** (rules PASS): `PackageStageBadge` reuses the existing `Badge` tones; package board mirrors the order list's URL-driven filter/pagination discipline; sidebar entries gated on `fulfillment.manage`.
- **Auth boundary** (security PASS): every admin route gates on `requireApiPermission("fulfillment.manage")`; server pages gate on `requirePermission("fulfillment.manage")`; the cron route gates on a `CRON_SECRET` bearer. Zod validates every body. Prisma parameterizes every query (no SQL injection). Audit rows written for all staff-initiated mutations, impersonator resolved correctly by `recordAudit`. CSRF mitigated by `parseBody` requiring `application/json`. The four security findings are input-validation/consistency gaps, not boundary breaches.
- **Codegraph index** (rules PASS): `arms/arm-06/workspace/.codegraph/` index exists; init obligation met.
- **No secrets committed** (rules PASS): `.env` untracked (`.gitignore` has `.env*` with `!.env.example`); `CRON_SECRET` lives only in local `.env`. The `.env.example` staleness (m10) is a documentation gap, not a secret leak.

## Bottom line

No Critical. P7 arm-06 is functionally complete against EXPECTED (all six items implemented, smoke S1–S3 pass 24/0, domain suite 34 checks, unit suite 23 checks). The single Blocker (B1) is a real UI correctness gap on the absorbing-regroup path that the smoke does not exercise; it should be fixed before any Test 4 fix pass. The Majors are one input-validation/header gap (M1), one dashboard-staleness correctness gap (M2), and three clean-code violations (M3 dependency pin, M4 magic-value duplication, M5 sort duplication with dropped tiebreaker). The 20 Minors are dead-code/duplication, magic-value, doc-drift, and concurrency/durability cleanups. No regressions vs P1–P6 surfaces are visible; out-of-scope items (live Shippo P8, package shipping P9) are correctly deferred.
