# Codebase inventory — arm-04 (specialist slice: security)

Scope: the **security** slice only — authentication, authorization, object-level
access control, trust boundaries on public input, webhook/cron authenticity,
secrets handling, PII protection, injection defense, upload/export controls, and
security automation in CI. Product/UI/data/integration features are out of scope
for this file; a merge agent unions the slices later.

IDs use the `F-SEC-###` prefix so they can't collide with the other specialists'
`F-###` rows during the merge.

## Proof-of-read

- Rules files read: **6** — `.cursor/rules/ponytail.mdc`, `workflow.mdc`,
  `clean-code.mdc`, `vocabulary.mdc`, `codegraph.mdc`, `grill-protocol.mdc`
  (plus arm `AGENTS.md`, `ARM.md`, `CONTESTANT-PROMPT.md`, and the frozen brief
  `.scratch/1a-security-prompt.md`).
- Source tree enumerated in full: 571 paths under `src/`, plus `prisma/`,
  `.github/workflows/`, `scripts/`, `e2e/`, `tests/`, and root config.
- Top-level dirs sampled: `src/app/(admin)`, `src/app/(auth)`,
  `src/app/(messenger)`, `src/app/(storefront)`, `src/app/api` (all 24 route
  files reviewed or classified), `src/features/auth`, `src/features/checkout`,
  `src/features/customers`, `src/features/email`, `src/features/orders`,
  `src/features/payments`, `src/features/testdata`, `src/features/users`,
  `src/features/imports`, `src/config`, `src/lib`, `src/server`,
  `src/integrations`, `prisma/schema.prisma`, `.github/workflows`.
- Files read end-to-end for this slice: 41.
- Tool note: `codegraph` CLI v1.0.1 is installed but the source tree has no
  `.codegraph/` index. `codegraph init` would write into the source, and the
  brief says the source is read-only — so structural lookups used directory
  enumeration + Read instead. Flagging as a deliberate deviation from
  `codegraph.mdc`, chosen protocol-safe per the ponytail conflict rule.

## Features

### Authentication and identity

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-001 | Clerk auth middleware on every non-static request | `src/middleware.ts` | `clerkMiddleware()` only makes `auth()`/`currentUser()` available; it deliberately protects nothing — every page/route carries its own guard. |
| F-SEC-002 | Single Clerk import boundary | `src/integrations/clerk.ts` | Only file allowed to import `@clerk/*`; exposes `getClerkAuth()` and `getClerkUser()` so the identity provider stays swappable. |
| F-SEC-003 | Hosted sign-in / sign-up routes | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Clerk catch-all routes; no hand-rolled credential handling anywhere in the tree. |
| F-SEC-004 | Effective-user resolution (identity → role + overrides) | `src/features/auth/server/resolveUser.ts` | `getEffectiveUser()` is the single input to every guard: role, per-user overrides, `canDrive`, confirmation state, default store. |
| F-SEC-005 | Staff invite self-healing link by normalized email | `src/features/auth/server/resolveUser.ts:34` | Links a Clerk id onto a staff row invited by email. No auto-creation — a non-staff signer-in stays non-staff. |
| F-SEC-006 | Unconfirmed staff downgraded to `customer` | `src/features/auth/server/resolveUser.ts:80`, `src/features/auth/server/requirePermission.test.ts:107` | Pending/revoked staff get role `customer`, and their overrides + `canDrive` are not applied at all (the override query does not even run). Closes privilege retention on revoke. |
| F-SEC-007 | Customer identity resolution + imported-customer email linking | `src/features/auth/server/customer.ts` | `findCustomerForClerkUser()` links only rows with a null `clerkUserId`, so an already-claimed customer can't be hijacked by email match. |
| F-SEC-008 | First-run developer bootstrap, self-disabling | `src/app/api/setup/route.ts` | The only intentionally unauthenticated write route; returns 409 once any `StaffUser` exists. |
| F-SEC-009 | Per-session login stamp without audit spam | `src/features/auth/server/staff.ts:57` | `logSessionLogin()` dedupes by Clerk session id (bounded 1000-entry set) and swallows failures so it can't break the admin layout. |

