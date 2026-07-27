# P11 Rules review — arm-05 (blind)

**Phase:** P11 — Email & notification platform
**Rules graded:** `clean-code.mdc`, `vocabulary.mdc`, `ponytail.mdc`, `workflow.mdc`, `codegraph.mdc`
**Scope:** P11 code only (`lib/email.ts`, `lib/resend.ts`, `lib/sms.ts`, `lib/cron-auth.ts`, `lib/newsletter.ts` P11 changes, `app/api/cron/email-outbox/route.ts`, `app/api/cron/email-log-purge/route.ts`, `app/api/admin/email/route.ts`, `app/api/newsletter/route.ts`, `app/api/newsletter/confirm/route.ts`, `app/admin/settings/page.tsx` email section, `app/unsubscribe/page.tsx`, `scripts/smoke-p11.ts`, `prisma/schema.prisma` § email models, `prisma/migrations/20260728012000_p11_email_platform/migration.sql`, `vercel.json` crons).
**Method:** Findings only — no fixes proposed.

## Summary counts

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 3 |
| Low | 6 |
| **Total** | **9** |

## Findings

### Medium

#### M1 — `queueOrderLifecycleEmail` dedupeKey collapses multiple refunds to one email
**Location:** `lib/email.ts:85`
**Claim:** `workflow.mdc` — "Never silently choose business logic (calculations, domain rules) — log in DECISION-LOG.md and flag." Plan § P11 R-087 expects a "refund" transactional email per refund event.
**Evidence:** `dedupeKey: \`order:${orderId}:${key}:${key === "PAYMENT_LINK" ? paymentLink ?? "pending" : "current"}\``. For `REFUND` the suffix is always `current`, so every refund email for one order shares one dedupeKey. `queueEmail` (line 59-64) upserts with `update: {}` — a no-op when the row already exists. A customer who gets a partial refund then a full refund (two `charge.refunded` webhook events) receives only the first email; the second `queueOrderLifecycleEmail` call is silently dropped. `PAYMENT_LINK` varies the key by `paymentLink`, but `REFUND` and `ORDER_CONFIRMATION` do not vary by refund/confirmation event. No DECISION-LOG entry (no `DECISION-LOG.md` exists in the workspace) records the "one refund email per order" choice.

#### M2 — `sendCampaign` runs without a transaction, marks SENT unconditionally, and records no audit event
**Location:** `lib/email.ts:205-235`; `app/api/admin/email/route.ts:46-51`
**Claim:** `workflow.mdc` — "Never silently choose business logic"; `clean-code.mdc` Consistency — "One state management pattern per project" (other admin mutations write `AuditEvent`). Plan § P11 R-083 expects campaign send with idempotent reruns.
**Evidence:** Three gaps in `sendCampaign`:
1. No `prisma.$transaction` wraps the subscriber loop. A crash after queueing some emails but before line 233 leaves the campaign in `DRAFT` with emails already in the outbox (recoverable via dedupeKey re-run, but the SENT/DRAFT state no longer reflects reality).
2. Line 233 `prisma.emailCampaign.update({ ... data: { status: "SENT" } })` runs unconditionally even when `queued === 0` (all subscribers unsubscribed or marketing-opt-out). A campaign with zero deliveries shows `SENT` — a silent, misleading business outcome.
3. No `AuditEvent` is written for `send_campaign`, `test_campaign`, `test_email`, or `update_template`. The admin layout banner (`app/admin/layout.tsx:21`) states "changes to orders, payments, and imports are audited"; email operations are the one admin mutation surface with no audit row. `purgeEmailLogs` (line 185) is the only email action that writes an `AuditEvent` — inconsistent within the same module.

