# P7 fix pass — arm-04

**Input:** `results/AGGREGATE-REVIEW-P7.md` (0 blockers, 4 majors, 16 minors)
**Scope:** one pass. All 4 majors, 10 of 16 minors. P8 not started.
**Verification:** `npm run ci` exits 0 — lint, typecheck, migration guard, **170/170 tests**
(2 new). **P7 smoke 21/21**, and all seven phase smokes replayed green on a reset database
(P1 28, P2 21, P3 39, P4 26, P5 29, P6 23, P7 21 — 187 checks).

## Fixed — majors

### M1 — `movePackageLines` now claims the target box too
`src/lib/fulfillment/package-edit.ts`

The move writes both boxes: the target takes the lines, and takes the fee as well when the source
empties. Only the source was claimed, so the target's `version` never moved and a concurrent edit to
it was a lost update. Both boxes are now claimed — the source at the version the screen posted, the
target at the version it was just read at inside the transaction — and the loser gets `STALE_VERSION`.
The two claims are made in id order so two staff moving lines in opposite directions cannot deadlock
on each other.

Proof: `moving lines claims the box they land in, not only the box they leave` asserts the target's
version advances and that a screen drawn before the regroup is refused. Smoke S1c records the version
going 1 → 2 over HTTP.

### M2 — reprints refuse what the nightly build refuses
`src/lib/print/print-data.ts`, `print-batch-service.ts`, `print-render.ts`,
`src/app/(admin)/admin/orders/[orderId]/page.tsx`, both PDF routes, `fulfillment/actions.ts`

`PRINTABLE_ORDER_STATUSES` (`PLACED`, `IN_FULFILLMENT`) and `printableOrderWhere(seasonId)` now live
beside `readPrintablePackages`, and every path that produces paper reads through them:

- `reprintOrder` takes a `seasonId` and refuses anything outside that scope with a message that says
  what the rule is, rather than filing paper for a cancelled order.
- `reprintGroup` and `renderGroupArtifact` read the group as `id + batchId + batch.seasonId`, so a
  batch from another season is simply not found.
- `renderOrderArtifact` reads the order's boxes through the printable scope; the route answers 404.
- The order screen hides the print links and the reprint button when the order is not printable, and
  says why instead.

Proof: `an order reprint names the pile it replaces, and refuses what the batch refuses`, plus smoke
S4a — the reprint form replayed from HTML rendered *before* the order was completed is refused, the
slip route answers 404, and no batch is filed.

### M3 — `print-service.ts` split by concern
Deleted; replaced by three files, each with one reason to change:

| File | Owns |
|---|---|
| `print-batch-service.ts` | build the nightly batch, reprint a group or an order, read and list batches, count what is waiting |
| `print-render.ts` | the two render functions and `PrintedDocument` |
| `print-filing.ts` | boxes → group rows → pile again (`groupCreateInput`, `readInFilingOrder`, `fileNameFor`) and the failure codes both sides report |

Dependencies point one way: batch → filing, render → filing, both → `print-data`. All eight import
sites updated. Dead code removed with it (`PRINT_BATCH_NOT_FOUND`, which was being used for a missing
*order*).

### M4 — encoding regression repaired
`tests/admin-ops.test.ts` re-saved as UTF-8 with no BOM and the mojibake em-dash restored
(`.scratch/fix-encoding.ps1`). Swept all 284 `.ts/.tsx/.md/.prisma` files under `src`, `tests`,
`scripts` and `prisma`: no BOM, and no latin-1 round-tripped punctuation anywhere.

## Fixed — minors

