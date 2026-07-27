# P11 Rules Review — arm-04 (blind)

**Phase:** P11 — Email & notification platform
**Arm rules graded:** ponytail, clean-code, workflow, vocabulary, codegraph
**Scope:** `arms/arm-04/workspace/` P11 additions (`prisma/migrations/20260727040000_p11_email_notification_platform`, `prisma/schema/{email,notifications,newsletter,routes}.prisma`, `src/app/(admin)/admin/email/**`, `src/app/(admin)/admin/settings/email/**`, `src/app/api/cron/{notification-sweep,email-log-purge}`, `src/lib/{email,notifications,messaging}/**`, `src/components/admin/nav-items.ts`, `scripts/smoke-p11.ts`, `tests/email.test.ts`, `package.json`, `.env.example`)
**Method:** Findings only, no fixes. Blind to model name.

## Summary by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 4 |
| Info | 3 |

## Medium

### M1 — `isUniqueViolation` duplicated verbatim in two notification modules
`src/lib/email/campaigns.ts:240-247` and `src/lib/notifications/outbox.ts:163-170`

The same 6-line Prisma `P2002` detector appears in both files, byte-for-byte. Two real call sites right now (campaign send, outbox queue) plus the same shape recurs in `dispatch.ts`'s `describe`/`job-run.ts`'s `safeMessage` (see L2). The arm's `clean-code.mdc` Rule of 2 says "needs 2+ real call sites right now" — this passes the threshold for extraction into `lib/notifications/` (or `lib/core/prisma.ts`), and the two copies can drift the way the cron-job boilerplate did before `runCronJobBody` was introduced (the comment in `job-run.ts:8-13` is the arm's own documented precedent for this exact failure mode). `campaigns.ts` already imports from `notifications/outbox`; lifting `isUniqueViolation` next to `queueMessage` would not add a new dependency edge.

**Rules:** clean-code (Refactor categories — duplicated logic; Consistency — one pattern per concern), ponytail (Rule of 2 satisfied).

### M2 — `sendCampaign` writes `status: 'SENDING'` but no observer ever reads it; the hub displays it as "Draft"
`src/lib/email/campaigns.ts:154` (write), `src/app/(admin)/admin/email/page.tsx:123-125` and `campaigns/[campaignId]/page.tsx:63-65` (read)

`sendCampaign` sets `status: 'SENDING'` before the recipient loop and `status: 'SENT'` after. The hub Badge binary-casts to Draft/Sent (`campaign.status === 'SENT' ? 'Sent' : 'Draft'`), and the campaign page does the same. A campaign mid-send (or stuck after a process death mid-loop) renders as "Draft" on both screens, so the SENDING column value is written but never displayed. The rerun is idempotent (`queueOneRecipient` collides on `(campaignId, subscriberId)`), so a stuck-SENDING campaign is recoverable by pressing Send again — but the office has no visual signal that a send is in progress or stalled. Either the SENDING state should render (the hub has a `data-status` attribute already used by the smoke test for `FAILED` rows), or the write is dead state. The `EmailCampaignStatus` enum carries it; nothing reads it.

