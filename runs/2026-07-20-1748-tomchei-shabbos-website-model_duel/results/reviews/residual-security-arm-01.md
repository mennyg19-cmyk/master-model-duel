# Security Review — Test 5 Residual (arm-01, blind)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-01` (reviewed blind — SELF-REVIEW / SELF-FIX artifacts were not read)
**Tree graded:** `arms/arm-01/workspace/` post self-fix, full tree (Next.js App Router + Prisma + Clerk + Stripe + Shippo + Vercel Blob)
**Reviewer specialist:** Security
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes.

---

## Severity summary

| Severity | Count |
|---|---|
| High     | 0 |
| Medium   | 4 |
| Low      | 8 |
| Info     | 2 |

---

## Methodology notes

- Reviewed every route under `src/app/api/**/route.ts` plus `src/lib/{auth,permissions,cron-auth,admin-request,public-request,customer-access,stripe,shippo,newsletter,ids,store-settings,env}.ts` and the CSV export domain.
- No `middleware.ts` exists anywhere in the workspace (confirmed by glob). Auth is enforced per-route only.
- `.env*` and `.scratch/` are gitignored, so secrets in those paths are not part of the deployable tree (see INFO-2).

---

## Medium findings

### M-1 — Inconsistent CSRF / same-origin guard across admin mutation endpoints
`requireSameOriginAdminRequest` is applied to only five admin routes: `admin/help`, `admin/test-console`, `admin/stripe-reconciliation`, `admin/legacy-imports` (stage), and `admin/legacy-imports/[batchId]/commit`. Every other state-changing admin route relies exclusively on Clerk session cookies + `requirePermission`:

- `admin/orders/bulk-repeat`, `admin/orders/[orderId]/repeat`
- `admin/pos/orders/[orderId]/checkout`
- `admin/packages/actions`, `admin/print-batches`, `admin/print-artifacts`
- `admin/delivery`, `admin/shipping`
- `admin/seasons`, `admin/catalog`, `admin/customers`, `admin/customer-addresses/[addressId]`
- `admin/email` (POST + PATCH), `admin/settings` (PATCH), `admin/staff` (POST + PATCH)
- `admin/impersonation` (POST + DELETE), `admin/imports/[batchId]/commit`

Practical CSRF is currently mitigated by Clerk cookies being `SameSite=Lax`, so cross-site JSON POSTs will not carry the session. The risk is defense-in-depth: if Clerk cookies are ever reconfigured (e.g. `SameSite=None` for a cross-origin embed) or a same-site XSS is introduced, every unguarded endpoint becomes cross-site exploitable. The guard exists in the codebase but is applied inconsistently — a missing-audit risk for future routes.

### M-2 — Test-auth trust boundary rests on a spoofable Host header plus a magic identity
`getAuthenticatedClerkUserId` (`src/lib/auth.ts:29-56`) gates the local test-auth bypass on `requestHeaders.get("host")` being `127.0.0.1` or `localhost`. The `Host` header is client-controlled in many deployments. When `ENABLE_TEST_AUTH=true` and `NODE_ENV !== "production"`, a caller who knows `TEST_AUTH_SECRET` can mint an HMAC token for the literal user id `__local_manager__`; `getCurrentStaffUser` (`auth.ts:65-71`) then resolves that id to **the first active MANAGER** without any further credential. Preconditions are narrow (test secret + non-prod + flag enabled), but if this flag is left on in a staging/preview deploy that an attacker can reach, the Host check alone should not be the trust boundary. The `__local_manager__` magic identity is a silent privilege escalation waiting to be re-enabled.

### M-3 — `admin:view` (base STAFF role) grants full draft + customer address-book read/write across all customers
`findAccessibleDraft` (`src/lib/customer-access.ts:38-48`) short-circuits for any staff session with `admin:view`, returning any draft by id with no customer scoping. `STAFF` is granted only `admin:view` in `permissions.ts:17`. Consequences:

