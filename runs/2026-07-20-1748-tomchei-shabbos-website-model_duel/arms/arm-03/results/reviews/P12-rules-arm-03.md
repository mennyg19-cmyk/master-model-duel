# P12 Rules review — arm-03

**Phase:** P12 — Reports, exports, money ops, harden scale
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Scope:** P12 deliverables (multi-season reports + margin, CSV export center + audit, Stripe reconcile manual + cron, legacy import dry-run/resume/ORDERS + address cleanup, test console + test-mode banner + help/entity map, dress rehearsal E2E + nightly scale + wipe/reseed, refunds, pagination/concurrency hardening). Findings only — no fixes applied.
**Smoke:** 4/5 PASS (S3 Legacy import FAIL).

## Summary

P12 ships working reports, exports, reconcile, refunds, imports, and test-ops (S1, S2, S4, S5 green), but the reports/exports/reconcile layer is built **twice over** with divergent semantics, three complete lib files are dead (zero importers), two cron routes do the same job, and the legacy-import commit path silently chooses business logic (hardcoded dates, magic greeting, fallback fulfillment method, no Payment row for "paid" imports). Exports hard-cap rows with no pagination despite the phase deliverable naming pagination. Permission model is inconsistent across money/data routes. Violates `clean-code` (one pattern per concern, dead code, type/schema drift, anti-hallucination, swallowed errors) and `ponytail` (no boilerplate, deletion over addition, Rule of 2). `workflow` gate discipline held (status file written, smoke run, refunds idempotent + compensating). `codegraph` not used in this review pass.

## Findings

### R-1 — Two parallel implementations of reports / exports / reconcile (clean-code: one pattern per concern; ponytail: no boilerplate, Rule of 2)

Same P12 concerns implemented twice with different semantics:

| Concern | Live path (wired to routes) | Dead/competing path |
|---|---|---|
| Performance report | `src/lib/ops/reports.ts` → `performanceReport` | `src/lib/reports/performance.ts` → `buildPerformanceReport` (unused) |
| Margin report | `src/lib/ops/reports.ts` → `marginReport` | `src/lib/reports/margin.ts` → `buildMarginReport` (unused) |
| CSV export | `src/lib/ops/exports.ts` → `runCsvExport` | `src/lib/exports/center.ts` → `runExport` (unused) |
| Payment reconcile | `src/lib/ops/reconcile.ts` → `runPaymentReconcile` (admin + cron) | `src/lib/payments/reconcile.ts` → `runPaymentReconciliation` (cron) |

The two reconcile copies have different matching logic, different fingerprint schemes, and different orphans shapes (see R-5, R-6). The dead reports/exports copies have different column sets and CSV line endings (`ops/exports` uses `\n` no BOM; `exports/center` uses `\r\n` + BOM). Two strategies for each concern in the same phase.

### R-2 — Dead code: three unused parallel lib files (clean-code: dead code; ponytail: deletion over addition)

`src/lib/reports/performance.ts`, `src/lib/reports/margin.ts`, `src/lib/exports/center.ts` have **zero importers** (grep for `from "@/lib/reports/performance"`, `from "@/lib/reports/margin"`, `from "@/lib/exports/center"` → no matches). They are complete alternative implementations left in the tree. `exports-client.tsx` has a local `runExport` function that is not an import of `lib/exports/center`.

### R-3 — Two reconcile cron routes for the same job (clean-code: one pattern per concern; inconsistent patterns)

`src/app/api/cron/stripe-reconcile/route.ts` and `src/app/api/cron/payment-reconcile/route.ts` are near-identical route handlers (GET + POST, same `beginCronRun`/`finishCronRun` wrapper) calling different lib functions. Smoke S2 exercises both (`recon1`, `recon2`). Which is canonical is undefined; both are wired to cron.

### R-4 — Permission model inconsistency across money/data routes (clean-code: one pattern per concern)

- `api/admin/reports` GET → `admin.access`
- `api/admin/exports` GET/POST → `settings.write`
- `api/admin/reconcile` GET/POST → `settings.write`
- `api/admin/orders/[id]/refund` POST → `admin.access`
- `api/admin/orders/bulk` POST → `admin.access`

