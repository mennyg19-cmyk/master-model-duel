# P7 Quality Review — arm-04 (blind)

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Phase: P7 — Package engine live: grouping UI, statuses, print batches, cards
Reviewer: Quality specialist (external, blind)
Scope: P7 delta + regressions vs `shared/phases/PHASE-P7-EXPECTED.md` and `shared/MERGED-BUILD-PLAN.md` § P7. Findings only — no fixes, no new scope.

## Evidence reviewed

- `src/lib/print/{print-service,filing-groups,documents,pdf,print-data,paths,pdf-response}.ts`
- `src/lib/fulfillment/{package-board,package-edit,package-stages,packages,bulk-stages,channel-summary}.ts`
- `src/app/(admin)/admin/fulfillment/**` (hub, board, package detail, batch detail, group artifact route, actions)
- `src/app/(admin)/admin/orders/[orderId]/{page.tsx,print/[artifact]/route.ts}`
- `prisma/schema/printing.prisma`, `prisma/migrations/20260727000000_p7_print_batches/migration.sql`
- `tests/fulfillment.test.ts`, `scripts/smoke-p7.ts`
- `.scratch/PHASE-P7-SMOKE.md` (19/19), `.scratch/PHASE-P7-STATUS.md`
- `src/lib/auth/permissions.ts`, `src/lib/audit.ts`, `src/components/admin/nav-items.ts`

Smoke 19/19 and `npm run ci` (168 tests) are green per status; no re-run attempted here. No stubs or `TODO` markers found in P7 code.

## Findings

### MAJOR

**M1. `reprintOrder` files paper for cancelled orders.**
`src/lib/print/print-service.ts:198-244` reads packages by `{ orderId }` with no order-status guard, unlike the nightly batch (`waitingToPrintWhere` at `print-service.ts:46-51` restricts to `PLACED`/`IN_FULFILLMENT`). `cancelUnpaidOrder` (`order-service.ts:192-207`) flips status to `CANCELLED` without deleting packages, so a cancelled order still has boxes. The order detail page renders the "File a reprint batch" button whenever `canPack` and `boxes.length > 0` (`orders/[orderId]/page.tsx:146,264-269`), so a manager can file a reprint batch — slips, labels, cards — for boxes that should not be packed. The nightly batch correctly excludes cancelled orders; the order-level reprint does not. Inconsistency + wrong operational output.

### MINOR

**m1. Dashboard and nightly batch disagree on COMPLETED orders.**
`channel-summary.ts:44-46` (`boardScopeWhere`) includes `COMPLETED`; `print-service.ts:46-51` (`waitingToPrintWhere`) does not. A COMPLETED order with an unprinted box shows in the channel table and board totals but is never filed by the nightly batch, and `countWaitingToPrint` excludes it. The two figures can diverge for an order marked COMPLETED with boxes still in `NEW`.

**m2. Nightly batch has no package-stage filter.**
`print-service.ts:46-51` picks up any box on a `PLACED`/`IN_FULFILLMENT` order with no nightly row, regardless of stage. A box already `SENT`/`PICKED_UP` that was never on a nightly batch gets filed for printing. Defensible (you may want a slip for the records) but unexercised by smoke and surprising.

**m3. `reprintOrder` does not set `supersedesBatchId`.**
`print-service.ts:219-229` creates a `REPRINT` batch with no `supersedesBatchId`, while `reprintGroup` (`print-service.ts:151-175`) does. Status invariant #5 ("a reprint is a new batch that names the one it came from") holds for group reprints only. An order reprint has no source batch, so the omission is defensible, but the two `REPRINT` origins are indistinguishable in the `print.batch_created` audit detail.

**m4. Hand-rolled PDF writer drops non-latin-1 characters as `?`.**
`pdf.ts:101-109` (`escapeText`) maps anything outside code points 32–255 to `?`. Recipient or customer names in Hebrew render as question marks on slips, labels and cards. `normalize.ts:35-40` (`collapseToLetters`) also strips non-ASCII for the filing sort key, so a Hebrew name sorts to the top with an empty last name. Documented in `pdf.ts` as a deliberate tradeoff against mojibake, but for a Purim platform serving a Hebrew-speaking community this is wrong output for a real fraction of recipients. Smoke uses Latin names only, so this is unobserved.

**m5. `movePackageLines` can land a fulfillment fee on a pickup box.**
`package-edit.ts:135-142` moves the source box's `fulfillmentFeeCents` onto the target when the source is emptied. If the last line moves from a paid ship box into a free pickup box, the pickup box inherits the ship fee. Order total is preserved, but a pickup box now carries a shipping charge, which feeds `channel-summary.ts` `chargedCents` for the pickup channel. Edge case; smoke only moves lines between same-recipient ship boxes.

**m6. Nightly batch is a button only; no cron route.**
`actions.ts:28-47` exposes `buildBatchAction` as a form submit. `buildNightlyBatch` writes a `CronRunLog` row (`print-service.ts:59`) even when invoked manually, so a button press is logged as a cron run. Schedule wiring is deferred to P12 per status deviation 1; EXPECTED item 4 does not explicitly require the cron, so this is a deferral note, not a spec gap.

**m7. Empty greeting-card group emits a placeholder page.**
`documents.ts:121-133` returns a single page reading "No greeting cards in this group." when no box has a greeting. EXPECTED item 5 says "Greeting-card PDFs per filing group on card stock"; a placeholder page is not a greeting card and will be sent to a card-stock tray. Defensible (avoids an empty PDF) but a UX wart.

## Regression check

P7 changes to existing files are additive: `orders/[orderId]/page.tsx` adds `OrderPaper` + reprint button behind `canPack`; `nav-items.ts` adds the Fulfillment link; `permissions.ts` adds `fulfillment.manage` to `STAFF`/`MANAGER` defaults; `audit.ts` adds the `print.*` and `package.*` actions; `fulfillment.prisma`/`orders.prisma` add the `printItems` relation; `package.json` adds `smoke:p7`. No removals or rewrites of P1–P6 logic observed. Full unit suite (`npm run ci`, 168 tests) is green per status, so no test-level regressions. P1–P6 smoke was not re-run as part of P7 evidence; CI is the regression backstop.

## Summary

Blockers: 0 · Majors: 1 · Minors: 7