- `PATCH/DELETE /api/order/drafts/[draftId]` — a base STAFF member can mutate or cancel any customer's draft.
- `GET/POST /api/account/addresses?draftId=X` and `PATCH /api/account/addresses/[addressId]` (guest path resolves `customerId` via `findAccessibleDraft`) — a base STAFF member can enumerate and edit any customer's full address book (recipient names + full postal addresses, PII).

For an ops tool this read access may be intended, but the scope (full mutation of every customer's address book) exceeds what the permission name `admin:view` implies, and there is no audit log on the address/draft mutation paths for staff actions (the staff address route `admin/customer-addresses/[addressId]` logs, but the customer-facing `account/addresses` path used by staff via `draftId` does not).

### M-4 — Staff invitation acceptance does not bind the accepting Clerk identity to the invited email
`POST /api/staff/accept-invite` (`src/app/api/staff/accept-invite/route.ts`) validates the invite token (hashed in DB, single-use, 7-day expiry) and requires *some* authenticated Clerk identity, then links `db.staffUser.update({ where: { email: invitation.email }, data: { clerkUserId } })`. It never checks that the caller's Clerk email equals `invitation.email`. A leaked invite token (logged, forwarded, snatched from the manager's screen during the one-time reveal) lets any Clerk account — including a freshly-created attacker account — claim the staff role. The token is a capability, but the manager's intent ("invite this specific person") is not enforced by the server.

---

## Low findings

### L-1 — Rate-limit key trusts `x-real-ip` directly
`guardPublicRateLimit` (`src/lib/public-request.ts:27`) uses `request.headers.get("x-real-ip") || "unknown"` as the throttle key. On Vercel `x-real-ip` is platform-set, but the harness targets "any host"; on a host that passes client headers through, an attacker rotates the header to bypass per-IP limits on `newsletter-subscribe`, `guest-draft`, `checkout-stripe-quotes`, and `local-stripe-checkout`. All callers without the header collapse into a single `unknown` bucket, so one attacker without the header also DoS-throttles all other headerless clients.

### L-2 — `/api/setup` setup-token comparison is not constant-time
`POST /api/setup` (`src/app/api/setup/route.ts:31`) checks `body.setupToken !== process.env.SETUP_TOKEN` with a plain string compare. The endpoint is one-time and locked after the first manager is created, so practical exposure is small, but it is a timing-oracle on a bootstrap secret. Other secret comparisons in the codebase (`cron-auth`, `client-errors`, `auth.ts` HMAC, `newsletter.ts`) correctly use `timingSafeEqual` — this one is the outlier.

### L-3 — Cron routes use GET for state-changing operations
All five cron routes (`season-status`, `pickup-expiry`, `payment-reminders`, `message-outbox`, `stripe-reconciliation`) are `GET` handlers that send reminders, sweep outboxes, expire pickups, and reconcile payments. They are gated by `isAuthorizedCronRequest` (Bearer `CRON_SECRET`, constant-time). The Bearer secret mitigates CSRF, but GET-for-mutation is a semantic/intermediary hazard (caching, proxy prefetching, accidental browser navigation). Vercel cron calls these on schedule; the concern is method choice, not auth.

### L-4 — `constructStripeEvent` falls back to a hardcoded dummy Stripe key
`src/lib/stripe.ts:21` does `getStripe() ?? new Stripe("sk_test_local_webhook_verification")`. Signature verification still uses the real `STRIPE_WEBHOOK_SECRET` (required via `requireStripeWebhookSecret`), so the trust boundary holds. But the fallback masks the "Stripe not configured" misconfiguration in the webhook path and embeds a literal key string in source. The webhook route does not 503 when Stripe is unconfigured the way `checkout/stripe` does.

### L-5 — No central auth gate (no middleware)
With no `middleware.ts`, every route must self-enforce auth. Current routes do enforce it, but a future route added without a `requirePermission`/`findAccessibleDraft` call is silently open. There is no belt-and-braces layer that denies `/admin/*` and `/account/*` by default for unauthenticated traffic.

