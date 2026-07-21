# Aggregate Review — P11 (Email & notification platform)

**Arm:** arm-02 (blind)
**Phase:** P11
**Inputs:** `results/reviews/P11-{security,quality,rules,clean-code}-arm-02.md`
**Method:** Union + dedupe by location+claim. Security findings always survive. No new findings introduced during aggregation.

## Severity scale

Aggregated to a single scale: **Blocker** (security Critical/High) · **Major** (security Medium, quality Medium, rules High/Medium, clean-code Major) · **Minor** (security Low/Info, quality Low, rules Low, clean-code Minor/Nit).

## Counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 11 |
| Minor | 18 |
| **Total** | **29** |

## Dedupe map (merges performed)

| Canonical finding | Absorbed duplicates |
|---|---|
| S-M3 List membership not audited | Q-L5 |
| S-L1 Test-send rows re-enter sweeper on failure | Q-M4 |
| Q-L2 SMS capture gated on `EMAIL_TEST_MODE` | R-M4 |
| Q-L3 Subscriber search case-sensitive on lowercased query | R-L5 |
| R-H1 `EmailHubData` type drift | C-M1 (drift half) |
| R-M1 Dead `components/admin/email/types.ts` | C-M1 (dead-file half) |
| R-M3 `act()` / `ActFn` duplicated across hubs | C-M2 |
| R-L4 `campaignValues` computed twice in `renderCampaignBody` | C-n1 |

Note: `formatCents` is kept as **two** findings — R-M2 (duplicated across `lib/email/templates.ts` and `lib/catalog.ts`) and C-m3 (misplaced in the template registry) — same location, **different claims**.

## Findings

### Blocker
None. No Critical/High security findings. Provider secrets, cron auth, newsletter HMAC, outbox idempotency, purge safety, and CSRF posture all cleared on inspection (see security review).

### Major

1. **S-M1 — Campaign preview mints a live signed manage token for a real subscriber.** `app/api/admin/email/campaigns/[id]/route.ts` GET returns a rendered body containing `…/newsletter/preferences?token=<signed>` for `audience[0]`; the hub renders it in the DOM. Any staff member with `email.manage` can copy the 90-day token to change that subscriber's preferences or unsubscribe them — the exact impersonation posture the Subscribers tab disclaims. *(Security, Medium)*
2. **S-M2 — Test-send endpoints send to arbitrary external addresses with no `AuditLog` entry.** `campaigns/[id]/test-send/route.ts` and `admin/email/test/route.ts` dispatch via the live Resend provider to a staff-entered address; unlike sibling campaign/list/template mutations they write no audit row, so the only trail ages out via `email-log-purge`. The campaign test-send also embeds `gate.staff.realUser.name` in the body, leaking the real staff member's name to the external recipient. *(Security, Medium)*
3. **S-M3 — List membership add/remove is not audited.** `app/api/admin/email/lists/[id]/members/route.ts` mutates campaign audience composition with no `writeAudit` call, while `lists/route.ts` POST does audit. An unlogged add/remove can silently change the reach of a later `campaigns/[id]/send`. *(Security, Medium; absorbs Q-L5)*
4. **Q-M1 — `sendThroughProvider` reads three settings on every dispatch.** `lib/email/dispatch.ts:107` runs `Promise.all([getSetting("email.from_address"), "email.reply_to", "email.branding_footer"])` inside the per-row sweep loop — 300 `prisma.setting.findUnique` calls for a 100-row batch, on immutable hot rows, while holding the claimed row. Reads also run in `mock` mode (only `capture` short-circuits). *(Quality, Medium)*
5. **Q-M2 — No P11 smoke evidence file.** `arms/arm-02/workspace/.scratch/PHASE-P11-SMOKE.md` is absent (no `.scratch` dir), so EXPECTED S1–S5 cannot be corroborated from evidence. *(Quality, Medium)*
6. **Q-M3 — Purge keys on `createdAt`, not on the terminal event.** `app/api/cron/email-log-purge/route.ts:19` deletes `sent/captured/failed` rows where `createdAt < cutoff`. A notification that sat pending/sending longer than retention and finished today is purged immediately, dropping a fresh `failed` trail. Anchoring to `sentAt`/`updatedAt` would match EXPECTED S5 intent. Active outbox rows are correctly protected by the status filter. *(Quality, Medium)*
7. **R-H1 — `EmailHubData` type drift (two sources of truth).** `components/admin/email/types.ts:39-46` and `components/admin/email-hub.tsx:15-39` define `EmailHubData` with different shapes; `app/(admin)/admin/email/page.tsx:20-44` builds the `email-hub.tsx` shape, so `types.ts` is stale. A downstream tab importing from `types.ts` silently gets the wrong fields. *(Rules/clean-code, High)*
8. **R-M1 — Dead file `components/admin/email/types.ts`.** Zero imports anywhere; every export (`CampaignRow`, `EmailListRow`, `SubscriberRow`, `TemplateRow`, `OutboxCounts`, `EmailHubData`, `ActFn`) is unused. Either wire it in as the single source for R-H1 or delete it. *(Rules, Medium; absorbs C-M1 dead-file half)*
9. **R-M2 — Duplicated `formatCents`.** `lib/email/templates.ts:72-74` re-implements `lib/catalog.ts:52-54` byte-for-byte (`$${(cents / 100).toFixed(2)}`); `lib/email/transactional.ts:6` imports the duplicate instead of the canonical helper. *(Rules, Medium)*
10. **R-M3 — `act()` / `ActFn` duplicated across hubs.** Identical `act` body in `components/admin/email-hub.tsx:49-54` and `components/admin/settings-hub.tsx:25-30`; `ActFn` declared three times (`email-hub.tsx:84`, `settings/types.ts:48`, `email/types.ts:49`). Three real call sites — past the Rule-of-2 threshold. Extract a shared hub-mutation helper + type. *(Rules, Medium; absorbs C-M2)*
11. **R-M5 — Inconsistent P2002 detection pattern.** `lib/notifications.ts:32` uses a structural cast `(error as { code?: string }).code === "P2002"`; `app/api/admin/email/lists/route.ts:32` uses `error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"`. Same phase, same case — pick one. *(Rules, Medium)*