### Authorization / RBAC

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-010 | Six-role model with linear rank | `src/config/permissions.ts:16` | developer > admin > manager > clerk > messenger > customer; `hasMinRole()` is the rank test. |
| F-SEC-011 | Central permission catalog (~35 keys) | `src/config/permissions.ts:52` | A string value means "this role and above"; an array means an explicit allow-list (used for messenger route carve-outs). |
| F-SEC-012 | Per-user permission overrides (grant/deny) | `src/config/permissions.ts:122`, `prisma/schema.prisma:206` | `canWithOverrides()`; unique on `(staffUserId, permissionKey)`, cascade-deleted with the staff row. |
| F-SEC-013 | Override allow-list — role-locked powers are ungrantable | `src/config/permissions.ts:180`, `src/features/users/server/actions.ts:209` | `getOverridablePermissions()` is derived from the override UI groups, so `impersonate`, `users.edit`, `settings.edit` can never arrive via an override row. |
| F-SEC-014 | Server-side permission gates | `src/features/auth/server/requirePermission.ts` | Three flavors: `requirePermission()` throws for actions/routes, `requirePagePermission()` redirects for pages, `userCan()` for an already-resolved user. UI hiding is explicitly not the boundary. |
| F-SEC-015 | Driver carve-out with explicit-deny precedence | `src/features/auth/server/requirePermission.ts:23`, `src/config/permissions.ts:135` | `canDrive` grants only `routes.viewOwn` / `routes.completeStop`, and an explicit deny override still wins over it. |
| F-SEC-016 | Hard staff gate | `src/features/auth/server/staff.ts:18` | `requireStaffUser()` throws unless the caller is confirmed clerk+. |
| F-SEC-017 | Denied-permission logging | `src/features/auth/server/requirePermission.ts:36` | Every denial logs `auth.permission.denied` with permission, role, staff id, and reason (`no_session` vs `role_denied`). |
| F-SEC-018 | Admin area gate + pending-confirmation screen | `src/app/(admin)/admin/layout.tsx:24` | Unauthenticated → `/sign-in`; unconfirmed → a "waiting for approval" page; messenger → `/messenger`; non-staff → `/`. |
| F-SEC-019 | Messenger area gate via permission, not rank | `src/app/(messenger)/messenger/layout.tsx:25` | Uses `userCan(user, "routes.viewOwn")` so the `canDrive` carve-out and per-user deny overrides both apply. |
| F-SEC-020 | Self-target protection on user administration | `src/features/users/server/actions.ts:37`, `:114`, `:131`, `:151` | `assertNotSelf()` blocks self role-change, self delete, and self revoke server-side (the UI hides them; the rule is enforced anyway). |
| F-SEC-021 | Self-override editing restricted to developer | `src/features/users/server/actions.ts:201` | Everyone else can only change other people's override rows. |
| F-SEC-022 | Server-side role allow-list on assignment | `src/features/users/server/actions.ts:135`, `:47` | Role arrives from the client, so it's re-checked against `ASSIGNABLE_ROLES` and rejected as a `DomainError`, not a crash. |
| F-SEC-023 | Authorization unit tests | `src/features/auth/server/requirePermission.test.ts`, `src/config/permissions.test.ts` | Covers role allow/deny, missing session, canDrive carve-out, deny-override precedence, unconfirmed-staff denial, page redirect. |

### Impersonation

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-024 | Developer-only "view as" impersonation | `src/features/auth/server/impersonation.ts:26` | Gated by the `impersonate` permission, which is developer-rank and not overridable. |
| F-SEC-025 | Impersonation cookie hardening | `src/features/auth/server/impersonation.ts:38` | `httpOnly`, `sameSite: lax`, `secure` in production, `path: /`, 8-hour max age. |
| F-SEC-026 | Impersonation target must be confirmed staff | `src/features/auth/server/impersonation.ts:29`, `:72` | Both start and role-resolution require `isConfirmed: true`. |
| F-SEC-027 | Forged impersonation cookie ignored for non-developers | `src/features/auth/server/impersonation.ts:66`, `src/features/auth/server/audit.ts:27` | Role is re-checked on every read, so a planted cookie neither swaps the UI role nor pollutes the audit trail. |
| F-SEC-028 | Impersonation start/stop API + audited transitions | `src/app/api/impersonate/route.ts`, `src/features/auth/server/impersonation.ts:46` | Writes `impersonation.start` / `impersonation.stop` audit rows; unauthorized returns 401. |