### L-6 — Impersonation session id is a DB row id, not a high-entropy signed token
`POST /api/admin/impersonation` sets the `impersonation_session_id` cookie to `impersonationSession.id` (a Prisma cuid). It is `httpOnly`, `sameSite: "lax"`, `secure` in prod, and `getCurrentStaffUser` re-binds the cookie to the actor (`actorStaffId: actor.id`), so cookie theft alone does not grant access. Still, a session id is a capability — using an unguessable signed token (or a separate session-token column) would be safer than exposing the row id.

### L-7 — Guest draft access token grants address-book CRUD beyond the single draft
`/api/account/addresses` (GET/POST) and `/api/account/addresses/[addressId]` (PATCH) accept a `draftId`, resolve the customer via `findAccessibleDraft`, and then operate on the **entire** `customerAddress` set for that `customerId` — there is no check tying the address to the draft's lines. In practice the guest's customer is freshly created with an empty address book, so impact is bounded, but the token's authority is broader than "this draft": a leaked 30-day `draft_access_token` cookie lets a holder create/edit any address on that customer record.

### L-8 — Newsletter preference URL falls back to `http://127.0.0.1:3101`
`POST /api/newsletter/subscribe` builds the preference URL as `process.env.APP_URL ?? "http://127.0.0.1:3101"`. If `APP_URL` is unset in a deployed environment, the HMAC-signed preference token (30-day) is emailed as a plaintext-http localhost link, which would fail to resolve for recipients and could leak the token if the message is forwarded. `EMAIL_TEST_MODE=true` additionally returns the token in the response body.

---

## Informational

### I-1 — `POST /api/order/drafts` `posCustomerId` branch has no try/catch and no rate limit
When `body.posCustomerId` is set, the route calls `requirePermission("admin:view")` outside any try/catch; an unauthenticated caller sending `{ posCustomerId: "x" }` triggers an uncaught `AccessDeniedError` → 500 instead of a clean 403. The guest `guardPublicWrite` rate limit is also skipped on this branch, so a manager can spin unbounded POS drafts. Not a confidentiality issue; error-handling/availability hygiene.

### I-2 — Local secrets present in the workspace tree (gitignored)
`.scratch/pg-password.txt`, a full local PostgreSQL install under `.scratch/pgsql/`, and `.env` exist in the arm-01 workspace. Both `.env*` and `.scratch/` are in `.gitignore`, so they are not committed or deployed. Flagging only because the run folder is shared as an experiment archive — if the archive is ever zipped/published without respecting `.gitignore`, the Postgres password and `.env` would leak.

---

## Notable strengths (for context, not scored)

- Stripe webhook verifies signatures with `STRIPE_WEBHOOK_SECRET` and deduplicates via `stripeWebhookEvent` rows inside serializable transactions; safety-refund path is audited.
- Guest draft tokens are 32-byte `randomBytes`, stored only as SHA-256 hashes, with expiry enforced on every read.
- Newsletter tokens are HMAC-signed with a ≥24-char secret and verified with `timingSafeEqual`.
- Cron, client-error, and test-auth secrets all use `timingSafeEqual` (except L-2).
- Admin mutations consistently use optimistic-concurrency `version` checks and write `auditLog` rows (impersonation start/stop, staff invite/accept, settings, exports, imports, payments).
- CSV export prefixes formula-leading characters (`= + - @ \t \r`) with a single quote — CSV injection is mitigated (`launch-exports.ts:14-16`).
- `checkout/stripe` validates `APP_URL` protocol and refuses to run the local test path in production; `checkout/test-complete` is hard-gated to non-prod + `ENABLE_TEST_AUTH`.
- Media upload restricts to JPEG/PNG/WebP/GIF (SVG excluded), enforces a 5 MB cap, and sanitizes filenames.
- `legacy-imports` stage/commit bound payload size on both `content-length` and measured body, validate with zod, and require same-origin.
