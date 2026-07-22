# P11 Aggregate Review — arm-03 (blind)

**Aggregator:** orchestrator (external reviewer union)
**Phase:** P11 — Email & notification platform
**Inputs:** `results/reviews/P11-{security,quality,rules,clean-code}-arm-03.md`
**Method:** Union of all findings, deduped by location + claim. No new findings introduced. Severity remapped per aggregation rules: Security Critical/High on trust-boundary/IDOR/money → Blocker; other High/Medium → Major; Low/Info → Minor.

## Counts

| Tier | Count |
|---|---|
| Blockers | 0 |
| Majors | 13 |
| Minors | 36 |
| **Total** | **49** |

## Blockers

None. All four reviewers agree trust boundaries are well-drawn: newsletter tokens are HMAC-signed with `SESSION_SECRET` and verified with `timingSafeEqual`; subscriber-scoped actions key off the signed token (no IDOR); campaign/template/list/member/subscriber/test mutations sit behind `email.manage` via `requirePermissionApi`; cron endpoints fail-closed (503) without `CRON_SECRET` with constant-time bearer compare; env validation refuses public `SESSION_SECRET` defaults and production without `RESEND_API_KEY`/`TRUST_PROXY`. No exploitable hole found.

## Majors (High / Medium)

| ID | Sources | Severity | Location | Claim |
|---|---|---|---|---|
| A-01 | Q-01 | High | `.env` `RESEND_API_KEY=mock` | `mock` is truthy → resend mode active → 401 on every send; breaks next smoke rerun. Remove or unset. |
| A-02 | Q-02 | High | `lib/email/provider.ts:75`, `lib/sms/provider.ts:59` | `EMAIL_MODE`/`SMS_MODE`/`EMAIL_FROM` env vars are dead; SMS capture coupled to `EMAIL_TEST_MODE`. Wire them in or delete and document single capture switch. |
| A-03 | Q-03 | Medium | `PHASE-P11-SMOKE.json` vs smoke scripts | Published S5 JSON fields not emitted by any script; SMS capture never exercised. Re-run with real SMS assertion and regenerate from script output. |
| A-04 | Q-04 | Medium | `app/api/cron/notification-sweeper` + `lib/email/dispatch.ts:92-99` | Post-send DB transaction failure leaves row `sending`; sweeper reclaims after `STALE_CLAIM_MS` → duplicate delivery. Violates EXPECTED S2/S3. Mark sent pre-provider or persist send-intent. |
| A-05 | Q-05, F-07 | Medium | `campaigns/[id]/test-send/route.ts`, `admin/email/test/route.ts` | Test-send rows `status:"sending"` → on failure `dispatchOne` flips to `pending` → production sweeper retries to external address for ~80 min. Mark test rows terminal-on-fail or `kind` the sweeper skips. |
| A-06 | Q-06, P11-CC-01 | Medium | `lib/email/dispatch.ts:31-39` `createEmailSettingsLoader` | `cached ??=` caches the promise; a rejected first read poisons the whole sweep. Reset `cached = null` on rejection. |
| A-07 | Q-08, F-03, P11-CC-02 | Medium | `app/api/newsletter/preferences/route.ts:22-28` | `.catch(() => null)` swallows every error → misleading 404. Catch only `P2025`; rethrow rest. |
| A-08 | F-04, P11-CC-02 | Medium | `app/api/newsletter/unsubscribe/route.ts:18-23` | Same swallow pattern; DB failure silently reported `ok:true` — subscriber thinks unsubscribed but row unchanged (CAN-SPAM). Catch only `P2025`. |
| A-09 | F-01 | Medium | `lib/notifications.ts:62-77` `notifyCustomer` | SMS body reuses email body verbatim (multi-paragraph + URLs). Real Twilio would split/fail. Give SMS its own short body. |
| A-10 | F-02 | Medium | `app/api/admin/email/campaigns/[id]/route.ts:21` (GET preview) | `campaignAudience` `findMany` loads all rows just for `length`. Use `count` for preview. |
| A-11 | Q-11, P11-CC-03 | Medium | `prisma/schema.prisma:892` + 4 files | `Notification.status` / `NotificationAttempt.outcome` free-form `String`; lifecycle literals repeated across files. Promote to enum / shared const map. |
| A-12 | F-05 | Low-Med | `lib/settings.ts:49-50` | `email.from_address` / `email.reply_to` are `z.string()` with no email-format validation. Use `z.string().email()` (or `.min(1)`). |
| A-13 | F-06, Q-16 | Low-Med | `lib/email/campaigns.ts:51-84` `sendCampaign` | Per-recipient loop, no batching; enqueue + `Campaign.status=SENT` not transactional → crash mid-send leaves partial queue and wrong `queuedCount`. Batch `createMany` + wrap in transaction or count queued rows after. |

## Minors (Low / Info)

### Security hardening / guardrails