### Audit trail

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-029 | Audit log writer that never breaks the action | `src/features/auth/server/audit.ts` | Records actor Clerk id, optional impersonated id, action, entity type/id, JSON details; all failures swallowed by design. |
| F-SEC-030 | AuditLog storage model | `prisma/schema.prisma:267` | Indexed on `userId` and `createdAt`; carries `impersonatedUserId` for attribution. |
| F-SEC-031 | Admin audit-log viewer | `src/app/(admin)/admin/audit-log/page.tsx`, `audit-table.tsx` | Staff-facing read surface for the trail. |

### Object-level access control (IDOR defense)

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-032 | Order ownership gate with three actor kinds | `src/features/orders/server/orderAccess.ts` | `assertOrderAccess()` admits the signed-in owning customer, a guest holding the signed token, or staff with the required permission. Documented as the fix for the original app's always-true guest check. |
| F-SEC-033 | Existence masking on denial | `src/features/orders/server/orderAccess.ts:23`, `src/features/customers/server/savedAddresses.ts:52` | Denials read "Order not found" / "Address not found" so a prober can't confirm an id exists. |
| F-SEC-034 | HMAC checkout token for guest draft ownership | `src/features/checkout/server/checkoutToken.ts` | SHA-256 HMAC over `orderId:checkout`, base64url-encoded, verified with `timingSafeEqual` and a length pre-check; purpose string prevents cross-use with unsubscribe tokens. |
| F-SEC-035 | Guest token only valid for guest customers | `src/features/orders/server/orderAccess.ts:87` | A token can't be used to reach a registered customer's order. |
| F-SEC-036 | Saved-address ownership gate | `src/features/customers/server/savedAddresses.ts:61` | Every read/create/update/delete runs `assertCustomerAccess()` — you, or staff with `orders.create`. |
| F-SEC-037 | Address edits scoped to the owner's own drafts | `src/features/customers/server/savedAddresses.ts:180` | The cascading `fulfillmentGroup.updateMany` is filtered by `order.customerId`, so an edit can't write into someone else's draft. |
| F-SEC-038 | Customer self-cancel with ownership + status race guard | `src/features/orders/server/cancelOwnDraft.ts:32` | Ownership check plus `expectedFrom: "draft"` on the transition closes the confirm-mid-click race. |
| F-SEC-039 | Profile update ownership check | `src/app/api/account/profile/route.ts:41` | The submitted `customerId` must map to a row whose `clerkUserId` equals the caller; otherwise 403. |
| F-SEC-040 | Order-access integration tests | `src/features/orders/server/orderAccess.integration.test.ts`, `src/features/customers/server/customerActions.integration.test.ts` | Database-backed coverage of the access rules. |

### Public API trust boundary

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-041 | `withPublicGuard` — one wrapper for every public route | `src/server/withPublicGuard.ts` | Same-origin check → per-IP rate limit → JSON parse → Zod parse → handler, with a catch-all that logs and returns a generic 500. No per-route copy-paste. |
| F-SEC-042 | Same-origin enforcement on public writes | `src/server/withPublicGuard.ts:27` | Compares the `Origin` header against `NEXT_PUBLIC_APP_URL`; a malformed origin is rejected. Note: a missing `Origin` is allowed through. |
| F-SEC-043 | Database-backed per-IP rate limiting | `src/server/withPublicGuard.ts:38`, `prisma/schema.prisma:1185` | Single atomic `INSERT … ON CONFLICT DO UPDATE` on `RateLimitBucket` with a 60-second sliding window, so it works across serverless instances with no new vendor. **Fails closed** — a DB error denies the request. |
| F-SEC-044 | Per-route rate budgets | `src/app/api/subscribe/route.ts:21` (5/min), `src/app/api/client-error/route.ts:21` (10/min), `src/app/api/checkout/route.ts:37` (20/min), `src/app/api/checkout/offline/route.ts:35` (30/min), `src/app/api/unsubscribe/route.ts:24` (30/min) | Budget scaled to abuse potential. |
| F-SEC-045 | Zod schema validation at every route boundary | `src/server/withPublicGuard.ts:91`, `src/app/api/impersonate/route.ts:19`, `src/app/api/account/profile/route.ts:13`, `src/app/api/setup/route.ts:14`, `src/app/api/addresses/validate/route.ts:12`, `src/features/users/server/actions.ts:47` | Server actions validate too, not just HTTP routes. |
| F-SEC-046 | Staff-only endpoints re-check permission server-side | `src/app/api/customers/search/route.ts:15`, `src/app/api/customers/find-or-create/route.ts`, `src/app/api/media/route.ts:17`, `src/app/api/route-builder/refresh-coords/route.ts:18`, `src/app/api/export/*/route.ts` | Uniform pattern: `requirePermission()` in a try/catch returning 401. |
| F-SEC-047 | Search-on-demand instead of bulk customer dump | `src/app/api/customers/search/route.ts` | Requires `customers.view`, needs ≥2 characters, caps at 25 rows, excludes guests — only matching PII leaves the server. |

