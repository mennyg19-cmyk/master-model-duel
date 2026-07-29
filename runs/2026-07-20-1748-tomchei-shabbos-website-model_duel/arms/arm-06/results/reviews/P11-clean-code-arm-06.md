# P11 — Clean-code review (arm-06, blind)

**Phase:** P11 — Email & notification platform
**Surface reviewed:** `lib/email/**`, `lib/notify/**`, `lib/newsletter/**`, `app/api/admin/email/**`, `app/api/cron/{outbox-sweep,email-log-purge,payment-reminders}/**`, `app/api/{subscribe,unsubscribe}/**`, `app/(admin)/admin/email/**`, `components/admin/email/**`, `prisma/schema.prisma` (P11 models)
**Rules applied:** `arms/arm-06/.cursor/rules/clean-code.mdc`, `vocabulary.mdc`, `ponytail.mdc`
**Scope:** findings only, no fixes. Blind to model name.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 5 |
| Minor | 7 |
| **Total** | **12** |

No god files (largest is `components/admin/email/campaign-editor.tsx` at 285 lines). No swallowed errors, no narration comments, no defensive code for impossible branches. The P11 surface is well-factored at the module level (Resend/Twilio SDK isolation, single renderer, single dispatcher, single sweeper). Findings cluster around three themes: (1) a duplicated claim-and-deliver loop, (2) duplicated cron/admin route boilerplate, and (3) type/schema drift between the outbox `kind`/`channel` columns and the TS unions that name them, plus a client/server response-shape drift that silently breaks the test-send error path.

## Major

### M1 — Duplicated claim-and-deliver loop (outbox sweep vs campaign send)
**Files:** `lib/email/outbox-sweep.ts:49-81`, `lib/email/campaigns.ts:117-148`
**Category:** Duplicated logic / copy-paste with minor variations.

Both functions implement the same pattern: filter candidate rows → per-row atomic `updateMany` claim (status in `[PENDING, FAILED]` → `SENDING`, `attempts: { increment: 1 }`) → `deliverMessage` → on success `update` to `SENT` with `providerId`/`sentAt`/`lastError: null` → on failure `update` to `FAILED` with `lastError`. The catch block (`error instanceof Error ? error.message : String(error)`) is identical verbatim. The clean-code rule "No copy-paste patterns with minor variations — extract the pattern" applies directly; Rule of 2 is met (exactly two call sites). The variation is only the model (`OutboxMessage` vs `EmailCampaignRecipient`) and the SENT payload fields, both of which a generic `claimAndDeliver` helper can parameterize.

### M2 — Duplicated cron route handler shape
**Files:** `app/api/cron/outbox-sweep/route.ts`, `app/api/cron/email-log-purge/route.ts`, `app/api/cron/payment-reminders/route.ts` (and the four other cron routes in `app/api/cron/**` follow the same shape).
**Category:** Duplicated logic / pattern drift.

Every cron `GET` is the same skeleton: `if (!isCronAuthorized(request)) return 401;` → `try { const result = await <fn>(); return NextResponse.json({ ok: true, ...result }); } catch (error) { const mapped = mapDomainError(error); if (mapped) return mapped; throw error; }`. Seven routes, identical control flow. Extract a `withCronAuth(handler)` wrapper (or a `cronRoute(fn)` helper) so the auth + error-map contract lives in one place. Today a change to the auth check or error mapping requires editing seven files in lockstep.

### M3 — Type drift between `testSendCampaign` response and `CampaignEditor` client (functional bug)
**Files:** `lib/email/campaigns.ts:34` (server return type), `components/admin/email/campaign-editor.tsx:91-104` (client generic + reads).
**Category:** Type/schema drift.

Server contract: `{ outboxId: string; delivered: boolean; lastError: string | null }`.
Client generic: `apiFetch<{ delivered: boolean; providerId: string | null; error: string | null }>`.

