# P11 Quality Review — arm-05 (blind)

**Phase:** P11 — Email & notification platform
**Scope:** Resend isolation, campaign idempotency, transactional templates, outbox retry, SMS seam, EXPECTED S1–S5.
**Mode:** Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 8 |
| Low | 7 |
| **Total** | **15** |

Smoke S1–S5 pass per `PHASE-P11-SMOKE.md`; the findings below are correctness/robustness issues the smoke does not cover.

---

## Medium

### M1 — Stale-claim recovery exhausts retries without a real failure
- **Location:** `lib/email.ts` `sweepEmailOutbox` (lines ~123–127)
- **Claim:** A crashed worker leaves an outbox row in `PROCESSING`. The next sweep resets it to `PENDING` but `attemptCount` (incremented at claim time) is never decremented. A few crashes — none of which actually contacted the provider — push `attemptCount` to `MAX_OUTBOX_ATTEMPTS` (3), after which the next real attempt flips the row to `FAILED` permanently.
- **Evidence:** Claim does `attemptCount: { increment: 1 }` (line 139). Stale-claim `updateMany` (lines 124–127) sets `status: "PENDING", claimedAt: null` with no `attemptCount` adjustment. The retry guard `outbox.attemptCount < MAX_OUTBOX_ATTEMPTS` (line 157) treats claim-crashes as provider failures.

### M2 — Permanently FAILED outbox messages can never be re-queued
- **Location:** `lib/email.ts` `queueEmail` (lines 59–64)
- **Claim:** `queueEmail` upserts on `dedupeKey` with `update: {}`. Once a row exists for a dedupeKey — including a `FAILED` one — re-triggering the domain event is a silent no-op. There is no path to retry a permanently failed message short of manual DB edits.
- **Evidence:** `prisma.emailOutbox.upsert({ where: { dedupeKey: input.dedupeKey }, create: {...}, update: {} })`. The dedupeKey is unique across the entire lifecycle, so FAILED rows block all future queues for the same key. Contradicts the resilience intent of "outbox + retry sweeper."

### M3 — Template `branding` is stored but never applied to rendered email
- **Location:** `lib/email.ts` `replaceTemplateVariables` (lines 25–27), `queueOrderLifecycleEmail` (lines 80–88); `prisma/schema.prisma` `EmailTemplate.branding` (line 242)
- **Claim:** The EXPECTED P11 §1.1 calls for "templates + branding." `branding` is persisted and shown in the settings UI ("custom branding" vs "default branding"), but `replaceTemplateVariables` only substitutes `{{key}}` placeholders in subject/body. No code reads `template.branding` during rendering. Branding has no effect on the delivered email.
- **Evidence:** `templateFor(key)` returns the row including `branding`, but only `template.subject` and `template.body` are passed to `replaceTemplateVariables`. The settings page (`app/admin/settings/page.tsx` line 109) advertises branding state to the operator that the system ignores.

### M4 — Admin test-send sweeps the entire outbox as a side effect
- **Location:** `app/api/admin/email/route.ts` `test_campaign` (lines 52–55) and `test_email` (lines 62–65)
- **Claim:** After queueing a test message, the handler calls `sweepEmailOutbox()` inline and returns the sweep result. An operator clicking "Test-send" or "Send platform test" triggers delivery of every other pending outbox row, not just the test message.
- **Evidence:** `await testSendCampaign(...); return NextResponse.json(await sweepEmailOutbox());` — same pattern for `sendTestEmail`. The sweep is cron-only by design (vercel.json registers `/api/cron/email-outbox`); invoking it from an admin UI action couples unrelated deliveries to a manual click and can mask the test result behind a batch summary.

### M5 — `sendCampaign` is not atomic and has no SENT guard
- **Location:** `lib/email.ts` `sendCampaign` (lines 205–235)
- **Claim:** The per-subscriber loop awaits `emailCampaignDelivery.upsert` and `queueEmail` sequentially with no transaction. A crash mid-loop leaves some subscribers with deliveries/outbox rows and others without, and the campaign status may never flip to `SENT`. There is also no check that the campaign is still `DRAFT` before sending.
- **Evidence:** No `prisma.$transaction` wrapping the loop; `prisma.emailCampaign.update({ ... data: { status: "SENT" } })` runs only after the full loop. A SENT campaign can be re-sent (see M6).

### M6 — Re-sending a SENT campaign silently queues newly-confirmed subscribers
- **Location:** `lib/email.ts` `sendCampaign` (lines 207–233)
- **Claim:** EXPECTED S2 requires "rerun send — no duplicates." For the original subscriber set, dedupe holds (outbox `dedupeKey` unique + `EmailCampaignDelivery` unique on `[campaignId, subscriberId]`). But the loop re-iterates *all currently* confirmed, non-unsubscribed subscribers on every call. A subscriber who confirmed *after* the first send gets queued on the rerun, with no operator signal that the campaign was already sent or that new recipients were added. There is no `status === "SENT"` short-circuit.
- **Evidence:** The query at lines 207–213 has no `status` predicate on the campaign; the upserts at 218–222 and 223–230 make the original set idempotent but do not gate new subscribers. The smoke only verifies the original subscriber's counts (lines 72–73 of `smoke-p11.ts`); it does not cover late-joiner behavior.

### M7 — Log purge deletes FAILED failure trails after 30 days
- **Location:** `lib/email.ts` `purgeEmailLogs` (lines 178–187)
- **Claim:** EXPECTED S5 says "Purge eligible logs without deleting active outbox records or audit evidence," and S3 requires an "auditable failure trail." The purge deletes `EmailLog` rows for any outbox with status in `["DELIVERED", "FAILED"]` older than the cutoff. The `AuditEvent` row records only an aggregate count (`email.logs_purged` with `deleted`), not the per-message failure detail. After 30 days, the only auditable failure trail for a permanently-failed message is gone.
- **Evidence:** `prisma.emailLog.deleteMany({ where: { createdAt: { lt: before }, outbox: { status: { in: ["DELIVERED", "FAILED"] } } } })`. FAILED logs are purged on the same schedule as DELIVERED logs; the per-message `details.message` and `attempt` are lost.

