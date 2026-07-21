# Codebase inventory — arm-03 (security)

## Proof-of-read
- Rules files read: 6 (`rules/ponytail.md`, `clean-code.md`, `workflow.md`, `vocabulary.md`, `codegraph.md`, `grill-protocol.md`)
- Top-level dirs sampled: `src/`, `prisma/`, `scripts/`, `e2e/`, `tests/`, `docs/`, `public/`, `.github/`
- Job focus: auth, roles, secrets handling, trust boundaries, sensitive paths

## Features
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| F-001 | Clerk middleware (session hydration, no route ACL) | `src/middleware.ts` | Runs `clerkMiddleware` on app/API; pages/actions enforce their own guards |
| F-002 | Clerk SDK isolation + identity shaping | `src/integrations/clerk.ts`, `eslint.config.mjs` | Sole server import of `@clerk/nextjs/server`; `getClerkAuth` / `getClerkUser` |
| F-003 | Clerk provider + hosted sign-in/sign-up | `src/app/layout.tsx`, `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Root `ClerkProvider`; Clerk `<SignIn>` / sign-up UI |
| F-004 | Env secrets schema + boot fail-loud validation | `src/config/env-schema.ts`, `src/config/env.ts`, `.env.example` | Critical keys: Clerk, Stripe, Resend, `CRON_SECRET`, `UNSUBSCRIBE_HMAC_SECRET`, DB URL; optional Shippo/UPS/Mapbox/Blob |
| F-005 | Role + permission authorization model | `src/config/permissions.ts` | Six ranks (`developer`…`customer`); linear + allow-list permissions; overrides; `canDrive` route carve-out |
| F-006 | StaffUser / Customer / PermissionOverride schema | `prisma/schema.prisma` (`StaffUser`, `PermissionOverride`, `Customer`, `StaffRole`) | Clerk id linkage, confirmation flags, `canDrive`, cascade overrides |
| F-007 | Effective user resolution (Clerk → app role) | `src/features/auth/server/resolveUser.ts` | Maps Clerk identity to staff row; unconfirmed staff forced to `customer`; loads overrides only when confirmed |
| F-008 | Email invite → Clerk staff auto-link | `src/features/auth/server/resolveUser.ts` (`linkStaffByEmail`) | Links invited `StaffUser` by normalized email; no auto-create of staff |
| F-009 | Server permission gate (`requirePermission`) | `src/features/auth/server/requirePermission.ts` | Throws/redirects; honors role, overrides, deny-wins, `canDrive` for route perms |
| F-010 | Confirmed-staff hard gate + login stamp | `src/features/auth/server/staff.ts` | `requireStaffUser`, `isConfirmedStaff` (UI), per-session `lastLoginAt` (no audit spam) |
| F-011 | Admin shell trust boundary | `src/app/(admin)/admin/layout.tsx` | Sign-in required; pending-confirmation interstitial; non-staff redirected (messenger → `/messenger`) |
| F-012 | Messenger app + own-route scoping | `src/app/(messenger)/messenger/layout.tsx`, `src/app/(messenger)/messenger/routes/[id]/page.tsx` | Needs `routes.viewOwn`; non-managers only if `route.messengerId === staffUserId` |
| F-013 | Customer account auth gate | `src/app/(storefront)/account/layout.tsx`, `src/features/auth/server/customer.ts` | Clerk required for `/account`; customer find/link-by-email (no inventing staff) |
| F-014 | Storefront customer ensure-on-signin | `src/features/auth/server/ensureCustomer.ts`, `src/features/auth/server/customer.ts` | Find-or-create / link Customer by Clerk id or email |
| F-015 | Order ownership / draft access control | `src/features/orders/server/orderAccess.ts` | Owner customer, guest HMAC token, or staff with permission; denial surfaces as “not found” |
| F-016 | Guest checkout HMAC tokens | `src/features/checkout/server/checkoutToken.ts` | HMAC-SHA256 over orderId using `UNSUBSCRIBE_HMAC_SECRET`; timing-safe verify |
| F-017 | Unsubscribe HMAC tokens | `src/features/email/server/unsubscribeToken.ts`, `src/app/api/unsubscribe/route.ts` | Signed email+purpose tokens; forged links rejected |
| F-018 | Public API guard (origin + rate limit + Zod) | `src/server/withPublicGuard.ts`, `prisma/schema.prisma` (`RateLimitBucket`) | Same-origin vs `NEXT_PUBLIC_APP_URL`; per-IP bucket; used by checkout/subscribe-style routes |
| F-019 | Checkout API (public + ownership) | `src/app/api/checkout/route.ts` | `withPublicGuard` (20/min) then `assertOrderAccess` before Stripe session |
| F-020 | Cron Bearer secret auth | `src/server/verifyCronSecret.ts`, `src/app/api/cron/outbox-sweep/route.ts` (and sibling cron routes) | `Authorization: Bearer ${CRON_SECRET}` required; 401 otherwise |
| F-021 | Stripe webhook signature + idempotency | `src/app/api/webhooks/stripe/route.ts`, `prisma/schema.prisma` (`ProcessedWebhookEvent`) | `constructEvent` with `STRIPE_WEBHOOK_SECRET`; duplicate event short-circuit; amount-mismatch auto-refund |
| F-022 | Developer impersonation | `src/features/auth/server/impersonation.ts`, `src/app/api/impersonate/route.ts`, `src/app/(admin)/admin/impersonate/page.tsx` | `impersonate` permission; httpOnly cookie; confirmed-staff targets only; audited start/stop |
| F-023 | Audit log (incl. impersonation actor) | `src/features/auth/server/audit.ts`, `prisma/schema.prisma` (`AuditLog`), `src/app/(admin)/admin/audit-log/page.tsx` | Records actor Clerk id + impersonated id when developer; never throws into main flow |
| F-024 | Staff user admin (invite/confirm/revoke/overrides) | `src/features/users/server/actions.ts`, `src/app/(admin)/admin/users/page.tsx` | `users.edit` gated; blocks self role-change/revoke/delete; overridable permission keys only |
| F-025 | Permission-filtered admin nav (cosmetic) | `src/features/auth/nav.ts` | Hides links by role/permission/`testOnly`; comments state server checks remain the boundary |
| F-026 | Test-env destructive admin APIs | `src/app/api/admin/wipe-test-data/route.ts`, `src/app/api/admin/reset-test-db/route.ts`, `src/app/api/admin/seed-test-season/route.ts` | Require `IS_TEST_ENV`/`isTestEnv` plus developer `impersonate` permission |
| F-027 | Staff-gated sensitive APIs | `src/app/api/media/route.ts`, `src/app/api/export/year-end/route.ts`, `src/app/api/customers/search/route.ts` | `products.edit` / `export.csv` / `customers.view`; media MIME+2MB upload limits |
| F-028 | Email HTML XSS escape | `src/features/email/server/htmlEscape.ts` | Escapes `& < > " '` before user strings enter HTML email bodies |
| F-029 | Env switch breadcrumb cookie | `src/app/(admin)/admin/env-switch/route.ts` | Sets non-httpOnly `envOverride` cookie then redirects to `/admin` (sister-env UX) |
| F-030 | Integration secret consumers | `src/integrations/stripe.ts`, `src/integrations/resend.ts`, `src/integrations/shippo.ts`, `src/integrations/mapbox.ts` | Server modules hold third-party API keys from validated env |
