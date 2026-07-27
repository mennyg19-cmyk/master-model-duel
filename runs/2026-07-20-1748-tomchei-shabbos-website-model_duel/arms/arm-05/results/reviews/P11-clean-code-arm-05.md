# P11 Clean-code Review — arm-05 (blind)

**Phase:** P11 — Email & notification platform
**Scope:** files added or modified by P11 initial build
**Rule:** `arms/arm-05/.cursor/rules/clean-code.mdc`
**Plan ref:** `shared/MERGED-BUILD-PLAN.md` § P11
**Reviewer:** clean-code specialist (blind — no model names)
**Verdict:** findings only — no fixes

## Files in scope

- `lib/email.ts` (new, 259 lines)
- `lib/resend.ts` (new, 27 lines)
- `lib/sms.ts` (new, 19 lines)
- `lib/newsletter.ts` (modified — P11 added `queueEmail` fallback path)
- `lib/cron-auth.ts` (new)
- `app/api/admin/email/route.ts` (new)
- `app/api/cron/email-outbox/route.ts` (new)
- `app/api/cron/email-log-purge/route.ts` (new)
- `app/api/cron/payment-reminders/route.ts` (modified)
- `app/api/cron/pickup-expiry/route.ts` (modified)
- `app/api/cron/season-auto-flip/route.ts` (modified)
- `prisma/migrations/20260728012000_p11_email_platform/migration.sql` (new)
- `prisma/schema.prisma` — `EmailLog`, `EmailOutbox`, `EmailCampaign`, `EmailCampaignDelivery`, `EmailList`, `EmailListMember`, `EmailTemplate` models

---

## Findings

### F1 — Pattern drift: `EmailLog.status` is `String` while siblings use enums
**Severity:** medium
**Location:** `prisma/schema.prisma:298`, `prisma/migrations/20260728012000_p11_email_platform/migration.sql:74`
**Claim:** The clean-code rule "one pattern per concern" requires one error-handling approach per project. Two sibling email tables use Postgres enums for status (`EmailOutboxStatus` at `migration.sql:2`, `EmailCampaignStatus` at `migration.sql:1`), but `EmailLog.status` is plain `TEXT` (`migration.sql:74`, `schema.prisma:298`). The log table is the audit trail of the outbox table — they should share a status vocabulary.
**Evidence:** `migration.sql:2` `CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING','PROCESSING','DELIVERED','FAILED')`; `migration.sql:74` `"status" TEXT NOT NULL`. `lib/email.ts:151,169` writes the string literals `"DELIVERED"` and `"FAILED"` untyped — no compile-time guard against a typo the enum would have caught.

### F2 — Inconsistent constant naming in the same file
**Severity:** low
**Location:** `lib/email.ts:5-6`
**Claim:** Module-level constants mix two conventions in the same file.
**Evidence:** `lib/email.ts:5` `const MAX_OUTBOX_ATTEMPTS = 3;` (SCREAMING_SNAKE) vs `lib/email.ts:6` `const outboxBatchSize = 25;` (camelCase). Both are module-level immutable config. Pick one.

### F3 — Inline magic numbers in outbox sweeper
**Severity:** low
**Location:** `lib/email.ts:125`, `lib/email.ts:164`, `lib/email.ts:178`
**Claim:** Three time-window constants are inlined as numeric expressions instead of named constants.
**Evidence:**
- `lib/email.ts:125` `new Date(now.getTime() - 10 * 60_000)` — 10-minute stale-claim recovery threshold.
- `lib/email.ts:164` `new Date(Date.now() + outbox.attemptCount * 60_000)` — per-attempt backoff minute.
- `lib/email.ts:178` `new Date(Date.now() - 30 * 24 * 60 * 60_000)` — 30-day retention cutoff.
The 10-minute claim TTL and the 30-day retention are policy values that belong in named constants next to `MAX_OUTBOX_ATTEMPTS`. The backoff multiplier is the only one readable in context.

### F4 — Mixed concerns in `lib/email.ts` (god-file candidate)
**Severity:** medium
**Location:** `lib/email.ts` (259 lines, 7 concerns)
**Claim:** The clean-code rule "split files by concern, not by line count — split when >500 lines, mixed concerns, or a refactor command" triggers on mixed concerns even under 500 lines. `lib/email.ts` owns: (a) transactional template defaults + variable substitution, (b) outbox queue + sweeper + retry, (c) log retention/purge, (d) subscriber lists, (e) campaigns + campaign delivery dedupe, (f) the admin hub aggregator, (g) the test sender. These are separable concerns that the plan itself lists as distinct deliverables (R-082..R-090).
**Evidence:** `lib/email.ts:8-49` templates; `lib/email.ts:51-64` queue; `lib/email.ts:122-176` sweeper; `lib/email.ts:178-187` purge; `lib/email.ts:189-199` lists; `lib/email.ts:201-247` campaigns; `lib/email.ts:249-258` hub. A split along `lib/email/{templates,outbox,lists,campaigns,hub}.ts` would let each concern be read independently.

