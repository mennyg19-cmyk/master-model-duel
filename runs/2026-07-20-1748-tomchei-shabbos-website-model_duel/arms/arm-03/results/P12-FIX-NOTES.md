# P12 Fix Notes — arm-03

**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness  
**Scope:** Fix pass from `AGGREGATE-REVIEW-P12.md` — M1–M3 + quick minors S2–S4 / F4 / F8  
**Ports:** web 3103 / db 4102 (embedded)  
**Smoke:** `npm run smoke:p12` → **5/5 PASS** (S1–S5)  
**CI:** `npm run ci` → **PASS** (lint, typecheck, migration:guard, 78 tests)

## Fixed IDs

| ID | Change |
|---|---|
| **M1** | Manual recon POST wrapped in `runCronJob("stripe-reconciliation")` (same overlap lock as cron → 409 on concurrent). Flag writes use `createMany({ skipDuplicates })` + open-flag `updateMany` instead of per-finding `create`. `useHubAct` gained a busy/in-flight guard; recon Run/Resolve buttons disable while busy. |
| **M2** | Legacy orders stage sets `orderCounter` to `Math.max(current, maxImported)` so a live order between dry-run and commit cannot rewind the counter. |
| **M3** | Legacy commit PUT wraps `commitLegacyImport` in `runCronJob(\`legacy-import:${runId}\`)` so concurrent PUTs skip with 409; crash mid-stage still resumes after the lock releases. |
| **S2 / m1** | Mock checkout: `guardPublicEndpoint` (same-origin + rate limit); `amountCents` override requires a staff session; logged-in customers must own the session’s order. |
| **S3 / m2** | `/api/setup` rate-limited (5 / 15 min / IP) before the bootstrap transaction. |
| **S4 / m3** | Name-only legacy customers without a usable name key on `name:line-{n}` so nameless rows no longer collapse onto one Customer. |
| **F4 / m6** | `formatCents` now uses `toLocaleString("en-US", { style: "currency" })`; reports page dropped its local `money()` helper. |
| **F8 / m10** | `lapsed-customers` export rewritten with a `last_orders` window CTE (no per-customer correlated season subquery). |

## Smoke result

```
PASS S1 Reports + margin
PASS S2 Exports + reconciliation
PASS S3 Legacy import
PASS S4 Imported repeat
PASS S5 Dress rehearsal
{"passed":5,"failed":0,"total":5}
```

## Not in this pass

Deferred per brief: **M4** (adminHandler season opt-in), **M5** (addressOf extract), **M6** (button patterns), **M7** (routes/service split), and remaining minors (m4–m5, m7–m9, m11–m15).
