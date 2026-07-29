# P7 Quality Review — arm-06 (blind)

**Phase:** P7 — Package engine live
**Spec:** `shared/phases/PHASE-P7-EXPECTED.md`
**Scope:** `arms/arm-06/workspace/` (lib/packages, lib/print, app/api/admin/{packages,fulfillment}, app/(admin)/admin/{packages,fulfillment}, prisma migration `20260729130000_p7_package_engine_live`)
**Rubric:** `kit/prompts/reviewer/review-quality.md` — correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.
**Evidence read:** `.scratch/PHASE-P7-STATUS.md`, `.scratch/PHASE-P7-SMOKE.md` (24/0), `scripts/test-p7-domain.mts`, all P7 lib + routes + pages.

## Summary

All six EXPECTED items are implemented and smoke S1–S3 pass (24 checks, 0 failures). No stubs, no missing smoke. Domain suite (34 checks) and unit suite (23 checks) cover the keystone paths. Findings below are edge-case correctness and one broken UI flow.

## Findings

### Blocker
1. **Absorbing regroup 404s the package detail page.** `regroupPackage` deletes the source package when all lines move out (`moves.ts:207`). The detail page's client action (`package-actions.tsx:111-124`) calls `router.refresh()` on success without checking `absorbed`. The server component (`[packageId]/page.tsx:45`) runs `notFound()` when the package is gone, so a successful "move everything" regroup lands the user on the 404 page instead of the board. Smoke S1c only splits (never fully absorbs via the UI), so this path is unexercised. Fix: on `absorbed === true`, `router.push("/admin/packages")` before/instead of `router.refresh()`.

### Major
2. **Production summary "to print" ignores batch membership.** `loadFulfillmentSummary` (`fulfillment.ts:86`) counts `production.toPrint` for every `NEW` package whose method includes `PRINTED`, without consulting the `batched` set it already built. After the nightly run files a batch, those packages are still `NEW` (printing never advances stage, by design), so "to print" stays unchanged while `awaitingBatch` drops to 0 — two dashboard numbers that should agree diverge. Staff reading the dashboard post-batch see a stale "to print" backlog. The `awaitingBatch` count (line 81) correctly excludes batched packages; the production buckets should do the same for the print bucket.

### Minor
3. **Order-reprint `supersedesId` crosses scopes.** `reprintBatch({ orderId })` (`print-batches.ts:156-165`) sets `supersedesId` to the latest batch containing *any* of the order's packages — typically a nightly, multi-order batch. That nightly batch is not actually superseded (it still validly covers other orders), so the FK is a traceability pointer dressed as a supersession. Group reprints are fine (same scope); order reprints produce a misleading chain. Domain test (`test-p7-domain.mts:282-286`) asserts filing group/trigger/count but never asserts `supersedesId`, so this is unverified.

4. **`loadBatchForPrint` sort lacks the id tiebreaker used by filing.** `sortForFiling` (`print-batches.ts:27-33`) breaks recipient/orderNumber ties with `a.id.localeCompare(b.id)`, but the PDF re-sort (`pdf.ts:101-105`) omits it. Split packages (same recipient, same order) end up in non-deterministic page order in the slips/labels PDF, and may not match the filing order persisted in `PrintBatchItem`. Cosmetic, but the two sort functions should share one helper.

5. **Status doc misstates card dimensions and slip granularity.** `PHASE-P7-STATUS.md` row 5 claims "5x7 card-stock page" and "one packing slip per package"; the code renders `CARD = [432, 288]` = 6in×4in (`pdf.ts:144`) and one slip page *per order* with all packages listed (`renderSlipsPdf`, `pdf.ts:249-265`). The EXPECTED spec says "per-order packing slip", so the code is right and the status doc is wrong — but the doc is what reviewers/operators read.

6. **Status doc misstates PICKUP stage list.** `PHASE-P7-STATUS.md` row 2 says "PICKUP runs NEW->PICKED_UP"; the seed (`prisma/seed.ts:214`) defines PICKUP stages as `["NEW","PACKED","PICKED_UP"]`, so PICKUP actually runs NEW→PACKED→PICKED_UP. The code (`stages.ts`) is data-driven and correct; only the doc is wrong.

7. **`reprintBatch` reads packages and predecessor outside the transaction.** `print-batches.ts:141-165` snapshots packages and the predecessor batch before the `prisma.$transaction` that creates the new batch (line 168). A concurrent nightly run or reprint between the snapshot and the create can change membership or insert a newer predecessor; the reprint then files a stale package set and points `supersedesId` at an already-superseded batch. No advisory lock guards reprints (unlike `runNightlyPrintBatch`). Low likelihood, low impact (both batches remain valid), but the supersession chain can become non-monotonic.

8. **`renderLabelsPdf` pagination counter is fragile.** `pdf.ts:272-296` forces a new page every 4 packages (`packagesOnPage % 4 === 0`) independently of the `line()` helper's own page-break-on-overflow. A label whose content overflows mid-page triggers an inner `addPage`, after which the outer counter still pushes a new page at the next multiple of 4, producing mostly-empty pages. No correctness impact on the printed data, just paper waste and inconsistent layout.

## Count by severity

- Blocker: 1
- Major: 1
- Minor: 6
- Total: 8
