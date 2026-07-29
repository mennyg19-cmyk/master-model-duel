# P11 Security Review — arm-06 (blind)

**Phase:** P11 — Email & notification platform
**Scope:** `lib/newsletter/*`, `lib/email/*`, `lib/notify/*`, `lib/cron-auth.ts`, `lib/hmac.ts`, `app/api/subscribe/*`, `app/api/unsubscribe/*`, `app/(storefront)/unsubscribe/*`, `app/api/admin/email/**`, `app/api/cron/outbox-sweep/*`, `app/api/cron/email-log-purge/*`, `app/api/admin/settings/email-test/*`, env/secrets.
**Reviewer:** Security specialist (blind — no model name).
**Method:** Findings only, no fixes. Trust boundaries, auth, secrets, IDOR, injection, claim races.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 5 |

The trust boundaries are mostly right: the HMAC unsubscribe token is purpose-prefixed and constant-time-verified, the subscribe route never returns the manage token in its response (it travels by email only), the cron bearer gate fails closed and hashes both sides before `timingSafeEqual`, the outbox claim is an atomic conditional `UPDATE` per row, and the dev fixture is hard-disabled on any Vercel deploy. The findings below are an authz-tier mismatch on the email hub, a missing stale-claim reclaim on the campaign send path, and a set of lower-severity lifecycle/leak concerns.

## Major

### M1 — Email hub admin routes gated on `customers.manage` (over-broad authz)

Every P11 admin route — campaigns list/create/edit/send/test-send (`app/api/admin/email/campaigns/**`), subscribers list/patch (`app/api/admin/email/subscribers/**`), lists and membership (`app/api/admin/email/lists/**`), templates create/edit (`app/api/admin/email/templates/**`), and triggered-key overrides (`app/api/admin/email/triggered/**`) — gates on `requireApiPermission("customers.manage")`.

`lib/permissions.ts:22` puts `customers.manage` in the **STAFF** role defaults (alongside `payments.manage` and `fulfillment.manage`) so floor staff can edit customer address books (UR-014) and run POS (UR-011). The result is that any floor-staff account can:

- Send a mass campaign blast to every subscriber on any list (`POST /api/admin/email/campaigns/[id]/send`).
- Suppress any transactional email at enqueue time by flipping `enabled: false` on the override — including `order_confirmation`, `payment_link`, and `refund_issued` (`PATCH /api/admin/email/triggered/[key]`).
- Edit the reusable email templates and campaign draft content.
- Unsubscribe or re-subscribe any individual subscriber (`PATCH /api/admin/email/subscribers/[id]`).

The settings Email tab's own test sender (`app/api/admin/settings/email-test/route.ts:20`) correctly gates on `settings.manage` (manager-only). The hub routes that actually move mail do not. There is no dedicated email permission in `PERMISSIONS` (`lib/permissions.ts:3`), so the arm picked `customers.manage` as the closest existing tier — but the actions it unlocks (mass send, transactional suppression) are manager-tier impact, not customer-management tier. A POS-focused staff member's job is not mass email, yet they hold the capability.

### M2 — `sendCampaign` has no stale-SENDING reclaim (stranded recipients, stuck campaign)

`lib/email/outbox-sweep.ts:32-43` selects candidates from three states — `PENDING`, `FAILED` (under `maxAttempts`), and `SENDING` with `lastAttemptAt < staleBefore` — and the per-row claim (`outbox-sweep.ts:50-60`) re-applies the same `OR` so a crashed sweeper's `SENDING` row becomes re-claimable after `STALE_CLAIM_MS = 10 min`. This is the S4 one-claim law, and it recovers from crashes.

`sendCampaign` (`lib/email/campaigns.ts:110-148`) does not. Its candidate query is `status: { in: ["PENDING", "FAILED"] }, attempts: { lt: policy.maxAttempts }` — no `SENDING` branch. Its claim (`campaigns.ts:120-123`) is `where: { id, status: { in: ["PENDING", "FAILED"] } }` — also no `SENDING` branch. The `EmailCampaignRecipient` model (`prisma/schema.prisma:1172-1189`) has no `lastAttemptAt` field at all, so there is no timestamp to build a stale-SENDING reclaim on even if the query wanted to.

If a campaign send crashes (process exit, runtime timeout, cold start) after claiming a recipient as `SENDING` but before the `SENT`/`FAILED` update, that recipient stays `SENDING` forever. The final-status check (`campaigns.ts:153-162`) counts `status: { in: ["PENDING", "SENDING"] }` as `openWork`, so the campaign can never reach `SENT` — it sits in `FAILED` with `openWork > 0` on every rerun, and no rerun ever picks the stranded `SENDING` rows back up. Unlike the outbox sweeper, there is no recovery path short of a DBA editing the rows. A single unlucky crash mid-blast strands the whole campaign.

## Minor

### m1 — Unsubscribe/manage token is 30-day TTL and reusable

