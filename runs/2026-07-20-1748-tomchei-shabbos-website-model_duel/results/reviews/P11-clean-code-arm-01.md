# Reviewer specialist — Clean-code

**Arm:** `arm-01` (blind to model name)
**Tree / phase:** `arms/arm-01/workspace/` — P11 (Email & notification platform)
**Output:** `results/reviews/P11-clean-code-arm-01.md`
**Scope:** P11-introduced/modified files only. Findings only, no fixes.

## Severity summary

| Severity | Count |
|---|---|
| High | 4 |
| Medium | 9 |
| Low | 7 |
| **Total** | **20** |

---

## High

### H1 — God file: `src/domain/messaging.ts` (486 lines, 5+ concerns)
Mixed concerns in one module: list/template seeding, message enqueue, transactional email rendering, campaign queueing, outbox claim/sweep/retry, delivery recording, cron-run tracking, log purge. Rule: split when >500 lines **or** mixed concerns. Suggest splitting by concern (`messaging-seed`, `messaging-templates`, `messaging-campaign`, `messaging-outbox`, `messaging-purge`).

### H2 — God file: `src/domain/delivery.ts` (657 lines, mixed concerns)
Route creation, PIN access, stop delivery, fulfillment switching, geocoding, nearby search, pickup ready/stamp/expire, bulk delivery, **and** `sendPaymentReminders`. `sendPaymentReminders` (lines 633–657) is unrelated to delivery — wrong module. Split by concern; move payment reminders to a billing/messaging domain.

### H3 — Duplicated logic: refund-email enqueue (Rule of 2 → extract)
`src/app/api/admin/orders/[orderId]/refunds/route.ts` (lines 90–100) and `src/app/api/stripe/webhook/route.ts` (`processRefund`, lines 147–157) build the same `order.refund` transactional email with near-identical idempotency keys and `refundAmount`/`orderNumber` variables. Two real call sites — extract a shared `enqueueRefundEmail(transaction, order, payment, amountCents)` helper.

### H4 — Duplicated data-fetch query
`src/app/(admin)/admin/email/page.tsx` (lines 11–32) and `src/app/api/admin/email/route.ts` `GET` (lines 45–67) issue the identical four-entity Prisma query (lists, templates, campaigns, recentMessages) with the same `orderBy`/`take`/`select`. One data-fetching pattern per project — extract a `loadEmailHubState(db)` helper and share between SSR page and API.

---

## Medium

### M1 — Inconsistent error-handling pattern
`api/admin/email/route.ts` uses an `apiError(error)` helper (lines 34–39) for `AccessDeniedError`; `api/admin/orders/[orderId]/refunds/route.ts` (lines 107–112) inlines the same `AccessDeniedError` → 403 check. Two patterns for the same concern. Pick one (the helper) and apply everywhere.

### M2 — Inconsistent transaction pattern within one file
`messaging.ts` `recordSuccessfulDelivery` uses interactive `prisma.$transaction(async (tx) => …)` (line 314) while `recordFailedDelivery` uses the batch-array form `prisma.$transaction([...])` (line 366). Same module, two transaction styles. Pick one.

### M3 — Magic numbers in `messaging.ts`
`take: 5_000` (line 219), `limit ?? 100` (line 394), `attempts >= 3` (line 364), `2 ** attempts * 1_000` backoff (line 372). Max batch, max attempts, and backoff base are unnamed constants. Name them (`MAX_CAMPAIGN_RECIPIENTS`, `OUTBOX_SWEEP_BATCH`, `MAX_DELIVERY_ATTEMPTS`, `BACKOFF_BASE_MS`).

### M4 — Magic numbers in `delivery.ts`
Geocode cache TTL `30 * 24 * 60 * 60 * 1000` (lines 105, 113), pickup expiry `14 * 24 * 60 * 60 * 1000` (line 534), payment-reminder `take: 500` (line 641), nearby-candidate `take: 200` (line 437). Some constants in this file are named (`routeLinkLifetimeMs`, `pinLockMs`, `nearbyMiles`); these aren't. Inconsistent.

