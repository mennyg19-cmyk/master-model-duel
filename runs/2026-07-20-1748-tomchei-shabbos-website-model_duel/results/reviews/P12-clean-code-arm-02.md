# Reviewer specialist — Clean-code

**Arm:** `arm-02`
**Tree / phase:** `arms/arm-02/workspace/` — P12 (Reporting, exports, reconciliation, legacy migration, scale hardening, launch readiness)
**Output:** `results/reviews/P12-clean-code-arm-02.md`
**Scope:** P12 deliverables only — `lib/legacy-import.ts`, `lib/exports.ts`, `lib/reports.ts`, `lib/payments/reconcile.ts`, `lib/test-console.ts`, `lib/test-mode.ts`, `lib/cron.ts`, `lib/csv.ts`, the `app/api/admin/{exports,legacy-import,reconciliation,test-console}` routes, the `app/api/cron/*` routes, the `app/(admin)/admin/{reports,exports,test-console,import,help}` pages, `app/(admin)/admin/layout.tsx`, `app/(storefront)/layout.tsx`, and the `components/admin/{legacy-import-client,recon-panel,test-console-client}` + `components/test-mode-banner` components.
**Rule applied:** `arms/arm-02/rules/clean-code.md` (clean-code is in arm rules).
**Posture:** Findings only, no fixes. Blind to model name.

---

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 6 |
| Low | 8 |
| **Total** | **15** |

The P12 surface is mostly disciplined — one cron pattern (`requireCronAuth` → `runCronJob` → `Response.json`) is applied consistently across all six cron routes, the export center streams via an async generator instead of buffering, and the reconciliation matcher is idempotent on a unique reference. The findings cluster around one god file (`lib/legacy-import.ts`), one duplicated helper (`isUniqueViolation`), one copy-pasted pagination loop, and UI/text-consistency drift in the test-mode banner and the reports page.

---

## High

### H1 — Mojibake em-dashes in user-facing reports page
`app/(admin)/admin/reports/page.tsx:79, 175`

The em-dash is stored as double-encoded mojibake bytes, not as `—`. Byte dump of line 175 confirms the literal sequence `â€"` (and `â€"` on line 79) is in the source, not a render artifact. Both are in user-visible text:

- Line 79: `<CardTitle>{drillSeason.seasonName} â€" drill-down</CardTitle>`
- Line 175: `{row.orderNumber ? \`#${row.orderNumber}\` : "â€""}`

Violates **UI Consistency** ("if a new screen looks different from the rest of the app, that's a bug") and is plain broken output in a manager-facing report. Every other admin page renders dashes correctly; this one is the outlier.

---

## Medium

### M1 — `lib/legacy-import.ts` is a god file (588 lines, mixed concerns)
`lib/legacy-import.ts:1-588`

The file bundles four distinct concerns: CSV column mapping/types, the pure `planLegacyImport` planner (parse + normalize + dedupe + repair), and the `commitLegacyImport` four-stage atomic committer (catalog → customers → addresses → orders, each its own `$transaction`), plus a stray `isUniqueViolation` helper. At 588 lines it crosses the 500-line split threshold and the "mixed concerns" threshold simultaneously. Split by concern: planner (`lib/legacy-import/plan.ts`) and committer (`lib/legacy-import/commit.ts`), with the shared types in an `index.ts` or `types.ts` colocated by concern.

### M2 — Duplicated `isUniqueViolation`, one export dead
`lib/legacy-import.ts:585` vs `lib/order-builder/draft-store.ts:108`

`lib/legacy-import.ts` exports `isUniqueViolation` with the comment "shared by callers," but **no file imports it** (grep across the workspace returns zero importers). Meanwhile `lib/order-builder/draft-store.ts:108` defines its own private copy and uses it at line 162. Two violations: (a) **Rule of 2** — the exported copy has zero real call sites and is dead code; (b) **duplicated logic** — the same Prisma `P2002` check exists in two places. Centralize one helper in `lib/` (e.g. `lib/db/prisma-errors.ts`) and have both call sites import it.

### M3 — Cursor-pagination loop duplicated across export datasets
`lib/exports.ts:26-59` (`deliveriesCsv`) and `61-85` (`yearEndCsv`)