Read-only data extraction (exports) requires a write permission (`settings.write`), while refunds (actual money movement) require only `admin.access`. Reconcile (writes adjustment rows) and exports (read) share the same permission. No single pattern for "who can touch money / who can read money data."

### R-5 — `lib/ops/reconcile.ts` is weaker and wired to the admin UI (clean-code: anti-hallucination; ponytail: pick one)

`runPaymentReconcile` (ops) reads only local `db.stripePaymentIntent` rows — it cannot detect orphans Stripe knows about but local doesn't, and uses a plain-string fingerprint `orphan:${id}`. `runPaymentReconciliation` (payments) calls Stripe (or mock-mode local rows) and uses a sha256 fingerprint. The admin UI (`api/admin/reconcile` POST) calls the weaker ops version; the cron calls the stronger payments version. A manual reconcile from the admin panel produces different results than the cron run for the same data.

### R-6 — `ReconcileResult` type/schema drift between the two reconcile files (clean-code: type/schema drift)

`lib/ops/reconcile.ts` `ReconcileResult.orphans`: `{ stripePaymentIntentId, orderId, amountCents, status }`. `lib/payments/reconcile.ts` returns `orphans: { stripePaymentIntentId, amountCents }`. Different shapes for the same concept. `ops` also exposes both `adjustedCount` and `createdAdjustments` set to the same value — redundant fields.

### R-7 — `commitOrderRow` silently chooses business logic (workflow: never silently choose business logic — log in DECISION-LOG)

- `placedAt: new Date("2025-03-01T12:00:00Z")` — hardcoded magic date for all imported historical orders.
- `greeting: "Imported historical"` — magic string.
- Fulfillment method lookup falls back to `tx.fulfillmentMethod.findFirst()` (any method) when listed codes don't match — silent default, no audit/DECISION-LOG entry.
- `expectedTotalCents: product.basePriceCents * qty` — ignores shipping/delivery charges and add-ons; imported totals don't match a real checkout. No note that this is intentional.

### R-8 — `commitImport` dry-run conflates status with real commits (clean-code: anti-AI-tics; workflow: verify in running app)

In dry-run mode, rows are marked `COMMITTED` and the batch status becomes `COMMITTED` even though no entities were written. A dry-run batch is indistinguishable from a real commit by status alone (only the `dryRun` boolean differs). Smoke S3 shows `dryCommitted: 0, resumed: "COMMITTED"` — the dry-run produced 0 valid rows, so moot for S3, but the conflation is latent.

### R-9 — `commitImport` address-book upsert is outside the order transaction (clean-code: error handling; data integrity)

`commitOrderRow` runs inside `db.$transaction`, but the follow-up `upsertCustomerAddress` for ORDERS commits is called outside the tx (`src/lib/ops/import.ts:631`). If the address upsert fails, the order is committed but the address book isn't updated — partial state, no compensation.

### R-10 — `commitOrderRow` marks imported orders PAID with no Payment row (clean-code: anti-hallucination; data integrity)

Imported historical orders are written with `status: PAID`, `paymentStatusCached: PAID`, but no `Payment` record is created. The reconcile matcher treats "order paid" as matched, so these slip through, but the data model says a paid order should have posted payments. Reconcile would flag any imported order that loses its `PAID` cache as an orphan. Silent schema shortcut.

### R-11 — Exports hard-cap rows with no pagination (clean-code: anti-AI-tics; P12 deliverable: pagination)

`runCsvExport` / `buildDataset` use `take: 50_000` (or 20_000) on every dataset. P12's deliverable explicitly includes "Batch tools / pagination / concurrency hardening for 1k orders / 5k packages." There is no pagination/cursor — just a hard cap that silently truncates larger datasets. No warning returned to the caller and no flag in the audit row when the cap is hit.

### R-12 — `buildDataset` default case returns a CSV with an "error" column (clean-code: swallowed errors)