| ID | Sources | Severity | Location | Claim |
|---|---|---|---|---|
| M-01 | P11-S1 | minor | `lib/cron.ts` `runCronJob`; all cron routes | No cron-level overlap lock; two simultaneous invocations both run and both log. Atomically claim job via unique `running` row. |
| M-02 | P11-S2 | minor | `app/api/cron/email-log-purge/route.ts`; `lib/settings.ts` | No min bound on `email.log_retention_days`; `0`/negative wipes audit trail. Clamp to minimum (e.g. `Math.max(.,7)`). |
| M-03 | P11-S3 | minor | `campaigns/[id]/test-send/route.ts:30-42` | Test-send `db.notification.create` (not `captureNotification`); same-ms `dedupeKey` collision → unhandled `P2002` → 500. Use `captureNotification` or catch `P2002`. |
| M-04 | P11-S4 | info | `campaigns/[id]/test-send/route.ts:29` | Test-send mints a live signed token for the test recipient. Acceptable (recipient's own link); could use inert placeholder for preview-only. |
| M-05 | P11-S5 | info | `app/api/newsletter/preferences/route.ts:22-31` | 404-vs-200 reveals subscription status, but only to `SESSION_SECRET` holders (who can already forge). Acceptable; could mirror unsubscribe's idempotent 200. |
| M-06 | P11-S6 | info | `lib/email/provider.ts:48-49`, `lib/sms/provider.ts:33-34` | Provider error text surfaces upstream `body.message` to staff/logs. No secret logged. Acceptable for staff diagnosis; scrub at display layer if shown to non-staff. |
| M-07 | P11-S7 | info | `lib/email/campaigns.ts:34-43` `campaignAudience` | No `take` cap on audience query; unbounded in-memory array at scale (P12 territory). Add cap/streaming when scaling. |
| M-08 | P11-S8 | info | `lib/rate-limit.ts:9-21`; `subscribe/route.ts:11` | In-memory per-process rate limiter; dev self-DoS with `TRUST_PROXY` off. Back with shared store at horizontal scale. |

### Quality / correctness (Low)

| ID | Sources | Severity | Location | Claim |
|---|---|---|---|---|
| M-09 | Q-07 | Low | `app/api/admin/email/templates/route.ts:31-55`; `lib/email/templates.ts:60-70` | Empty-string subject/body overrides accepted (`""` not nullish) → blank subject/body. Reject `""` or coerce to `null`. |
| M-10 | Q-09 | Low | `app/api/cron/payment-reminders/route.ts:39-48` | `payment_reminder` emails raw `captureNotification`, not in `TEMPLATE_DEFAULTS` → unmanaged from Templates tab. Register or document as intentionally unmanaged. |
| M-11 | Q-10 | Low | `.scratch/PHASE-P11-SMOKE.md` line 1 | Workspace smoke copy header says "arm-02"; canonical `results/` copy is correct. Fix header or delete stale `.scratch` copy. |
| M-12 | Q-12 | Low | `prisma/schema.prisma:974` `Campaign.createdByStaffId` | `String?` with no FK to `StaffUser` → dangling creator ids on staff delete. Add `onDelete: SetNull` relation + migration. |
| M-13 | Q-13 | Low | `app/api/cron/` S4 coverage | `stripe-reconciliation` cron not exercised in S4 smoke (uses same `requireCronAuth`). Add to S4 loop. |
| M-14 | Q-14 | Low | `components/admin/email-hub.tsx` `CampaignsTab` | "Send"/"Re-run send" always shows static "Campaign queued" regardless of `queued`/`skippedDuplicates`. Surface API numbers. |
| M-15 | Q-15 | Low | `email-hub.tsx` `TemplatesTab`/`ListsTab`/`CampaignsTab` | Local form state not cleared after `act` success; inputs retain submitted values. Clear state or key form off refreshed prop. |

### Rules compliance (Low)

| ID | Sources | Severity | Location | Claim |
|---|---|---|---|---|
| M-16 | F-08 | Low | `lib/sms/provider.ts:41-53` `mockSmsProvider` | Only `[failonce]`, no `[failalways]`; SMS can't exercise exhausted-retry flow in mock. Add `[failalways]` branch mirroring email mock. |
| M-17 | F-09 | Low | `lib/email/provider.ts:71-82`, `lib/sms/provider.ts:55-66` | Provider module-memoized; mode chosen once per process. No runtime toggle without restart. Record as known constraint; expose `resetEmailProvider()` test hook if ever needed. |
| M-18 | F-10 | Low | `app/api/admin/email/subscribers/route.ts:13` | `take:200` no cursor/offset; beyond newest 200 invisible with no truncation indicator. Add `count` total + "showing newest 200" note, or paginate. |
| M-19 | F-11 | Low | `lib/email/templates.ts:11-45` `TEMPLATE_DEFAULTS` | Defaults WIN1252-safe but override PATCH has no charset check; Unicode paste breaks dev DB write. Fix dev client encoding to UTF-8 or validate/notes in UI. |
| M-20 | F-12 | Low | `lib/payments/post-payment.ts:144-159` `resolveStaffRefund` | `enqueueRefundEmail` outside transaction with `payment.update`; enqueue throw → refund recorded, no email, no retry. Wrap both writes or use outbox sweeper semantics. |
| M-21 | F-13 | Low | `lib/email/dispatch.ts:103` | `backoffMinutes` computed even when `exhausted` (value unused in `failed` branch). Dead computation. Move into non-exhausted branch only. |
| M-22 | F-14 | Low | `components/admin/settings/email-tab.tsx:89` | `Number(retention)` of empty input is `NaN`/`0` → generic PATCH error; no `type="number"`/`min`. Use `<Input type="number" min={1}>` + disable Save on invalid. |
| M-23 | F-15 | Low | `app/api/admin/email/lists` | No DELETE route for lists or subscribers; misspelled list lives forever. Add `DELETE /lists/[id]` (cascade) + subscriber delete, or document DB-only removal. |
| M-24 | F-16 | Low | `tests/email-platform.test.ts` | Only 3 tests (template render + `formatCents`); no unit tests for dispatch claim/backoff, dedupe collision, token tamper/expired. Add unit tests so `npm run ci` catches regressions. |

### Clean code (Low)

| ID | Sources | Severity | Location | Claim |
|---|---|---|---|---|
| M-25 | P11-CC-04 | Low | `app/api/admin/email/templates/route.ts:12-27` | GET runs two queries per template key; second `findUnique` duplicates `resolveTemplate` work. Have `resolveTemplate` return the override row or derive `hasOverride`. |
| M-26 | P11-CC-05 | Low | `test-send/route.ts:30-42`, `admin/email/test/route.ts:23-35` | Duplicated "enqueue + dispatch immediately" pattern (Rule of 2 met). Extract `dispatchNow(input)` helper. |
| M-27 | P11-CC-06 | Low | `lib/email/provider.ts:71-82`, `lib/sms/provider.ts:55-66` | Duplicated module-level singleton factory with byte-identical capture branch. Share `createCaptureProvider(prefix)` helper. |
| M-28 | P11-CC-07 | Low | `lib/email/dispatch.ts:43-66` | `claimable` `where` condition duplicated between `due` query and claim `updateMany`; must stay in sync by hand. Extract `claimable(now, staleCutoff)` helper. |
| M-29 | P11-CC-08 | Low | `components/admin/email-hub.tsx:233-283` `SubscribersTab` | Inline row type literal mirrors API/Prisma shape; type drift risk. Move into `components/admin/email/types.ts`. |
| M-30 | P11-CC-09 | Low | `app/(admin)/admin/email/page.tsx:20-32`, `email-hub.tsx:53-176` | `EmailHubData["campaigns"]` ships `body`/`listId` that `CampaignsTab` never reads. Dead payload across server/client boundary. Drop from `CampaignRow`. |
| M-31 | P11-CC-10 | Low | `subscribers/route.ts:16-20`, `email-hub.tsx:240-244` | Endpoint returns `counts` but `SubscribersTab` ignores it; subscriber counts fetched twice. Drop `counts` or consume it and drop page-level count query. |
| M-32 | P11-CC-11 | Low | `email-log-purge/route.ts:13-29`, `notification-sweeper/route.ts:9-15` | Both cron routes repeat `requireCronAuth` + `runCronJob` + `POST as GET` boilerplate. Add `cronHandler(jobName, fn)` wrapper in `lib/cron.ts`. |
| M-33 | P11-CC-12 | Low | `lib/email/campaigns.ts:22-28` `renderCampaignBody` | `campaignValues(subscriber, token)` called twice (render + appended URL). Compute once and reuse. |
| M-34 | P11-CC-13 | Low | `dispatch.ts:101`, `subscribers/route.ts:13`, `lib/cron.ts:37` | Scattered unnamed magic numbers (`slice(0,500)`, `take:200`). Name them (`MAX_ERROR_CHARS`, `SUBSCRIBER_SEARCH_LIMIT`) or reference shared constant. |
| M-35 | P11-CC-14 | Low | `components/admin/email-hub.tsx` (358 lines) | Single file holds `EmailHub` + 4 tab components; mixed concerns. Split each tab into `components/admin/email-hub/*-tab.tsx` with `email-hub.tsx` as shell. |
| M-36 | P11-CC-15 | Low | `email-hub.tsx:90,309` | Raw textarea class string repeated verbatim; no `Textarea` primitive. Add `Textarea` UI primitive or extract class constant. |

## Dedupe notes

- **A-06** = Q-06 + P11-CC-01 (same location `dispatch.ts:31-39`, same poisoned-promise-cache claim).
- **A-07** = Q-08 + F-03 + P11-CC-02 (preferences route, `.catch(()=>null)` swallow).
- **A-08** = F-04 + P11-CC-02 (unsubscribe route, same swallow pattern, distinct location from A-07).
- **A-11** = Q-11 + P11-CC-03 (`Notification.status` free-form String / repeated literals).
- **A-13** = F-06 + Q-16 (sendCampaign transaction integrity + batching; reviewer disagreement on DRAFT-vs-SENT post-crash state recorded, not resolved here — both flag the missing transaction).
- **A-05** = Q-05 + F-07 (test-send rows ride production sweeper). P11-CC-05 kept separate (M-26): code-duplication claim, not behavior.
- P11-S3 (M-03) distinct from A-05: P2002-collision handling vs retry-path behavior — different claims, kept separate.

No new findings introduced during aggregation.