Both generators contain the identical pagination skeleton:

```ts
let cursor: string | undefined;
for (;;) {
  const page = await db.X.findMany({
    where: ..., orderBy: { id: "asc" }, take: PAGE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: ...,
  });
  if (page.length === 0) return;
  for (const row of page) { yield csvLine([...]); }
  cursor = page[page.length - 1].id;
}
```

Only the `where`/`include`/row-shape differ. Violates **Anti-AI-Tics** ("No copy-paste patterns with minor variations — extract the pattern"). Extract a `paginateCsv<T>(findMany, formatRow)` helper. The other three datasets (`yearMetricsCsv`, `itemSalesCsv`, `lapsedCustomersCsv`) intentionally don't paginate (single aggregate queries), so the helper stays a 2-site extraction — meets Rule of 2.

### M4 — Empty if-branch with comment-only body in planner
`lib/legacy-import.ts:181-183`

```ts
if (customersByKey.has(key) && !emailValid) {
  // name-keyed rows collapse into the existing name-keyed customer
} else if (!customersByKey.has(key)) {
  customersByKey.set(key, { ... });
}
```

An empty positive branch whose body is a narration comment is a confusing control-flow shape — the reader has to infer that "do nothing" is the collapse case. Rewrite as a guard so the collapse is explicit (e.g. skip the `set` when the key already exists for non-email keys), instead of an empty branch that depends on a comment to mean anything. Borderline with **Comment Quality** (the comment narrates WHAT the code does *not* do).

### M5 — `wipeOpenSeason` deletes globally-unscoped tables, contradicting its own contract
`lib/test-console.ts:49-50, 56`

The function's header comment (lines 7-10) promises it "clears every transactional row for the open season ... but never touches the catalog, customers, staff, settings, or audit log." Yet three operations ignore `seasonId`:

- Line 49: `tx.stripeWebhookEvent.deleteMany({})` — wipes **all** webhook events, every season.
- Line 50: `tx.paymentReconFlag.deleteMany({})` — wipes **all** reconciliation flags, including ones staff already resolved for other seasons (and the audit log records those resolutions as historical).
- Line 56: `tx.inventoryItem.updateMany({ data: { reserved: 0 } })` — resets reservations across **all** inventory, not the open season's catalog.

Violates **Consistency** (one scope per operation) and the function's own documented contract. Test-only, so Medium not High — but a wipe that silently destroys another season's recon trail is a real correctness gap, not a stylistic one.

### M6 — Test-mode banner uses raw Tailwind amber; competing banner palettes
`components/test-mode-banner.tsx:10` vs `app/(admin)/admin/layout.tsx:55`

The test-mode banner hardcodes `bg-amber-400 text-amber-950`, while the rest of the app routes color through semantic theme tokens (`bg-accent`, `text-brand`, `border-border`, `bg-brand-soft`). The closed-store banner in `admin/layout.tsx:55` uses a *different* amber shade (`bg-amber-100 text-amber-900`), and the storefront closed-store banner (`app/(storefront)/layout.tsx:22`) uses `bg-accent text-white`. Three banners, three palettes. Violates **UI Consistency** ("No rogue styling — one styling approach per project") and **Consistency** ("one styling approach per project"). Pick one token (e.g. a `banner-warning` token) and route all status banners through it.

---

## Low

### L1 — Unreachable `|| "00000"` fallback in zip normalization
`lib/legacy-import.ts:289`

```ts
const safeZip = zipValid ? zipDigits : zipDigits.padStart(5, "0").slice(0, 5) || "00000";
```

When `zipDigits` is empty, `"".padStart(5,"0").slice(0,5)` already yields `"00000"`, so the `|| "00000"` tail can never execute. **Anti-AI-Tics** ("No 'just in case' code — every line must have a reason"). Drop the `|| "00000"`.

### L2 — Section narration comments in planner
`lib/legacy-import.ts:138, 221, 224, 227`

`// ---- customers: dedupe on email, then normalized phone, then exact name ----`, `// ---- products ----`, `// ---- addresses ... ----`, `// ---- orders ... ----` narrate WHAT the next block does. The dedupe-strategy comment at line 138 carries real intent (the precedence order is a constraint); the three bare section headers are narration. **Comment Quality** — drop the bare headers or fold them into function extraction.

