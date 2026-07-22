# Residual security review — arm-03 (post Test 5 self-fix tree)

**Arm:** arm-03 (blind)
**Tree:** post Test 5 self-fix workspace (`arms/arm-03/workspace`)
**Reviewer scope:** trust boundaries, auth, secrets, IDOR, injection
**Method:** static read of the post-fix tree; the self-review chat was not consulted
**Output:** findings only — no fixes proposed

---

## Summary counts

| Severity | Count |
|---|---:|
| Blocker | 0 |
| High | 1 |
| Medium | 2 |
| Low | 3 |
| Informational | 2 |
| **Total** | **8** |

The tree is in strong shape overall. The residual findings cluster around one
theme: the fail-closed env guards in `lib/env.ts` check the wrong default
values, so an operator who copies `.env.example` into production with a live
Stripe key would start with publicly-known secrets the guards do not refuse.

---

## High

### H-1 — Stripe webhook secret guard checks the wrong default value

`lib/env.ts:5` defines `DEV_WEBHOOK_SECRET = "whsec_dev_mock_secret"`, and the
real-mode guard at `lib/env.ts:115` refuses startup only when
`STRIPE_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET`.

But `.env.example:36` (and the local `.env:32`) ship
`STRIPE_WEBHOOK_SECRET=whsec_mock_dev_only` — a **different** string.

Consequence: an operator who copies `.env.example` into `.env` and adds a real
`STRIPE_SECRET_KEY` starts in real mode with `STRIPE_WEBHOOK_SECRET` set to the
public repo value `whsec_mock_dev_only`. The guard does not fire (it only
catches the unset-default path, `whsec_dev_mock_secret`). The webhook route
`app/api/webhooks/stripe/route.ts:50` then verifies every Stripe event against
that public value, so:

- real Stripe events (signed with the dashboard endpoint secret) are rejected
  → payments never land, and
- anyone who has read the repo can forge `checkout.session.completed` events
  against the production webhook and mint completed orders / drive auto-refund
  paths.

The mock gateway (`lib/payments/stripe.ts`) signs with `env.STRIPE_WEBHOOK_SECRET`,
so dev is internally consistent and the bug is invisible in the harness.

---

## Medium

### M-1 — `SESSION_SECRET` public-default blocklist omits the `.env.example` value

`lib/env.ts:11` `PUBLIC_SESSION_SECRET_DEFAULTS` blocks two placeholders:
`change-me-to-a-random-string` and `dev-only-secret-not-for-production-1748`.

`.env.example:75` (and `.env:62`) ship
`SESSION_SECRET=arm03-local-session-secret-not-public` — a third, unblocked
value.

`SESSION_SECRET` is the HMAC key for staff sessions (`lib/auth/session.ts`),
customer sessions (`lib/auth/customer-session.ts`), newsletter tokens
(`lib/newsletter-token.ts`), registration tokens
(`lib/auth/registration-token.ts`), guest-draft tokens
(`lib/order-builder/draft-store.ts`), and driver magic-link PIN cookies
(`lib/routes/links.ts`). An operator who copies `.env.example` into production
with a real Stripe key passes the real-mode guard with this public secret, so
every signed token in the system becomes forgeable by anyone who has read the
repo. The guard exists for exactly this case and misses the one shipped value.

### M-2 — `CRON_SECRET` has no public-default guard

`lib/env.ts:60` only requires `CRON_SECRET.min(16)`. `.env.example:57` ships
`CRON_SECRET=tomchei-arm03-cron-dev-only` (16 chars, public).

`lib/cron.ts:11` (`requireCronAuth`) is correctly fail-closed when
`CRON_SECRET` is unset, and uses a constant-time compare. But there is no
public-default blocklist, so an operator who copies `.env.example` into
production runs every cron endpoint (`/api/cron/*` in `vercel.json`) guarded
by a secret anyone can read from the repo — season auto-flip, payment
reminders, pickup expiry, notification sweep, log purge, and Stripe
reconciliation become externally invocable.

---

## Low

### L-1 — In-memory rate limiter is per-process only

`lib/rate-limit.ts:7` stores windows in a process-local `Map`. The file
documents this as a dev-only posture and notes the need for a shared store
before horizontal scaling. `lib/env.ts:137` correctly refuses to start in
production without `TRUST_PROXY=true` (so the rate-limit key is per-client-IP,
not one shared bucket), but the limiter itself is still per-instance. A
multi-instance production deploy gives an attacker `limit × instances`
attempts per window on setup, registration, checkout, draft-save, repeat, and
the mock pay endpoint. Not a blocker for the single-node duel harness; flagged
as a production hardening gap.

### L-2 — Dead env vars declared in `.env.example` but never consumed

`NEWSLETTER_HMAC_SECRET` and `DRAFT_ACCESS_SECRET` appear only in
`.env.example` (lines 28, 31). A repo-wide search finds no code reference —
the newsletter token (`lib/newsletter-token.ts`) and guest-draft HMAC
(`lib/order-builder/draft-store.ts`) both key off `SESSION_SECRET`. The
declared-but-unused vars mislead an operator into believing rotating them
matters; they also imply a separation of concerns (newsletter vs session)
that the code does not actually enforce. Minor, but a config/hygiene drift.