### Webhook and cron authenticity

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-048 | Stripe webhook signature verification on the raw body | `src/app/api/webhooks/stripe/route.ts:40` | Missing signature → 400; `constructEvent` failure logs `webhook.stripe.signature_failed` and returns 400 without detail. |
| F-SEC-049 | Webhook replay protection | `src/app/api/webhooks/stripe/route.ts:53`, `src/features/payments/server/webhookIdempotency.ts`, `prisma/schema.prisma:1118` | Unique `(provider, eventId)`; only a P2002 counts as a duplicate. The claim row is deleted if the handler fails, so Stripe's retry can reprocess. |
| F-SEC-050 | Charged-amount tamper/stale-session check with auto-refund | `src/app/api/webhooks/stripe/route.ts:163` | If the frozen snapshots no longer add up to what was charged, the charge is auto-refunded instead of finalizing an order at a different price. |
| F-SEC-051 | Refund idempotency (money and bookkeeping) | `src/app/api/webhooks/stripe/route.ts:342`, `:253` | Stripe idempotency key per intent, plus a unique `stripeRefundId` on the local row and a status guard that never downgrades an already-posted refund. |
| F-SEC-052 | Cron bearer-secret verification | `src/server/verifyCronSecret.ts` | Missing `CRON_SECRET` returns false (fails closed). Applied on all five cron routes: `src/app/api/cron/{outbox-sweep,payment-reminders,pickup-expiry,purge-email-log,reconcile-stripe}/route.ts`. |
| F-SEC-053 | Declared cron schedule | `vercel.json` | Five scheduled jobs; the paths match the secret-guarded routes above. |

### Secrets and configuration

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-054 | Fail-loud env validation at boot | `src/config/env.ts:20` | Importing `config/env` validates `process.env` and throws, rather than producing a silent 500 at request time. |
| F-SEC-055 | Typed env schema with critical/optional split | `src/config/env-schema.ts:13`, `:65`, `:78` | Ten critical keys (DB, Clerk, Stripe, Stripe webhook, Resend, app URL, cron secret, HMAC secret) vs seven optional integration keys. |
| F-SEC-056 | `.env.example` generated from the schema and parity-tested | `scripts/gen-env-example.ts`, `src/config/env-schema.ts:250`, `src/config/env.test.ts`, `.env.example` | Placeholders only; a test asserts schema and example can't drift, so a new secret can't ship undocumented. |
| F-SEC-057 | Secrets kept out of git | `.gitignore` (`.env*`), `.github/workflows/ci.yml:41` | CI runs on obvious placeholder values (`sk_test_ci_placeholder`, `ci_hmac_secret`) rather than real credentials. |
| F-SEC-058 | Health check that reports degraded without leaking config | `src/app/api/health/route.ts` | Returns `env_validation_failed` / `database_unreachable` — never the missing variable names. |

### PII and data protection

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-059 | Structured logger with secret + PII redaction | `src/lib/logging/index.ts` | Exact-key set (password, secret, token, apikey, authorization, cookie, ssn, card fields, email, phone, address, names) plus substring matching (`stripeSecretKey`, `accessToken`, `…name`, `zip`), applied recursively through nested objects and arrays. |
| F-SEC-060 | Query-string stripping on client error reports | `src/app/api/client-error/route.ts:23` | Only the pathname is logged, so tokens in URLs don't reach the log. Message and URL are length-capped at 2000. |
| F-SEC-061 | Log/PII retention purge | `src/app/api/cron/purge-email-log/route.ts` | EmailLog 30 days, SentEmail 90 days, ProcessedWebhookEvent 90 days, deleted in one transaction and recorded as a `JobRun`. |
| F-SEC-062 | Deliberate non-logging of routine logins | `src/features/auth/server/staff.ts:50` | `lastLoginAt` column instead of an audit row per login — a documented decision, not an omission. |