The client reads `result.body.providerId` (line 96) and `result.body.error` (line 99), neither of which exists in the server response. Effects:
- On a failed test send (`ok: true`, `delivered: false`), `result.body.error` is `undefined`, so the UI always shows `"Test email failed: unknown"`.
- The delivered-case message references `result.body.providerId` which is also `undefined` → `"provider n/a"` always.

The `apiFetch` generic is a lie the compiler accepts because the success body is structurally compatible enough to type-check. This is a real user-visible bug sourced in type drift, not just style.

### M4 — `OutboxMessage.kind` / `channel` are free strings while code holds three separate vocabularies
**Files:** `prisma/schema.prisma:1048-1069` (`OutboxMessage`), `lib/notify/outbox.ts:16-31` (`NotificationKind`), `lib/email/triggered.ts:10-11` (`TriggeredKey`), `lib/email/campaigns.ts:41` (literal `"campaign_test"`).
**Category:** Type/schema drift — no single source of truth.

`OutboxMessage.kind` and `.channel` are `String` in the schema (no enum). The codebase names the legal values in three places that don't share a type:
- `NotificationKind` = `"day_of_delivery" | "bulk_scheduled" | "pickup_ready" | "pickup_expired" | "payment_reminder"` (P9 notification seam).
- `TriggeredKey` = `"order_confirmation" | "payment_link" | "refund_issued" | "subscription_manage"` (P11 transactional).
- `"campaign_test"` literal in `testSendCampaign`, not in any union.

`channel` is similarly a free string while `NotificationChannel = "EMAIL" | "SMS"` exists only in `lib/notify/outbox.ts`. `deliverMessage` (`lib/email/dispatch.ts:20`) compares `message.channel === "SMS"` against an untyped string. A typo in any `kind`/`channel` write site is not caught at compile time or by the DB. Centralize the vocabulary into one union (or a Prisma enum) and have every producer reference it.

### M5 — `getEmailBranding()` is an uncached DB hit called per message in the campaign send loop
**Files:** `lib/email/dispatch.ts:32` (called from `deliverMessage`), `lib/email/campaigns.ts:109` + the loop at `117-148`, `lib/settings.ts:70-74` (no cache).
**Category:** Pattern drift / hot-path inefficiency.

`getSetting` hits `prisma.setting.findUnique` on every call — no memoization. `sendCampaign` fetches branding once at line 109, then `deliverMessage` fetches it again per recipient inside the loop (line 32). For a 1000-recipient campaign that is ~1001 DB round-trips for branding that does not change mid-send. `testSendCampaign` double-fetches the same way (line 36 then line 50). Either pass the already-fetched branding into `deliverMessage`, or cache `getSetting` for the request lifetime. The dispatcher's signature already accepts a `Pick<OutboxMessage, ...>`; threading a `branding` arg is the smaller change.

## Minor

### m1 — Two approaches for status → badge tone
**Files:** `components/admin/email/campaigns-tab.tsx:32-37` (`STATUS_TONES` record), `components/admin/email/campaign-editor.tsx:34-40` (`RECIPIENT_TONES` record) vs `components/admin/email/email-tabs.tsx:114-118` (inline ternary chain for outbox status), `campaign-editor.tsx:133` (inline ternary chain for campaign header status).
**Category:** Pattern drift — one concern, two approaches.

The record-map form is used in two places; the inline ternary form (`status === "SENT" ? "green" : status === "FAILED" ? "red" : ...`) is used in two other places for the same status→tone concern. Pick one (the record form) and reuse it for the outbox and campaign-header badges.

### m2 — Inconsistent magic truncation lengths for `lastError` display
**Files:** `components/admin/email/email-tabs.tsx:123` (`slice(0, 60)`), `components/admin/email/campaign-editor.tsx:264` (`slice(0, 50)`).
**Category:** Magic values / pattern drift.