#### M3 — No admin recovery path for permanently FAILED outbox rows
**Location:** `lib/email.ts:59-64` (`queueEmail` upsert `update: {}`); `lib/email.ts:162` (status `FAILED` after `MAX_OUTBOX_ATTEMPTS`); `app/admin/settings/page.tsx` (email section)
**Claim:** `workflow.mdc` Execution Discipline — "Verify in the running app"; `clean-code.mdc` Error Handling — "Error messages say what went wrong AND what the expected state was." Plan § P11 R-088/R-181 expect a retrying sweeper cron.
**Evidence:** The sweeper retries up to `MAX_OUTBOX_ATTEMPTS = 3` (line 5), then sets `status: "FAILED"` with `lastError`. Once `FAILED`, the row is dead: `queueEmail` with the same `dedupeKey` is a no-op (upsert with empty `update`), and the settings UI has no "retry failed" control — only `send_campaign`, `test_campaign`, `create_list`, `add_list_member`, `test_email`, `update_template`, and `sweep` actions exist. A refund email that fails 3 times (provider outage) is silently lost with no surfaced recovery. The `lastError` is recorded but never shown to staff. The plan's merge boundary says "all required messaging is ... decoupled from provider outages" — a permanently failed message is not decoupled, it is dropped.

### Low

#### L1 — In-memory subscribe rate limiter is per-instance on serverless
**Location:** `app/api/newsletter/route.ts:29-45`
**Claim:** `ponytail.mdc` — "Never cut: Trust-boundary validation." The subscribe endpoint is public and triggers outbound email.
**Evidence:** `const subscribeAttempts = new Map<string, { count: number; startedAt: number }>()` is module-level. On Vercel serverless each instance has its own map and instances recycle, so a determined caller can exceed `maximumSubscribeAttempts = 5` per minute by hitting different instances. The limiter also never evicts stale entries except on window expiry for the same key — memory grows with distinct client addresses. Acceptable as a cheap first-pass guard, but the per-instance limitation is not documented in code or README.

#### L2 — `emailHub()` lazy-seeds templates on every GET (write-on-read)
**Location:** `lib/email.ts:249-250`; `app/api/admin/email/route.ts:33-36`
**Claim:** `ponytail.mdc` — "Minimum code"; REST hygiene — GET should not mutate.
**Evidence:** `emailHub()` calls `await ensureDefaultEmailTemplates()`, which runs `Promise.all` of three `prisma.emailTemplate.upsert` calls on every `GET /api/admin/email`. The upserts are idempotent (no-op if templates exist), but every hub load issues three write-capable queries against the DB. A `templateFor` call on first hub load is enough; subsequent loads could rely on the existing rows. Not a correctness issue — a token/latency cost on the admin read path.

#### L3 — Settings page nests email AJAX controls inside the settings `<form>`
**Location:** `app/admin/settings/page.tsx:94-125`
**Claim:** `clean-code.mdc` — "Split files by concern, not by line count"; UI consistency — one form per submit context.
**Evidence:** The email section (`<section id="email">`) with campaign name/subject/body inputs, test-recipient input, and `createCampaign` / `runCampaign` / `sendPlatformTest` buttons lives inside `<form onSubmit={saveSettings}>` (line 94). The email buttons use `type="button"` so they do not submit the settings form, but the campaign `<textarea>` and `<input>` elements are unassociated form controls inside a form whose submit handler ignores them. A staff member tabbing through the email section interacts with controls that belong to a different submit context. The store-settings form and the email hub are distinct concerns; co-locating them in one `<form>` mixes submit semantics.

#### L4 — `sweepEmailOutbox` stale-claim recovery burns an attempt (undocumented)
**Location:** `lib/email.ts:124-127, 137-141`
**Claim:** `workflow.mdc` — "Never silently choose business logic ... log and flag."
**Evidence:** When a `PROCESSING` claim goes stale (>10 min, line 125) and is reset to `PENDING`, `attemptCount` was already incremented at claim time (line 139). On re-claim, `attemptCount` increments again. One stalled instance therefore burns 2 attempts. After `MAX_OUTBOX_ATTEMPTS = 3` the message is `FAILED` even if the provider never actually returned an error — only the instance died. This is a known trade-off of claim-based sweepers, but the double-count is not documented in code, README, or a DECISION-LOG entry. The smoke S4 overlap test does not cover the stale-claim-recovery path.

