# P10 Fix Notes — arm-03

**Phase:** P10 aggregate fix pass  
**Tree:** `arms/arm-03/workspace/`  
**Source:** `AGGREGATE-REVIEW-P10.md`  
**Smoke:** `npm run smoke:p10` → **3/3 PASS** (S1–S3)

## Fixed

| ID | Fix |
|---|---|
| **B1** | Added `/api/cron(.*)` to Clerk `isPublic` matcher in `src/middleware.ts` so bearer-authed cron handlers (`requireCronBearer`) run in production. |
| **B2** | `resolveTargetSeason` rejects non-OPEN preferred seasons and never falls back to CLOSED; `createDraftFromChoices` re-asserts `status === OPEN` before minting a draft (customer, staff single, bulk). |
| **B3** | `POST /api/admin/imports/prior-year-stub` returns 404 unless `AUTH_MODE=dev` and `NODE_ENV !== production`; audit records `actorId`. |
| **M1** | Staff "Repeat order" navigates to `/admin/orders/[id]/repeat` with shared `RepeatReviewClient` (`audience="staff"`, preview/confirm) — no "draft undefined". |
| **M3** | Confirmed `vercel.json` hourly cron → `/api/cron/season-auto-flip`. |
| **M6** | `createDraftFromChoices` applies `productOption.priceAdjustmentCents` and copies allowed `OrderLineAddOn` rows (preview includes `addOns`). |
| **M7** | Removed duplicate `smoke:p10` key from `package.json`. |
| **M8** | Deleted byte-identical `src/app/api/cron/season-flip/` (kept `season-auto-flip`). |
| **M9** | Removed dead `needsReview` / unreachable return / unused `forceAuto` from `repeatOrder` + admin repeat route. |
| **M12** | Deleted unused exported `pickPriceSmart` from `src/lib/catalog/replacements.ts`. |

## Skipped

| ID | Why |
|---|---|
| **M2** | Impersonation audit actor attribution — not in prioritized list. |
| **M4** | Past scheduled flip times accepted — medium audit-integrity. |
| **M5** | Bulk already requires `confirmReplacements`/`confirmRecipients`; deeper per-recipient UX deferred. |
| **M10** | God-file split of `repeat.ts` — refactor scope. |
| **M11** | Prior-year-stub unused-by-smoke / seed drift — mitigated by B3 prod guard. |
| **M13–M20** | Type drift, redundant ternaries, route fold, schedule onChange, N+1 — tidy. |
| **m1–m20** | All minors deferred. |

## Verification

```text
npm run smoke:p10
→ ok: true, passed: 3, failed: 0
→ S1 PASS (discontinued item + confirm)
→ S2 PASS (bulkCreated: 2, cronStatus: 200)
→ S3 PASS (prior-year repeat draft)
```

Evidence: `PHASE-P10-SMOKE.md`