### M8 — SMS dispatch is capture-only with no provider seam, test toggle, or retry
- **Location:** `lib/sms.ts` (lines 12–18)
- **Claim:** EXPECTED P11 §4 calls for "SMS dispatch module wired for P9 notification channel reuse (G-021)." `dispatchSms` writes a `DeliveryNotification` row with `channel: "SMS"` and returns. There is no provider call, no `SMS_TEST_MODE` toggle (unlike email's `EMAIL_TEST_MODE`), no outbox, and no retry. The status note says "No live SMS provider is configured," but the seam itself is a single upsert — when a provider is later confirmed (open question 1), there is no dispatch path to wire it into without rewriting the function.
- **Evidence:** `lib/sms.ts` is 18 lines; the only side effect is `prisma.deliveryNotification.upsert`. `lib/delivery.ts` line 106 delegates to `dispatchSms` for `channel === "SMS"`, so P9 notifications are recorded but never dispatched to a phone.

---

## Low

### L1 — `EmailLog` has no index on `outboxId`
- **Location:** `prisma/migrations/20260728012000_p11_email_platform/migration.sql` (line 88)
- **Claim:** Queries `prisma.emailLog.findMany({ where: { outboxId } })` (used in smoke and presumably admin failure-trail views) will table-scan as logs grow. Only `EmailLog_createdAt_idx` exists.
- **Evidence:** Migration creates `EmailLog_createdAt_idx` on `createdAt`; no `outboxId` index. The FK `EmailLog_outboxId_fkey` does not auto-index in Postgres for the referencing column.

### L2 — `EmailLog.status` is a plain String, not an enum
- **Location:** `prisma/schema.prisma` line 298; migration line 74
- **Claim:** `EmailOutboxStatus` is an enum, but `EmailLog.status` is `TEXT`. Inconsistent typing for the same conceptual domain; values are `"DELIVERED"` / `"FAILED"` string literals with no DB-level constraint.
- **Evidence:** `model EmailLog { status String ... }` vs `model EmailOutbox { status EmailOutboxStatus @default(PENDING) }`.

### L3 — Triggered template keys are hardcoded to three
- **Location:** `app/api/admin/email/route.ts` `update_template` schema (line 25); `lib/email.ts` `TransactionalKey` (line 8)
- **Claim:** EXPECTED P11 §1.1 calls for "triggered (transactional) keys" with per-key overrides. The API only accepts `["ORDER_CONFIRMATION", "PAYMENT_LINK", "REFUND"]`. There is no way to add new triggered keys (e.g., a P9 delivery-notification email) without a code change. New keys default-seed via `ensureDefaultEmailTemplates` but cannot be created or managed through the hub.
- **Evidence:** `z.enum(["ORDER_CONFIRMATION", "PAYMENT_LINK", "REFUND"])` in the route; `defaultTemplates` in `lib/email.ts` is a closed record.

### L4 — `sendCampaign` return value `queued` is misleading
- **Location:** `lib/email.ts` `sendCampaign` (lines 214–232)
- **Claim:** `queued` is incremented for every iterated subscriber, even when both the `emailCampaignDelivery.upsert` and `queueEmail` upsert were no-ops on an existing row. The API response `${body.queued} campaign messages queued.` (settings page line 74) over-reports actual new work on a rerun.
- **Evidence:** `queued += 1` runs unconditionally inside the loop; the upserts' `count` is not consulted.

### L5 — Test-send dedupe makes repeat tests a silent no-op
- **Location:** `lib/email.ts` `testSendCampaign` (line 244), `sendTestEmail` (line 109)
- **Claim:** `testSendCampaign` dedupeKey is `campaign:test:${campaignId}:${recipient}`; `sendTestEmail` is `email-platform-test:${recipient}`. Both use `queueEmail`'s `update: {}` upsert. An operator who test-sends to the same recipient twice gets a "Test email captured" success message (settings page line 74/85) for the second call even though no new outbox row was created.
- **Evidence:** `queueEmail` upsert on `dedupeKey`; the route returns `sweepEmailOutbox()` result regardless of whether a new row was inserted.

### L6 — Terminal outbox rows are never purged
- **Location:** `lib/email.ts` `purgeEmailLogs` (lines 178–187)
- **Claim:** The purge deletes `EmailLog` rows only. `EmailOutbox` rows for `DELIVERED` and `FAILED` messages accumulate indefinitely. At 5k-package scale with retries, this is unbounded table growth in the outbox.
- **Evidence:** `deleteMany` targets `EmailLog`; no corresponding `EmailOutbox` cleanup. The `EmailLog` FK is `ON DELETE CASCADE`, so the outbox row is the parent that survives.

### L7 — Resend env var name leaks into the email orchestration layer
- **Location:** `lib/email.ts` `isTestCaptureEnabled` (lines 29–31)
- **Claim:** EXPECTED P11 §1.1 calls for "Resend integration isolated in SDK module." `lib/resend.ts` is the SDK module, but `lib/email.ts` reads `process.env.RESEND_API_KEY` directly to decide test-capture vs live send. The orchestration layer knows the provider's env var name, weakening the isolation boundary.
- **Evidence:** `isTestCaptureEnabled()` checks `!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production"`. A `sendThroughResend.isConfigured()` (or similar) helper on the SDK module would keep the boundary clean.
