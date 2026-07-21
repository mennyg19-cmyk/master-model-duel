# P5 Security Review — arm-03

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Workspace: `arms/arm-03/workspace/`
Expected: `shared/phases/PHASE-P5-EXPECTED.md`
Scope: Checkout, delivery fees, hosted Stripe, webhook, POS, order lifecycle, guest draft access.
Findings only.

## Severity summary

| Sev | Count |
|---|---|
| High | 3 |
| Medium | 5 |
| Low | 7 |

## High

### H1 — `claimWebhookEvent` swallows all DB errors and silently drops events
`src/lib/payments/webhook.ts:42-50`

```ts
async function claimWebhookEvent(eventId, type, meta) {
  try {
    await db.stripeWebhookEvent.create({ data: { eventId, type, meta } });
    return true;
  } catch {
    return false;
  }
}
```

The catch is not scoped to Prisma `P2002` (unique violation). Any transient DB error (connection blip, timeout, serialization failure) returns `false`, and `processStripeWebhook` then returns `ok({ type, replay: true })` with HTTP 200. Stripe sees success and will **not retry**. A real `checkout.session.completed` can be silently lost — customer is charged, order never finalizes, stock never reserved. Must distinguish unique-constraint (legit replay → 200) from other errors (return 500 so Stripe retries).

### H2 — `mock-complete` endpoint accepts arbitrary `orderId`/`amountCents` with no auth and a broken mode guard
`src/app/api/checkout/mock-complete/route.ts:18-43`

```ts
if (getStripeMode() !== "mock" && process.env.NODE_ENV === "production") {
  return NextResponse.json({ ok: false, error: "Not available" }, { status: 404 });
}
```

The guard is `mode !== "mock" && production`, so **test mode in development** (`STRIPE_MODE=test`, `NODE_ENV=development`) leaves the endpoint wide open. Even in mock mode there is no `withPublicGuard`, no rate limit, no draft-ownership check. Any caller can POST `{ sessionId, orderId, amountCents }` for **any** order and run it through `processStripeWebhook`, which finalizes the order, posts a Stripe payment, and flips it to PAID. The charged-amount safety compares `amount_total` to `expected`, so a wrong amount triggers a safety refund — but a matching amount completes any order. The guard must be `if (getStripeMode() !== "mock") return 404` (independent of NODE_ENV), and the route still needs `withPublicGuard` + draft-ownership even in mock.

### H3 — Refund webhook double-counts `refundedCents` (no per-refund idempotency)
`src/lib/payments/webhook.ts:233-261` and `:296-300`

`handleChargeRefunded` does `refundedCents: { increment: refund.amount }` keyed only on `payment_intent`. The dispatcher matches **both** `charge.refunded` and `refund.created` (Stripe emits both for one refund). The top-level `claimWebhookEvent` dedupes by Stripe `event.id`, but these are two distinct events with different IDs and identical `payment_intent`/`amount`. Net effect: a single refund increments `refundedCents` twice, corrupting `recalcOrderPaymentStatus` (can flip a PAID order to PARTIAL/UNPAID). There is also no dedupe by `refund.id`, so any future re-emission of the same refund object repeats the increment. Persist seen refund IDs and skip if already applied.

## Medium

### M1 — Webhook signature has no timestamp freshness / replay window
`src/lib/stripe/client.ts:60-88`

`verifyWebhookSignature` HMAC-verifies `t.payload` with `timingSafeEqual` but never compares `t` to the current time. Stripe's official library rejects events older than ~5 minutes. Exact-replay is currently caught by `claimWebhookEvent` on `event.id`, but the missing freshness check is a defense-in-depth gap and a deviation from Stripe's contract. Add `if (Math.abs(now - t) > 300) return false`.

### M2 — `checkout.session.completed` handler does not check `payment_status`
`src/lib/payments/webhook.ts:97-132`

`handleCheckoutSessionCompleted` only compares `amount_total` to `expected`. It never asserts `session.payment_status === "paid"`. With `mode: "payment"` and immediate capture this is normally paid, but if a deferred/`pay_later` or 3DS-session-completed event ever lands, the order would finalize and post a `POSTED` Stripe payment for a charge that hasn't actually captured. Assert `payment_status === "paid"` before finalizing.

### M3 — `withPublicGuard` same-origin check is bypassable by header omission
`src/lib/http/public-guard.ts:40-58`

```ts
const site = request.headers.get("sec-fetch-site");
if (site === "same-origin" || site === "none" || site === null) return true;
return false;
```

