# P7 Rules Review — arm-04 (blind)

Reviewer: external, rules specialist. Scope: P7 delta only (package board, split/regroup, per-package stage advance, fulfillment channel dashboard, nightly print batch, reprint per group/order, slips/labels/cards PDFs, per-order packing slip). Graded against this arm's selected catalog rules: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`. Findings only — no fixes. No new scope beyond P7.

## Summary

The P7 delta is tight and on-rule. The ladder holds — `src/lib/print/pdf.ts` is hand-written with an explicit justification comment (no PDF dep added; `package.json` adds scripts only, no new packages). `Result<T>` stays the single error shape; `bulk-report.ts` was extracted once from `orders/bulk-actions.ts` and now has two real call sites (orders desk + package board), satisfying Rule of 2. Comments carry intent, not narration. The print-vs-status invariant (G-002/G-004) is enforced structurally — `renderGroupArtifact`/`renderOrderArtifact` only write a `print.rendered` audit row and never touch `stage` — and the smoke harness checks it over HTTP plus a DB read. Findings are narrow.

## Findings

### Minor

1. **UTF-8 BOM introduced at the start of `tests/admin-ops.test.ts`** — `tests/admin-ops.test.ts:1`
   Bytes `EF BB BF` now precede `import assert`. The pre-P7 version had no BOM (git diff shows `+﻿import`). `workflow.mdc` (Shell execution / Windows) calls for "UTF-8 no BOM when scripts write files"; the same applies to test files the agent rewrote. Node tolerates it, but it is a regression and a diff-noise source. Re-save without the BOM.

2. **Em-dash corrupted to mojibake in a comment** — `tests/admin-ops.test.ts:30`
   "what those three have in common â€\" every read is" — the original `—` (U+2014) is now `â€"` (the UTF-8 bytes of `—` re-decoded as latin-1 and re-encoded). Byte inspection confirms `0xC3 0xA2 ...` at offset ~1347 where the em-dash used to live. Comment-only so cosmetic, but it is character corruption introduced by the P7 edit pass, not a deliberate change.

3. **`item` used as a standalone variable name in three P7-new modules** — `clean-code.mdc` Naming Conventions bans `item` as a standalone name
   - `src/lib/print/print-service.ts:166` — `group.items.map((item) => ({ packageId: item.packageId, ... }))`
   - `src/lib/print/print-service.ts:438` — `items.map((item) => [item.packageId, item.sortKey])`
   - `src/lib/fulfillment/package-board.ts:222` — `box.printItems.map((item) => ({ batchId: item.group.batch.id, ... }))`

   Each is a `PrintBatchItem` row; name it `printItem` / `batchItem` so the reader sees what kind of item. The collection names (`items`, `printItems`) are fine; only the loop variable is flagged.

4. **Per-order reprint creates a `REPRINT` batch with no `supersedesBatchId`** — `src/lib/print/print-service.ts:219-240`
   The `PrintBatch` schema comment (`prisma/schema/printing.prisma:11-13`) states the invariant: "A reprint is a new batch pointing at the one it came from (`supersedesBatchId`) rather than an edit of it." `reprintGroup` honors it (sets `supersedesBatchId: input.batchId` on both the row and the `print.batch_created` audit detail). `reprintOrder` sets `kind: 'REPRINT'` and labels it "Reprint — order #N" but leaves `supersedesBatchId` null on the row and omits it from the audit detail. An order's boxes can be spread across multiple nightly batches (or none), so there is no single source — but then the row is a REPRINT that points at nothing, and "which nightly batches did this order's paper come from" is only answerable by joining `PrintBatchItem` by `packageId`. Either keep the invariant (pick a source, or record the set in the audit detail) or document the exception in the schema comment. The smoke check `S3d` asserts `kind === 'REPRINT'` but not the link, so the gap is not caught.

## Rules adherence scoreboard

| Rule | Verdict |
|---|---|
| `ponytail` (ladder, anti-bloat) | Strong. Hand-written PDF writer with a one-line justification instead of a dep; no new packages; `bulk-report.ts` extracted with 2 call sites; `paths.ts` is URL-as-state for one concern (7 cohesive exports, not a grab-bag). |
| `clean-code` (naming, comments, error handling, dead code) | Three `item` loop variables (finding 3); one comment with corrupted text (finding 2). Comments elsewhere are intent-bearing; no narration; no swallowed errors; `Result<T>` is the one error shape. |
| `workflow` (verify in running app, gates, security, no BOM) | Strong on verification — `scripts/smoke-p7.ts` drives the real app over HTTP, reads the DB after, runs the unit-test file by name, and runs `npm run ci`; `fulfillment.manage` is re-checked inside every server action and on both PDF routes (S3e confirms a driver gets 403 on the page and the PDF). One BOM regression (finding 1). |
| `vocabulary` | No command words issued in this delta; n/a. |
| `codegraph` | Not evaluable from the delta alone; no grep-for-structure evidence in P7 files. |

## Counts

- blocker: 0
- major: 0
- minor: 4
