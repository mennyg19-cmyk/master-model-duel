# P5 Security Review — arm-05 (blind)

**Phase:** P5 — Checkout: delivery rules, fees, Stripe hosted, order lifecycle, payments
**Scope:** Stripe webhook authenticity/idempotency, payment safety, guest tokens, public endpoint guards, POS auth.
**Method:** Findings only — no fixes. P5 scope only.

## Summary

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 2 |
| Medium | 3 |
| Low | 3 |

---

## Critical

### C1 — Safety-refund path never issues a refund

- **Location:** `lib/checkout.ts` `completeCheckout` (lines 235–238); `app/api/stripe/webhook/route.ts`
- **Claim:** When `session.amountCents !== session.order.totalCents` or `order.status !== "DRAFT"`, the checkout is marked `SAFETY_REFUND_REQUIRED` and the handler returns `{ refundNeeded: true, paymentIntentId }`, but no code anywhere calls the Stripe API to actually issue the refund. The webhook response body is discarded by Stripe, and no cron/worker picks up `SAFETY_REFUND_REQUIRED` sessions.
- **Evidence:**
  - `lib/checkout.ts:236-237` — `await transaction.checkoutSession.update({ ... data: { status: "SAFETY_REFUND_REQUIRED" } }); return { replayed: false, refundNeeded: true, paymentIntentId: session.providerIntentId };` — no refund API call, no outbox row, no queued job.
  - Grep for `refund|Refund|SAFETY_REFUND` across the workspace returns only the webhook handler, the smoke script, and `lib/checkout.ts`. There is no `POST /v1/refunds` call to Stripe, no sweeper, no reconciliation cron for safety refunds.
  - `capture_method` is `automatic` (`lib/checkout.ts:164`), so the charge is already captured when the webhook fires. A customer whose total was tampered post-session (or whose draft was discarded) is charged with no order and no refund.
- **Plan ref:** R-126 / R-169 require auto-refund of stale/failed; PHASE-P5-EXPECTED item 4.

### C2 — `charge.refunded` webhook looks up the wrong ID, so refund sync silently no-ops

- **Location:** `app/api/stripe/webhook/route.ts` `markRefunded` (lines 11–20)
- **Claim:** For `charge.refunded` events, Stripe's `data.object` is a **Charge** (`object.id = ch_...`), not a PaymentIntent. The code uses `event.data?.object?.id` as `intentId` and looks up `stripePaymentIntent.findUnique({ where: { stripeIntentId: intentId } })`. The `StripePaymentIntent` row is stored under the PaymentIntent ID (`pi_...`) set in `completeCheckout` (`lib/checkout.ts:258-261`). The lookup misses, `intent?.paymentId` is undefined, and the function returns silently — the payment and order are never marked `REFUNDED`.
- **Evidence:**
  - `app/api/stripe/webhook/route.ts:12-15` — `const intentId = event.data?.object?.id; ... const intent = await prisma.stripePaymentIntent.findUnique({ where: { stripeIntentId: intentId } }); if (!intent?.paymentId) return;`
  - `lib/checkout.ts:258-261` — `stripeIntentId: session.providerIntentId ?? sessionId` (the PaymentIntent ID, not the charge ID).
  - The smoke test masks the bug by faking `data.object.id = paidIntent.stripeIntentId` (`scripts/smoke-p5.ts:156`), so the lookup succeeds in the harness but would fail against real Stripe events. The correct field for `charge.refunded` is `data.object.payment_intent`.
- **Plan ref:** R-168 (refund sync); PHASE-P5-EXPECTED item 4.

---

## High

### H1 — Rate limiter trusts spoofable `x-forwarded-for[0]`

