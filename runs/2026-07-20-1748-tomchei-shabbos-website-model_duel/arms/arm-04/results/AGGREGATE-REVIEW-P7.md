# P7 Aggregate Review — arm-04 (blind)

**Phase:** P7 — Package engine live: grouping UI, statuses, print batches, cards
**Method:** Union + dedupe by location+claim across 4 specialist reviews (security, quality, rules, clean-code). Security blockers always survive. No new findings introduced during aggregation. No model names — arm id only.

## Counts (after dedupe)

- Blockers: **0**
- Majors: **4**
- Minors: **16**

Dedupe merges applied:
- Security m3 (`reprintOrder`/`reprintGroup` no season/status scope) ∪ Quality M1 (`reprintOrder` files paper for cancelled orders) → one Major, root cause identical (no order-status guard on `reprintOrder` at `print-service.ts:198`).
- Quality m3 (`reprintOrder` no `supersedesBatchId`) ∪ Rules m4 (same) → one Minor.
- Rules m1 (BOM) ∪ Rules m2 (mojibake em-dash) ∪ Clean-code M2 (encoding regression in `tests/admin-ops.test.ts`) → one Major; highest severity across sources wins.

## Blockers

None.

## Majors (fix order)

### M1 — `movePackageLines` never claims or bumps the target package's version
`src/lib/fulfillment/package-edit.ts:115-141`
Source claims version via `claimPackageVersion(tx, input.fromPackageId, input.expectedVersion)`; target is only read by `readEditablePackage` (`:108`) and never version-claimed. The line `updateMany` (`:117`) and the source-emptied fee overwrite (`:138-141`) both commit against a stale target snapshot. Under READ COMMITTED a concurrent edit to the target's fee or stage is a lost update; the regroup audit (`package.regrouped`) lands with no conflict and the target's `version` unchanged. At the G-024 crunch target (5k packages, 10 concurrent staff) this is the realistic collision, not a theoretical one. **Fix:** claim and increment the target's `version` the same way the source's is; surface a `CONFLICT` to the loser.

### M2 — `reprintOrder` files paper for cancelled / out-of-scope orders; `reprintOrder`+`reprintGroup` accept any id without season or status scoping
`src/lib/print/print-service.ts:139, 198-244`; UI at `src/app/(admin)/admin/orders/[orderId]/page.tsx:146, 264-269`
`reprintOrder` reads packages by `{ orderId }` with no order-status guard, unlike the nightly batch (`waitingToPrintWhere` at `:46-51` restricts to `PLACED`/`IN_FULFILLMENT`). `cancelUnpaidOrder` flips status to `CANCELLED` without deleting packages, so a cancelled order still has boxes and the order detail page renders the "File a reprint batch" button whenever `canPack && boxes.length > 0`. `reprintGroup` (`:139`) reads the group by `id + batchId` with no check that the original batch is in the active season. Both produce paper the board would not have offered. **Fix:** apply the nightly `waitingToPrintWhere` status set and an active-season check to both reprint paths; refuse anything the nightly build would refuse.

### M3 — God file: `src/lib/print/print-service.ts` mixes 6 concerns
`src/lib/print/print-service.ts:1-454`
454 lines (under the 500-line trigger) but trips the "mixed concerns" rule in `clean-code.mdc`. Owns nightly batch build (`buildNightlyBatch`), group reprint (`reprintGroup`), order reprint (`reprintOrder`), group render (`renderGroupArtifact`), order render (`renderOrderArtifact`), batch read/list (`readBatch`, `listRecentBatches`, `countWaitingToPrint`), plus private filing helpers (`groupCreateInput`, `readInFilingOrder`, `fileNameFor`) and the `BatchRow`/`BatchGroupRow`/`PrintedDocument` types. The render path and the batch-build/reprint path share no state beyond `readPrintablePackages`. **Fix:** split into `print-batch-service.ts` (build/reprint/read), `print-render.ts` (two render fns), `print-filing.ts` (filing helpers); each file one reason to change.

### M4 — Encoding regression: UTF-8 BOM + mojibake em-dash introduced in `tests/admin-ops.test.ts`
`tests/admin-ops.test.ts:1` (BOM bytes `EF BB BF`) and `tests/admin-ops.test.ts:30` (em-dash `—` → `â€"`)
The P7 edit pass introduced a UTF-8 BOM at the start of the file and replaced a previously valid em-dash with mojibake in the file-header comment (the UTF-8 bytes of `—` re-decoded as latin-1 and re-encoded). `workflow.mdc` (Shell execution / Windows) and `deploy-awareness.mdc` require UTF-8 no BOM for Windows-authored files. Node tolerates it, but it is a regression and a diff-noise source. **Fix:** re-save as UTF-8 no BOM and restore the em-dash.

## Minors (priority order)