### L3 — Forced `as unknown as …` / `as never` assertions to fit audit `detail`
`app/api/admin/legacy-import/route.ts:91`, `app/api/admin/reconciliation/route.ts:28`, `app/api/admin/test-console/route.ts:34`

- `result.completedStages as unknown as object`
- `summary as unknown as Record<string, number>`
- `detail as never`

These exist to satisfy `writeAudit`'s `detail` parameter shape. **Anti-AI-Tics** ("No redundant type assertions the compiler already guarantees") — the assertions paper over a too-narrow `detail` type. Widen `writeAudit`'s `detail` to `Prisma.InputJsonObject` (or `Record<string, unknown>`) once and drop the per-callsite casts.

### L4 — Server sends `orders` in dry-run report; client type omits it
`app/api/admin/legacy-import/route.ts:50-55` vs `components/admin/legacy-import-client.tsx:14-24`

The POST handler builds `report.orders = plan.orders.map(...)` and persists it on the `LegacyImportRun.report`. The client `DryRunReport` type has no `orders` field, so the field is silently dropped on the client and the type lies about the payload. **Type/schema drift** — single source of truth for the report shape is missing. Either consume `orders` in the UI or stop sending it.

### L5 — `resolveItem` skips the `busy`/error contract used by the other two actions
`components/admin/legacy-import-client.tsx:73-76`

`dryRun` (49-59) and `doCommit` (61-71) both toggle `busy`, clear `error`, and surface `outcome.error`. `resolveItem` fires the PATCH and `router.refresh()` with no busy state and no error surface — a failed resolve is silent. **Consistency** — one error-handling approach per component.

### L6 — `[1, 2].map(() => ({...}))` to create two identical order lines
`lib/test-console.ts:80`

```ts
create: [1, 2].map(() => ({ productId: product.id, unitPriceCents: product.basePriceCents, ... greeting: "A freilichen Purim!" })),
```

The array `[1, 2]` is a count-by-convention, not a range that varies per index — every element is identical. **Anti-AI-Tics** ("No over-verbose code that does in 10 lines what could be done in 3"). A single line with `quantity: 2` (or an explicit two-element literal) is clearer about intent.

### L7 — `: [[], []]` fallback loses element types
`app/(admin)/admin/import/page.tsx:24`

```ts
const [runs, reviewItems] = canLegacy ? await Promise.all([...]) : [[], []];
```

The empty-array fallback is inferred as `never[]`, so the subsequent `.map(...)` on `runs` and `reviewItems` type-checks loosely. **Type/schema drift** — annotate the fallback (`[] as RunRow[]`, `[] as ReviewItem[]`) or restructure so the non-legacy branch doesn't need the tuple at all.

### L8 — `usable` filter is O(n²) on invalidRows
`lib/legacy-import.ts:228-230`

```ts
const usable = records.filter(
  ({ line }) => customerKeyForLine.has(line) && !invalidRows.some((invalid) => invalid.line === line)
);
```

`invalidRows.some(...)` runs per record. Build `const invalidLines = new Set(invalidRows.map(r => r.line))` once and test membership. Quality/performance smell, not a correctness issue — the import is bounded by `MAX_IMPORT_ROWS = 5000`, so this is a Low.

---

## Notes (not findings)

- The cron route pattern is genuinely consistent: all six routes under `app/api/cron/*` use `requireCronAuth` → `runCronJob` → `Response.json({ ok: true, ...result })` and re-export `POST as GET` for Vercel. No drift.
- `lib/payments/reconcile.ts` is idempotent on a unique `reference` and refreshes open flags without duplicating — the comment at lines 130-131 explains a real trade-off, not narration.
- `lib/exports.ts` streaming via `AsyncGenerator` + `ReadableStream` `pull` is the right shape for the 5k-package deliveries export; the audit-on-stream-close at `app/api/admin/exports/[dataset]/route.ts:38-46` captures the real row count.
- `lib/reports.ts` uses aggregate SQL everywhere and explicitly avoids row-walking — matches the documented 1k-order scale posture.
