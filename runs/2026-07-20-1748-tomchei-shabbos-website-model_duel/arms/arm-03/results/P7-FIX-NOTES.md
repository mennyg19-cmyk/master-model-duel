# P7 Fix Notes — arm-03

**Phase:** P7 fix pass (aggregate AGGREGATE-REVIEW-P7.md)  
**Smoke after fix:** 16/16 PASS (`PHASE-P7-SMOKE.md`)  
**Workspace only** — no git, no run-root results.

## Fixed (blockers)

| ID | Fix |
|---|---|
| **B1** | Dev auth no longer trusts `x-dev-user-id`. Cookie-only identity; allowlisted to `DEV_*_USER_ID` env values; `NODE_ENV=production` fails closed; `/api/dev/session` sets `httpOnly` cookie and rejects non-allowlisted ids. |
| **B2** | Confirmed/kept: `GET /api/admin/packages` always scopes via `getCurrentSeason()` → `listPackages({ seasonId })`. |
| **B3** | Confirmed/kept: `POST … action=stage` uses `bulkAdvancePackageStage` with `seasonId` + `assertMethodTerminal`. |
| **B4** | Confirmed/kept: regroup requires season-scoped locks + matching grouping key. |
| **B5** | Confirmed/kept: `getPackageDetail(seasonId, id)` season filter. |
| **B6** | Confirmed/kept: split via ops engine with season lock. |
| **B7** | Print-batches POST schema **drops** client `seasonId`; always uses current season. |
| **B8** | Confirmed/kept: `reprintOrder` requires `order.seasonId ===` current season. |
| **B9** | Dead `bulk-stage` methodId phantom-audit path remains **410 Gone**; live path is ops `bulkAdvancePackageStage` (lock + version + packageAuditLog + AuditLog). |
| **B10** | Confirmed/kept: `assertMethodTerminal` on `transitionPackage` + `bulkAdvancePackageStage` (PICKUP→PICKED_UP only). |
| **B11** | Live print uses `renderPdf` + `LABEL_4X6` / `CARD_5X7` / `LETTER` (`ops/print-batch.ts` → `lib/pdf.ts`). |
| **B12** | Same path: WinAnsi/`latin1` escaping via `lib/pdf.ts` (not raw UTF-8 in `(…)`). |
| **B13** | Deleted dead parallel `lib/packages/actions.ts`. Single engine: `lib/ops/packages.ts`. Duplicate routes already 410. |
| **B14** | Deleted dead `lib/print/batches.ts` (+ orphaned `render.ts` / `payload.ts`). Single engine: `lib/ops/print-batch.ts`. |
| **B15** | Deleted dead `lib/print/pdf.ts` (`buildSimplePdf`). Sole PDF writer: `lib/pdf.ts`. |
| **B16** | Resolved by deleting actions engine (divergent regroup/split rules gone). |
| **B17** | Stage transitions: live = `transitionPackage` + `bulkAdvancePackageStage` only; actions `advancePackageStage` deleted. |
| **B18** | Shared row locks in `lib/orders/lock.ts` (`lockOrderForUpdate`, `lockPackageRow`, `requirePackageInSeasonLocked`, `lockPaymentForUpdate`); package-stages/ops/refunds reuse them. |
| **B19** | Extracted `zipBlockedConflict()` in `lib/checkout/validation.ts`; all three session sites use it. |

## Fixed (critical majors prioritized)

| ID | Fix |
|---|---|
| **M1** | `FulfillmentActions` already absent (no file). |
| **M2** | Print UI: empty `packageStages` no longer vacuously sets `stillUnshipped=true`; falls back to `stagesUnchanged`. API already returns `packageStages`. |
| **M3** | Same as B9 — deprecated bulk-stage 410; live bulk audits correctly. |
| **M4** | `reprintFilingGroup` excludes `SENT`/`PICKED_UP` stages. |
| **M5** | Confirmed/kept: `fulfillmentChannelDashboard(seasonId)` season-scoped. |
| **M6** | Removed dead “create channel on the fly” branch. |
| **M7/M8** | Deleted dead `lib/packages/board.ts` (`void itemGroups` gone with it). |

## Skipped (with why)

| ID | Why skipped |
|---|---|
| **M9** | Shared PackageInclude type — cleanup only; not security/drift blocker after dead engines deleted. |
| **M10** | STATUS doc ASCII claim — ops path already uses `->`; actions (Unicode) deleted. Doc-only residual. |
| **M11–M18** | Clean-code debt (formatting, pagination dupes, formatCents, writeAudit coverage, god files, AddressFields) — not P7 gate blockers; deferred. |
| **M19** | Coarse `admin.access` permissions — product/plan (UR-012) beyond P7 fix scope. |
| **M20** | Reprint rate-limit / storage DoS hardening — deferred (idempotent fingerprints already reduce regen spam). |
| **M21** | Single live bulk pattern remains (`bulkAdvancePackageStage`); channel `updateMany` path gone with 410. |
| **m1–m11** | Minors (artifact IDOR polish, Cache-Control, greeting-card always-on, smoke gaps) — not required for this pass. |

## Files touched (high level)

- `src/lib/auth.ts`, `src/app/api/dev/session/route.ts`
- `src/app/api/admin/print-batches/route.ts`
- `src/lib/ops/packages.ts`, `src/lib/ops/print-batch.ts`, `src/lib/ops/refunds.ts`
- `src/lib/orders/lock.ts`, `src/lib/orders/package-stages.ts`
- `src/lib/checkout/validation.ts`, `src/lib/checkout/session.ts`
- `src/components/admin/print-batches.tsx`
- **Deleted:** `lib/packages/actions.ts`, `lib/packages/board.ts`, `lib/print/{batches,pdf,render,payload}.ts`

## Smoke

Re-ran `npm run smoke:p7` → **16/16 PASS**. Evidence refreshed in `PHASE-P7-SMOKE.md` / `.json`.
