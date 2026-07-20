# P5 Security Review — arm-02 (blind)

**Phase:** P5 — Checkout, delivery rules/fees, Stripe hosted checkout, order lifecycle, POS payments
**Scope:** `arms/arm-02/workspace/` P5 surface only. Findings only — no fixes. Blind to model identity.

## Findings

### HIGH-1 — `STRIPE_WEBHOOK_SECRET` ships with a known default
`lib/env.ts:25` declares `STRIPE_WEBHOOK_SECRET: z.string().default("whsec_dev_mock_secret")`. The webhook route authenticates every event purely with this value (`app/api/webhooks/stripe/route.ts:35`, `lib/payments/webhook-verify.ts:15-32`). If an operator deploys without setting the env var, the primary money ingress trusts a public, repo-committed secret. Anyone who can reach `/api/webhooks/stripe` can forge a `checkout.session.completed` event (mark any open order PAID + FINALIZED + commit stock), forge `refund.*` events (insert negative payment rows), or drive the `!safe` branch to auto-refund + discard real orders. There is no startup guard that rejects the default when `STRIPE_SECRET_KEY` is set (i.e. when the gateway is in real mode). The signature scheme itself (HMAC-SHA256, `t=…,v1=…`, 5-min tolerance, `timingSafeEqual`) is sound — the failure is the default secret and the absence of a fail-closed check.

### MEDIUM-1 — Silent fallback to mock gateway in any non-dev environment
`lib/payments/stripe.ts:98-103` selects mock mode whenever `STRIPE_SECRET_KEY` is unset, with no `NODE_ENV`/production guard. In mock mode, `POST /api/checkout` returns a checkout URL pointing at `/dev/stripe-checkout`, and `POST /api/dev/stripe-checkout` (`app/api/dev/stripe-checkout/route.ts:22-61`) builds a `checkout.session.completed` event, signs it with the webhook secret, and posts it through the REAL webhook route — so `postPayment` + `finalizeOrder` mark the order PAID/FINALIZED with zero real money captured. A misconfigured production deployment (missing key) silently accepts "paid" orders that were never charged. The only thing keeping this contained is the `mode !== "mock"` 404 gate on the dev route, which is itself bypassed in exactly the misconfigured case.

### MEDIUM-2 — Duplicate positive payment row on the finalize-after-payment failure path
`app/api/webhooks/stripe/route.ts:113-134`. On the safe branch, `postPayment` writes a `+amountCents` POSTED row (line 113-119) BEFORE `finalizeOrder` is attempted. If `finalizeOrder` throws (e.g. stock ran out between checkout and webhook — the documented case at line 124-127), the `autoRefund` path then writes ANOTHER `+amountCents` POSTED row plus the `-amountCents` refund row (lines 174-192). Net money is correct, but two charge rows exist for one Stripe charge, `recalcPaymentStatus` runs against an intermediate 2×-charge state before the refund row lands, and the audit/ledger no longer matches Stripe's 1:1 charge. This is on the payment trust boundary and breaks the "books match Stripe" invariant the surrounding code is written to enforce.

### MEDIUM-3 — Refund sync listens for non-existent Stripe event types
`app/api/webhooks/stripe/route.ts:65` handles `refund.created` / `refund.updated`. Stripe emits `charge.refunded` and `charge.refund.updated` (and `refund.*` objects, not events). Refunds issued in the Stripe dashboard therefore never sync back through this webhook, so `recordRefund` is never called for external refunds and the local ledger diverges from Stripe's view of the order — a refund issued outside the app leaves the customer's order showing a balance due. Not a direct injection, but a trust-boundary gap on the refund path that the EXPECTED (§4 "refund sync") calls out as required.

### LOW-1 — `/api/dev/stripe-checkout` has no same-origin guard, no rate limit, no auth
`app/api/dev/stripe-checkout/route.ts:22` is a state-changing money-path trigger (it mints a webhook event and finalizes an order) yet bypasses `guardPublicEndpoint` entirely, unlike its sibling `/api/checkout` and `/api/checkout/quote`. The real-mode 404 gate and the random `cs_mock_<24-hex>` session ids keep exploitation marginal, but in mock mode anyone who learns a session id (e.g. from the customer's redirect URL) can drive that checkout to completion from any origin with no throttling. The public-guard doc (`lib/public-guard.ts:4-7`) says state-changing public routes get same-origin + rate limit; this one opts out without a stated reason.

### LOW-2 — `clientIp` trusts the LAST hop of `X-Forwarded-For`
`lib/rate-limit.ts:28-37`. When `TRUST_PROXY=true`, the rate-limit key is built from the last entry of the client-supplied `X-Forwarded-For` chain. The safe selection behind a single appending proxy is the leftmost hop; the last-hop choice is only correct if exactly one proxy always appends and never passes through a pre-existing header. If the proxy forwards the client's chain as-is (or the chain is multi-hop), the attacker controls the last hop and can mint a fresh rate-limit bucket per request, defeating the 20/60s checkout and 60/60s quote limits. The comment asserts the last hop "cannot be forged," which is only true under a narrow proxy contract.

### LOW-3 — Webhook buffers the full request body before signature verification
`app/api/webhooks/stripe/route.ts:34-37` calls `await request.text()` (unbounded) and only then runs `verifyWebhookSignature`. With no body-size cap, an attacker can POST an arbitrarily large payload to the unauthenticated webhook endpoint and force the server to buffer it fully in memory before rejecting the signature — a cheap memory-amplification vector against the money endpoint. The idempotency ledger and signature check do not mitigate the pre-verification buffering.

### LOW-4 — Checkout throws an unhandled 500 on a client-supplied key that misses the server-resolved map
`lib/checkout/create-order.ts:160-162` throws `Error("…lost its pricing or recipient mid-transaction")` when a client-supplied `recipientKey`/`methodId` does not match a server-resolved recipient. `checkoutSchema` accepts arbitrary `z.string().min(1)` recipient keys, so a malformed payload produces a 500 (transaction rolls back) rather than a 4xx. Combined with the 20/60s rate limit this is a minor error-spray / log-noise vector, not a money risk.

## Severity counts
- Critical: 0
- High: 1
- Medium: 3
- Low: 4
- Total: 8