### Injection defense

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-063 | HTML escaping for email templates | `src/features/email/server/htmlEscape.ts` | Escapes `& < > " '` for every user-supplied string interpolated into an HTML email body. |
| F-SEC-064 | CSV formula-injection neutralization | `src/lib/csv.ts:18` | Cells starting with `= + - @ tab CR LF` are prefixed with `'`; numbers passed as numbers are untouched. Quote/comma/newline escaping handled separately. |
| F-SEC-065 | Parameterized SQL for the one raw query | `src/server/withPublicGuard.ts:46` | Prisma tagged template — `bucketKey` and `windowStart` are bound parameters, not string-concatenated. |
| F-SEC-066 | ORM-only data access elsewhere | `src/server/db.ts`, all `src/features/*/server/*` | No hand-built SQL outside the rate-limit upsert and the `SELECT 1` health probe. |
| F-SEC-067 | HMAC-signed unsubscribe tokens | `src/features/email/server/unsubscribeToken.ts`, `src/app/api/unsubscribe/route.ts:26` | Timing-safe comparison; the route additionally requires the token's email to equal the submitted email, so a valid token can't unsubscribe a third party. |

### Uploads, exports, destructive operations

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-068 | Media upload validation | `src/app/api/media/route.ts:34` | `products.edit` permission, MIME allow-list (jpeg/png/gif/webp), 2 MB cap, filename sanitized to `[a-zA-Z0-9._-]` and truncated to 200 chars, stored under a timestamped Blob key. |
| F-SEC-069 | Media delete gated + resilient | `src/app/api/media/[id]/route.ts:32` | `products.edit` required; a Blob-delete failure still removes the row and logs. |
| F-SEC-070 | CSV import gated per data kind | `src/features/imports/server/actions.ts:345`, `:354`, `:363` | Products/add-ons need `products.edit`, customers need `customers.create`; every row is validated before a staged batch is committed in one transaction. |
| F-SEC-071 | Export permission + export recording | `src/app/api/export/{deliveries,item-sales,lapsed-customers,year-end,year-metrics}/route.ts`, `src/features/exports/server/exportResponse.ts` | Each route requires `export.csv` and calls `recordExport()` with row count and actor name. |
| F-SEC-072 | Double gate on destructive test-data routes | `src/app/api/admin/reset-test-db/route.ts:16`, `src/app/api/admin/wipe-test-data/route.ts:14`, `src/app/api/admin/seed-test-season/route.ts` | Requires `IS_TEST_ENV` **and** the developer-only `impersonate` permission; a production hit returns 403 before auth is even consulted. |
| F-SEC-073 | Wipe helper refuses without the test-env flag | `src/features/testdata/server/wipeTestData.ts:33` | Defense in depth behind the route guard; the flag is typed `isTestEnv: true` so a caller can't pass `false`. |

### Error handling and information disclosure

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-074 | DomainError vs bug separation | `src/lib/result/index.ts` | Expected failures come back as a `Result` with a user-safe message; real bugs keep throwing so Next.js masks them and they surface with a digest in the logs. |
| F-SEC-075 | Generic 500 body on unhandled route errors | `src/server/withPublicGuard.ts:101` | Path and error message go to the server log; the client sees `Internal server error`. |
| F-SEC-076 | Server-side re-check of client-hidden payment options | `src/app/api/checkout/offline/route.ts:59` | Cash/check availability is re-read from settings for non-staff callers, so a crafted request can't use a disabled method. |
| F-SEC-077 | Price-freeze gate before any money moves | `src/app/api/checkout/route.ts:81`, `src/app/api/checkout/offline/route.ts:77`, `src/features/checkout/server/checkoutValidation.ts` | `prepareOrderForPayment()` validates stock and price and snapshots them; Stripe line items are rebuilt from the frozen snapshot, and the total charged is stored server-side on `PaymentIntent`. |

### Security automation in CI

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-SEC-078 | Secret scanning on every PR and push | `.github/workflows/agent-guardrails.yml:13` | gitleaks with full history (`fetch-depth: 0`). |
| F-SEC-079 | Static application security scan | `.github/workflows/agent-guardrails.yml:28` | semgrep `p/default` with `--error`, so findings fail the build. |
| F-SEC-080 | GitHub Actions supply-chain lint | `.github/workflows/agent-guardrails.yml:41` | zizmor, pinned by commit SHA, with `persist-credentials: false` on checkout and least-privilege `permissions:` at workflow level. |
| F-SEC-081 | Schema-migration drift check | `.github/workflows/ci.yml:36`, `scripts/check-schema-has-migration.mjs` | Prevents a schema change (including permission/audit tables) from shipping without a migration. |