**Rules:** clean-code (Anti-AI-Tics — "No 'just in case' code — every line must have a reason"; Consistency — the outbox page *does* surface `QUEUED`/`SENT`/`FAILED` via `STATUS_TONE`, the campaign page does not), workflow (Verify in the running app — the smoke test asserts `afterSend.status === 'SENT'` but never asserts that SENDING is visible, because it isn't).

## Low

### L1 — `rejectWith` duplicated across four action files with two incompatible shapes
`src/app/(admin)/admin/email/actions.ts:102-104`, `src/app/(admin)/admin/email/lists/actions.ts:80-82`, `src/app/(admin)/admin/email/templates/actions.ts:77-79`, `src/app/(admin)/admin/settings/actions.ts:296-298`

Four copies of the same "redirect with `?problem=`" helper. Two take `(path, message)`, two take `(message)` and hardcode the module path. The email sub-actions each hardcode their own `*_PATH` constant, so the helper's signature is the only thing that differs. Rule of 2 is met (4 call sites), but each copy is 2 lines and a shared helper would still need a path argument — per `clean-code.mdc` "If removing duplication adds more lines than it saves and the duplicated code is stable, leave it duplicated," this is borderline. Flagging only because the two-shape split (hardcoded path vs. passed path) is an inconsistency the arm's own "one pattern per concern" rule would normally catch, and because `settings/actions.ts` already owns the path-argued shape the email actions could have reused.

**Rules:** clean-code (Consistency — one pattern per concern; Refactor categories — duplicated logic), ponytail (Rule of 2 met; "If removing duplication adds more lines than it saves… leave it duplicated" — the counter-rule that makes this Low, not Medium).

### L2 — `describe`/`safeMessage`/`firstMessage` are three copies of "first line of an error, truncated"
`src/lib/notifications/dispatch.ts:218-221` (`describe`), `src/lib/cron/job-run.ts:67-71` (`safeMessage`), `src/app/(admin)/admin/settings/actions.ts:292-294` (`firstMessage`)

All three do `error.message.split('\n')[0].slice(0, N)` with N=200 (dispatch, job-run) or no truncation (settings). Three call sites, same shape, slightly different truncation policy. The 200-char cap is a real choice (provider errors get quoted into the attempt trail / `CronRunLog.detail` which staff read), so a shared helper with a `maxLength` parameter would carry the intent better than three copies. The settings `firstMessage` is the odd one out (no cap) and is the one most likely to put a long string on a URL.

**Rules:** clean-code (Refactor categories — duplicated logic; Consistency — one error-handling approach per project), ponytail (Rule of 2 met).

### L3 — Campaign test send is filed under `source: 'settings-test'`, collapsing two distinct callers in `CapturedMessage`
`src/lib/email/campaigns.ts:144` (passes `CAPTURE_SOURCES.settingsTest`), `src/lib/messaging/capture.ts:17` (`CAPTURE_SOURCES = { outbox, settingsTest }`), `src/lib/email/one-off.ts:36-39`

`sendCampaignTest` and the settings test sender both go through `sendOneOffEmail`, which files the capture under `source: 'settings-test'`. The `CapturedMessage.source` comment says "Which part of the app asked for it: `outbox` or `settings-test`" — two buckets for three callers (outbox sweep, settings test, campaign test). The P11 smoke test asserts `testCapture.source === 'settings-test'` for a campaign test send and passes, so the behavior is intentional, but a campaign test send is not a settings test. The source column is the only field that distinguishes a captured message's origin; collapsing campaign-test into settings-test loses that. Either the enum needs a `campaignTest` entry or the comment should say "settings or campaign test."

**Rules:** clean-code (Naming — `source` no longer names what asked for it on the campaign path; Consistency — the outbox sweep gets its own source, the campaign test does not), ponytail ("No unrequested abstractions" cuts the other way here — the second source value is *missing*, not extra).

### L4 — `sweepNotificationOutbox` reads branding once at the start; a branding change mid-sweep ships the old letterhead for the rest of the run
`src/lib/notifications/dispatch.ts:66-67`

`readEmailBranding` and `senderLine` are read once before the `claimDueMessages` loop and passed into every `deliver` call. `branding.ts:11-12` promises "read at send time, so a message queued last night goes out under today's letterhead." Within a single sweep that promise holds for the first claimed message and silently breaks for the last: a manager who changes the logo mid-sweep gets the old logo on every message after the change. The sweep is bounded (`DEFAULT_SWEEP_LIMIT = 100`) and fast, so this is an edge case, but the comment's guarantee is broader than the code delivers. Either re-read branding per message (cheap — six cached settings) or narrow the comment to "read at the start of each sweep."

**Rules:** workflow (Never silently choose business logic — the letterhead-at-send-time rule is a domain decision the comment overstates), clean-code (Anti-Hallucination — "Do not claim 'fixed/passed/working' without tool output or running-app evidence"; the comment claims a property the code only partially delivers).

## Info

### I1 — `codegraph` adherence not verifiable from artifacts; reuse pattern is consistent with the rule's fallback
No `.codegraph/` directory exists in `arms/arm-04/workspace/`, so `codegraph.mdc`'s fallback ("Read/grep fallback for this run only") applies. The P11 code reuses existing helpers consistently — `recordAudit`, `requirePermission`, `runCronJob`/`runCronJobBody`, `DbClient`, `formatCents`, `normalizeEmail`, `createUnsubscribeToken`, `formatOrderLabel`, `readSetting`/`writeSetting`, `runInTransaction` shape — rather than reimplementing them. No competing reimplementations of indexed helpers, no "I grepped the tree" comments. The new modules (`lib/email/*`, `lib/notifications/*`) are additive and import from `lib/core`, `lib/db`, `lib/messaging`, `lib/newsletter`, `lib/cron`, `lib/settings` — the existing structure. No structural evidence of a grep-for-symbol violation. The M1 finding (duplicated `isUniqueViolation`) is a *missed* extraction, not a grep-for-symbol violation.

**Rules:** codegraph (unverifiable from artifacts; fallback applied correctly).

### I2 — `vocabulary` and `clean-code` UI Consistency / God files / Dependency Discipline / Anti-Hallucination not flagged
- **vocabulary:** No `refactor`/`tidy`/`rebuild`/`redesign` commands issued mid-phase. The new screens are "add" (new feature, existing patterns). `resetTemplateAction` ("reset") is a domain action on a template row, not a vocabulary command. No finding.
- **clean-code UI Consistency:** All four email admin pages reuse `Card`, `CardTitle`, `CardDescription`, `Button`, `Badge`, `FlashMessages`, `Input`, `Label`, `Textarea`, `Select` from the existing library. Header pattern (`text-2xl font-semibold`) matches every other admin screen. `EmailTabs` mirrors `SettingsTabs` and says so in its comment. The campaign detail header uses `flex flex-wrap items-end justify-between` — the same shape as other detail pages. The outbox `STATUS_TONE` map reuses the `Badge` tone vocabulary. No rogue styling. No finding.
- **clean-code God files:** Largest P11 file is `campaigns.ts` at 248 lines, `dispatch.ts` at 222, `smoke-p11.ts` at 648 (test script, not product code), `transactional.ts` at 152. All product files well under the 500-line trigger. No mixed concerns. No finding.
- **clean-code Dependency Discipline:** No new packages added for P11 (`package.json` deps unchanged). The Resend integration uses `fetch` not the `resend` npm package, with a comment that follows the ponytail ladder ("a dependency would add a build to audit and an upgrade to track for four lines of JSON"). `AbortSignal.timeout` and `node:crypto` are stdlib. Versions pinned. No finding.
- **clean-code Anti-Hallucination:** `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` is a real Node 18+/browser API. `z.email()` / `z.url()` match Zod 4 (pinned 4.4.3). Prisma `$queryRaw`, `$transaction([…])` and `$transaction(async (tx) => …)` signatures match the current client. `FOR UPDATE SKIP LOCKED` is valid Postgres. The `wallClockUtc` `CAST(… AS timestamptz) AT TIME ZONE 'UTC'` is correct for the documented Prisma `timestamp` vs. `timestamptz` binding mismatch. No invented APIs observed. No finding.
- **clean-code Error Handling:** No swallowed errors. `deliver` catches and records every provider failure into `NotificationAttempt`. `queueMessage`'s `catch (error)` only swallows `P2002` (returns `alreadySent`) and rethrows everything else. Error messages say what went wrong and the expected state (e.g. "That campaign no longer exists.", "Set the sender address on Settings → Email before sending anything."). No finding.
- **workflow Security Basics:** `.env.example` carries `EMAIL_PROVIDER`, `RESEND_API_KEY`, `SMS_PROVIDER`, `TWILIO_*`, `CRON_SECRET` — all with `# Secret: rotate immediately` headers. The two new cron routes go through `runCronJob`, which refuses every request when `CRON_SECRET` is empty and uses `timingSafeEqual` on SHA-256 digests. `RESEND_API_KEY` is read via `env.RESEND_API_KEY ?? ''` and sent only as a bearer header to Resend — never logged, never put in `NotificationAttempt.error` (the `describe` helper takes only the first line of `error.message`, and `MessageProviderError`'s message is `"<provider> refused the message with status <n>"`, no key). No secrets hardcoded. No finding.
- **workflow Shell execution:** No PowerShell written by the contestant in P11 (all `.ts`/`.tsx`/`.sql`). N/A.
- **workflow Expectation Files:** `.scratch/phase-plan.md` is gitignored and not in the tree; cannot verify the pre-build EXPECTED blocks. The smoke script `scripts/smoke-p11.ts` encodes verifiable expectations per check (S1a–S5c, P11-1–P11-4) and maps them onto the EXPECTED table's S1–S5 in its header. No finding from artifacts.
- **workflow Tone / ponytail Anti-slop:** Comments are plain English, no jargon ("Retry up to 3 times" style — `RETRY_DELAYS_MS` comment says "A minute, five, half an hour, two hours"). No sycophancy, no "delve/tapestry/seamless", no em-dash pileups, no tricolon padding. Doc-block-style comments are absent — every comment explains a non-obvious intent (the idempotency pair, the timezone trap, the "sent letter is a record" rule). No finding.

### I3 — `MAX_DELIVERY_ATTEMPTS` / `RETRY_DELAYS_MS` / `CLAIM_EXPIRY_MS` are business rules with clear comments but no DECISION-LOG entry
`src/lib/notifications/dispatch.ts:35-45`

These three constants are domain rules (when do we give up on a donor's address? how long between retries? when is a dead sweep's claim reusable?). Each has a comment that explains the *why* in plain English ("Long enough that a slow provider is never overtaken, short enough that a crash during Purim week costs one sweep rather than the night"). `workflow.mdc` says "Never silently choose business logic — log in DECISION-LOG.md and flag." No DECISION-LOG is in the P11 tree (gitignored or absent), so this is not verifiable from artifacts — but the constants are the kind of domain decision the rule is written for. Flagging as Info rather than Low because the comments carry the reasoning the DECISION-LOG would carry, and because `logRetentionDays` (the one domain number a manager would reasonably want to change) is correctly a setting, not a constant.

**Rules:** workflow (Never silently choose business logic — log in DECISION-LOG and flag; unverifiable from artifacts here).
