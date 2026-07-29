# P7 Clean-code review — arm-06

**Phase:** P7 — Package engine live (per `shared/phases/PHASE-P7-EXPECTED.md`)
**Rule source:** `arms/arm-06/.cursor/rules/clean-code.mdc`
**Scope:** new and modified files under `arms/arm-06/workspace/` for P7
**Mode:** findings only, no fixes. Blind to model name.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 7 |

## Major

### M1 — Terminal-stages list hardcoded three ways (magic values + duplicated logic + pattern drift)
`["SENT", "PICKED_UP"]` is spelled out in three independent places with three different shapes, while the schema already carries a data-driven `FulfillmentMethod.terminalStage` that `lib/packages/moves.ts` and the package detail page use correctly:

- `lib/packages/print-batches.ts:20` — `const TERMINAL_STAGES = ["SENT", "PICKED_UP"] as const;` (used twice in the same file)
- `app/(admin)/admin/fulfillment/page.tsx:15` — `const TERMINAL: PackageStage[] = ["SENT", "PICKED_UP"];`
- `lib/packages/fulfillment.ts:81` — inline `pkg.stage !== "SENT" && pkg.stage !== "PICKED_UP"`

`lib/packages/stages.ts` already owns the `PACKAGE_STAGES` enum list; the terminal set belongs there too (or derived from the enum). The hardcoded list silently breaks the moment a future method declares a different `terminalStage`, and the three copies can drift from each other. Violates: magic values, duplicated logic, one-pattern-per-concern.

### M2 — `pdf-lib` pinned with a caret range
`package.json` adds `"pdf-lib": "^1.17.1"`. Every other dependency in this file is exact-pinned (`next: "15.5.22"`, `clsx: "2.1.1"`, `react: "19.2.8"`, …). The clean-code rule explicitly says "Pin versions — no floating ranges." Caret also drifts from the project's own convention. Re-pin to an exact version.

### M3 — Filing sort duplicated in `lib/print/pdf.ts` with dropped tiebreaker
`lib/packages/print-batches.ts:26-33` defines `sortForFiling` (recipientName → orderNumber → id). `lib/print/pdf.ts:101-105` re-implements the same sort inline but drops the `id` tiebreaker:

```101:105:arms/arm-06/workspace/lib/print/pdf.ts
  packages.sort(
    (a, b) =>
      a.recipientName.localeCompare(b.recipientName) ||
      ((orderById.get(a.orderId)?.orderNumber ?? 0) - (orderById.get(b.orderId)?.orderNumber ?? 0)),
  );
```

The nightly batch's stated contract is "the same batch always produces the same report, row for row." Two packages on the same order with equal recipient names now sort nondeterministically in the PDF while the persisted batch order is deterministic. `sortForFiling` should be exported and reused. Violates: duplicated logic, copy-paste-with-minor-variation.

## Minor

### m1 — Bulk-action scaffold duplicated between orders and packages
`lib/packages/bulk.ts` (`runBulkPackageAdvance`) is a near-verbatim structural copy of `lib/orders/bulk.ts` (`runBulkOrderAction`): limit check → open-season check → trim/dedupe candidate ids → scoped `findMany` → `seen` set loop → per-row try/catch with an instanceof error allow-list → count by outcome. Differences are the action type, the extra `PackageConcurrencyError` in the catch list, and the outcome labels. A shared `runBoundedBulkAction` helper (generic over id type, error list, and per-row step) would remove ~80 lines of duplication. Left as Minor because the two are stable and the abstraction needs generics/callbacks to stay honest.

### m2 — Cron nightly-print route skips the try/`mapDomainError` pattern
`app/api/cron/nightly-print/route.ts` calls `runNightlyPrintBatch()` with no try/catch, while every staff POST route in P7 (`bulk`, `print-batches`, `reprint`, `advance`, `split`, `regroup`) wraps the call in `try { … } catch (error) { const mapped = mapDomainError(error); if (mapped) return mapped; throw error; }`. A `DomainRuleError` ("No open season…") from the cron path becomes a raw 500 instead of a mapped response. `runNightlyPrintBatch` does record a FAILED `CronRun` before rethrowing, so the audit trail is intact, but the error-mapping discipline is inconsistent.

