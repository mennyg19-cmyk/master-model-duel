# Aggregate Review — P11 — arm-06

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-06 (late join)
**Phase:** P11 — Email & notification platform
**Inputs:** P11-security, P11-quality, P11-rules, P11-clean-code (arm-06, all blind)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings. Mixed-severity clusters resolve to the highest severity (Blocker > Major > Minor).

## Counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 13 |
| Minor | 25 |
| **Total** | **38** |

Source totals (pre-dedupe): security 7 (0B/2M/5m), quality 11 (0B/3M/8m), rules 13 (0B/5M/8m), clean-code 12 (0B/5M/7m) = 43. 5 clusters merged (M2: security Major 2 + quality Major 2 + rules Major 2 → Major; M4: security Minor 4 + quality Major 3 → Major; M12: rules Minor 2 + clean-code Major 4 → Major; m8: quality Minor 4 + rules Minor 8 → Minor) → 5 duplicates removed → net 38 unique. No security blockers were raised by any specialist.

## Blockers (0)

None.

## Majors (13)

### M1 — Email hub admin routes gated on `customers.manage` (over-broad authz)
**Sources:** security Major 1
**Location:** `app/api/admin/email/campaigns/**`, `app/api/admin/email/subscribers/**`, `app/api/admin/email/lists/**`, `app/api/admin/email/templates/**`, `app/api/admin/email/triggered/**`; `lib/permissions.ts:22`
**Claim:** Every P11 admin route gates on `requireApiPermission("customers.manage")`, which `lib/permissions.ts:22` places in the STAFF role defaults (alongside `payments.manage` and `fulfillment.manage`). Any floor-staff account can: send a mass campaign blast to every subscriber on any list (`POST /api/admin/email/campaigns/[id]/send`), suppress any transactional email at enqueue time by flipping `enabled: false` on the override — including `order_confirmation`, `payment_link`, `refund_issued` (`PATCH /api/admin/email/triggered/[key]`), edit reusable email templates and campaign draft content, and unsubscribe/re-subscribe any individual subscriber (`PATCH /api/admin/email/subscribers/[id]`). The settings Email tab's own test sender (`app/api/admin/settings/email-test/route.ts:20`) correctly gates on `settings.manage` (manager-only); the hub routes that actually move mail do not. There is no dedicated email permission in `PERMISSIONS` (`lib/permissions.ts:3`), so the arm picked `customers.manage` as the closest existing tier — but the actions it unlocks (mass send, transactional suppression) are manager-tier impact, not customer-management tier. A POS-focused staff member's job is not mass email, yet they hold the capability.

### M2 — `sendCampaign` has no stale-SENDING reclaim (stranded recipients, stuck campaign)
**Sources:** security Major 2, quality Major 2, rules Major 2
**Location:** `lib/email/campaigns.ts:110-148, 153-162`; `lib/email/outbox-sweep.ts:32-43` (contrast); `prisma/schema.prisma:1172-1189` (`EmailCampaignRecipient` has no `lastAttemptAt`)
**Claim:** `lib/email/outbox-sweep.ts:32-43` selects candidates from `PENDING`, `FAILED` (under `maxAttempts`), and `SENDING` with `lastAttemptAt < staleBefore`, and the per-row claim re-applies the same `OR` so a crashed sweeper's `SENDING` row becomes re-claimable after `STALE_CLAIM_MS = 10 min` — the S4 one-claim law, recovering from crashes. `sendCampaign` does not. Its candidate query is `status: { in: ["PENDING", "FAILED"] }, attempts: { lt: policy.maxAttempts }` — no `SENDING` branch. Its claim is `where: { id, status: { in: ["PENDING", "FAILED"] } }` — also no `SENDING` branch. The `EmailCampaignRecipient` model has no `lastAttemptAt` field at all. If a campaign send crashes (process exit, runtime timeout, cold start) after claiming a recipient as `SENDING` but before the `SENT`/`FAILED` update, that recipient stays `SENDING` forever. The final-status check counts `status: { in: ["PENDING", "SENDING"] }` as `openWork`, so the campaign can never reach `SENT` — it sits in `FAILED` with `openWork > 0` on every rerun, and no rerun ever picks the stranded `SENDING` rows back up. Unlike the outbox sweeper, there is no recovery path short of a DBA editing the rows. A single unlucky crash mid-blast strands the whole campaign.

### M3 — Campaign claim omits the `attempts < maxAttempts` guard, so overlapping reruns can exceed the retry cap and deliver one extra email
**Sources:** quality Major 1
**Location:** `lib/email/campaigns.ts:111-123` (candidate query + atomic claim); contrast `lib/email/outbox-sweep.ts:50-60`
**Claim:** The candidate `pending` query (line 111) filters `attempts: { lt: policy.maxAttempts }`, so exhausted `FAILED` rows are excluded from the candidate set. But the atomic claim `updateMany` (lines 120–123) only re-checks `status: { in: ["PENDING", "FAILED"] }` — it does NOT re-check `attempts`. Two concurrent reruns that both fetch the same retryable `FAILED` row can race: rerun B claims it, delivers, fails, and flips it back to `FAILED` with `attempts = maxAttempts`; rerun A's claim then succeeds (status is `FAILED`) and increments `attempts` past the cap, performing one real provider call beyond `maxAttempts`. This violates the retry cap and the "no duplicates on retry" intent (S2/S3). The outbox sweeper's claim guards each branch with `attempts: { lt: policy.maxAttempts }` for `FAILED` rows; the campaign claim has no such guard. The race window is the gap between the `findMany` (line 110) and the `updateMany` (line 120).