### Minor

12. **S-L1 — Test-send rows enter the cron retry outbox on failure.** Both test-send routes create a `Notification` with `status:"sending"` and call `dispatchOne`; on provider failure `dispatchOne` resets to `pending` with backoff, so the `notification-sweeper` cron retries a staff-initiated test send to an external address automatically, with no audit entry (see S-M2) and no further UI signal. *(Security, Low; absorbs Q-M4)*
13. **S-L2 — No rate limiting on admin email send endpoints.** No `rateLimit` in any `app/api/admin/email/*` route; test-send `dedupeKey` is `Date.now()`-salted, so a staff member can repeatedly fire test sends to the same external address unthrottled. Staff-gated, but amplifies S-M2. *(Security, Low)*
14. **S-L3 — Campaign preview `to` exposes a real subscriber's email.** `campaigns/[id]/route.ts` GET returns `preview.to = sample.email` (first real audience member). Already visible to `email.manage` via subscribers search, but the preview endpoint is meant to render content, not enumerate audience. *(Security, Low)*
15. **S-I1 — Preferences PATCH is a (weak) token-state oracle.** `app/api/newsletter/preferences/route.ts` returns 403 for invalid/expired token, 404 for valid token with no subscriber, 200 on success — leaking whether a signed token is still live. Not forgeable without `SESSION_SECRET`; the unsubscribe route correctly collapses all cases to 200. *(Security, Info)*
16. **S-I2 — `from`/`reply_to` settings have no email-format validation.** `lib/settings.ts` declares both as bare `z.string()` with no `.email()`; Resend rejects malformed addresses at send time, but a syntactically valid address on a spoofed domain could be accepted. Staff-gated. *(Security, Info)*
17. **Q-L1 — Campaign "not found" maps to 409, not 404.** `app/api/admin/email/campaigns/[id]/send/route.ts:17` returns 409 for every `{error}` from `sendCampaign`, including `"Campaign not found"`. The "no subscribed addresses" case is correctly 409. *(Quality, Low)*
18. **Q-L2 — SMS test mode shares the email test-mode flag.** `lib/sms/provider.ts:59` gates SMS `capture` on `env.EMAIL_TEST_MODE`; no independent SMS switch, so SMS cannot be exercised in isolation from email test mode. *(Quality, Low; absorbs R-M4)*
19. **Q-L3 — Subscriber search is case-sensitive on a lowercased query.** `app/api/admin/email/subscribers/route.ts:9` lowercases `q` then filters with `email: { contains: query }`; Prisma `contains` on Postgres is case-sensitive, so mixed-case stored emails don't match a lowercased term. Directory capped at `take: 200` with no pagination. *(Quality, Low; absorbs R-L5)*
20. **Q-L4 — `hasOverride` hides an `isEnabled`-only override.** `app/api/admin/email/templates/route.ts:24` computes `Boolean(override?.subject || override?.body)`; a manager who only toggles `isEnabled: false` has `hasOverride === false`, so the hub doesn't surface the disabled state as an override. *(Quality, Low)*
21. **Q-L6 — Campaign send has no DRAFT-status guard.** `sendCampaign` (`lib/email/campaigns.ts:51`) doesn't check `status === "DRAFT"`; re-clicking Send on a `SENT` campaign re-runs audience expansion, hits `dedupeKey` for every address (queued=0), re-marks `SENT`, and writes a second `email.campaign.send` audit entry. Idempotent for delivery, noisy in audit. *(Quality, Low)*
22. **Q-L7 — SMS mock has no exhausted-failure hook.** `lib/sms/provider.ts:41` provides only `[failonce]`; the email mock also has `+failalways` to exercise `MAX_ATTEMPTS`. SMS has no equivalent, so the SMS `failed`-terminal + audit-trail path can't be driven end-to-end (EXPECTED S3). *(Quality, Low)*
23. **R-L1 — Repeated `<textarea>` class string.** `block w-full max-w-2xl rounded-md border border-border bg-background px-3 py-2` appears at `components/admin/email-hub.tsx:123` and again at `:342`. Tokenize or componentize. *(Rules, Low)*
24. **R-L2 — `act` is a vague name.** Doesn't describe what it does (run mutation, surface outcome, refresh on success). `runMutation` / `mutateAndReport` reads clearer. *(Rules, Low)*
25. **R-L3 — Magic page-size constant.** `app/api/admin/email/subscribers/route.ts:13` uses `take: 200` with no named constant; 200 is also a silent cap with no pagination cursor. *(Rules, Low)*
26. **R-L4 — `renderCampaignBody` calls `campaignValues` twice on the fallback path.** `lib/email/campaigns.ts:23` renders, then `:27` re-calls to recover `preferencesUrl`. No correctness bug (token deterministic), but redundant work. *(Rules, Low; absorbs C-n1)*
27. **C-m1 — `email-hub.tsx` is a god file with mixed concerns.** 392 lines hosting four tab components (`CampaignsTab`, `ListsTab`, `SubscribersTab`, `TemplatesTab`) plus the shell, each with its own state/apiFetch/data shape. The settings hub splits tabs into `components/admin/settings/*-tab.tsx`; email hub should follow. Under 500 lines but mixed-concern. *(Clean-code, Minor)*
28. **C-m2 — Immediate-dispatch pattern duplicated.** `app/api/admin/email/test/route.ts:22-34` and `app/api/admin/email/campaigns/[id]/test-send/route.ts:27-39` build a `sending`+`claimedAt`+`Date.now()`-salted `dedupeKey` row then call `dispatchOne` for instant feedback. A `dispatchImmediateNotification(...)` helper in `lib/email/dispatch.ts` would remove the duplication and keep the salt convention in one place. *(Clean-code, Minor)*
29. **C-m3 — `formatCents` lives in the template registry.** `lib/email/templates.ts:72` exports a money formatter with nothing to do with templates; consumed by `lib/email/transactional.ts`. Different concern from R-M2 (which flags the duplication) — this flags the placement. *(Clean-code, Minor)*
30. **C-n2 — Magic `500` error slice.** `lib/email/dispatch.ts:80` slices the error message to `500` chars inline; the bound tracks the `lastError` column width. Name it as a constant next to `MAX_ATTEMPTS` / `BATCH_SIZE`. *(Clean-code, Nit)*

## Cleared on inspection (not findings)

- Provider secret isolation (R-171): Resend/Twilio keys never leave `lib/email/provider.ts` / `lib/sms/provider.ts`.
- Outbox idempotency/overlap: conditional claim UPDATE + `dedupeKey` unique constraint.
- Cron auth: `requireCronAuth` fails 503 without secret, constant-time bearer compare.
- Newsletter token: HMAC-SHA256, constant-time verify, expiry enforced.
- Purge safety: only `sent/captured/failed` with `createdAt < cutoff`; pending/sending untouched; retention schema-validated `>= 1`.
- Test-mode capture: `EMAIL_TEST_MODE` short-circuits to `captured` before any network call.
- Production mock-provider guard; CSRF (`sameSite=lax`, no GET mutations); SQL injection (parameterized); email body injection (plain `text` only).
- Stale-claim reaper (`STALE_CLAIM_MS`) and campaign-send idempotency via `dedupeKey` — the two High patterns from the sibling arm are absent here.