When `Origin` and `Referer` are both absent, the fallback allows the request through if `Sec-Fetch-Site` is `null` (header missing entirely). Any non-browser client (curl, server-to-server, scripted fetch) omits all three headers and bypasses the same-origin guard. Modern browsers send `Sec-Fetch-Site: cross-origin` on cross-site POSTs, so browser CSRF is still blocked, but the "same-origin" guarantee is not real for non-browser callers. Fail closed when Origin/Referer are missing.

### M4 — `clientIp` trusts `X-Forwarded-For` blindly; rate limits are trivially evadable
`src/lib/http/public-guard.ts:13-17` and `:78-86`

`clientIp` returns the first comma-delimited entry of `X-Forwarded-For` with no trusted-proxy validation. An attacker sets a fresh `X-Forwarded-For` per request and gets a fresh rate-limit bucket, defeating the per-IP limit on `checkout-prepare` / `checkout-start`. The bucket map is also in-module-memory (not shared across instances), so multi-instance deployments multiply the effective limit. Validate XFF only against a trusted hop list, and back the limiter with shared storage for production.

### M5 — Dev auth trusts `x-dev-user-id` header for full identity spoofing
`src/lib/auth.ts:36-54`

In `AUTH_MODE=dev`, `getAuthIdentity` reads `x-dev-user-id` (then a cookie, then `DEV_ACTING_USER_ID`). Any request with `x-dev-user-id: dev_manager_1` is treated as that manager, and `isPublic` in middleware already exempts `/api/checkout(.*)`, `/api/drafts(.*)`, `/api/dev(.*)`, etc. from Clerk `protect()`. A dev/preview instance exposed to the internet is a full auth bypass to manager level. `AUTH_MODE=dev` is opt-in and defaults to Clerk (fail-closed), but the header path should be disabled whenever `NODE_ENV=production` regardless of `AUTH_MODE`, and preview deploys must never run dev auth.

## Low

### L1 — `assertOfflinePaymentStaffOnly(true)` is a no-op guard
`src/app/api/checkout/offline/route.ts:41-42` and `src/lib/payments/offline.ts:203-207`

The route calls `assertOfflinePaymentStaffOnly(true)` with a hardcoded literal, so the function (which checks `if (!isStaff) throw`) can never fire. The real gate is `requirePermission("admin.access")`. The named guard is dead code and misleading — either pass the actual staff flag or delete the helper and rely on `requirePermission`.

### L2 — `voidPayment` / `transitionOrder` / `discardDraft` have no per-order scoping
`src/app/api/orders/lifecycle/route.ts`, `src/lib/payments/offline.ts:151-200`

Any staff with `admin.access` can void any CASH/CHECK payment by ID, transition any order, or discard any customer's draft. All actions are audited, and `admin.access` is a broad permission by design, but there is no ownership/region scoping. Worth noting if `admin.access` is ever granted broadly.

### L3 — `setup` bootstrap allows any signed-in user to seize first manager
`src/app/api/setup/route.ts:28-97`

`POST /api/setup` only requires `getAuthIdentity()` (any signed-in Clerk user) plus the setup-lock mutex. The unique `appSetting.create` correctly serializes concurrent bootstraps (P2002 → 409), but whoever wins the race becomes the first manager. If the site is reachable before setup completes, any registered user can take admin. Restrict bootstrap to an allow-list or an out-of-band claim.

### L4 — `dev/session` sets `dev_user_id` cookie `httpOnly: false`
`src/app/api/dev/session/route.ts:17`

The dev identity cookie is JS-readable, so any XSS on a dev/preview instance can exfiltrate the acting user ID. Dev-only and gated by `AUTH_MODE=dev`, but the cookie should still be `httpOnly: true` to limit blast radius.

### L5 — `claimWebhookEvent` stores only `{ type }` as `meta`
`src/lib/payments/webhook.ts:43-45`

The idempotency row records only `event.type`, not the event body or key fields, so forensics on a dropped/replayed event are limited. Store a redacted digest (sessionId, orderId, amount) for auditability without retaining PII.

### L6 — `donationCents` has no upper bound
`src/app/api/checkout/route.ts:16`

`donationCents: z.number().int().min(0).optional()` has no max. The total is server-computed and the Stripe amount is derived from it, so a client can inflate the donation arbitrarily (the customer just pays more). Not exploitable for fraud, but cap it to a sane maximum to prevent accidental huge charges and to keep `expectedTotalCents` arithmetic clean.

### L7 — Guest draft token lookup iterates up to 25 rows non-constant-time
`src/lib/orders/drafts.ts:118-136` and `src/app/api/drafts/route.ts:44-57`

`findGuestDraftByToken` / drafts GET loop over the 25 most-recent guest drafts and return on first `guestTokenMatches` hit. The loop length leaks a weak timing signal about how far down the recent list a match is. Guest tokens are 24 random bytes, so enumeration is infeasible; the signal is negligible. Acceptable, noted for completeness.
