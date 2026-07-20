# Codebase inventory — arm-02 (job: security)

Source root: `D:\Projects\Personal\Tools\agent-duel-harness\.scratch\sources\tomche-shabbos-website` (all evidence paths below are relative to it).

## Proof-of-read
- Rules files read: 7 (arm `AGENTS.md` + `rules/clean-code.md`, `codegraph.md`, `grill-protocol.md`, `ponytail.md`, `vocabulary.md`, `workflow.md`)
- Top-level dirs sampled: `src/app` (admin/auth/messenger/storefront/api route groups), `src/features` (auth, users, email, checkout, exports, testdata), `src/server`, `src/config`, `src/integrations`, `src/lib`

## Features

| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| SEC-001 | Clerk identity integration (single SDK boundary) | `src/integrations/clerk.ts` | Only file importing `@clerk/*`; exposes `getClerkAuth` / `getClerkUser` shaped identity. |
| SEC-002 | Clerk middleware on all app/API requests | `src/middleware.ts` | `clerkMiddleware()` with static-asset-excluding matcher; pages/routes enforce their own guards. |
| SEC-003 | Sign-in / sign-up pages (Clerk-hosted UI) | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Clerk catch-all auth routes; URLs configurable via env (`src/config/env-schema.ts` lines 27-30). |
| SEC-004 | Six-role RBAC model with linear rank + allow-list carve-outs | `src/config/permissions.ts` | Roles developer/admin/manager/clerk/messenger/customer; `PERMISSIONS` map; `can()` / `hasMinRole()` / `isStaff()`. |
| SEC-005 | Per-user permission overrides (grant/deny beats role default) | `src/config/permissions.ts` (`canWithOverrides`, `getOverridablePermissions`), `src/features/auth/server/resolveUser.ts` (loads `permissionOverride` rows) | Override keys restricted to the override-UI whitelist; role-locked powers (impersonate, users.edit, settings.edit) never overridable. |
| SEC-006 | Server-side authorization gate for actions/routes/pages | `src/features/auth/server/requirePermission.ts` | `requirePermission` throws, `requirePagePermission` redirects, `userCan` pure check; explicit deny wins; logs denials. |
| SEC-007 | Effective-user resolution (Clerk id → StaffUser role + overrides) | `src/features/auth/server/resolveUser.ts` | Unconfirmed/revoked staff demoted to `customer`; their overrides and canDrive deliberately not applied. |
| SEC-008 | Staff invite auto-link by normalized email | `src/features/auth/server/resolveUser.ts` (`linkStaffByEmail`) | Glues Clerk id to pre-invited staff row on first sign-in; no auto-creation of staff. |
| SEC-009 | "Must be staff" hard guard + storefront staff check | `src/features/auth/server/staff.ts` | `requireStaffUser()` throws unless confirmed clerk+; `isConfirmedStaff()` best-effort for showing Admin link. |
| SEC-010 | canDrive carve-out for driver-route permissions | `src/config/permissions.ts` (`isDriverRoutePermission`), `src/features/auth/server/requirePermission.ts` (`allows`) | Non-messenger with `canDrive` gets `routes.viewOwn` / `routes.completeStop` only; explicit deny still wins. |
| SEC-011 | Admin area layout guard (sign-in redirect + staff-only) | `src/app/(admin)/admin/layout.tsx` (lines 24-67) | Unauthenticated → `/sign-in?redirect_url=/admin`; non-staff → `/` or `/messenger`. |
| SEC-012 | Messenger area guard + own-route scoping | `src/app/(messenger)/messenger/layout.tsx`, `src/app/(messenger)/messenger/routes/[id]/page.tsx` (line 78) | Requires `routes.viewOwn`; non-managers can only open routes where `route.messengerId === user.staffUserId`. |
| SEC-013 | Developer-only impersonation (httpOnly cookie, 8h TTL, audited) | `src/features/auth/server/impersonation.ts`, `src/app/api/impersonate/route.ts` | Requires `impersonate` permission; target must be confirmed staff; start/stop write audit rows; forged cookies ignored for non-developers. |
| SEC-014 | Audit logging of privileged actions (with impersonation attribution) | `src/features/auth/server/audit.ts` | `logAction()` writes `AuditLog` rows (actor, impersonated-as, entity, details); never throws. |
| SEC-015 | Admin audit-log viewer page | `src/app/(admin)/admin/audit-log/page.tsx` | Staff-facing UI over `auditLog` rows. |
| SEC-016 | Staff user management with server-side self-target blocking | `src/features/users/server/actions.ts` | All mutations gate on `users.edit`; `assertNotSelf` blocks self role-change/revoke/delete; role values validated against `ASSIGNABLE_ROLES`. |
| SEC-017 | Access revocation (unlink Clerk id + unconfirm) | `src/features/users/server/actions.ts` (`revokeAccess`, lines 148-169) | Clears `clerkUserId` and confirmation so the person can no longer act as staff. |
| SEC-018 | Permission-override editor with key whitelisting + self-edit block | `src/features/users/server/actions.ts` (`savePermissionOverrides`, lines 191-244) | Filters to `getOverridablePermissions()`; only developers may edit their own overrides. |
| SEC-019 | Public API guard: same-origin check + IP rate limit + Zod parse | `src/server/withPublicGuard.ts` | Atomic DB rate limiting via `RateLimitBucket` upsert; fail-closed on rate-limit DB errors; used by subscribe/unsubscribe/client-error etc. |
| SEC-020 | Cron endpoint bearer-secret verification | `src/server/verifyCronSecret.ts`, used in `src/app/api/cron/*/route.ts` (e.g. `src/app/api/cron/outbox-sweep/route.ts`) | `Authorization: Bearer CRON_SECRET`; denies if unset or wrong. |
| SEC-021 | Stripe webhook signature verification + idempotency | `src/app/api/webhooks/stripe/route.ts` (lines 22-69) | `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`; duplicate events deduped via `ProcessedWebhookEvent` P2002. |
| SEC-022 | HMAC-signed unsubscribe tokens (timing-safe verify) | `src/features/email/server/unsubscribeToken.ts`, `src/app/api/unsubscribe/route.ts` | SHA-256 HMAC over (email, purpose) with `UNSUBSCRIBE_HMAC_SECRET`; `timingSafeEqual` comparison. |
| SEC-023 | Customer profile API with ownership check | `src/app/api/account/profile/route.ts` (lines 21-45) | Requires Clerk session; rejects unless `customer.clerkUserId === userId`. |
| SEC-024 | First-run setup bootstrap (only works on empty staff table) | `src/app/api/setup/route.ts` | Unauthenticated by design; becomes 409 no-op once any StaffUser exists. |
| SEC-025 | Test-data admin routes double-gated (IS_TEST_ENV + developer) | `src/app/api/admin/reset-test-db/route.ts`, `src/app/api/admin/wipe-test-data/route.ts`, `src/app/api/admin/seed-test-season/route.ts` | 403 unless `isTestEnv`; then requires developer-only `impersonate` permission. |
| SEC-026 | Guarded staff-only API routes (media, exports, route-builder) | `src/app/api/media/route.ts` (lines 17, 44), `src/app/api/export/deliveries/route.ts` (line 21), `src/app/api/route-builder/refresh-coords/route.ts` (line 18) | Each route calls `requirePermission` with its specific permission (`products.edit`, `export.csv`, `routes.manage`). |
| SEC-027 | Export audit trail | `src/features/exports/server/exportResponse.ts`, `src/app/(admin)/admin/export/page.tsx` | CSV exports logged to `ExportLog` (migration `prisma/migrations/20260611120000_export_log/migration.sql`). |
| SEC-028 | Env secret schema + boot validation + .env.example generation | `src/config/env-schema.ts`, `src/config/env.ts`, `scripts/gen-env-example.ts` | All secrets (Clerk, Stripe, Resend, CRON_SECRET, HMAC secret) validated by Zod; `safeParseEnv` for health check; `.env.example` kept in sync by test. |
| SEC-029 | Session login stamping (lastLoginAt, deduped per Clerk session) | `src/features/auth/server/staff.ts` (`logSessionLogin`, lines 54-75) | Deliberately not written to AuditLog to avoid flooding the feed. |
| SEC-030 | Permission unit tests (guard behavior locked by tests) | `src/config/permissions.test.ts`, `src/features/auth/server/requirePermission.test.ts` | Cover role ranks, overrides, canDrive carve-out, deny-wins. |
| SEC-031 | Production error masking for server actions | `src/lib/result/index.ts` (`tryAction`, `DomainError`) | Expected failures surfaced as `DomainError` messages; unexpected thrown errors masked in production (referenced in `src/features/users/server/actions.ts` header). |
| SEC-032 | Developer-gated CI guardrails workflow | `.github/workflows/agent-guardrails.yml` | Repo-level guardrail checks in CI (supporting control, not app runtime). |

## Blocked areas
- None. Source tree fully readable; no directories inaccessible.
- Not inventoried here (other job slices): checkout price validation, payments/refund flows, email campaign logic — only their security-guard aspects appear above.