### F5 — Test-fixture branch shipped in production code path
**Severity:** medium
**Location:** `lib/email.ts:33-36`, `lib/email.ts:115-117`
**Claim:** The anti-AI-tics rule bans "just in case code — every line must have a reason." `hasForcedFixtureFailure` reads `payload.testFailureOnce === true` and throws a synthetic provider failure purely to exercise the retry path in smoke. This is test-only logic living in the production outbox sender.
**Evidence:** `lib/email.ts:33-36` `function hasForcedFixtureFailure(payload, attemptCount) { return ... payload.testFailureOnce === true && attemptCount === 1; }`; called at `lib/email.ts:115`. The smoke script (`scripts/smoke-p11.ts:99`) sets `payload: { testFailureOnce: true }` to exercise it. Production callers never set this key, so the branch is dead in any non-test path. Either gate it behind `EMAIL_TEST_MODE` or move the failure injection into the test harness.

### F6 — Read endpoint writes on every call
**Severity:** medium
**Location:** `lib/email.ts:249-250`, `lib/email.ts:38-45`
**Claim:** `emailHub()` is the GET handler for the admin email screen, but it calls `ensureDefaultEmailTemplates()` — which fires three `upsert` writes against `EmailTemplate` — on every hub read. Read endpoints should not write. The same pattern repeats per lifecycle email: `queueOrderLifecycleEmail` → `templateFor` → `upsert` on every queue.
**Evidence:** `lib/email.ts:249-250` `export async function emailHub() { await ensureDefaultEmailTemplates(); ... }`; `lib/email.ts:77` `const template = await templateFor(key);` inside `queueOrderLifecycleEmail`. Seeding defaults belongs in a migration or a one-time bootstrap, not a per-request upsert. At 5k orders the template table is re-upserted 5k times for nothing.

### F7 — Duplicated cron route boilerplate (5 sites)
**Severity:** low
**Location:** `app/api/cron/email-outbox/route.ts`, `app/api/cron/email-log-purge/route.ts`, `app/api/cron/payment-reminders/route.ts`, `app/api/cron/pickup-expiry/route.ts`, `app/api/cron/season-auto-flip/route.ts`
**Claim:** Five cron route handlers are copy-paste: import `authorizeCron`, call it, return its rejection or `NextResponse.json(await handler())`, then `export const POST = GET`. Rule of 2 is satisfied (5 call sites). A `makeCronRoute(handler)` factory would remove the boilerplate and make the auth pattern impossible to drift.
**Evidence:** All five files are 11 lines each with identical shape. `email-outbox/route.ts:5-11` is representative.

### F8 — Inconsistent rejection variable name across cron routes
**Severity:** low
**Location:** `app/api/cron/season-auto-flip/route.ts:6` vs the other four cron routes
**Claim:** Four cron routes name the auth rejection `rejected`; `season-auto-flip` names it `unauthorized`. Same concept, different name, same patch.
**Evidence:** `email-outbox/route.ts:6` `const rejected = authorizeCron(request);`; `payment-reminders/route.ts:6` same; `pickup-expiry/route.ts:6` same; `email-log-purge/route.ts:6` same; `season-auto-flip/route.ts:6` `const unauthorized = authorizeCron(request);`.

### F9 — Premature extraction: `lib/sms.ts` has a single call site
**Severity:** low
**Location:** `lib/sms.ts` (whole file, 19 lines), `lib/delivery.ts:6,106`
**Claim:** Rule of 2 requires 2+ real call sites before extracting. `dispatchSms` has exactly one caller (`captureNotification` in `lib/delivery.ts:106`). The plan does call for an "SMS dispatch module reused by P9" (G-021), but P9 already shipped and currently routes both SMS and non-SMS through `captureNotification` — the module is not yet reused, it is only invoked.
**Evidence:** Grep for `dispatchSms` returns two hits: the definition in `lib/sms.ts:12` and the single call in `lib/delivery.ts:106`. Either inline until a second caller exists, or wire P9's other notification paths through it so the extraction earns its keep.

