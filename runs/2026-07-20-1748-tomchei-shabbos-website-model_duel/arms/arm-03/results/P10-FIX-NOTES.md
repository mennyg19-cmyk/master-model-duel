# P10 Fix Notes — arm-03

**Smoke:** 3/3 PASS (`npm run smoke:p10`)

## Fixed majors

| # | Fix |
|---|---|
| **M3** | Staff Repeat navigates to `/admin/orders/[id]/repeat`; review UI uses `mode:"preview"` / `mode:"confirm"` (shared `RepeatReviewClient` with `audience="staff"`). |
| **M6** | Bulk repeat requires `confirmReplacements` + `confirmRecipients` (literal `true`); orders list shows a confirm dialog before POST. |
| **M4** | Added `vercel.json` hourly cron → `/api/cron/season-auto-flip`; route accepts GET (Vercel) and POST (smoke). |
| **M7** | `createDraftFromChoices` applies `productOption.priceAdjustmentCents` (incl. fallback option). |
| **M8** | `resolveTargetSeason` throws when no OPEN season — no silent CLOSED fallback. |

## Not in this pass

M1–M2, M5, M9–M15 and minors left for a later tidy/refactor pass.