## Gaps and weak spots observed

Recorded as observations with evidence, not as features. A build arm should
treat these as open decisions rather than settled behavior.

| # | Observation | Evidence |
|---|---|---|
| G-01 | No security response headers anywhere — no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, or Referrer-Policy. `next.config.ts` sets only `images.remotePatterns` and there is no `headers()` block or edge header injection. | `next.config.ts`, `vercel.json`, `src/middleware.ts` |
| G-02 | CSRF protection on public JSON routes rests entirely on the `Origin` header, and a **missing** `Origin` is treated as same-origin. Non-browser clients therefore bypass the check. | `src/server/withPublicGuard.ts:27` |
| G-03 | Rate limiting keys on `x-forwarded-for` / `x-real-ip` with an `"unknown"` fallback. Behind an untrusted proxy this is spoofable, and all header-less callers share one bucket. | `src/server/withPublicGuard.ts:19` |
| G-04 | Rate limiting is applied only to routes using `withPublicGuard`. `POST /api/setup`, `POST /api/addresses/validate`, and `POST /api/impersonate` parse bodies directly with no rate limit or origin check. | `src/app/api/setup/route.ts`, `src/app/api/addresses/validate/route.ts`, `src/app/api/impersonate/route.ts` |
| G-05 | `GET /api/media/[id]` is unauthenticated and redirects to a public Blob URL; enumerating cuids exposes uploaded media. Uploads are `access: "public"` by design. | `src/app/api/media/[id]/route.ts:17`, `src/app/api/media/route.ts:78` |
| G-06 | The impersonation cookie stores a raw Clerk user id and is not signed. The developer-role recheck on every read mitigates it, but the cookie itself carries no integrity. | `src/features/auth/server/impersonation.ts:38` |
| G-07 | `envOverride` cookie is set `httpOnly: false` by an unauthenticated `GET` route inside the admin segment. Cosmetic breadcrumb only, but it is a writable client-visible cookie set without auth. | `src/app/(admin)/admin/env-switch/route.ts:18` |
| G-08 | `POST /api/setup` is unauthenticated by design; its only guard is `staffCount === 0`. Whoever reaches an empty deployment first becomes developer. | `src/app/api/setup/route.ts:31` |
| G-09 | One HMAC secret (`UNSUBSCRIBE_HMAC_SECRET`) signs both unsubscribe and checkout tokens. The purpose string separates them, and there is no rotation or key-id mechanism. | `src/features/checkout/server/checkoutToken.ts:15`, `src/features/email/server/unsubscribeToken.ts:13` |
| G-10 | Checkout and unsubscribe tokens carry no expiry or revocation — a leaked checkout link grants order access indefinitely. | `src/features/checkout/server/checkoutToken.ts:24` |
| G-11 | `verifyCronSecret` compares the bearer token with `===` rather than a constant-time compare. | `src/server/verifyCronSecret.ts:14` |
| G-12 | No dependency vulnerability scanning in CI (`npm audit` / Dependabot absent), and no `npm audit` script in `package.json`. Semgrep covers code, not the dependency tree. | `.github/workflows/ci.yml`, `.github/workflows/agent-guardrails.yml`, `package.json` |
| G-13 | Audit coverage is manual — `logAction()` must be called explicitly. Impersonation start/stop is audited; there is no evidence of audit rows on role change, permission-override save, refund, or destructive test-data wipes. | `src/features/users/server/actions.ts`, `src/app/api/admin/wipe-test-data/route.ts` |
| G-14 | No automated authorization test at the HTTP layer (no e2e "clerk hits an admin route" case). `e2e/smoke.spec.ts` is the only Playwright spec. | `e2e/smoke.spec.ts` |
| G-15 | `POST /api/addresses/validate` echoes back arbitrary well-formed input as "valid" with no auth, and is a documented placeholder for USPS. Same for the geocode refresh route, which counts but does not refresh. | `src/app/api/addresses/validate/route.ts:38`, `src/app/api/route-builder/refresh-coords/route.ts:33` |

## Blocked areas

None. Every path named in the brief was readable. Two constraints shaped the
method rather than blocking it:

1. `codegraph init` was skipped because it would write into the read-only source
   tree (see the tool note under Proof-of-read).
2. Per `AGENTS.md`, no other arm, `../../results`, or `../../.scratch` was read,
   and no git command was run.