### M4 — Outbox stale-claim recovery counts a crash as a provider failure, exhausting retries without a real attempt
**Sources:** security Minor 4, quality Major 3
**Location:** `lib/email/outbox-sweep.ts:50-60` (claim)
**Claim:** When a stale `SENDING` row is recovered, the claim `updateMany` does `attempts: { increment: 1 }` BEFORE `deliverMessage` runs. A sweeper that crashed before contacting the provider has already burned one attempt. A few such crashes — none of which actually hit Resend/Twilio — push `attempts` to `maxAttempts`, after which the next real attempt is refused (the `FAILED` branch's `attempts: { lt: policy.maxAttempts }` guard fails) and the row is permanently `FAILED`. EXPECTED S3 wants "force provider failure → retry → single delivery + auditable failure trail"; a crash is not a provider failure, but it consumes the same retry budget. The claim at line 59 runs unconditionally for every claimed row, including stale-claim recoveries; there is no path that re-claims a stale `SENDING` row without incrementing `attempts`. Security rates Minor; quality rates Major — highest wins.

### M5 — Campaign bulk sends bypass the outbox; the "Send log" claim is false
**Sources:** rules Major 1
**Location:** `lib/email/campaigns.ts:117-147` (inline `deliverMessage`); `components/admin/email/email-tabs.tsx:90-92` (Send log tab); contrast `lib/email/triggered.ts`, `lib/email/order-emails.ts`, `app/api/admin/settings/email-test/route.ts`
**Claim:** `sendCampaign` delivers each `EmailCampaignRecipient` inline via `deliverMessage({...})` with a plain object — it never creates an `OutboxMessage` row. Transactional emails (`lib/email/triggered.ts`, `lib/email/order-emails.ts`), campaign test-sends, and the settings test sender all write an `OutboxMessage` first. The hub's "Send log" tab renders `prisma.outboxMessage.findMany` and states "every email/SMS the system sends lands here first and is drained by the outbox sweep cron" — that is false for the one delivery path that moves the most volume (a campaign send to a full list). Campaign deliveries are invisible in the central log; the only per-recipient trail is on `EmailCampaignRecipient` rows in the campaign detail page. Two delivery paths for the same concern (email→provider) with no shared log is the "one pattern per concern" violation, and the UI text is an unverified claim. Violates: consistency / anti-hallucination (claim vs behavior).

### M6 — Duplicated claim-and-deliver loop (outbox sweep vs campaign send)
**Sources:** clean-code Major 1
**Location:** `lib/email/outbox-sweep.ts:49-81`, `lib/email/campaigns.ts:117-148`
**Claim:** Both functions implement the same pattern: filter candidate rows → per-row atomic `updateMany` claim (status in `[PENDING, FAILED]` → `SENDING`, `attempts: { increment: 1 }`) → `deliverMessage` → on success `update` to `SENT` with `providerId`/`sentAt`/`lastError: null` → on failure `update` to `FAILED` with `lastError`. The catch block (`error instanceof Error ? error.message : String(error)`) is identical verbatim. The clean-code rule "No copy-paste patterns with minor variations — extract the pattern" applies directly; Rule of 2 is met (exactly two call sites). The variation is only the model (`OutboxMessage` vs `EmailCampaignRecipient`) and the SENT payload fields, both of which a generic `claimAndDeliver` helper can parameterize.

### M7 — Test-send paths race the outbox sweeper with no claim (double-delivery hole)
**Sources:** rules Major 5
**Location:** `lib/email/campaigns.ts:39-63` (`testSendCampaign`); `app/api/admin/settings/email-test/route.ts:28-56`
**Claim:** Both test-send paths create an `OutboxMessage` (default `PENDING`) and then call `deliverMessage(row)` directly without claiming the row first. If the outbox sweep cron fires between the `create` and the inline `update`, the sweeper claims the row (`PENDING → SENDING`) and delivers it, while the inline dispatch also delivers — two provider contacts for one test email, and the inline `update` then clobbers the sweeper's `SENT`/`SENDING` state. The transactional path avoids this by only writing `PENDING` and letting the sweeper be the sole deliverer; the test paths bypass that discipline for a synchronous UI answer. Narrow window, low stakes (a test email), but it is a real double-delivery hole in the "exactly once" law the rest of P11 enforces. Violates: correctness / idempotency.

### M8 — `EmailCampaign.createdById` is a dangling id with no FK relation
**Sources:** rules Major 3
**Location:** `prisma/schema.prisma:1151`; `app/api/admin/email/campaigns/route.ts:44`
**Claim:** `prisma/schema.prisma:1151` declares `createdById String?` on `EmailCampaign` with no `createdBy StaffUser? @relation(...)`. The create route writes `createdById: gate.ctx.staff.id`, but there is no referential integrity and no way to join the campaign to its creator — the column is an orphaned string. Every other audited entity in the codebase uses a real relation or an `AuditLog` row; here the creator id is stored raw with no constraint and no reader. Either drop the column (the `email_campaign_send` audit row already records the actor) or add the relation. Violates: type/schema drift / data integrity.

### M9 — Triggered-tab UI hides `bodyTemplateOverride`; the per-key body override is unreachable from the hub
**Sources:** rules Major 4
**Location:** `lib/email/triggered.ts:73` (resolution); `app/api/admin/email/triggered/[key]/route.ts:14` (PATCH schema); `components/admin/email/triggered-tab.tsx:13-20`; `app/(admin)/admin/email/page.tsx:79-89`
**Claim:** `lib/email/triggered.ts:73` resolves `override?.bodyTemplateOverride ?? override?.template?.bodyText ?? defaults.bodyText`, and the PATCH schema accepts `bodyTemplateOverride`. But `components/admin/email/triggered-tab.tsx:13-20` and the server mapping never send or render `bodyTemplateOverride` — only `enabled`, `subjectOverride`, and `templateId`. The PHASE-P11-STATUS.md item 1 claims "per-key `EmailTriggeredOverride` rows override subject/body/sender per triggered key"; the body-override half is wired in the backend but unreachable from the UI. A staff member who wants a one-off body for a triggered key must create a reusable `EmailTemplate` and link it — the direct paste path the schema and lib support is dead surface. Violates: dead surface / anti-hallucination.

### M10 — Duplicated cron route handler shape
**Sources:** clean-code Major 2
**Location:** `app/api/cron/outbox-sweep/route.ts`, `app/api/cron/email-log-purge/route.ts`, `app/api/cron/payment-reminders/route.ts` (and the four other cron routes in `app/api/cron/**`)
**Claim:** Every cron `GET` is the same skeleton: `if (!isCronAuthorized(request)) return 401;` → `try { const result = await <fn>(); return NextResponse.json({ ok: true, ...result }); } catch (error) { const mapped = mapDomainError(error); if (mapped) return mapped; throw error; }`. Seven routes, identical control flow. Extract a `withCronAuth(handler)` wrapper (or a `cronRoute(fn)` helper) so the auth + error-map contract lives in one place. Today a change to the auth check or error mapping requires editing seven files in lockstep. Violates: duplicated logic / pattern drift.

### M11 — Type drift between `testSendCampaign` response and `CampaignEditor` client (functional bug)
**Sources:** clean-code Major 3
**Location:** `lib/email/campaigns.ts:34` (server return type); `components/admin/email/campaign-editor.tsx:91-104` (client generic + reads)
**Claim:** Server contract: `{ outboxId: string; delivered: boolean; lastError: string | null }`. Client generic: `apiFetch<{ delivered: boolean; providerId: string | null; error: string | null }>`. The client reads `result.body.providerId` (line 96) and `result.body.error` (line 99), neither of which exists in the server response. Effects: on a failed test send (`ok: true`, `delivered: false`), `result.body.error` is `undefined`, so the UI always shows "Test email failed: unknown"; the delivered-case message references `result.body.providerId` which is also `undefined` → "provider n/a" always. The `apiFetch` generic is a lie the compiler accepts because the success body is structurally compatible enough to type-check. This is a real user-visible bug sourced in type drift, not just style. Violates: type/schema drift.

### M12 — `OutboxMessage.kind` / `channel` are free strings while code holds three separate vocabularies
**Sources:** rules Minor 2, clean-code Major 4
**Location:** `prisma/schema.prisma:1048-1069` (`OutboxMessage`); `lib/notify/outbox.ts:16-31` (`NotificationKind`); `lib/email/triggered.ts:10-11` (`TriggeredKey`); `lib/email/campaigns.ts:41` (literal `"campaign_test"`); `lib/email/dispatch.ts:20`
**Claim:** `OutboxMessage.kind` and `.channel` are `String` in the schema (no enum). The codebase names the legal values in three places that don't share a type: `NotificationKind` = `"day_of_delivery" | "bulk_scheduled" | "pickup_ready" | "pickup_expired" | "payment_reminder"` (P9 notification seam); `TriggeredKey` = `"order_confirmation" | "payment_link" | "refund_issued" | "subscription_manage"` (P11 transactional); `"campaign_test"` literal in `testSendCampaign`, not in any union. `channel` is similarly a free string while `NotificationChannel = "EMAIL" | "SMS"` exists only in `lib/notify/outbox.ts`. `deliverMessage` compares `message.channel === "SMS"` against an untyped string. A typo in any `kind`/`channel` write site is not caught at compile time or by the DB. Centralize the vocabulary into one union (or a Prisma enum) and have every producer reference it. Rules rates Minor; clean-code rates Major — highest wins. Violates: type/schema drift / magic values.

### M13 — `getEmailBranding()` is an uncached DB hit called per message in the campaign send loop
**Sources:** clean-code Major 5
**Location:** `lib/email/dispatch.ts:32` (called from `deliverMessage`); `lib/email/campaigns.ts:109` + loop at `117-148`; `lib/settings.ts:70-74` (no cache)
**Claim:** `getSetting` hits `prisma.setting.findUnique` on every call — no memoization. `sendCampaign` fetches branding once at line 109, then `deliverMessage` fetches it again per recipient inside the loop (line 32). For a 1000-recipient campaign that is ~1001 DB round-trips for branding that does not change mid-send. `testSendCampaign` double-fetches the same way (line 36 then line 50). Either pass the already-fetched branding into `deliverMessage`, or cache `getSetting` for the request lifetime. The dispatcher's signature already accepts a `Pick<OutboxMessage, ...>`; threading a `branding` arg is the smaller change. Violates: pattern drift / hot-path inefficiency.

## Minors (25)

### m1 — Unsubscribe/manage token is 30-day TTL and reusable
**Sources:** security Minor 1
**Location:** `lib/newsletter/tokens.ts:6`; `lib/newsletter/subscribers.ts:42`; `app/(storefront)/unsubscribe/unsubscribe-form.tsx`
**Claim:** `UNSUBSCRIBE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000`. The token is a bearer — anyone holding it can change all three preference flags and unsubscribe/resubscribe the subscriber for the full 30 days. It is not single-use: after `unsubscribeAll: true`, the same token with `unsubscribeAll: false` re-subscribes (`subscribers.ts:42` clears `unsubscribedAt`). The form deliberately exposes a Resubscribe button on the same token, so reuse is by design — but a leaked/forwarded manage link stays useful for a month. The subscriber id inside the token body is base64 (not encrypted), so a leaked token also exposes the subscriber id and email indirectly (the `/unsubscribe?token=…` page renders the email). Shortening the TTL or issuing a fresh token on each manage email would reduce exposure.

### m2 — Campaign test-send accepts any external address, staff-tier gated
**Sources:** security Minor 2
**Location:** `app/api/admin/email/campaigns/[id]/test-send/route.ts:10`
**Claim:** `toAddress: z.string().email()` with no allowlist. A staff user can send the rendered campaign draft (subject + body) to any external mailbox. Combined with M1, any floor-staff account can exfiltrate draft campaign content to an arbitrary address. The settings email-test route has the same shape but is manager-only (`settings.manage`); the campaign test-send inherits the looser `customers.manage` tier. If draft campaign content is not considered sensitive this is acceptable, but the asymmetry between the two test-send routes is inconsistent.

### m3 — `safeEqual` uses a non-standard constant-time comparison
**Sources:** security Minor 3
**Location:** `lib/hmac.ts:35-42`; contrast `lib/cron-auth.ts:17`
**Claim:** `safeEqual` uses modulo cycling of the shorter string rather than `crypto.timingSafeEqual` (which `lib/cron-auth.ts:17` already uses for the bearer gate). The expected HMAC signature is a fixed 43-char base64url string, so the practical timing surface is small, but the pattern deviates from the standard: the loop runs `max(a.length, b.length)` iterations and cycles the shorter operand with `i % a.length`, which is not the textbook fixed-length byte compare. The guard in `verifyUnsubscribeToken` (`tokens.ts:25`) rejects empty body/signature before reaching `safeEqual`, so the `i % 0` edge is not hit in practice. Using `crypto.timingSafeEqual` on equal-length buffers (with a length check that does not short-circuit) would match the cron-auth pattern and remove the unconventional comparison.

### m4 — Subscribe rate limit keyed on spoofable `x-forwarded-for`
**Sources:** security Minor 5
**Location:** `app/api/subscribe/route.ts:26`; `lib/client-ip.ts:6`; `lib/rate-limit.ts:3`
**Claim:** `newsletterRateLimit(clientIp(request.headers) ?? "unknown")`. `lib/client-ip.ts:6` reads `x-forwarded-for` first hop, capped at 45 chars — client-controllable. An attacker rotating the `X-Forwarded-For` header gets a fresh bucket per request. The code comment at `rate-limit.ts:3` acknowledges this is a "speed bump rather than a hard cap," so it is an accepted limitation, but the subscribe route is the unauthenticated entry point that mints the HMAC manage token's subscriber row — the one place where upsert spam (creating churn rows, triggering `subscription_manage` emails) is reachable without any credential. Worth noting for the P12 launch-readiness abuse review.

### m5 — A resubscribed member never receives a campaign they were previously `SKIPPED` from
**Sources:** quality Minor 1
**Location:** `lib/email/campaigns.ts:95-104` (snapshot upsert)
**Claim:** The snapshot upsert sets `status: member.subscriber.unsubscribedAt ? "SKIPPED" : "PENDING"` only on the `create` path; the `update: {}` path is a no-op. If a member was unsubscribed at run 1 (row created `SKIPPED`) and later resubscribes (`unsubscribedAt` cleared), run 2's upsert hits the existing row and does nothing — the row stays `SKIPPED`. The `pending` query (line 111) excludes `SKIPPED`, so the resubscribed member is silently dropped from every rerun of that campaign. This is inconsistent with the late-joiner behavior the domain test asserts (sub4 gets sent on rerun): new members are reached, resubscribed members are not. The domain test only covers a freshly added subscriber, not a resubscribed one.

### m6 — No `PHASE-P11-SMOKE.md` evidence file at the EXPECTED path
**Sources:** quality Minor 2
**Location:** `arms/arm-06/workspace/.scratch/PHASE-P11-SMOKE.md` (missing)
**Claim:** EXPECTED P11 §Smoke requires "Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P11-SMOKE.md`." No such file exists for arm-06. The domain test covers S2–S5 and G-021 programmatically, and S1's token logic is unit-tested in `test-p3.mts`, but the per-arm smoke evidence artifact the EXPECTED asks for is absent. Smoke gap vs EXPECTED.

### m7 — Overlapping-sweep one-claim law is not tested (S4)
**Sources:** quality Minor 3
**Location:** `scripts/test-p11-domain.mts:115-127`
**Claim:** S4 requires "overlapping sweeps — one claim per message/job." The domain test runs `sweep1` then `sweep2` sequentially and asserts `sweep2.claimed === 0` because the row is already `SENT`. This proves a SENT row is not re-claimed, but it does NOT prove two concurrent sweeps claim distinct rows. The atomic `updateMany` makes the guarantee, but no test exercises it. No `Promise.all([sweepOutbox(), sweepOutbox()])` or equivalent in `test-p11-domain.mts`. The one-claim law is structural, not tested.

### m8 — `snapshotted`, `alreadySent`, and `skipped` return fields are cumulative/current counts, not per-run deltas; `snapshotted` misnamed
**Sources:** quality Minor 4, rules Minor 8
**Location:** `lib/email/campaigns.ts:177-197` (return); line 191 (`snapshotted: members.length`)
**Claim:** `snapshotted` is `members.length` (every current list member, including already-snapshotted and `SKIPPED` ones), not the number newly snapshotted this run — and the name implies rows written, while the value is the list size. `alreadySent` is `count(status: "SENT")` after the loop, so it includes this run's sends — the name implies "previously sent." `skipped` is recomputed from current membership, not from the snapshot rows. An operator reading the rerun report sees `snapshotted: 4, alreadySent: 3, skipped: 1` and cannot tell how many were newly sent vs. already sent. `totalMembers`/`listSize` would be honest for the `snapshotted` field.

### m9 — Campaign personalization is limited to the recipient's email address; the subscriber `name` is dropped
**Sources:** quality Minor 5
**Location:** `lib/email/campaigns.ts:101, 110, 126-127`; `prisma/schema.prisma:1172-1189` (`EmailCampaignRecipient`)
**Claim:** The campaign snapshot stores only `email` on the recipient row (line 101). The send loop fetches `pending` recipients without the subscriber relation (line 110), so `brandTokens` is called with `customerName: recipient.email` (line 126). A campaign template using `{{customerName}}` renders the raw email address in the greeting — "Hello p11-s1-...@example.org" instead of the subscriber's name. `NewsletterSubscriber.name` exists but is never carried into the campaign send path.

### m10 — No index on `OutboxMessage.lastAttemptAt`; stale-claim scan relies on the status index then filters in-memory
**Sources:** quality Minor 6
**Location:** `prisma/schema.prisma:1066-1067` (`OutboxMessage` indexes); `lib/email/outbox-sweep.ts:32-43` (candidate query)
**Claim:** The stale-claim branch `{ status: "SENDING", lastAttemptAt: { lt: staleBefore } }` uses the `@@index([status, createdAt])` to find `SENDING` rows, then filters `lastAttemptAt` in-memory. At scale with many concurrent sweeps, the `SENDING` partition can grow, and the unindexed `lastAttemptAt` filter becomes a scan. The batch cap (100) limits the damage, but the candidate query may read more `SENDING` rows than it claims. Schema indexes on `OutboxMessage`: `@@index([kind, channel, createdAt])` and `@@index([status, createdAt])`. No `lastAttemptAt` index.

### m11 — A failed test-send is silently retried by the sweeper, surprising the operator with a delayed test email
**Sources:** quality Minor 7
**Location:** `lib/email/campaigns.ts:49-63` (`testSendCampaign`); `app/api/admin/settings/email-test/route.ts:41-56`; `lib/email/outbox-sweep.ts:36`
**Claim:** Both test-send paths create an `outboxMessage` row with `status: PENDING` (default), attempt one inline dispatch, and on failure mark the row `FAILED` with `attempts: 1`. Because `attempts < maxAttempts`, the sweeper cron later re-claims the `FAILED` row and retries it. An operator who saw "Test email failed" in the UI can receive the test email minutes later when the sweeper succeeds — with no UI signal tying the delayed delivery back to the test action. The inline dispatch and the sweeper share the same outbox, which is the intended honesty, but the retry side effect is not surfaced. (Distinct from M7 — M7 is the race/double-delivery on the create→deliver path; m11 is the silent retry surprise on the failure path.)

### m12 — `FAILED` outbox rows are never purged; the failure trail grows unbounded at scale
**Sources:** quality Minor 8
**Location:** `lib/email/purge.ts:25-30` (`purgeEmailLog`)
**Claim:** The purge deletes only `SENT` outbox rows past `retentionDays`. `FAILED` rows are intentionally preserved as the "auditable failure trail" (comment lines 6–10), satisfying EXPECTED S5's "without deleting active outbox records or audit evidence." But there is no retention cap on `FAILED` rows — they survive forever. At 5k-packages scale with retries, a chronic provider issue accumulates `FAILED` rows without bound. EXPECTED S3 wants an "auditable failure trail," not an eternal one; a separate longer-but-finite retention for `FAILED` would bound growth while preserving the trail.

### m13 — `getEmailBranding` throws a raw `Error` while peer config gaps throw `DomainRuleError`
**Sources:** rules Minor 1
**Location:** `lib/email/render.ts:18`; contrast `lib/email/outbox-sweep.ts:27`, `lib/email/purge.ts:20`, `lib/email/campaigns.ts:83`
**Claim:** `lib/email/render.ts:18` throws `new Error("email.branding is not configured...")`. The sibling guards in `outbox-sweep.ts:27`, `purge.ts:20`, and `campaigns.ts:83` throw `DomainRuleError`, which `mapDomainError` (`lib/http-errors`) maps to a clean response. A raw `Error` escapes the mapper and surfaces as a 500 with a generic message. Same concern, two error shapes. (Distinct from M13 — M13 is the uncached DB hit on the same function; m13 is the error-shape drift.)

### m14 — STATUS doc names a route that does not exist
**Sources:** rules Minor 3
**Location:** `PHASE-P11-STATUS.md` item 3; real route `app/api/admin/orders/[orderId]/payment-link/route.ts`
**Claim:** `PHASE-P11-STATUS.md` item 3 says the payment-link email fires from `POST /api/admin/orders/[orderId]/payment-link-email`. The real route is `app/api/admin/orders/[orderId]/payment-link/route.ts` (no `-email` suffix). The code is correct; the status doc's path is wrong. Same doc also lists `lib/email/campaigns.ts (createCampaign, ...)` — `createCampaign` is not exported (creation is inline in `app/api/admin/email/campaigns/route.ts`). Violates: workflow § expectation files / anti-hallucination.

### m15 — `sendCampaign` snapshot loop is N sequential upserts inside one transaction
**Sources:** rules Minor 4
**Location:** `lib/email/campaigns.ts:93-107`
**Claim:** Runs `await tx.emailCampaignRecipient.upsert(...)` per member inside `prisma.$transaction`. For a list of thousands this holds the transaction open for N round-trips. The idempotency ledger (unique `[campaignId, subscriberId]`) is the reason for the per-row upsert, but the SKIPPED/PENDING split could be precomputed and written with `createMany(skipDuplicates)` in two batches. Violates: ponytail § scale.

### m16 — `deliverMessage` email fallback `subject ?? "(no subject)"` defends a state that cannot happen
**Sources:** rules Minor 5
**Location:** `lib/email/dispatch.ts:35`
**Claim:** Falls back `message.subject ?? "(no subject)"`. Every EMAIL enqueue path sets `subject` (`triggered.ts:81`, `campaigns.ts:44`, `order-emails.ts`, `settings/email-test/route.ts:33`). The fallback is dead code for the email branch; SMS legitimately has `subject: null`. Violates: no defensive code for impossible conditions.

### m17 — Test-send + settings-test duplicate the create→deliver→update pattern
**Sources:** rules Minor 6
**Location:** `lib/email/campaigns.ts:49-63`; `app/api/admin/settings/email-test/route.ts:43-56`
**Claim:** Both implement: create outbox row → `deliverMessage` → update `SENT`/`FAILED` with `attempts: 1`. Two real call sites, same shape — a `dispatchOnce(row)` helper in `lib/email/dispatch.ts` would cover both (Rule of 2 satisfied). (Distinct from M6 — M6 is the claim-and-deliver loop shared by outbox sweep vs campaign send; m17 is the simpler create→deliver→update shared by the two test-send paths.)

### m18 — `brandTokens` lets caller tokens shadow `brand`/`footer`
**Sources:** rules Minor 7
**Location:** `lib/email/render.ts:27`
**Claim:** Returns `{ brand: branding.fromName, footer: branding.footerText, ...tokens }`. A caller that passes a `brand` or `footer` token silently overwrites the branding. No current caller does this (tokens are `customerName`, `orderRef`, `amount`, `payUrl`, `manageUrl`), but the spread order makes the branding non-authoritative. Violates: latent footgun.

### m19 — Two approaches for status → badge tone
**Sources:** clean-code Minor 1
**Location:** `components/admin/email/campaigns-tab.tsx:32-37` (`STATUS_TONES` record); `components/admin/email/campaign-editor.tsx:34-40` (`RECIPIENT_TONES` record) vs `components/admin/email/email-tabs.tsx:114-118` (inline ternary chain); `campaign-editor.tsx:133` (inline ternary chain)
**Claim:** The record-map form is used in two places; the inline ternary form (`status === "SENT" ? "green" : status === "FAILED" ? "red" : ...`) is used in two other places for the same status→tone concern. Pick one (the record form) and reuse it for the outbox and campaign-header badges. Violates: pattern drift — one concern, two approaches.

### m20 — Inconsistent magic truncation lengths for `lastError` display
**Sources:** clean-code Minor 2
**Location:** `components/admin/email/email-tabs.tsx:123` (`slice(0, 60)`); `components/admin/email/campaign-editor.tsx:264` (`slice(0, 50)`)
**Claim:** Same concept (truncate an error string for a table cell) with two different lengths. Pick one constant and reuse, or drop the truncation and rely on `title` for the full text (both sites already set `title={...lastError}`). Violates: magic values / pattern drift.

### m21 — Vague name `data` + over-verbose conditional spreads in triggered override PATCH
**Sources:** clean-code Minor 3
**Location:** `app/api/admin/email/triggered/[key]/route.ts:37-42`
**Claim:** `const data = { ... }` uses `data`, which `clean-code.mdc` bans as a standalone name. The four conditional spreads (`parsed.data.enabled !== undefined ? { enabled: ... } : {}` ×4) strip `undefined` values, which Prisma's `update` ignores anyway. The whole block reduces to `const override = await prisma.emailTriggeredOverride.upsert({ where: { key }, update: parsed.data, create: { key, ...parsed.data } })`. Rename and simplify. Violates: naming (banned word) + anti-AI-tic (over-verbose code).

### m22 — `getCampaignOrThrow` helper not reused by the campaign detail route
**Sources:** clean-code Minor 4
**Location:** `lib/email/campaigns.ts:15-22` (helper); `app/api/admin/email/campaigns/[id]/route.ts:26-33` (GET) and `46-47` (PATCH)
**Claim:** The helper exists and is used by `testSendCampaign` and `sendCampaign`, but the detail route's GET and PATCH each do their own `prisma.emailCampaign.findUnique` + 404 return. The PATCH additionally throws `DomainRuleError` for non-DRAFT, which the helper doesn't — so either widen the helper or call it for the lookup and keep the status check local. As-is, the 404 shape (`{ error: "EmailCampaign not found" }`) is duplicated in three places. Violates: pattern drift / missed reuse.

### m23 — Repeated `prisma.emailList.findUnique` + 404 pattern
**Sources:** clean-code Minor 5
**Location:** `app/api/admin/email/campaigns/route.ts:40-41`; `app/api/admin/email/campaigns/[id]/route.ts:52-53`; `app/api/admin/email/lists/[id]/members/route.ts:23-26`
**Claim:** Same `findUnique` + `return 404 "EmailList not found"` in three handlers. A `getEmailListOrThrow(id)` helper (mirroring `getCampaignOrThrow`) would collapse these and make the 404 message consistent. Violates: duplicated logic (Rule of 2 met — 3 sites).

### m24 — Magic number `take: 20` for recent outbox
**Sources:** clean-code Minor 6
**Location:** `app/(admin)/admin/email/page.tsx:32`; `components/admin/email/email-tabs.tsx:91` (prose)
**Claim:** The "20 most recent outbox rows" limit is a literal in the page query. The `email-tabs.tsx` copy at line 91 also hardcodes "20 most recent" in prose, so the two must stay in sync manually. Lift to a named constant shared by the query and the copy, or at least reference one from the other. Violates: magic value.

### m25 — `subscribers-tab.tsx` pref-toggle onChange rebuilds the prefs object with three inline ternaries
**Sources:** clean-code Minor 7
**Location:** `components/admin/email/subscribers-tab.tsx:71-73`
**Claim:** The three-line ternary (`field === "prefNewProducts" ? !subscriber.prefNewProducts : subscriber.prefNewProducts` ×3) can be a computed-key spread: `{ ...subscriber (prefs fields), [field]: !subscriber[field] }`. Minor, but it's the kind of copy-paste-with-one-variation the rules flag. Violates: anti-AI-tic (over-verbose code that does in 3 lines what could be done in 1).

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| M2 | security Major 2 ; quality Major 2 ; rules Major 2 (Major + Major + Major → Major) |
| M4 | security Minor 4 ; quality Major 3 (Minor + Major → Major) |
| M12 | rules Minor 2 ; clean-code Major 4 (Minor + Major → Major) |
| m8 | quality Minor 4 ; rules Minor 8 (Minor + Minor → Minor) |

All other aggregate IDs are single-source. No new findings introduced.

Related-but-distinct pairs kept separate:
- **M2 vs M3 vs M4** (security/quality/rules + quality + security/quality): all touch the campaign/outbox send loop. M2 is the missing stale-SENDING reclaim on `sendCampaign` (stranded recipients, no `lastAttemptAt`). M3 is the missing `attempts < maxAttempts` re-check in the campaign claim (retry-cap exceed + one extra delivery). M4 is the outbox sweeper incrementing `attempts` on stale-claim recovery (crash burns a retry). Different defects in adjacent code.
- **M5 vs M6** (rules + clean-code): both touch campaign send delivery. M5 is the bypassed outbox (no `OutboxMessage` row, false "Send log" claim). M6 is the duplicated claim-and-deliver loop between outbox sweep and campaign send. Different claims.
- **M7 vs m11 vs m17** (rules + quality + rules): all touch test-send paths. M7 is the race/double-delivery between inline dispatch and the sweeper (no claim). m11 is the silent retry surprise on a failed test-send. m17 is the duplicated create→deliver→update code between the two test-send paths. Different defects.
- **M11 vs m2** (clean-code + security): both touch test-send. M11 is the type drift between server response and client generic (functional UI bug). m2 is the authz concern (any external address, staff-tier). Different claims.
- **M12 vs m14** (rules/clean-code + rules): both touch the STATUS doc / schema. M12 is the free-string `kind`/`channel` schema drift. m14 is the STATUS doc naming a nonexistent route. Different artifacts.
- **M13 vs m13** (clean-code + rules): both touch `getEmailBranding`. M13 is the uncached DB hit per message. m13 is the raw-`Error` vs `DomainRuleError` shape drift. Different defects on the same function.
- **m8 vs m15** (quality/rules + rules): both touch `sendCampaign` snapshot/return. m8 is the misnamed/misleading return fields. m15 is the N sequential upserts holding the transaction. Different claims.
- **m9 vs m18** (quality + rules): both touch personalization/branding. m9 is the dropped subscriber `name` in campaign send. m18 is the `brandTokens` shadow footgun. Different defects.

## Pass notes (not counted)

- **HMAC unsubscribe token** (security PASS): purpose-prefixed, constant-time-verified, signature binds subscriber id — no IDOR. The 30-day TTL/reuse concern is m1, raised separately.
- **Subscribe response token leak** (security PASS): `app/api/subscribe/route.ts:49` returns `{ ok: true }` only; the manage token travels by email via the outbox. Correct.
- **Cron bearer gate** (security PASS): fails closed when `CRON_SECRET` unset, hashes both sides with SHA-256 before `timingSafeEqual` (length oracle killed), 401 never reveals config state. Correct.
- **Outbox claim atomicity** (security PASS): the per-row `updateMany` claim is an atomic conditional `UPDATE`; the one-claim law holds structurally. (M3 is the missing `attempts` re-check in the campaign variant; M4 is the attempt-burn on stale recovery — both raised separately.)
- **Resend/Twilio secret handling** (security PASS): keys read from env, sent as `Authorization` headers, never logged. Provider error messages stored in `lastError` are the carrier's own response text, not the API key. No secret leak.
- **Dev fixture routes** (security PASS): `isDevAuthBypass` hard-disables on `VERCEL_ENV === "production" | "preview"` regardless of the flag. Correct.
- **Template injection in `renderTemplate`** (security PASS): single-pass `replace` with no recursion, so a token value containing `{{…}}` is not re-expanded. No injection.
- **Unsubscribe IDOR** (security PASS): the HMAC token binds the subscriber id in the signed body; the id cannot be swapped without invalidating the signature. The `/api/unsubscribe` route re-verifies before any write. No IDOR.
- **`fromName`/`fromEmail` in `brandedFrom`** (security PASS): manager-configured setting, not user input; RFC 5322 breakage would require a manager misconfiguration. Not a finding.
- **`/api/admin/*` not in middleware matcher** (security PASS): `middleware.ts:23` matches `/admin/:path*` and `/driver/:path*` only. API routes rely on per-handler `requireApiPermission`. All P11 admin routes call the gate. (M1 is the tier choice, raised separately.)
- **Campaign idempotent reruns** (quality PASS for the clean path): snapshot upsert keyed on `[campaignId, subscriberId]`, `PENDING`/`FAILED` re-claim, `SENT` excluded. (M2/M3 are the crash/concurrency gaps; m5 is the resubscribed-`SKIPPED` drop — all raised separately.)
- **Outbox retry-to-exhaustion** (quality PASS): `attempts < maxAttempts` guard on `FAILED` re-claim, `lastError` recorded, `SENT` terminal. (M4 is the crash-burns-attempt gap, raised separately.)
- **SMS G-021 wiring** (quality PASS): capture-mode double, `NotificationChannel = "SMS"`, provider isolation in `lib/notify/sms.ts`. Correct.
- **Retention purge safety** (quality PASS for `SENT`): deletes only `SENT` past `retentionDays`, preserves `FAILED`/active. (m12 is the unbounded `FAILED` growth, raised separately.)
- **Coverage** (rules PASS): all four P11 EXPECTED "must be true" items have code + smoke evidence; S1–S5 reported 42/0. No stubs; the seams are honest. (m6 is the missing per-arm smoke artifact; m7 is the untested concurrency leg — both raised separately.)
- **Codegraph rule** (rules PASS): the arm's `.codegraph/` index exists; init obligation met.
- **Vocabulary rule** (rules PASS): no command-scope words in the reviewed artifacts.
- **No secrets committed** (rules PASS): `.env` is gitignored; `.env.example` carries placeholders only.
- **Ponytail ladder** (rules PASS): Resend and Twilio hand-rolled on native `fetch` (no `resend`/`twilio` npm dep) — ladder rungs 2–4 honored; comments state the rationale.
- **Ponytail anti-slop** (rules PASS): comments across the new modules are non-obvious intent (capture-mode honesty, one-claim law, stale-claim recovery, forward-only chain rationale), not narration. No sycophancy or stock vocab in code comments.
- **No swallowed errors** (clean-code PASS): the sweep/purge catch blocks record `lastError`/`message` and rethrow; the per-message catch in the sweep records and continues (intentional retry semantics).
- **No dead code in reviewed surface** (clean-code PASS): (m16 is the one impossible-branch fallback, raised separately; no other dead code detected.)
- **No god files** (clean-code PASS): largest is `components/admin/email/campaign-editor.tsx` at 285 lines.

## Bottom line

No Blockers, no Critical. P11 arm-06 is functionally complete against EXPECTED (all four must-trues implemented, smoke S1–S5 reported 42/0, lint/typecheck/migration-guard/test:unit/test:domain/build green). The 13 Majors cluster on: the email-hub authz tier mismatch (M1 — `customers.manage` lets floor staff mass-send and suppress transactional mail), the campaign stale-SENDING strand (M2 — no `lastAttemptAt`, no reclaim, stuck campaign), the campaign claim missing the `attempts` re-check (M3 — retry-cap exceed), the outbox stale-claim burning an attempt on a crash (M4), campaign sends bypassing the outbox and falsifying the "Send log" claim (M5), the duplicated claim-and-deliver loop (M6), the test-send race with the sweeper (M7), the dangling `EmailCampaign.createdById` (M8), the unreachable `bodyTemplateOverride` UI (M9), the duplicated cron route shape (M10), the `testSendCampaign`/client type drift that always shows "unknown"/"n/a" (M11), the free-string `kind`/`channel` schema drift (M12), and the uncached `getEmailBranding` per-message DB hit (M13). The 25 Minors are bearer-token lifecycle (m1), authz asymmetries (m2), crypto-pattern drift (m3), rate-limit spoofability (m4), resubscribed-`SKIPPED` drop (m5), missing smoke artifact (m6), untested concurrency legs (m7), misleading return fields (m8), dropped personalization (m9), missing index (m10), silent retry surprise (m11), unbounded `FAILED` growth (m12), error-shape drift (m13), doc path errors (m14), N-upsert transactions (m15), dead defensive code (m16), duplicated test-send shape (m17), branding-token shadow footgun (m18), and a tail of pattern drift / magic values / naming / missed-reuse / over-verbose code (m19–m25). M1 + m2 compose into a staff-tier mass-email/exfiltration path that is the most urgent P12 fix; M2/M3/M4 tee up the campaign/outbox crash-recovery hardening the launch-load review needs.

