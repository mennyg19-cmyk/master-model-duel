# P11 Security Review — arm-03 (blind)

**Reviewer:** glm-5.2-high (external)
**Phase:** P11 — Email & notification platform
**Workspace:** `arms/arm-03/workspace`
**Scope:** trust boundaries, auth, secrets, IDOR, injection, cron auth, token tampering, email preference tokens, campaign send authorization
**Method:** static review of `lib/email/*`, `lib/newsletter-token.ts`, `lib/cron.ts`, `lib/notifications.ts`, `lib/rate-limit.ts`, `lib/sms/provider.ts`, `app/api/admin/email/**`, `app/api/newsletter/**`, `app/api/cron/{notification-sweeper,email-log-purge,payment-reminders}/**`, `app/(storefront)/newsletter/preferences/**`
**Findings only — no fixes applied.**

## Summary

Trust boundaries are well-drawn. Newsletter tokens are HMAC-signed with `SESSION_SECRET` and verified with `timingSafeEqual`; subscribe never returns a token; preferences/unsubscribe gates are token-bound; campaign send, templates, lists, members, subscribers, and test-send all sit behind `email.manage` (or `settings.manage` for the settings test sender) via `requirePermissionApi`; cron endpoints fail-closed (503) without `CRON_SECRET` and use a constant-time bearer compare; the outbox claim is a conditional `updateMany` so overlapping sweeps can't double-send; `captureNotification` dedupes on `dedupeKey` (P2002 → false); env validation refuses public `SESSION_SECRET` defaults and refuses production without `RESEND_API_KEY`/`TRUST_PROXY`. Resend and Twilio keys stay inside their provider files. No IDOR: subscriber-scoped actions key off the signed token, not a user-controlled id.

Findings below are hardening / guardrail gaps, not exploitable holes.

## Findings

