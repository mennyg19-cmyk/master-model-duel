# P11 Quality review — arm-04 (blind)

**Phase:** P11 — Email & notification platform
**Reviewer:** Quality specialist
**Mode:** Blind (model name unknown). Findings only, no fixes.
**Scope:** `arms/arm-04/workspace/` against `shared/phases/PHASE-P11-EXPECTED.md`.

## What was read

- `prisma/schema/email.prisma`, `prisma/schema/notifications.prisma`, `prisma/migrations/20260727040000_p11_email_notification_platform/migration.sql`
- `src/lib/email/{campaigns,transactional,templates,branding,one-off,provider,resend-api,subscriber-lists}.ts`
- `src/lib/notifications/{outbox,dispatch,purge}.ts`
- `src/lib/messaging/{provider,capture}.ts`, `src/lib/sms/{provider,twilio-api}.ts`
- `src/lib/cron/{authorize,job-run}.ts`, `src/app/api/cron/{notification-sweep,email-log-purge}/route.ts`
- `src/app/(admin)/admin/email/{page,actions,campaigns/[campaignId]/page,outbox/page,templates/actions,lists/actions}.tsx`
- `src/app/(admin)/admin/settings/email/page.tsx`, `src/app/(admin)/admin/settings/actions.ts`
- `src/lib/env-spec.ts`, `tests/email.test.ts`, `tests/newsletter.test.ts`, `scripts/smoke-p11.ts`

## Verdict vs EXPECTED

| EXPECTED | Status | Notes |
|---|---|---|
| 1. Resend isolated in SDK module; email hub (campaigns, subscribers, lists, templates + branding, triggered keys) | PASS | `resend-api.ts` is the only Resend-aware file; hub covers all four tabs. |
| 2. Campaign builder + send with idempotent reruns | PASS (with caveats) | `EmailCampaignSend` unique pair + dedupe key + transactional rollback cover double-press and post-purge rerun. See F1, F4, F6. |
| 3. Transactional order emails with per-key overrides, test capture, outbox + retry sweeper cron | PASS | All three templates ship in `templates.ts`; override via `EmailTemplate`; capture provider writes `CapturedMessage`; sweeper drains the outbox with backoff. See F2. |
| 4. Email-log purge cron; test sender in settings; SMS dispatch wired for P9 reuse | PASS (with caveat) | Purge is safe; SMS provider + Twilio adapter present. See F5 for the test-sender page text. |

Smoke script `scripts/smoke-p11.ts` maps S1–S5 to concrete checks and exercises real failure via the `bounce-` prefix. However, see F3 for the missing evidence files.

## Findings

### F1 — Campaign marooned in SENDING if the recipient loop throws [MEDIUM]

`src/lib/email/campaigns.ts:150-178` sets `status = 'SENDING'`, iterates recipients, then sets `status = 'SENT'`. The loop has no try/catch. A non-unique-violation throw mid-loop (DB connection drop, OOM, a transient `P1001`) leaves the campaign permanently in `SENDING`. There is no recovery path, no admin reset, and no sweeper that re-enters a SENDING campaign. The per-recipient transaction is correct, so no duplicates occur — but the campaign is stuck and the office has no way to know whether the send completed.

EXPECTED #2 ("idempotent reruns") implies a rerun should be safe; a SENDING campaign cannot be rerun cleanly because the status never returns to a state the UI treats as editable or sent.

### F2 — Claim expiry shorter than worst-case batch runtime; recordSent/recordFailure don't guard on status [MEDIUM]

`src/lib/notifications/dispatch.ts:45` sets `CLAIM_EXPIRY_MS = 10 * 60 * 1000`. `DEFAULT_SWEEP_LIMIT = 100` and `REQUEST_TIMEOUT_MS = 15_000` per send (`resend-api.ts:27`, `twilio-api.ts:21`). Worst case 100 × 15s = 25 min > 10 min.

The claim query (`dispatch.ts:113-126`) re-claims rows whose `claimedAt <= now - 10min`. At T=10min, all 100 rows claimed at T=0 satisfy `claimedAt <= staleClaim` and are re-claimed by a second sweep, which then re-sends them. `recordSent`/`recordFailure` (`dispatch.ts:178-216`) update unconditionally — no `where status = 'QUEUED'` guard — so the second delivery overwrites the first's `providerReference` and writes a second `NotificationAttempt`.