### L-3 — `/media/[id]` serves any local media asset with no auth

`app/media/[id]/route.ts` looks up a `MediaAsset` by id and streams its bytes
to any caller. Ids are CUIDs (unguessable) and the library is for public
product images, so this is fine today. But there is no access-control layer
at all — if a "private media" concept is ever introduced, this route would
leak it. Worth noting because the route does not even check `storage ===
"local"` against an ownership/visibility model; it trusts the row.

---

## Informational

### I-1 — Staff order mutations are not season-scoped

`app/api/admin/orders/[id]/{payments,refund,discard,finalize}` and the bulk
routes look orders up by id alone, with no `seasonId` predicate. A staff
member with `payments.record` / `orders.manage` / `payments.refund` can post
payments, finalize, discard, or refund orders from any season (past or
current). This is almost certainly intentional — late payments and refunds
on prior-season orders are legitimate — and the state-transition tables
refuse illegal moves (a FINALIZED order cannot be re-finalized). Flagged
only so the trust boundary is explicit: the gate is the staff permission,
not the season.

### I-2 — Signed tokens carried in URL query strings

Newsletter preferences (`app/(storefront)/newsletter/preferences/page.tsx`)
and the registration verify-email link (`app/api/account/register/route.ts:92`)
embed HMAC-signed, expiring tokens in the URL. This is the standard email-link
pattern and the tokens are purpose-scoped (newsletter vs register) and
non-replayable, but URL tokens can leak via `Referer` headers, browser
history, or proxy logs. The unsubscribe endpoint correctly takes the token in
the POST body (`app/api/newsletter/unsubscribe/route.ts`); the preferences
page reads it from the query string. No action required for the duel; noted
for completeness.

---

## What was checked and looked clean

- Session design: HMAC-hashed tokens in DB (staff, customer, driver link,
  guest draft), `httpOnly` + `sameSite=lax` + `secure` in prod, 12h/30d TTL,
  rotation revokes earlier driver links.
- Passwords: scrypt + per-password salt + `timingSafeEqual` (`lib/auth/passwords.ts`).
- Webhook authenticity: Stripe-Signature `t=,v1=` scheme with 5-min tolerance
  and constant-time compare (`lib/payments/webhook-verify.ts`); event
  idempotency ledger with claim/processing-grace (`app/api/webhooks/stripe/route.ts`).
- Charged-amount safety + auto-refund on mismatch (`.../webhooks/stripe/route.ts:142`).
- DB-first staff refund with stable idempotency key + placeholder claim
  (`lib/payments/post-payment.ts`, `app/api/admin/orders/[id]/refund/route.ts`).
- Permission model: role + per-user overrides, `requirePermissionApi` /
  `requirePermissionPage` everywhere admin, self-role/self-revoke/self-override
  blocked, role/status/override changes kill target sessions
  (`lib/auth/permissions.ts`, `lib/auth/current-user.ts`, `app/api/staff/...`).
- Impersonation: self-impersonate blocked, audited, session-scoped, stop-audit
  records real vs acting user (`app/api/impersonate/route.ts`, `lib/audit.ts`).
- IDOR: customer profile/addresses derive the row id from the session (never
  the client); repeat checks `order.customerId === customer.id`; payment void
  checks `payment.orderId === params.id`; package split / print-artifact /
  route-print / shipments-tracking scope by `seasonId`; foreign ids return
  the same 404 as missing ones (anti-enumeration).
- Anti-enumeration on registration (same pending shape for known/unknown
  emails), customer search bounded, phone never used for matching
  (`lib/customers.ts`).
- Public endpoints: same-origin + per-IP rate limit (`lib/public-guard.ts`)
  on checkout, draft-save, repeat, mock-stripe-pay, register, register-complete.
- Destructive test-console: fail-closed (explicit TEST_MODE/IS_TEST_ENV AND
  non-production AND `settings.manage`) (`lib/test-mode.ts`).
- Media upload: magic-byte signature check (PNG/JPEG/GIF/WebP), 5 MB cap,
  filename sanitization (`lib/media.ts`).
- CSV export formula neutralization (tab prefix for `=+-@`) (`lib/csv.ts`).
- PDF text escaping (parens, backslash, Latin-1) (`lib/pdf.ts`).
- Raw SQL in `lib/exports.ts` (lapsed-customers) uses `Prisma.sql` tagged
  template — parameterized, no injection.
- Guest draft cookie cleared on login/register/checkout-success (no shared-
  device leak) (`lib/order-builder/draft-store.ts`).
- `.gitignore` covers `.env*`, `.env`, `.scratch/`, `.uploads/`, `.pgdata/`.
- Cron endpoints all use `requireCronAuth` (verified across all six routes).
- `next.config.ts` enables `authInterrupts` so `forbidden()`/`unauthorized()`
  return real 403/401.