| # | Fix |
|---|---|
| 1 | `advancePackageStage` and `bulkAdvanceStage` take a `seasonId` and read through `boardScopeWhere`; the board's actions pass the active season. A box outside the season, or on an order nobody is working, is not one these screens can move. |
| 2 | Season scoping for the cross-season IDOR ask: `readBatch`, `readPackageDetail`, `renderGroupArtifact` and `renderOrderArtifact` all take a `seasonId`; the pages and routes resolve the active season and 404 without one. |
| 5 | `reprintOrder` sets `supersedesBatchId` to the batch its boxes were last filed on (null when they never were) and records it in the `print.batch_created` audit detail, keeping the schema invariant `reprintGroup` already honoured. |
| 10 | `item` as a standalone name is gone: `filing` in `reprintGroup`, `readInFilingOrder` and `readPackageDetail`. |
| 11 | `formatDate` had one call site; the `Intl.DateTimeFormat` call is inlined where the batch label is built and the helper is deleted. `formatDateTime` stays — four callers. |
| 12 | `OrderPrintLinks` in `src/components/admin/order-print-links.tsx` replaces the duplicated `PRINT_ARTIFACTS.map(...)` on the order page and the package page. |
| 13 | One `readVersionStamp(formData): number \| null` in `lib/forms/form-data.ts`; the fulfillment and staff actions both use it and each chooses its own refusal. The fulfillment side no longer coerces a missing stamp to `0`. |
| 14 | `package-edit.ts`'s `destinationOf` is now `destinationFieldsOf`, so the display helper in `package-board.ts` keeps the plain name. |
| 15 | `editPackageAction` validates `intent` against `['move','split']` with a zod enum, the way `stage` already was; an unknown intent is refused instead of silently splitting. |
| 16 | `BoardFilters.methodId` carries a one-line comment naming the `channel` URL param it comes from. |

## Deferred — 6 minors, with reasons

| # | Finding | Why not now |
|---|---|---|
| 3 | Dashboard counts `COMPLETED`, nightly batch does not | Real, but the fix is a product decision (does a finished order still get paper, or should the board stop counting it?), not a code tidy. Both sides now read named scopes — `boardScopeWhere` and `printableOrderWhere` — so the disagreement is visible in one place instead of two literal arrays. |
| 4 | Nightly batch has no package-stage filter | Adding `stage notIn (SENT, PICKED_UP)` would also stop paper for a box marked sent by mistake, which is the case the office would actually want printed. Wants a decision, not a patch. |
| 6 | PDF writer drops non-latin-1 characters | The real fix is embedding a TrueType font with a Unicode CMap in the hand-written writer — a phase of work on its own, and it belongs with a decision about the font licence. Out of scope for one fix pass. |
| 7 | A regroup can land a ship fee on a pickup box | Correct as reported, but every alternative moves money after checkout (G-028 freezes it). Needs the office to say which box should carry the fee. |
| 8 | Nightly batch is a button, not a cron route | Scheduled jobs are P12 in the merged plan; a cron endpoint here means inventing its authentication too. Unchanged from the original status deviation 1. |
| 9 | Empty greeting-card group emits a placeholder page | Deliberate (status deviation 3): a group with no messages must still answer the card link with a valid PDF rather than a zero-page file. Changing it means changing what the link does when there is nothing to print. |

## Verification

```
npm run ci        -> exit 0   (lint, typecheck, migration guard, 170/170 tests)
npm run smoke:p7  -> 21/21    (.scratch/PHASE-P7-SMOKE.md)
```

Full ladder replayed from an empty database after the fixes — `db:fresh`, `smoke` (P1),
`seed`, `smoke:p2` … `smoke:p7` — 187/187 checks green.

New tests in `tests/fulfillment.test.ts`:

- `moving lines claims the box they land in, not only the box they leave` (M1)
- `an order reprint names the pile it replaces, and refuses what the batch refuses` (M2, minor 5)

New smoke check `S4a`: a completed order offers no paper on screen, refuses the reprint form replayed
from before it was completed, answers 404 on the slip route, and files no batch.

Two smoke checks were re-worded to carry the fixes' evidence: S1c now records the target box's version
claim, and the unit-test citation rows renumber to P7-1 … P7-7.