1. **`advancePackageStage` / `bulkAdvanceStage` not scoped by season or order status** — `src/lib/fulfillment/packages.ts:24`, `src/lib/fulfillment/bulk-stages.ts:40`. Board UI scopes via `boardScopeWhere` (`channel-summary.ts:44`) but the actions read by bare `id`. Clamp both read paths with `boardScopeWhere(seasonId)`.
2. **Print and package-detail reads not scoped by season (cross-season IDOR for `fulfillment.manage`)** — `print-service.ts:257, 287`, `package-board.ts:155`. Permission-gated, unguessable ids, low risk; flag per brief's IDOR ask.
3. **Dashboard and nightly batch disagree on COMPLETED orders** — `channel-summary.ts:44-46` includes `COMPLETED`; `print-service.ts:46-51` does not. A COMPLETED order with an unprinted box shows in the board totals but is never filed; figures diverge.
4. **Nightly batch has no package-stage filter** — `print-service.ts:46-51`. A `SENT`/`PICKED_UP` box on a `PLACED`/`IN_FULFILLMENT` order with no nightly row gets filed. Surprising; unexercised by smoke.
5. **`reprintOrder` does not set `supersedesBatchId`** — `print-service.ts:219-240`. `reprintGroup` honors the schema invariant; `reprintOrder` leaves it null and omits it from the `print.batch_created` audit detail. Either keep the invariant (pick a source / record the set in audit) or document the exception in `prisma/schema/printing.prisma:11-13`.
6. **Hand-rolled PDF writer drops non-latin-1 characters as `?`** — `src/lib/print/pdf.ts:101-109` (`escapeText`); `src/lib/core/normalize.ts:35-40` (`collapseToLetters`). Hebrew recipient/customer names render as `?` on slips, labels, cards and sort to the top with an empty last name. For a Purim platform serving a Hebrew-speaking community this is wrong output for a real fraction of recipients; smoke uses Latin names only.
7. **`movePackageLines` can land a fulfillment fee on a pickup box** — `package-edit.ts:135-142`. Moving the last line from a paid ship box into a free pickup box inherits the ship fee on the pickup box; feeds `channel-summary.ts` `chargedCents` for the pickup channel. Order total preserved; smoke only moves lines between same-recipient ship boxes.
8. **Nightly batch is a button only; no cron route** — `src/app/(admin)/admin/fulfillment/actions.ts:28-47`. `buildNightlyBatch` writes a `CronRunLog` row even when invoked manually, so a button press is logged as a cron run. Schedule wiring deferred to P12 per status deviation 1; EXPECTED item 4 does not explicitly require the cron.
9. **Empty greeting-card group emits a placeholder page** — `src/lib/print/documents.ts:121-133`. A page reading "No greeting cards in this group." is sent to a card-stock tray. EXPECTED item 5 wants greeting-card PDFs per filing group; a placeholder is not a greeting card.
10. **`item` used as a standalone variable name in three P7-new modules** — `print-service.ts:166, 438`; `package-board.ts:222`. `clean-code.mdc` Naming Conventions bans `item` standalone; name it `printItem` / `batchItem`. Collection names (`items`, `printItems`) are fine.
11. **`formatDate` has a single call site (Rule of 2)** — `src/lib/core/dates.ts:13`, used only at `print-service.ts:58`. Inline the `Intl.DateTimeFormat` call or wait for a second caller before promoting.
12. **Duplicated print-links UI across order page and package page** — `orders/[orderId]/page.tsx:242-274`, `fulfillment/packages/[packageId]/page.tsx:122-138`. Both render `PRINT_ARTIFACTS.map(...)`. Extract `OrderPrintLinks({ orderId })`.
13. **Two `version` / `readVersion` form parsers with divergent fallback** — `fulfillment/actions.ts:175` returns `0`; `staff/actions.ts:148` returns `null`. Shared `readVersionStamp(formData): number | null` in `lib/forms/` with caller-chosen reject path.
14. **Two functions named `destinationOf` in the same feature, different behavior** — `package-board.ts:240` returns a display string; `package-edit.ts:220` returns a `Pick<Package, …>`. Rename one (e.g. `destinationFieldsOf` for the edit path).
15. **`editPackageAction` silently treats unknown `intent` as `split`** — `fulfillment/actions.ts:138-168`. Branches on `intent === 'move'` and falls through to `splitPackage`. Validate `intent` against `['move','split']` and reject anything else, the way `stageSchema` already does for `stage`.
16. **`readBoardFilters` URL-vs-internal naming drift** — `package-board.ts:42-54`. URL param `channel` is stored as `BoardFilters.methodId` and re-exposed as `channel`. Add a short comment on `BoardFilters.methodId` noting "from the `channel` URL param" or rename to `channelMethodId`.

## Notes (not scored)

- `buildNightlyBatch` advisory lock key is a fixed `hashtext('print.nightly-batch')` — nightly builds across seasons serialize on the same lock. Performance concern at multi-season scale, not a security finding.
- `packages.bulk_stage` audit `entityId` is a synthetic `randomUUID()` (`bulk-stages.ts:37`), not a `PrintBatch` row. Fine for correlation.
- `bulkAdvanceStage` read-then-claim window is safe — the claim is atomic; a concurrent bump yields `moved.count === 0` reported as `conflict`. This is the deliberate exception in status decision 10 and it is correct.
- `filingGroupOf` buckets by `pickupLocationId` / `deliveryDay` / `methodCode`, all server-derived — no key-collision injection.
- `print.rendered` audit written after the PDF is built but before the response leaves; a render that throws leaves no audit row (nothing was produced).
- `src/lib/admin/bulk-report.ts` consolidation of `BulkReport`/`boundedIds`/`summarizeBulk`/`firstFewOutcomes` is a clean dedupe; `BulkRecord.orderId` → `BulkRecord.id` rename consistent across all call sites.
- `package-stages.ts` `stageLabel` clears the Rule of 2 (4+ call sites across board, package detail, batch, bulk bar).
- `print/pdf.ts` hand-written PDF writer (no dep) is consistent with `ponytail.mdc` ladder; file documents why no library.