`lib/newsletter/tokens.ts:6` sets `UNSUBSCRIBE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000`. The token is a bearer — anyone holding it can change all three preference flags and unsubscribe/resubscribe the subscriber for the full 30 days. It is not single-use: after `unsubscribeAll: true`, the same token with `unsubscribeAll: false` re-subscribes (`lib/newsletter/subscribers.ts:42` clears `unsubscribedAt` when `unsubscribeAll` is false). The form at `app/(storefront)/unsubscribe/unsubscribe-form.tsx` deliberately exposes a Resubscribe button on the same token, so reuse is by design — but a leaked/forwarded manage link stays useful for a month. The subscriber id inside the token body is base64 (not encrypted), so a leaked token also exposes the subscriber id and email indirectly (the `/unsubscribe?token=…` page renders the email). Shortening the TTL or issuing a fresh token on each manage email would reduce exposure.

### m2 — Campaign test-send accepts any external address, staff-tier gated

`app/api/admin/email/campaigns/[id]/test-send/route.ts:10` validates `toAddress: z.string().email()` with no allowlist. A staff user can send the rendered campaign draft (subject + body) to any external mailbox. Combined with M1, any floor-staff account can exfiltrate draft campaign content to an arbitrary address. The settings email-test route has the same shape but is manager-only (`settings.manage`); the campaign test-send inherits the looser `customers.manage` tier. If draft campaign content is not considered sensitive this is acceptable, but the asymmetry between the two test-send routes is inconsistent.

### m3 — `safeEqual` uses a non-standard constant-time comparison

`lib/hmac.ts:35-42` implements `safeEqual` with modulo cycling of the shorter string rather than `crypto.timingSafeEqual` (which `lib/cron-auth.ts:17` already uses for the bearer gate). The expected HMAC signature is a fixed 43-char base64url string, so the practical timing surface is small, but the pattern deviates from the standard: the loop runs `max(a.length, b.length)` iterations and cycles the shorter operand with `i % a.length`, which is not the textbook fixed-length byte compare. The guard in `verifyUnsubscribeToken` (`tokens.ts:25`) rejects empty body/signature before reaching `safeEqual`, so the `i % 0` edge is not hit in practice. Using `crypto.timingSafeEqual` on equal-length buffers (with a length check that does not short-circuit) would match the cron-auth pattern and remove the unconventional comparison.

### m4 — Outbox sweeper stale-SENDING reclaim consumes a retry attempt

`lib/email/outbox-sweep.ts:59` sets `attempts: { increment: 1 }` on every claim, including the stale-SENDING reclaim. A sweeper that crashes after claiming (attempts goes 0→1, status `SENDING`) and is reclaimed after 10 min (attempts 1→2, status `SENDING`) has burned one attempt on a send that never reached the provider. With a low `email.policy.maxAttempts`, repeated crashes can push a message to permanent `FAILED` (attempts ≥ maxAttempts) without the provider ever being contacted. The candidate query's `FAILED, attempts: { lt: maxAttempts }` filter then refuses to retry it. Correctness (no double-send) is preserved; reliability on the crash path is not.

### m5 — Subscribe rate limit keyed on spoofable `x-forwarded-for`

`app/api/subscribe/route.ts:26` rate-limits via `newsletterRateLimit(clientIp(request.headers) ?? "unknown")`. `lib/client-ip.ts:6` reads `x-forwarded-for` first hop, capped at 45 chars — client-controllable. An attacker rotating the `X-Forwarded-For` header gets a fresh bucket per request (`lib/rate-limit.ts` keys on the IP string). The code comment at `rate-limit.ts:3` acknowledges this is a "speed bump rather than a hard cap," so it is an accepted limitation, but the subscribe route is the unauthenticated entry point that mints the HMAC manage token's subscriber row — the one place where upsert spam (creating churn rows, triggering `subscription_manage` emails) is reachable without any credential. Worth noting for the P12 launch-readiness abuse review.

## Out of scope / explicitly not findings

- **Cron bearer gate** (`lib/cron-auth.ts`): fails closed when `CRON_SECRET` unset, hashes both sides with SHA-256 before `timingSafeEqual` (length oracle killed), 401 never reveals config state. Correct.
- **Unsubscribe IDOR**: the HMAC token binds the subscriber id in the signed body; the id cannot be swapped without invalidating the signature. The `/api/unsubscribe` route re-verifies the token before any write and re-loads the subscriber by the verified id. No IDOR.
- **Subscribe response token leak**: `app/api/subscribe/route.ts:49` returns `{ ok: true }` only; the manage token is enqueued via the outbox to the subscriber's mailbox. Correct.
- **Resend/Twilio secret handling**: keys read from env, sent as `Authorization` headers, never logged. Provider error messages stored in `lastError` are the carrier's own response text, not the API key. No secret leak.
- **Dev fixture routes** (`/api/dev/email-fixture/**`, `/api/dev/outbox`): `isDevAuthBypass` hard-disables on `VERCEL_ENV === "production" | "preview"` regardless of the flag. Correct.
- **Template injection in `renderTemplate`**: `lib/email/render.ts:9` uses a single-pass `replace` with no recursion, so a token value containing `{{…}}` is not re-expanded. No injection.
- **`fromName`/`fromEmail` in `brandedFrom`**: manager-configured setting, not user input; RFC 5322 breakage would require a manager misconfiguration. Not a finding.
- **`/api/admin/*` not in middleware matcher**: `middleware.ts:23` matches `/admin/:path*` and `/driver/:path*` only. API routes rely on per-handler `requireApiPermission`. All P11 admin routes call the gate; a forgotten gate on a future route is a pattern concern, not a finding in this phase.