`src/lib/ops/exports.ts:160` — `default: return { headers: ["error"], rows: [["unknown dataset"]] };`. The zod `z.nativeEnum(ExportDataset)` should prevent reaching default, but if it does, the function returns a 200 CSV with an "error" column rather than throwing or returning an `err`. Swallowed error path. `lib/exports/center.ts:217` does the same with empty rows.

### R-13 — `api/admin/reconcile` POST schema is decorative (clean-code: anti-AI-tics — no "just in case" code)

`postSchema = z.object({ action: z.enum(["run"]).default("run") })` parsed via `request.json().catch(() => ({}))`. The body is never used — `runPaymentReconcile` is called unconditionally. The schema + catch swallows JSON parse errors and validates a body that has no effect. Dead validation.

### R-14 — `commitImport` resume is not self-healing on a crashed commit (clean-code: data integrity)

On resume (INTERRUPTED), `pending` filters rows with `rowNumber > commitCursor` and status in {VALID, DUPLICATE, INVALID}. If a previous run crashed after a `commitOrderRow` tx committed but before the row was marked COMMITTED, the row stays VALID and `commitCursor` wasn't advanced (the batch `commitCursor` update is at the end, outside the row tx). On resume the row is reprocessed → `commitOrderRow` throws P2002 → caught at top level → returns `err("P2002", "Import hit a duplicate key — retry after refresh.")`. The batch is left stuck; no auto-skip of the already-committed row. Recoverable by manual intervention but not self-healing.

### R-15 — BOM handling asymmetric between export and import (clean-code: consistency)

`lib/exports/center.ts` writes a UTF-8 BOM (`\uFEFF`) for Excel-friendliness; `lib/ops/exports.ts` does not. `parseCsv` in `lib/ops/import.ts` does not strip a leading BOM, so a CSV re-imported from the BOM-writing export would have `\uFEFFdisplayName` as the first header cell and miss the `displayName` column. Two export paths, one import path, inconsistent BOM contract.

### R-16 — `codegraph` not used for structural lookup during P12 review (codegraph rule)

Same as P7 R-10 — process note for this review pass, not a product defect. Index exists under `workspace/`; this review used Read + Grep over the reports/exports/reconcile/import tree.

## Rule-by-rule score

| Rule | Adherence | Notes |
|---|---|---|
| ponytail | **Partial** | Ladder respected (no new deps, stdlib crypto/csv). Violated by duplicated implementations (R-1), dead code (R-2), decorative schema (R-13). |
| clean-code | **Partial** | R-1 (one pattern per concern), R-2 (dead code), R-4 (permission pattern), R-5/R-6 (drift), R-7/R-10 (anti-hallucination), R-9 (data integrity), R-11 (pagination), R-12 (swallowed errors), R-13 (just-in-case code), R-14 (resume), R-15 (BOM consistency). Naming mostly clean in P12 surface. |
| workflow | **Pass (with caveat)** | Gate discipline held: P12 status file written, smoke run and reported, refunds idempotent with row lock + Stripe Idempotency-Key + compensating claim. Caveat: S3 blocker unresolved and silent business logic in `commitOrderRow` (R-7, R-10) not flagged in DECISION-LOG. |
| vocabulary | **N/A** | No refactor/tidy/rebuild commands issued in P12 build. |
| codegraph | **N/A for product** | Index exists; not used in this review pass (R-16). |

## Net

P12 ships working smoke-grade reports, exports, reconcile, refunds, and imports (4/5 green), but the reports/exports/reconcile subsystem is built twice with divergent semantics, three lib files are dead, two cron routes do the same job, and the legacy-import commit path silently hardcodes dates/greeting/fulfillment and writes "paid" orders with no Payment row. Exports hard-cap rows with no pagination despite the phase deliverable naming it. Deleting the dead `lib/reports/*` and `lib/exports/center.ts`, collapsing to one reconcile implementation + one cron route, fixing the permission model, and replacing the export hard-cap with cursor pagination would remove the bulk of the findings; the S3 legacy-import blocker needs the classifier to produce at least one VALID row before dry-run.