### M5 — `subscriberFilter` duplicates `defaultLists` field names
`messaging.ts` lines 203–209 hardcode `productUpdates` / `volunteerStories` / `communityImpact` — the same three fields already declared in `defaultLists` (lines 14–30) and in the schema. Adding a list requires editing two places; the filter should derive from `defaultLists.preferenceField` against the subscriber model fields, not a parallel if-chain. Type/schema drift risk.

### M6 — Type drift: `"EMAIL" | "SMS"` string union vs `MessageChannel` enum
`delivery-notifications.ts` `input.channel: "EMAIL" | "SMS"` (line 12) is converted via `MessageChannel[input.channel]` (line 30). Two representations of the same concept. Use `MessageChannel` directly at the API boundary.

### M7 — Type drift: loose `string` for enum fields in `email-hub.tsx`
`CampaignSummary.status: string` (line 18), `MessageSummary.channel: string` / `status: string` (lines 25–27). These mirror Prisma `CampaignStatus` / `MessageChannel` / `MessageStatus` enums but are typed as bare strings — manual projection types that can drift from the schema. Use the generated enum types.

### M8 — `ensureMessagingConfiguration` over-defensive
Called inside `enqueueTransactionalEmail` (line 179), inside the email page (line 10), and inside `api/admin/email/route.ts` `GET` (line 44). Every transactional email and every page load runs three upserts-per-list and three-per-template. Should run once at boot/seed, not on every enqueue. "Just-in-case" code — every line must have a reason.

### M9 — `queueCampaign` can strand a campaign in `SENDING`
`messaging.ts` lines 221–241 set status `SENDING`, then loop `enqueueMessage` per subscriber, then set `SENT`. If any enqueue throws mid-loop, the campaign stays `SENDING` with no recovery path. Error-handling gap for a P11 core flow.

---

## Low

### L1 — Dead prop: `CampaignSummary.sentAt`
`email-hub.tsx` line 20 declares `sentAt: string | null`; `admin/email/page.tsx` line 41 maps it; the component never renders it. Dead code across two files.

### L2 — Inconsistent projection between page and API
`admin/email/page.tsx` `messageOutbox.findMany` select (lines 22–30) omits `createdAt`; `api/admin/email/route.ts` `GET` select (lines 56–65) includes it. Same entity, two projections, no shared selector — drift waiting to happen.

### L3 — `purgeMessageLogs` reuses `cronRun.claimed`/`succeeded` for purge counts
`messaging.ts` lines 480–481 store `attempts.count + captures.count` in both `claimed` and `succeeded`. `claimed` semantically means "claimed for processing"; reusing it for a delete count is schema/semantic drift on `CronRun`.

### L4 — `response.json()` parsed before `response.ok` check
`email-hub.tsx` `refreshHub` (line 51), `createCampaign` (line 74), `campaignAction` (line 88), `saveTemplate` (line 103), `testTemplate` (line 117) all `await response.json()` unconditionally. A non-JSON error response (502 HTML, empty body) throws before the `ok` branch can set a status message. Parse defensively or check `ok` first.

### L5 — `testTransactional` idempotencyKey uses `Date.now()`
`api/admin/email/route.ts` line 117: `idempotencyKey: \`settings-test:${templateKey}:${Date.now()}\``. Each click produces a new key, so reruns are not idempotent (duplicates on retry). For a test sender this may be intentional, but it contradicts the P11 idempotent-rerun guarantee.

### L6 — Vague standalone names
`email-hub.tsx` state `message` (line 46) is a status banner, not a message entity — borderline banned-vague; prefer `statusMessage`. `delivery.ts` `hash` (line 12) is a generic SHA-256 helper alongside the specific `pinHash` — name it `sha256Hex` or similar.

### L7 — Redundant field in `enqueueMessage` create
`messaging.ts` lines 139–142 spread `...input` then re-set `recipient: input.recipient` explicitly. `recipient` is already part of `input`; the explicit line is redundant.

---

## Notes (not findings)

- `resend` dependency is pinned exactly (`6.17.2`) — good. `@vercel/blob": "^2.6.1"` is a floating range but is pre-existing, not P11-introduced.
- No narration/change-explanation comments observed in P11 code — comment quality is clean.
- UI consistency: email hub reuses the existing eyebrow + `text-4xl font-black` H1 + `bg-white` card pattern from `settings-hub.tsx` — consistent.
