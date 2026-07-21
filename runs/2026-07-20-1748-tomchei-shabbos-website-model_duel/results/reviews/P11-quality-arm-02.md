# P11 Quality review — arm-02

Reviewer specialist: Quality. Findings only, no fixes. Blind to model identity.
Phase: P11 (Email & notification platform). Reference: `shared/phases/PHASE-P11-EXPECTED.md`.
Scope reviewed: `lib/email/provider.ts`, `lib/email/dispatch.ts`, `lib/email/campaigns.ts`, `lib/email/transactional.ts`, `lib/email/templates.ts`, `lib/sms/provider.ts`, `lib/notifications.ts`, `lib/cron.ts`, `lib/settings.ts`, `lib/domain/finalize.ts` (P11 touch point), `app/api/cron/notification-sweeper/route.ts`, `app/api/cron/email-log-purge/route.ts`, `app/api/admin/email/test/route.ts`, `app/api/admin/email/campaigns/route.ts`, `app/api/admin/email/campaigns/[id]/route.ts`, `app/api/admin/email/campaigns/[id]/send/route.ts`, `app/api/admin/email/campaigns/[id]/test-send/route.ts`, `app/api/admin/email/subscribers/route.ts`, `app/api/admin/email/lists/route.ts`, `app/api/admin/email/lists/[id]/members/route.ts`, `app/api/admin/email/templates/route.ts`, `app/(admin)/admin/email/page.tsx`, `components/admin/email-hub.tsx`, `components/admin/settings/email-tab.tsx`, `lib/auth/permissions.ts`, `lib/env.ts`.

No `arms/arm-02/workspace/.scratch/PHASE-P11-SMOKE.md` exists (the `.scratch` directory is absent), so S1–S5 cannot be corroborated from evidence — see M2. Findings below are from source inspection.

## High

None. The outbox dispatcher implements a proper stale-claim reaper (`STALE_CLAIM_MS`, reclaiming `sending` rows whose `claimedAt` is older than 10 min via a conditional `updateMany`), and the campaign send is idempotent through the `dedupeKey` with no stuck `SENDING` intermediate state — the two High patterns from the sibling arm are not present here.

## Medium

### M1 — `sendThroughProvider` reads three settings on every dispatch
`lib/email/dispatch.ts:107` runs `Promise.all([getSetting("email.from_address"), getSetting("email.reply_to"), getSetting("email.branding_footer")])` inside the per-row sweep loop. `getSetting` (`lib/settings.ts:69`) issues a `db.setting.findUnique` per call, so a full batch of 100 notifications costs 300 setting reads on hot rows that change rarely. The reads also run inside the dispatch path that holds the claimed row, adding lock surface and latency for no benefit (the values are immutable between sweeps). They are fetched even in `mock` mode (only `capture` mode short-circuits before the reads).

### M2 — No P11 smoke evidence file
`shared/phases/PHASE-P11-EXPECTED.md` declares the per-arm evidence path `arms/{id}/workspace/.scratch/PHASE-P11-SMOKE.md`. For arm-02 the `.scratch` directory does not exist, so S1–S5 (preferences/tokens, campaign rerun no-dup, transactional failure→retry→single delivery, cron auth+overlap, purge+test-mode) are unverified from evidence. This is the "missing smoke" category the quality reviewer is asked to flag; the source paths look plausible but cannot be corroborated against a recorded run.

### M3 — Purge keys on `createdAt`, not on the terminal event
`app/api/cron/email-log-purge/route.ts:19` deletes rows where `status in ["sent","captured","failed"]` AND `createdAt < cutoff`. Retention is semantically "time since the log finished," but the cutoff is anchored to creation. A notification that sat `pending`/`sending` for longer than the retention window and then finished today is purged immediately, dropping a fresh `failed` audit trail. EXPECTED S5 intends purging of *eligible* (finished-ago) logs; using `sentAt`/`updatedAt` would match that intent. Active outbox rows are correctly protected by the status filter, and `AuditLog` is a separate table (untouched) — those parts of S5 hold.

### M4 — Test-sender failures re-enter the sweeper and can deliver late
`app/api/admin/email/test/route.ts` creates the row with `status: "sending"` + `claimedAt`, then calls `dispatchOne`. On provider failure `dispatchOne` (`lib/email/dispatch.ts:83`) resets the row to `status: "pending"` with `nextAttemptAt = now + backoff` and `claimedAt: null`. The sweeper then retries it on the next tick. A staff member who sees `outcome: "failed"` (or `"retried"`) in the settings tab can still receive that test email minutes later via the cron sweep, with no further signal in the UI. For a manual test send the outbox-retry semantics are surprising; a test row should terminate after one attempt.

## Low

### L1 — Campaign "not found" maps to 409, not 404
`app/api/admin/email/campaigns/[id]/send/route.ts:17` returns 409 for every `{error}` from `sendCampaign`, including `"Campaign not found"`, which should be 404. The "no subscribed addresses" case is correctly a 409.

### L2 — SMS test mode shares the email test-mode flag
`lib/sms/provider.ts:59` gates SMS `capture` mode on `env.EMAIL_TEST_MODE`. There is no independent SMS capture switch, so the flag name is misleading and SMS cannot be exercised in isolation from email test mode. (Same posture as the sibling arm's L2.)

### L3 — Subscriber search is case-sensitive on a lowercased query
`app/api/admin/email/subscribers/route.ts:9` lowercases `q` and filters with `email: { contains: query }`. Prisma `contains` on Postgres is case-sensitive unless the column is `citext`; a mixed-case stored email will not match a lowercased search term. The directory is capped at `take: 200` with no pagination, so a large directory silently truncates regardless of query.

### L4 — `hasOverride` hides an `isEnabled`-only override
`app/api/admin/email/templates/route.ts:24` computes `hasOverride: Boolean(override?.subject || override?.body)`. A manager who only toggles `isEnabled: false` (no subject/body change) has `hasOverride === false`, so the hub does not surface the disabled state as an override even though the template is in fact overridden (disabled).

### L5 — List member add/remove is not audited
`app/api/admin/email/lists/[id]/members/route.ts` performs add/remove without `writeAudit`, while list creation, campaign create/update/send, and template update all audit. EXPECTED does not mandate it, but the inconsistency means list membership changes are not in the audit log.

### L6 — Campaign send has no DRAFT-status guard
`sendCampaign` (`lib/email/campaigns.ts:51`) does not check `campaign.status === "DRAFT"` before sending. Re-clicking "Send" on an already-`SENT` campaign re-runs the audience expansion, hits the `dedupeKey` for every address (queued=0), re-marks `SENT`, and writes a second `email.campaign.send` audit entry. Idempotent for delivery, but noisy in audit and returns 200 with `queued: 0` as if a send happened.

### L7 — SMS mock has no exhausted-failure hook
`lib/sms/provider.ts:41` provides only a `[failonce]` marker (first-attempt failure → retry). The email mock (`lib/email/provider.ts:63`) also has `+failalways` to exercise the `MAX_ATTEMPTS` exhausted path. SMS has no equivalent, so the SMS `failed`-terminal + audit-trail path cannot be driven end-to-end the way email can — relevant to EXPECTED S3's "auditable failure trail" for both channels.

## Severity counts

- Critical: 0
- High: 0
- Medium: 4
- Low: 7
- Total: 11