#### L5 — `purgeEmailLogs` 30-day retention is a hardcoded magic value tied to an open question
**Location:** `lib/email.ts:178`
**Claim:** `clean-code.mdc` — "Magic values — named constants / enums"; `workflow.mdc` — "Never silently choose business logic." Plan § 4 Open questions Q6: "Retention periods for ... transactional message logs ... (arm-01 Q6)."
**Evidence:** `export async function purgeEmailLogs(before = new Date(Date.now() - 30 * 24 * 60 * 60_000))` — the 30-day cutoff is an unnamed literal with no constant, no env override, and no settings field. The cron route (`app/api/cron/email-log-purge/route.ts:8`) calls `purgeEmailLogs()` with no argument, so the 30-day default is the only retention policy. The plan lists retention as an open question; the code silently picks 30 days. The `AuditEvent` records `before` (line 185) but not the policy name or rationale.

#### L6 — `sendCampaign` preferences cast is an unvalidated `Json` assertion
**Location:** `lib/email.ts:216`
**Claim:** `clean-code.mdc` — "No redundant type assertions the compiler already guarantees" (inverse: an assertion the compiler does not guarantee); Anti-Hallucination — validate before trusting.
**Evidence:** `const preferences = subscriber.preferences as { marketing?: boolean }`. `preferences` is `Json` in the schema (default `{"marketing":true,"updates":true,"reminders":true}`). The cast is unvalidated — a malformed value (e.g., `null`, a string, or `{"marketing":"yes"}`) makes `preferences.marketing` `undefined`, which is not `=== false`, so the subscriber is included. That is the safe direction (include by default), but the cast papers over the invariant rather than validating the shape. `updateNewsletterPreferences` (`lib/newsletter.ts:127-135`) writes via Zod-validated input, so well-formed rows are the norm, but a manual DB edit or migration could break the assumption silently.

## Rules not violated (noted for completeness)

- **Dependency discipline:** no new packages added in P11. `lib/resend.ts` uses native `fetch` against `https://api.resend.com/emails` — no `resend` SDK. `package.json` deps unchanged from P10. Ponytail ladder followed.
- **Naming:** no banned vague standalone names (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`) in P11 product code. `body`, `parsed`, `authorization`, `subscription`, `attempt`, `delivery`, `claim`, `retry`, `overlap` are descriptive or domain terms.
- **Comments:** no narration / change-explanation comments in P11 code.
- **UI consistency:** settings email section reuses `eyebrow`, `card`, `button`, `button secondary`, `ops-list`, `ops-row`, `lead` classes used elsewhere in the admin shell. Unsubscribe page reuses `eyebrow`, `lead`, `button`, `role="status"` patterns.
- **Security basics:** `.env` and `.env.local` in `.gitignore`; `.env.example` has placeholders for `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `EMAIL_TEST_MODE`, `NEWSLETTER_TOKEN_SECRET`, `NEWSLETTER_DELIVERY_WEBHOOK_URL`, `NEWSLETTER_DELIVERY_WEBHOOK_SECRET`, `CRON_SECRET`. Admin email route uses `authorize("settings.manage")` + `hasSameOrigin` + Zod discriminated union. Newsletter routes use `hasSameOrigin` on mutations. `authorizeCron` uses `timingSafeEqual` with a length guard and fails closed when `CRON_SECRET` is unset/empty. Unsubscribe tokens are HMAC-signed, base64url-encoded, expiry-checked, and timing-safe compared. No secrets logged.
- **Error handling:** no swallowed errors. `readUnsubscribeToken` catch returns `null` (the intended reject path for tampered tokens). Admin email route try/catch returns a JSON error.
- **Idempotency:** campaign delivery upsert on `(campaignId, subscriberId)` with `update: {}` and outbox upsert on `dedupeKey` with `update: {}` make campaign reruns duplicate-free (smoke S2 verifies). Outbox claim uses conditional `updateMany` on `status: "PENDING"` for atomic claim (smoke S4 verifies overlap).
- **Expectation files:** `.scratch/phase-plan.md` has the P11 EXPECTED block (lines 1-17) written before build. `.scratch/PHASE-P11-STATUS.md` and `.scratch/PHASE-P11-SMOKE.md` record evidence with per-check pass lines and the command set (`npm run typecheck`, `npm run smoke:p11`, both exit 0). Resolves the P10 H1 gap for this phase.
- **Codegraph:** cannot be graded from code output alone (governs agent behaviour during build, not artifact shape).