| ID | Severity | Location | Claim | Suggested fix |
|---|---|---|---|---|
| P11-S1 | minor | `lib/cron.ts` `runCronJob` (lines 25-41); all `app/api/cron/*/route.ts` | No cron-level overlap lock. `runCronJob` creates a `CronRunLog` row and runs the job, but never checks for an already-running job with the same `jobName`. Two simultaneous scheduler invocations both execute and both create `CronRunLog` rows. The notification sweeper's row-level claim (`dispatch.ts`) and `captureNotification` dedupe prevent double-delivery, and `deleteMany`/`captureNotification` are idempotent for purge/payment-reminders, so there is no double-effect — but wasted work, duplicate `CronRunLog` rows, and no single-winner guarantee at the job level. | Before running, atomically claim the job: insert/select a `CronRunLog` with `jobName + status=running` under a unique constraint (or `updateMany`-claim an existing running row past a stale threshold), and skip when a live run exists. |
| P11-S2 | minor | `app/api/cron/email-log-purge/route.ts` (lines 17-24); `lib/settings.ts` (setting `email.log_retention_days`) | No minimum bound on `email.log_retention_days`. A staff member with `settings.manage` can set the value to `0` (or negative), which makes `cutoff = now` (or future) and the purge `deleteMany` wipes every finished notification row plus cascaded `NotificationAttempt` rows on the next cron tick — destroying the delivery audit trail. `settings.manage` is a trusted role, but there is no guardrail and the purge is irreversible. | Clamp `retentionDays` to a minimum (e.g. `Math.max(retentionDays, 7)`) in the purge route, or validate the setting's range where it is written. |
| P11-S3 | minor | `app/api/admin/email/campaigns/[id]/test-send/route.ts` (lines 30-42) | Test-send creates the `Notification` row with `db.notification.create` directly (not `captureNotification`) and a `dedupeKey` of `campaign-test|${id}|${Date.now()}`. Two test-sends in the same millisecond collide on the unique `dedupeKey` and the second `create` throws `P2002`, which is unhandled and surfaces as a 500 rather than a clean dedupe result. Low likelihood, but the rest of the email path uses `captureNotification` precisely to swallow this. | Use `captureNotification` (or catch `P2002`) so a same-millisecond collision returns a clean "already queued" instead of 500. |
| P11-S4 | info | `app/api/admin/email/campaigns/[id]/test-send/route.ts` (line 29) | Test-send mints a real signed newsletter token (`createNewsletterToken(recipient.email)`) for the arbitrary `to` address and embeds it in the rendered body. The token is bound to the test recipient's own address, so it grants that address its own preferences/unsubscribe — no cross-subscriber privilege. But if a staff member test-sends to a third party who is also a real subscriber, the third party receives a valid management link they could have obtained anyway. No leak across subscribers; noting the token is live, not a preview-only inert value. | Acceptable as-is (the link is the recipient's own). If a preview-only token is preferred for test sends, render with an inert placeholder and omit the appended unsubscribe link. |
| P11-S5 | info | `app/api/newsletter/preferences/route.ts` (lines 22-31) | Preferences PATCH returns 404 when no subscriber matches the token's email, and 200 otherwise. A valid signed token is required to reach the lookup, so this is not exploitable without `SESSION_SECRET`. The status differential (404 vs 200) does reveal whether an email is subscribed to anyone holding `SESSION_SECRET` — but that secret already grants full token forgery, so the oracle adds nothing. | Acceptable. If uniform response posture is desired, return 200 with a no-op (or the same body) regardless of subscriber existence, mirroring the unsubscribe route's idempotent success. |
| P11-S6 | info | `lib/email/provider.ts` `resendProvider` (lines 48-49); `lib/sms/provider.ts` `twilioProvider` (lines 33-34) | Provider error messages surface the upstream provider's `body.message` to the caller (and into `Notification.lastError` via `dispatch.ts` line 101, capped at 500 chars). This is staff-visible in the outbox/audit and useful for diagnosis; it can also echo provider-side diagnostic text into stored logs. No secret is logged (the API key is in the request header, never in the error). | Acceptable for staff diagnosis. If logs are ever shown to non-staff, scrub provider error text at the display layer. |
| P11-S7 | info | `lib/email/campaigns.ts` `campaignAudience` (lines 34-43) | Campaign audience query selects all `SUBSCRIBED` rows (optionally filtered by list) with no `take` cap. A very large subscriber base makes `sendCampaign` build an unbounded in-memory array and issue one `captureNotification` per recipient. This is a performance/scalability concern (P12 territory), not a trust-boundary issue. | Add a `take` cap or streaming/batched audience iteration when scaling past the dev deployment. |
| P11-S8 | info | `lib/rate-limit.ts` (lines 9-21); `app/api/newsletter/subscribe/route.ts` (line 11) | The subscribe rate limiter is in-memory and per-process. With `TRUST_PROXY` off, all clients share one `"direct"` bucket (5/min total), which is a self-DoS vector; the env guard already forces `TRUST_PROXY=true` in production, so the shared-bucket failure mode is dev-only. The comment acknowledges this. | Production-ready: back the limiter with a shared store (Redis/etc.) once horizontal scaling is on the table. Dev/single-node is fine. |

## Counts

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 0 |
| minor | 3 |
| info | 5 |
| **total** | **8** |

## Notes

- Smoke (`arms/arm-03/results/PHASE-P11-SMOKE.md`) reports 5/5 PASS, including tampered/expired token rejection (S1), cron missing/wrong/correct secret (S4), and overlap one-claim-per-message (S4). The overlap behavior in S4 is the `dispatch.ts` row-level claim, not a cron-level lock — hence P11-S1.
- No secrets, API keys, or `SESSION_SECRET` values are committed; env validation fails closed on public defaults in real mode.
- Resend/Twilio credentials do not leak past their provider files; `provider`/`getSmsProvider` are the only consumers.
- All campaign/template/list/member/subscriber/test mutations are audited via `writeAudit` with `gate.staff.realUser.id` (real user, not impersonated) — attribution is preserved.
