# P11 Fix Notes — arm-03

**Phase:** P11 — Email & notification platform  
**Scope:** Single fix pass from `AGGREGATE-REVIEW-P11.md`  
**Ports:** web 3103 / db 4103  
**Smoke:** `npm run smoke:p11` → **5/5 PASS** (S1–S5)

## Fixed IDs

| ID | Title | Change |
|---|---|---|
| **B1** | Stored HTML injection in `renderTemplate` | Confirmed/kept: `escapeHtml` on every `{{var}}` substitution; `sanitizeSameOriginUrl` on payment URLs in order + admin transactional paths |
| **B2** | Duplicate delivery / missing `claimedBy` + non-atomic finalize | `processClaimedMessage(rowId, workerId)` heartbeats lease, requires `claimedBy === workerId`, finalizes log+outbox in `$transaction` with `updateMany` ownership guard; failure path also ownership-gated |
| **B3** | P11 cron routes POST-only (Vercel GET → 405) | Added `GET`+`POST` to `outbox-sweep` and `purge-email-log` (same pattern as `season-auto-flip`) |
| **M1** | `mintUnsubscribeToken` unwired for subscribers | Campaign send already appends minted prefs/unsub footer; subscribe now enqueues `newsletter.welcome` via `enqueueSubscribeWelcome` (token never returned on HTTP) |
| **M7** | `finishCronRun` always `ok: true` | Outbox sweep sets `ok: sweepResult.failed === 0` |
| **M11** | Cron overlap test-only (Vercel gets random tokens) | Default token is `${jobKey}:inflight`; released to `${runId}:done` on finish; stale inflight reaped after 10m; explicit `?token=` still unique forever for smoke overlap |
| **M12** | `finishCronRun` missing on failure | Outbox-sweep, purge-email-log, season-auto-flip finalize with `ok: false` in catch (payment-reminder / pickup-expiry already had this) |

## Smoke result

```
passed: 5
failed: 0
S1 Preferences + tokens — PASS
S2 Campaign flow + idempotent rerun — PASS
S3 Transactional + failure trail — PASS
S4 Cron auth + overlap — PASS (o2 skipped overlap; raceClaimed=1)
S5 Purge + test mode + SMS — PASS
```

## Files touched

- `src/lib/notify/outbox.ts`
- `src/lib/cron/runs.ts`
- `src/app/api/cron/outbox-sweep/route.ts`
- `src/app/api/cron/purge-email-log/route.ts`
- `src/app/api/cron/season-auto-flip/route.ts`
- `src/lib/storefront/newsletter.ts`
- `src/app/api/newsletter/subscribe/route.ts`
- `src/lib/email/templates.ts` (B1 already present; no further change)

## Not in this pass

Remaining majors/minors from the aggregate (M2–M6, M8–M10, M13–M19, m1–m29) left for later unless promoted.
