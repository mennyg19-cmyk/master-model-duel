# P7 FIX NOTES — arm-06 (Test 4 fix pass)

**Date:** 2026-07-29 · **Source list:** `AGGREGATE-REVIEW-P7.md` (1 blocker / 5 majors / 20 minors)
**Result:** **Blocker fixed. 5/5 majors fixed. 18/20 minors fixed, 2 deferred (m11, m14 — justifications below).**
**Verification:** lint ✓ · typecheck ✓ · migration-guard ✓ (11 migrations, in sync) · test:unit ✓ (8 suites) · test:domain ✓ (8 suites; test-p7-domain grew the supersedes-chain checks) · build ✓ · **re-smoke S1–S3 + absorb leg: 26 checks, 0 failures** (`workspace/.scratch/PHASE-P7-SMOKE.md`).

---

## Blocker — fixed

### B1. Absorbing regroup 404s the package detail page — FIXED
`PackageActions.run` (`app/(admin)/admin/packages/[packageId]/package-actions.tsx`) now branches on the regroup response: when `absorbed: true` (the full-move case deletes the page's own package row) it `router.push("/admin/packages")` to the board instead of `router.refresh()`-ing into `notFound()`. The API contract already carried `absorbed`; the client just never read it. Pinned by smoke **S1g** (new leg): split one unit out, regroup everything back → `absorbed: true`, survivor holds all 3 units + both regroup events, the absorbed detail URL answers 404, and the board the client now lands on renders the survivor.

---

## Majors — all 5 fixed

### M1. Reprint `filingGroup` unvalidated + injected into Content-Disposition — FIXED
Two layers. The reprint schema (`app/api/admin/fulfillment/print-batches/reprint/route.ts`) now constrains `filingGroup` to `z.enum(FulfillmentChoice)` — it is persisted verbatim on `PrintBatch` and interpolated into a header, so only channel values get in (400 on anything else). The PDF route (`app/api/admin/fulfillment/print-batches/[batchId]/pdf/route.ts`) additionally sanitizes the quoted-string filename: quotes, backslashes, and control characters become `_` before the header is built, so even a legacy row can't break out of the quoted string.

### M2. Production summary "to print" ignored batch membership — FIXED
`loadFulfillmentSummary` (`lib/packages/fulfillment.ts`) now excludes already-batched packages from `production.toPrint`: a package claimed by a batch has been sent to print even though its stage stays NEW by design, so counting it again double-booked tonight's backlog. `awaitingBatch` and `toPrint` now tell one consistent story.

### M3. `pdf-lib` floating range — FIXED
`package.json` pins `"pdf-lib": "1.17.1"` (exact) and the lockfile is regenerated. A renderer whose output is a printed artifact can no longer drift between installs.

### M4. Terminal-stages list hardcoded in three places — FIXED
One source of truth: new `loadTerminalStages()` (`lib/packages/stages.ts`) derives the season-wide terminal set from `FulfillmentMethod.terminalStage` (distinct), with a comment recording that single-package verbs keep checking their own method's terminal. The nightly batch, reprints, and the dashboard bulk query consume it; `loadFulfillmentSummary` derives its terminal set from the methods it already loads. The hardcoded `["SENT","PICKED_UP"]` lists are gone, so a future method redefining its terminal stage can't silently desync read models.

### M5. Filing sort duplicated with a dropped tiebreaker — FIXED
`sortForFiling` is exported from `lib/packages/print-batches.ts` over a flat shape (`{ id, recipientName, orderNumber }`): recipient name → order number → **package id** as final tiebreaker. The PDF load path (`lib/print/pdf.ts`) maps its rows into that shape and calls the same comparator — rendered page order now matches the persisted `PrintBatchItem` order exactly (the old copy dropped the id tiebreaker).

---

## Minors — 18 fixed, 2 deferred

| # | Fix |
|---|---|
| m1 | Cron bearer check uses `timingSafeEqual` on equal-length UTF-8 buffers (`app/api/cron/nightly-print/route.ts`) — no early-exit timing oracle |
| m2 | Auth runs **before** any config disclosure: with `CRON_SECRET` unset every caller gets 401, so configuration state is never observable pre-auth (the old 503 leaked it). `lib/env-spec.ts` description updated to match |
| m3 | Single-package verbs are season-scoped like the bulk path: `advancePackageStage`, `splitPackage`, `regroupPackage` load the open season up front and treat a past season's package id as nonexistent (404), refusing with `DomainRuleError` when no season is open |
| m4 | Order reprints supersede only same-scope batches: `reprintBatch` looks up the predecessor by the batch's own `filingGroup` (`ORDER:<id>` chains to prior `ORDER:<id>`, never to a nightly multi-order batch). First order reprint → `supersedesId: null`; second → the first (pinned in domain + smoke S3c) |
| m5 | STATUS doc: cards are 6x4 card stock, slips are per-order (not per-package) |
| m6 | STATUS doc: PICKUP stage list is NEW → PACKED → PICKED_UP (no PRINTED) |
| m7 | Reprint package load + predecessor lookup moved **inside** the advisory-locked transaction — a concurrent nightly/reprint can no longer race the snapshot |
| m8 | `renderLabelsPdf` pagination: `PdfWriter` tracks `pageNumber`; a label that overflowed mid-page counts against the page it forced, not the old one — no more blank-page/5-per-page edge |
| m9 | `pdfText` inflate+hex-decode helper extracted to `scripts/lib/pdf-text.mts`; all three copies (test-p7, test-p7-domain, smoke-db) import it |
| m10 | `.env.example` regenerated from `lib/env-spec.ts` (`CRON_SECRET` present) |
| m12 | STATUS doc: migration name corrected to `20260729130000_p7_package_engine_live`; schema bullet now lists only what that migration actually added (`channel`/`deliveryDay`, `PackageLine`, `PrintBatch`/`PrintBatchItem`, `PrintBatchTrigger`) |
| m13 | `loadFulfillmentSummary`'s `printBatchItem` query scopes by `batch: { seasonId }` — bounded per season instead of all-time |
| m15 | Cron route wraps the engine call in the standard try/`mapDomainError` lane; a "No open season" DomainRuleError maps to 422 instead of a raw 500 (FAILED CronRun still written by the engine) |
| m16 | Banned standalone names renamed: `data` → `batch` (pdf renderers), `item` → `batchItem` (pdf/fulfillment/package page), `result` → `entry` (bulk counts) |
| m17 | Magic numbers named: `RECENT_BATCHES_LIMIT = 10`, `PACKAGE_EVENTS_LIMIT = 25`; pdf.ts gains `CHAR_WIDTH_EM`/`LINE_SPACING_EM`/`CENTERED_SPACING_EM`/`LABELS_PER_PAGE` with a metrics comment, and `centered` now uses the single `MARGIN` instead of a second `36` |
| m18 | `methodStages.get(pkg.fulfillmentMethodId)!` drops the defensive `?? []` — a package's method is a FK guarantee; an empty stage list would be seed corruption that should throw, not silently count |
| m19 | `PrintBatch.createdById` schema comment records the deliberate denormalization (loose staff-id snapshot; batch history survives staff deletion; attribution lives in the audit log) |
| m20 | One timestamp format: `formatBatchTimestamp` ("YYYY-MM-DD HH:MM" UTC) exported from `lib/packages/fulfillment.ts`; dashboard, package print history, and event trail all use it (three inline `toISOString().slice(0,16).replace("T"," ")` copies deleted) |

### Deferred

- **m11 (`CronRun` created outside the transaction):** the create-before-tx is deliberate, not an oversight. The row must exist before the advisory-locked tx so a waiting second runner is already visible, and the catch path writes FAILED **outside** the failed tx by necessity. The only orphan window is a hard process crash between create and commit; the next run's rows make that self-evident, and `CronRun` is an ops log, not books. Moving creation inside the tx would extend lock hold time for zero observable gain.
- **m14 (bulk-action scaffold duplicated orders vs packages):** the reviewer themselves filed it as Minor because "the two are stable and the abstraction needs generics/callbacks to stay honest." A shared `runBoundedBulkAction` would need generics over id type, the per-row error allow-list, and outcome labels — the type plumbing costs more lines than the ~80 it saves, and both copies are exercised end-to-end by domain + smoke suites. clean-code discipline: when removing duplication adds more lines than it saves and the duplicated code is stable, leave it duplicated.

## Contract changes reviewers should know

1. Absorbed-regroup responses are now consumed by the client: `POST /api/admin/packages/[id]/regroup` with `absorbed: true` redirects the browser to `/admin/packages` (was: refresh into 404). API shape unchanged.
2. Reprint `filingGroup` must be a `FulfillmentChoice` value (was: any non-empty string) — 400 otherwise.
3. First order-scoped reprint now has `supersedesId: null`; the chain links only within the same `filingGroup` scope (was: pointed at the order's latest batch of any scope).
4. `GET /api/cron/nightly-print` without `CRON_SECRET` configured answers 401 for every caller (was: 503 revealing "not configured"); a `DomainRuleError` from the engine maps to 422 (was: raw 500).
5. Package verbs (`advance`/`split`/`regroup`) treat packages outside the open season as 404 and refuse entirely when no season is open (422).
6. Production summary `toPrint` excludes batched packages — dashboard numbers shift down by the already-printed backlog (correctness fix, not a regression).

## Notes

- Re-smoke grew from 24 to **26 checks**: S3c rewritten for the in-scope supersedes chain (null, then first batch), new 4-check leg **S1g** drives the B1 absorb path end-to-end (split → full regroup → `absorbed:true` → detail 404 → board renders survivor).
- New tests in `test-p7-domain.mts`: first order reprint supersedes nothing, second supersedes the first — the m4 chain is pinned at the domain layer, not just the smoke.
- The m2 wording change in `lib/env-spec.ts` is load-bearing documentation: the 503→401 flip is only a security win if the next reader knows it's intentional.