In production (Resend) the `idempotency-key` header deduplicates at the provider, so the customer sees one email. In capture mode the capture provider (`messaging/capture.ts:33-45`) ignores the idempotency key and writes a second `CapturedMessage`, so CI/dev and the smoke run can show duplicate delivery under a slow provider. EXPECTED S4 ("one claim per message/job") is violated in this edge case. The smoke S4b uses 4 recipients and completes in seconds, so it does not catch this.

### F3 — Missing `.scratch/PHASE-P11-STATUS.md` and `.scratch/PHASE-P11-SMOKE.md` [MEDIUM]

The `arms/arm-04/workspace/.scratch/` folder does not exist. EXPECTED states: "Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P11-SMOKE.md`". The smoke script `scripts/smoke-p11.ts` exists and is thorough, but no recorded run output or per-phase status file was produced. The reviewer prompt asked to skim both; neither is present. This is a process/evidence gap, not a code defect, but it blocks the gate per `workflow.mdc` expectation-file discipline.

### F4 — SENDING campaigns render as Draft in the hub [LOW]

`src/app/(admin)/admin/email/page.tsx:123-125` renders status as `campaign.status === 'SENT' ? 'Sent' : 'Draft'`. `EmailCampaignStatus` has three values (DRAFT, SENDING, SENT), so a SENDING campaign shows as Draft. The `Badge tone` likewise only handles 'success'/'neutral'. Combined with F1, a stuck campaign looks editable and unsent, which invites a second press that re-enters `sendCampaign` on a campaign already mid-flight. Idempotency holds at recipient level, so no duplicates, but the UI is misleading.

### F5 — Settings test-sender page text contradicts the implementation [LOW]

`src/app/(admin)/admin/settings/email/page.tsx:135` says: "Email is set to capture, so a test is written to the outbox instead of leaving the machine." The test sender (`settings/actions.ts:251-281` → `one-off.ts:sendOneOffEmail`) deliberately bypasses the outbox and writes straight to `CapturedMessage`. The smoke S5a asserts `deskQueued === 0` and passes. The page tells staff the test lands in the outbox when it does not; the flash message in `actions.ts:277` correctly says "on the email outbox page" but the row is in `CapturedMessage`, surfaced via the outbox screen — so the screen is right and the card description is wrong.

### F6 — Campaign recipients loaded unbounded [LOW]

`src/lib/email/campaigns.ts:156-159` calls `findMany` with no `take`. The docblock references "four thousand people", and the loop processes each recipient in its own transaction sequentially. Correctness holds (per-recipient idempotency), but for a large list this is one in-process call holding N rows in memory and doing N sequential DB round-trips. A campaign big enough to matter is exactly the case where a single synchronous send is slowest. EXPECTED does not mandate pagination, so this is a scale note rather than a spec violation.

### F7 — Redundant pre-check in queueMessage [INFO]

`src/lib/notifications/outbox.ts:51-56` runs `findUnique` before `create`; the unique constraint on `dedupeKey` plus the `P2002` catch (line 78) already makes the write idempotent. The pre-check adds a round-trip per call and a TOCTOU window the catch already closes. Not a bug; minor inefficiency.

## Severity counts

- Medium: 3 (F1, F2, F3)
- Low: 3 (F4, F5, F6)
- Info: 1 (F7)
- Total: 7

## Notes on what is solid

- Idempotency design (dedupe key + `EmailCampaignSend` unique pair + transactional rollback) is the right shape and the post-purge rerun case is genuinely covered.
- `FOR UPDATE SKIP LOCKED` with `wallClockUtc` cast is the correct Postgres pattern and the timezone note is real.
- Cron auth hashes both sides before `timingSafeEqual`; empty secret refuses all requests; POST-only on both new endpoints.
- Purge is conservative: only `SENT` past retention; `QUEUED`/`FAILED` survive; `AuditEvent`/`CronRunLog` untouched; `EmailCampaignSend.messageId` is `onDelete: SetNull` so the send proof survives a purge.
- Test capture via `bounce-` prefix is an honest way to exercise the retry ladder without a network.
- Unit tests in `tests/email.test.ts` cover the shipped wording, override, disable, placeholder validation, branding escape/linkify, sender gate, single delivery, backoff trail, give-up, not-due skip, email-holds-while-SMS-goes, purge safety, and campaign-once — a strong mapping to EXPECTED.