### F10 — Duplicated notification-write logic between `captureNotification` and `dispatchSms`
**Severity:** medium
**Location:** `lib/delivery.ts:98-112`, `lib/sms.ts:12-18`
**Claim:** Both functions write to `prisma.deliveryNotification` with the same idempotent-upsert shape. `captureNotification` branches: if `channel === "SMS"` it delegates to `dispatchSms` (which hardcodes `channel: "SMS"` and ignores `input.channel`); otherwise it inlines the same upsert using `input.channel`. Two code paths, one table, slightly different field handling.
**Evidence:** `lib/delivery.ts:106-111`:
```ts
if (input.channel === "SMS") return dispatchSms(input);
return prisma.deliveryNotification.upsert({
  where: { dedupeKey: input.dedupeKey },
  create: input,
  update: {},
});
```
`lib/sms.ts:13-17`:
```ts
return prisma.deliveryNotification.upsert({
  where: { dedupeKey: input.dedupeKey },
  create: { ...input, channel: "SMS" },
  update: {},
});
```
The SMS branch silently drops `input.channel` (always becomes `"SMS"`); the inline branch trusts it. One helper should own the write.

### F11 — Sequential `await` in a for-loop over potentially 5k subscribers
**Severity:** medium
**Location:** `lib/email.ts:215-232`
**Claim:** `sendCampaign` iterates subscribers with `await` inside a `for` loop, queueing one by one. The plan's non-functional baseline is 1,000+ orders / 5,000+ packages / 10 concurrent staff (G-024). A campaign to all confirmed subscribers at that scale serializes 5k DB upserts + 5k outbox upserts.
**Evidence:** `lib/email.ts:215` `for (const subscriber of subscribers) { ... await prisma.emailCampaignDelivery.upsert(...); await queueEmail(...); queued += 1; }`. No batching, no concurrency. The outbox sweeper itself uses a bounded batch (`outboxBatchSize = 25`), so the pattern exists in the same file — just not applied here.

### F12 — Implicit fall-through handler for explicit `sweep` action
**Severity:** low
**Location:** `app/api/admin/email/route.ts:30,69`
**Claim:** The discriminated union declares `action: z.literal("sweep")` (`route.ts:30`) but no `if (parsed.data.action === "sweep")` branch exists. The action is handled by the final catch-all `return NextResponse.json(await sweepEmailOutbox())` at `route.ts:69`. Every other action has an explicit branch; `sweep` relies on fall-through. A reader has to infer that the catch-all is the sweep handler.
**Evidence:** `route.ts:46-68` branches on every action except `sweep`; `route.ts:69` is the fall-through that returns the sweep result. Either add an explicit `sweep` branch or drop the literal from the union and document the default.

### F13 — `sendCampaign` marks campaign `SENT` regardless of queue outcome
**Severity:** low
**Location:** `lib/email.ts:233`
**Claim:** The campaign status is flipped to `SENT` unconditionally after the loop, even if every subscriber was skipped by the marketing-preference filter (`lib/email.ts:217`) or `queued === 0`. The status no longer reflects whether anyone was actually mailed.
**Evidence:** `lib/email.ts:217` `if (preferences.marketing === false) continue;` can skip all subscribers; `lib/email.ts:233` `await prisma.emailCampaign.update({ where: { id: campaignId }, data: { status: "SENT" } });` runs regardless. A `QUEUED` or `sentCount`-aware status would track reality.

### F14 — Admin test-send couples to immediate sweep
**Severity:** low
**Location:** `app/api/admin/email/route.ts:54,64`
**Claim:** The `test_campaign` and `test_email` actions both call `sweepEmailOutbox()` inline after queueing. The sweep is also exposed as its own explicit action (`route.ts:30,69`). Three entry points trigger the same sweeper from one route. The test-send handler now does two things (queue + sweep) instead of one.
**Evidence:** `route.ts:53-54` `await testSendCampaign(...); return NextResponse.json(await sweepEmailOutbox());`; `route.ts:63-64` same shape. The sweep action at `route.ts:69` is the canonical trigger. Test-send should queue and let the cron or an explicit sweep handle delivery — coupling here makes test-sends compete with the cron sweeper for the same outbox rows.

---

## Summary counts

| Severity | Count |
|---|---|
| medium | 6 |
| low | 8 |
| high | 0 |
| **Total** | **14** |

**By category:**
- Pattern drift / one-pattern-per-concern: F1, F10
- God file / mixed concerns: F4
- Magic values / inconsistent constants: F2, F3
- Anti-AI-tics / just-in-case code: F5
- Read-endpoint-writes / per-request upsert: F6
- Duplicated logic / boilerplate: F7, F10, F14
- Inconsistent naming: F2, F8
- Rule of 2 / premature extraction: F9
- Performance pattern (sequential await at scale): F11
- Implicit control flow: F12
- Logic / status fidelity: F13

No high-severity findings. No naming violations from the banned list (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`) observed in P11 code. No narration or change-explanation comments in the new code.
