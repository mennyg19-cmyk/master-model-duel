# P11 Fix Notes — arm-03

**Phase:** P11 — Email & notification platform  
**Tree:** `arms/arm-03/workspace/`  
**Source:** `results/AGGREGATE-REVIEW-P11.md`  
**Smoke after fix:** 5/5 PASS (`PHASE-P11-SMOKE.md`)

## Fixed

| ID | What changed |
|---|---|
| **B1** | `renderTemplate` now HTML-escapes all substituted vars (`escapeHtml`). `sanitizeSameOriginUrl` rejects non-http(s) and off-origin URLs. `enqueuePaymentLinkEmail` and admin `trigger_transactional` bind `paymentUrl` to same-origin only (fallback `${APP_URL}/checkout`); admin can no longer inject an external phishing `paymentUrl` via vars spread. |
| **M1** | Removed capture-only `captureNotification`. Added `enqueueEmailAndSms` that uses mode-aware `enqueueNotification` (`PENDING` in live/mock, `CAPTURED` in capture). Call sites in `pickup/service.ts`, `pickup/bulk.ts`, `routes/service.ts` updated. Live mode can now be swept/delivered. |
| **M2** | All five cron routes finalize with `finishCronRun({ ok: false, … })` on work failure before rethrowing/`apiErrorResponse`. |
| **M3** | `enqueueOrderEmail` and `sendCampaign` store `recipientKey` as lowercased email, matching the idempotency key. |
| **M5** | `sendCampaign` mints tokens via `mintUnsubscribeToken` and appends preferences + unsubscribe footer links to each recipient's HTML body. |
| **m20** | Deleted unused `writeCronAudit` from `src/lib/cron/runs.ts`. |
| **M22** | `outbox-sweep`, `purge-email-log`, `pickup-expiry`, and `payment-reminder` now export both `GET` and `POST` (same pattern as `season-auto-flip`) so Vercel Cron GET works. |

## Skipped (not in fix priority / deferred)

| ID | Why skipped |
|---|---|
| **M4** | Production overlap still relies on shared `?token=` for collision; fixing real Vercel overlap needs a different claim design (e.g. unique open-run per jobKey). Out of prioritized set. |
| **M6** | Stale-claim duplicate delivery (`claimedBy` check) — not in prioritized list. |
| **M7** | `purgeEmailLogs` non-transactional delete+audit — not prioritized. |
| **M8** | Folding residual `capture*` naming into enqueue is done via M1; further outbox dedupe left alone. |
| **M9–M21** | From-address dedupe, test-send duplicates, bulk cron skeleton dupes, god-file splits, branding casts, magic defaults cleanup beyond phishing binding, etc. — lower priority / larger refactors. |
| **m1–m19, m21–m26** | Minors (token leak reason codes, audit action name, god UI, magic numbers, etc.) — not in fix pass scope. |

## Verification

- `npm run typecheck` — pass
- `npm run smoke:p11` — **5/5 PASS** (S1–S5)
