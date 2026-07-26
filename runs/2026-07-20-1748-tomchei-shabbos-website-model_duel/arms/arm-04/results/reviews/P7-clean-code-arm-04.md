# P7 Clean-Code Review — arm-04 (blind)

Scope: P7 fulfillment/print delta in `arms/arm-04/workspace/` (new files under `src/lib/print/`, `src/lib/fulfillment/`, `src/app/(admin)/admin/fulfillment/`, `src/app/(admin)/admin/orders/[orderId]/print/`, `prisma/schema/printing.prisma`, plus the modified `orders/bulk-actions.ts`, `audit.ts`, `permissions.ts`, `dates.ts`, `package-stages.ts`, `packages.ts`, `nav-items.ts`, `orders/[orderId]/page.tsx`, `orders/actions.ts`, `orders/page.tsx`, `tests/admin-ops.test.ts`).
Findings only — no fixes. No model names; arm id only.

## Summary

- Blocker: 0
- Major: 2
- Minor: 6

## Major

### M1 — God file: `src/lib/print/print-service.ts` mixes 6 concerns
`src/lib/print/print-service.ts:1-454` is 454 lines (under the 500-line trigger) but trips the "mixed concerns" trigger in `clean-code.mdc` (split when >500 lines **or mixed concerns**). It owns: nightly batch build (`buildNightlyBatch`), group reprint (`reprintGroup`), order reprint (`reprintOrder`), group render (`renderGroupArtifact`), order render (`renderOrderArtifact`), batch read/list (`readBatch`, `listRecentBatches`, `countWaitingToPrint`), plus private filing helpers (`groupCreateInput`, `readInFilingOrder`, `fileNameFor`) and the `BatchRow`/`BatchGroupRow`/`PrintedDocument` types. The render path and the batch-build/reprint path do not share state beyond `readPrintablePackages`; splitting (e.g. `print-batch-service.ts` for build/reprint/read + `print-render.ts` for the two render fns + `print-filing.ts` for `groupCreateInput`/`readInFilingOrder`/`fileNameFor`) would give each file one reason to change.

### M2 — Encoding regression: UTF-8 BOM + mojibake em-dash introduced in `tests/admin-ops.test.ts`
The P7 edit introduced a UTF-8 BOM at the start of `tests/admin-ops.test.ts` (bytes `EF BB BF` confirmed via `Get-Content -Encoding Byte -TotalCount 3` → `239,187,191`) and replaced a previously valid em-dash with mojibake `â€"` in the file-header comment (diff shows `— every read is` → `â€" every read is`, around `tests/admin-ops.test.ts:30`). `workflow.mdc` (Shell execution / Windows) and `deploy-awareness.mdc` require UTF-8 no BOM for Windows-authored files; the mojibake is a readback artifact of saving the file as UTF-8-with-BOM in one editor round-trip. Re-save as UTF-8 no BOM and restore the em-dash.

## Minor

### m1 — `formatDate` has a single call site (Rule of 2)
`src/lib/core/dates.ts:13` exports `formatDate`, used only at `src/lib/print/print-service.ts:58` for the nightly-batch label. `clean-code.mdc` Rule of 2 requires 2+ real call sites now, not "might be useful later." Inline the `Intl.DateTimeFormat` call at the print-service site, or wait for a second caller before promoting it to `dates.ts`.

### m2 — Duplicated print-links UI across order page and package page
`OrderPaper` in `src/app/(admin)/admin/orders/[orderId]/page.tsx:242-274` and the "Paper" card in `src/app/(admin)/admin/fulfillment/packages/[packageId]/page.tsx:122-138` both render the same chunk: `PRINT_ARTIFACTS.map((artifact) => <Link href={orderArtifactPath(orderId, artifact)} …>{ARTIFACT_LABELS[artifact]}</Link>)`. `clean-code.mdc` flags duplicated UI for extraction; a small `OrderPrintLinks({ orderId })` component would dedupe the link list (the package page's filings list and the order page's reprint button stay where they are).

### m3 — Two `version`/`readVersion` form parsers with divergent fallback
`src/app/(admin)/admin/fulfillment/actions.ts:175` `version(formData)` returns `0` on invalid input (relying on `updateMany` refusing the row). `src/app/(admin)/admin/staff/actions.ts:148` `readVersion(formData)` returns `null` on invalid input (caller rejects with `INVALID_SUBMISSION`). Same intent — pull the optimistic-concurrency stamp off `FormData` — two implementations. A shared `readVersionStamp(formData): number | null` in `lib/forms/` with each caller choosing its own reject path would remove the drift.

### m4 — Two functions named `destinationOf` in the same feature, different behavior
`src/lib/fulfillment/package-board.ts:240` `destinationOf(box)` returns a display string (`"Pick up at …"` or `addressSummary(…)`). `src/lib/fulfillment/package-edit.ts:220` `destinationOf(source)` returns a `Pick<Package, …>` of the destination columns for `package.create`. Same name, same feature folder, different return contract. Rename one (e.g. `destinationFieldsOf` for the edit path) so grep lands on the right concern.

### m5 — `editPackageAction` silently treats unknown `intent` as `split`
`src/app/(admin)/admin/fulfillment/actions.ts:138-168` branches on `intent === 'move'` and otherwise falls through to `splitPackage`. The form posts two known intents (`split`, `move`), but a crafted POST with `intent=foo` (or a future third button whose wiring forgets to add a branch) silently splits. Validate `intent` against `['move','split']` and reject anything else back to the package screen, the way `stageSchema` already does for `stage`.

### m6 — `readBoardFilters` URL-vs-internal naming drift
`src/lib/fulfillment/package-board.ts:42-54` reads the URL param `channel` and stores it on `BoardFilters` as `methodId`; the board page (`packages/page.tsx:71-76`) then re-exposes `methodId` as `channel` in the query string. The URL/user-facing word is "channel," the internal field is "methodId." Not wrong (UI label vs domain noun), but the indirection is one grep can't follow without reading the function. A short comment on `BoardFilters.methodId` noting "from the `channel` URL param" would close it; or rename the field to `channelMethodId`.

## Notes (not findings)

- `src/lib/admin/bulk-report.ts` consolidation of the old `orders/bulk-actions.ts` `BulkReport`/`boundedIds`/`summarizeBulk`/`firstFewOutcomes` is a clean dedupe — the order desk and the package board now share one bulk-report contract. `BulkRecord.orderId` → `BulkRecord.id` rename is consistent across all call sites; no stale `record.orderId` references remain (verified by grep).
- `package-stages.ts` `stageLabel` is a single call site helper too, but it has 4+ call sites across the new fulfillment UI (board, package detail, batch, bulk bar), so it clears the Rule of 2.
- `print/pdf.ts` is a hand-written PDF writer (no dep) — consistent with `ponytail.mdc` ladder (stdlib/native/existing-deps before a new package); the file documents why no library.