### m3 — Banned standalone names (`data`, `item`, `result`)
The clean-code rule bans `data`, `result`, `info`, `temp`, `val`, `item`, `thing` as standalone names. P7 introduces:
- `data: BatchPrintData` in `renderSlipsPdf` / `renderLabelsPdf` / `renderCardsPdf` / `renderBatchPdf` (`lib/print/pdf.ts`)
- `(item) => item.packageId` in `lib/packages/fulfillment.ts:60`, `(item) => ({…})` in `lib/print/pdf.ts:75`, `(item) => (…)` in `app/(admin)/admin/packages/[packageId]/page.tsx:111`
- `results.filter((result) => result.outcome === …)` in `lib/packages/bulk.ts:83-84`

Rename to domain nouns (`batch`, `batchItem`, `row` / `r`).

### m4 — Undocumented magic numbers
- `take: 10` for recent batches (`fulfillment/page.tsx:47`) and `take: 25` for package events (`packages/[packageId]/page.tsx:38`) — no named constant, no comment.
- In `lib/print/pdf.ts`, `centered` uses `36` for both the margin guard (`this.y < 36`) and the wrap width (`this.pageSize[0] - 2 * 36`), while `line` uses `MARGIN = 54`. Two margin constants for the same page is drift; pick one or name both.
- `wrap` uses `size * 0.48` (char-width estimate), `line` uses `size * 1.35` (line spacing), `centered` uses `size * 1.5`. None are named or commented; they're load-bearing for layout.

### m5 — Defensive `?? []` for a method that cannot be missing
`lib/packages/fulfillment.ts:84` does `const stages = methodStages.get(pkg.fulfillmentMethodId) ?? [];`. `methodStages` is built from `prisma.fulfillmentMethod.findMany({})` (no filter), and `Package.fulfillmentMethodId` is a non-nullable FK, so every package's method is in the map. The fallback silently reclassifies a phantom package into "to pack" instead of "to print." The rule: "No defensive code for conditions that can't happen." Throw or drop the `?? []`.

### m6 — `PrintBatch.createdById` is a loose string, no relation to `StaffUser`
`prisma/schema.prisma` adds `createdById String?` on `PrintBatch` with no `@relation` to `StaffUser`, while the rest of the schema models staff attribution via relations (e.g. `Order` / audit rows). The staff POST routes populate it with `gate.ctx.staff.id`, but nothing enforces referential integrity. Either add the relation or document why this denormalization is intentionally loose.

### m7 — Batch timestamp formatting duplicated
`createdAt.toISOString().slice(0, 16).replace("T", " ")` appears in `fulfillment/page.tsx:146` and `packages/[packageId]/page.tsx:115` (and the same page's event trail uses the same expression again at line 159). Extract a `formatBatchTimestamp(date)` helper next to `CHANNEL_LABELS` / the batch read model.

## Notes (not findings)

- `PackageStageBadge` correctly extends the existing badge language; new admin pages reuse `Card`, `Button`, `Input`, `Select`, `Label`, `PaginationNav`, `BackLink`, and the `text-2xl font-semibold` header convention.
- The packages list page's raw `<button class="bg-brand-700 …">` Apply button matches the pre-existing `orders/page.tsx` list-filter convention, so it is consistent, not drift.
- `filingGroupForChannel(channel)` is a one-line identity, but it names a concept used in three places and satisfies the rule-of-2; leaving it is fine.
- `lib/packages/board.ts` correctly reuses `first` / `parsePageSize` from `lib/admin/order-list` rather than re-parsing search params — good single-pattern discipline.