- **Location:** `app/api/checkout/[draftId]/route.ts` `allowPublicAttempt` (lines 9–19); `app/api/newsletter/route.ts` `isRateLimited` (lines 33–45)
- **Claim:** Both rate limiters key on `request.headers.get("x-forwarded-for")?.split(",")[0]`. A client can set its own `X-Forwarded-For` header; on platforms that append the real client IP, the attacker-controlled value becomes `[0]`. Rotating that value gives the attacker an unbounded number of distinct keys, defeating the per-IP limit. The newsletter limiter also falls back to `x-real-ip` only when XFF is absent, and otherwise to `"unknown"` (shared bucket for all anonymous callers).
- **Evidence:**
  - `app/api/checkout/[draftId]/route.ts:10` — `const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";`
  - `app/api/newsletter/route.ts:34-36` — same pattern with `x-real-ip` fallback.
  - No use of the platform-trusted client IP (e.g. the last XFF entry, or `x-vercel-forwarded-for`).
- **Plan ref:** R-122 (public endpoint guards — IP rate limit).

### H2 — `markRefunded` runs before idempotency recording, and refund events have no replay guard

- **Location:** `app/api/stripe/webhook/route.ts` (lines 35–41)
- **Claim:** For `charge.refunded` / `payment_intent.canceled`, `markRefunded(event)` is awaited **before** the `webhookEvent.upsert`. If `markRefunded` partially succeeds (e.g. updates the payment but the order update fails) and then the upsert throws, the event is not recorded as processed and Stripe retries — re-running `markRefunded`. More importantly, the upsert is an `upsert` with empty `update: {}`, so a replayed event always "succeeds" and `markRefunded` re-executes on every retry. `markRefunded` happens to be idempotent today (sets `REFUNDED`), but there is no structural guarantee and no transactional coupling between the side effect and the idempotency record.
- **Evidence:**
  - `app/api/stripe/webhook/route.ts:35` — `if (event.type === "charge.refunded" || event.type === "payment_intent.canceled") await markRefunded(event);` followed by `await prisma.webhookEvent.upsert(...)` at line 36.
  - Contrast with `completeCheckout` (`lib/checkout.ts:228-233`), which creates the `webhookEvent` row first and uses `P2002` as the replay guard before any side effect.
- **Plan ref:** R-167 (webhook idempotency).

---

## Medium

### M1 — `GET /api/order/drafts/[draftId]` skips same-origin guard

- **Location:** `app/api/order/drafts/[draftId]/route.ts` `GET` (lines 8–13)
- **Claim:** `PUT` on the same route checks `hasSameOrigin`, but `GET` does not. A cross-origin page making a `fetch` to read draft contents (recipient names, addresses, line items) is not blocked at the header level. Clerk session cookies are `SameSite=Lax`, so a cross-origin GET from a top-level navigation could carry cookies and leak draft PII to an attacker origin (the response has no `Access-Control-Allow-Origin`, so `fetch` reading the body is blocked by CORS in browsers, but the gap is inconsistent with the rest of the route and weakens defense-in-depth).
- **Evidence:**
  - `app/api/order/drafts/[draftId]/route.ts:16` — `if (!hasSameOrigin(request)) ...` only inside `PUT`.
  - `GET` (line 8) has no origin check.
- **Plan ref:** R-122 (public endpoint guards — same-origin).

### M2 — In-memory rate-limit maps are unbounded and per-instance

- **Location:** `app/api/checkout/[draftId]/route.ts` `attempts` (line 7); `app/api/newsletter/route.ts` `subscribeAttempts` (line 29)
- **Claim:** Both limiters use module-level `Map<string, ...>` with no eviction of stale entries beyond the per-key reset check. Under load, the map grows with each distinct (spoofable) XFF value and is never pruned. On serverless / multi-instance deployments each instance keeps its own map, so the effective limit is `instances × threshold` and an attacker can shard across instances.
- **Evidence:**
  - `app/api/checkout/[draftId]/route.ts:7` — `const attempts = new Map<string, { count: number; resetAt: number }>();` with no `setInterval` cleanup or max-size cap.
  - `app/api/newsletter/route.ts:29` — same pattern.
- **Plan ref:** R-122 (rate limit); G-024 (crunch scale).