Same concept (truncate an error string for a table cell) with two different lengths. Pick one constant and reuse, or drop the truncation and rely on `title` for the full text (both sites already set `title={...lastError}`).

### m3 — Vague name `data` + over-verbose conditional spreads in triggered override PATCH
**File:** `app/api/admin/email/triggered/[key]/route.ts:37-42`.
**Category:** Naming (banned word) + anti-AI-tic (over-verbose code).

`const data = { ... }` uses `data`, which `clean-code.mdc` bans as a standalone name. The four conditional spreads (`parsed.data.enabled !== undefined ? { enabled: ... } : {}` ×4) strip `undefined` values, which Prisma's `update` ignores anyway. The whole block reduces to `const override = await prisma.emailTriggeredOverride.upsert({ where: { key }, update: parsed.data, create: { key, ...parsed.data } })`. Rename and simplify.

### m4 — `getCampaignOrThrow` helper not reused by the campaign detail route
**Files:** `lib/email/campaigns.ts:15-22` (helper), `app/api/admin/email/campaigns/[id]/route.ts:26-33` (GET) and `46-47` (PATCH).
**Category:** Pattern drift / missed reuse.

The helper exists and is used by `testSendCampaign` and `sendCampaign`, but the detail route's GET and PATCH each do their own `prisma.emailCampaign.findUnique` + 404 return. The PATCH additionally throws `DomainRuleError` for non-DRAFT, which the helper doesn't — so either widen the helper or call it for the lookup and keep the status check local. As-is, the 404 shape (`{ error: "EmailCampaign not found" }`) is duplicated in three places.

### m5 — Repeated `prisma.emailList.findUnique` + 404 pattern
**Files:** `app/api/admin/email/campaigns/route.ts:40-41`, `app/api/admin/email/campaigns/[id]/route.ts:52-53`, `app/api/admin/email/lists/[id]/members/route.ts:23-26`.
**Category:** Duplicated logic (Rule of 2 met — 3 sites).

Same `findUnique` + `return 404 "EmailList not found"` in three handlers. A `getEmailListOrThrow(id)` helper (mirroring `getCampaignOrThrow`) would collapse these and make the 404 message consistent.

### m6 — Magic number `take: 20` for recent outbox
**File:** `app/(admin)/admin/email/page.tsx:32`.
**Category:** Magic value.

The "20 most recent outbox rows" limit is a literal in the page query. The `email-tabs.tsx` copy at line 91 also hardcodes "20 most recent" in prose, so the two must stay in sync manually. Lift to a named constant shared by the query and the copy, or at least reference one from the other.

### m7 — `subscribers-tab.tsx` pref-toggle onChange rebuilds the prefs object with three inline ternaries
**File:** `components/admin/email/subscribers-tab.tsx:71-73`.
**Category:** Anti-AI-tic (over-verbose code that does in 3 lines what could be done in 1).

The three-line ternary (`field === "prefNewProducts" ? !subscriber.prefNewProducts : subscriber.prefNewProducts` ×3) can be a computed-key spread: `{ ...subscriber (prefs fields), [field]: !subscriber[field] }`. Minor, but it's the kind of copy-paste-with-one-variation the rules flag.

## Notes (not findings)

- `lib/email/resend.ts` and `lib/notify/sms.ts` are deliberately SDK-isolated with native `fetch` (ponytail ladder rung 4) — correct call, no `resend`/`twilio` npm dep added.
- Comment quality across the P11 surface is high: comments cite R-XXX IDs and explain trade-offs (e.g. `outbox-sweep.ts:7-12`, `campaigns.ts:8-13`, `dispatch.ts:7-12`). No narration or change-explanation comments found.
- No swallowed errors: the sweep/purge catch blocks record `lastError`/`message` and rethrow; the per-message catch in the sweep records and continues (intentional retry semantics).
- No defensive code for impossible branches detected.
- No dead code detected in the reviewed surface.