### M3 — Local checkout harness completes sessions without verifying caller ownership

- **Location:** `app/api/checkout/local/route.ts` (lines 5–15)
- **Claim:** The dev-only local harness accepts any `sessionId` starting with `cs_local_` and calls `completeCheckout` with no check that the caller owns the draft or the session. Anyone who can guess or learn a local session ID can finalize that order (reserve inventory, post a payment, assign an order number). Mitigations: `NODE_ENV === "development"` gate, `hasSameOrigin`, and the session ID is a random UUID. Still, the harness trusts the caller's stated session ID with no draft-access token check.
- **Evidence:**
  - `app/api/checkout/local/route.ts:9-11` — `if (!body?.sessionId?.startsWith("cs_local_")) ...; return NextResponse.json(await completeCheckout(body.sessionId, ...))` — no `readDraft` / `x-draft-access-token` verification.
- **Plan ref:** R-121 (guest tokens / draft ownership anti-enumeration).

---

## Low

### L1 — `hasSameOrigin` is CSRF-only, not an auth boundary

- **Location:** `lib/route-auth.ts` `hasSameOrigin` (lines 56–59)
- **Claim:** The check compares the `Origin` header to the request URL's origin. This blocks browser-driven CSRF but provides no protection against non-browser clients, which can set `Origin` freely. Several routes (checkout, drafts, POS, addresses, newsletter) rely on this as the only "public endpoint guard" beyond Zod. The plan's R-122 "same-origin" requirement is satisfied literally, but reviewers should note it is not a substitute for auth on actions that mutate state.
- **Evidence:** `lib/route-auth.ts:57-58` — `return origin === new URL(request.url).origin;`. No token, no signed header.
- **Plan ref:** R-122.

### L2 — `JSON.parse(body)` in webhook handler is unguarded

- **Location:** `app/api/stripe/webhook/route.ts:27`
- **Claim:** After signature validation, `JSON.parse(body)` is called without a try/catch. A signature-valid payload with malformed JSON (only reachable by someone holding `STRIPE_WEBHOOK_SECRET`, or by the local harness path) would throw an unhandled exception and surface a 500 instead of a clean 400. Low impact because the signature gate is strong, but it is an unhandled-error path on a payment endpoint.
- **Evidence:** `app/api/stripe/webhook/route.ts:27` — `const event = JSON.parse(body) as StripeEvent;` with no try/catch.
- **Plan ref:** R-167.

### L3 — `createPosOrder` opens a real Stripe Checkout session for cash/check POS

- **Location:** `lib/checkout.ts` `createPosOrder` (lines 287–308) → `startCheckout` → `createProviderCheckout`
- **Claim:** When `STRIPE_SECRET_KEY` is configured, a staff POS cash/check order still calls `createProviderCheckout`, which POSTs to `https://api.stripe.com/v1/checkout/sessions` and creates a real (abandoned) Stripe session for an order that will never be paid via Stripe. The session is then completed locally with a synthetic `evt_pos_...` event and the payment row is rewritten to `CASH`/`CHECK`. This leaks abandoned sessions into the Stripe dashboard and makes the Stripe secret key reachable from the POS code path unnecessarily. Not a direct exploit, but a payment-surface hygiene issue.
- **Evidence:**
  - `lib/checkout.ts:294` — `const checkout = await startCheckout(orderId, input, requestUrl);` (unconditional).
  - `lib/checkout.ts:295` — `await completeCheckout(checkout.sessionId, \`evt_pos_${checkout.sessionId}\`);` synthesizes an event ID that is recorded as a real `WebhookEvent`.
- **Plan ref:** UR-011 (staff-only cash/check POS); R-170 (lazy Stripe singleton).

---

## Out of scope (noted, not scored)

- `lib/dev-auth.ts` dev session tokens — P1 identity surface, not P5.
- `app/api/setup/route.ts` bootstrap lockout — P1.
- `app/api/admin/security/route.ts`, `app/api/audit/route.ts` — admin surface, not P5-specific.
