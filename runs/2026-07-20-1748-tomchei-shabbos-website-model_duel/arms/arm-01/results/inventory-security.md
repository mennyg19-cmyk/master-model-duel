# Security inventory — arm-01

Job: SECURITY

## Proof-of-read
- Rules files read: 22 (`.cursor/rules/*.mdc`), plus `AGENTS.md`
- Top-level areas sampled: `.github`, `prisma`, `scripts`, `src/app`, `src/config`, `src/features`, `src/integrations`, `src/server`
- Structural lookup: `codegraph status` reported that the source was not initialized. The source was kept read-only, so tracked-file listing and targeted source reads were used instead.

## Features
| ID | Name | Evidence path(s) | Notes |
|---|---|---|---|
| SEC-001 | Clerk request identity middleware | `src/middleware.ts`; `src/integrations/clerk.ts` | Clerk middleware runs for application and API requests so server-side identity helpers can resolve the current session. It does not protect routes by itself. |
| SEC-002 | Server-side role and permission authorization | `src/config/permissions.ts`; `src/features/auth/server/requirePermission.ts` | Six roles map to named permissions; protected pages, actions, and routes use throwing or redirecting server gates rather than relying on hidden UI. |
| SEC-003 | Per-user permission grants and denies | `src/config/permissions.ts`; `src/features/auth/server/requirePermission.ts`; `src/features/users/server/actions.ts` | Database overrides can grant or deny selected permissions; explicit deny wins, and role-locked powers such as impersonation cannot be added through overrides. |
| SEC-004 | Staff confirmation and revocation gate | `src/features/auth/server/resolveUser.ts`; `src/app/(admin)/admin/layout.tsx`; `src/features/users/server/actions.ts` | Unconfirmed or revoked staff are down-scoped to customer permissions; the admin shell shows pending confirmation until an authorized user confirms access. |
| SEC-005 | Staff invitation identity linking | `src/features/auth/server/resolveUser.ts` | A signed-in Clerk identity can link to a pre-invited staff row by normalized email, but unknown sign-ins do not auto-create staff access. |
| SEC-006 | Customer identity linking and owned profile updates | `src/features/auth/server/customer.ts`; `src/app/api/account/profile/route.ts` | Imported customer rows can link to Clerk identities; profile updates require a session and a matching `clerkUserId`. |
| SEC-007 | Admin and messenger application gates | `src/app/(admin)/admin/layout.tsx`; `src/app/(messenger)/messenger/layout.tsx` | Admin requires confirmed clerk-or-higher staff; messenger access requires the route permission, including explicit-deny handling and the `canDrive` carve-out. |
| SEC-008 | Driver route ownership scoping | `src/app/(messenger)/messenger/routes/[id]/page.tsx` | Drivers can read only routes assigned to their own staff row, while users with route-management permission can read any route. |
| SEC-009 | Staff-management mutation hardening | `src/features/users/server/actions.ts` | User mutations require `users.edit`, validate assignable roles, block self-delete/self-revoke/self-role-change, and limit non-developers from changing their own overrides. |
| SEC-010 | Developer-only staff impersonation | `src/features/auth/server/impersonation.ts`; `src/features/auth/server/audit.ts` | Impersonation requires developer permission, accepts only confirmed targets, uses an eight-hour `httpOnly`, `sameSite=lax` cookie with production `secure`, and records start/stop plus acting-as context. |
| SEC-011 | Security-relevant audit trail | `src/features/auth/server/audit.ts`; `src/features/auth/server/staff.ts` | Audit rows record actor, entity, action, and legitimate impersonation context; staff login time is stamped once per session. |
| SEC-012 | Draft-order ownership and anti-enumeration gate | `src/features/orders/server/orderAccess.ts`; `src/features/checkout/server/checkoutToken.ts` | Order access is limited to the owning signed-in customer, a guest with an order-bound HMAC token, or authorized staff; denials use “Order not found” to avoid revealing IDs. |
| SEC-013 | Guarded public JSON endpoints | `src/server/withPublicGuard.ts`; `src/app/api/subscribe/route.ts`; `src/app/api/checkout/route.ts` | Shared protection performs same-origin checks, atomic per-IP rate limiting, JSON parsing, Zod validation, and fail-closed behavior when the rate-limit store errors. |
| SEC-014 | Signed email-preference changes | `src/features/email/server/unsubscribeToken.ts`; `src/app/api/unsubscribe/route.ts` | Unsubscribe links use HMAC-SHA256 and timing-safe verification; the API also checks the signed email against the submitted email. |
| SEC-015 | Cron endpoint authentication | `src/server/verifyCronSecret.ts`; `src/app/api/cron/outbox-sweep/route.ts` | Cron handlers require an exact `Authorization: Bearer <CRON_SECRET>` value and reject missing configuration or mismatches. |
| SEC-016 | Stripe webhook authenticity verification | `src/app/api/webhooks/stripe/route.ts` | The webhook reads the raw request body and verifies `stripe-signature` with the configured Stripe webhook secret before processing. |
| SEC-017 | Webhook replay and retry safety | `src/app/api/webhooks/stripe/route.ts`; `src/features/payments/server/webhookIdempotency.ts`; `prisma/schema.prisma` | Provider/event IDs are uniquely claimed; duplicates are ignored, and a claim is removed when handling fails so Stripe can safely retry. |
| SEC-018 | Charged-amount and fulfillment safety checks | `src/app/api/webhooks/stripe/route.ts`; `src/features/checkout/server/checkoutValidation.ts` | Server-frozen totals are compared with the charged amount; stale totals or failed inventory finalization trigger idempotent automatic refunds instead of silently retaining payment. |
| SEC-019 | Server-enforced offline payment policy | `src/app/api/checkout/offline/route.ts` | Cash/check availability is rechecked on the server, access is validated, and the recorded amount comes from the finalized server-side order total. |
| SEC-020 | Restricted and validated media uploads | `src/app/api/media/route.ts`; `src/app/api/media/[id]/route.ts` | Listing, upload, and deletion require `products.edit`; uploads allow only selected image MIME types, cap size at 2 MB, and sanitize filenames. |
| SEC-021 | Test-only destructive operations | `src/app/api/admin/reset-test-db/route.ts`; `src/app/api/admin/wipe-test-data/route.ts`; `src/app/api/admin/seed-test-season/route.ts` | Database reset, wipe, and seed APIs require the test environment plus developer-level permission, keeping destructive training tools unavailable in production. |
| SEC-022 | Empty-database bootstrap lockout | `src/app/api/setup/route.ts` | The unauthenticated first-run setup endpoint validates input and creates the initial confirmed developer only while no staff row exists; later calls return a conflict. |
| SEC-023 | Startup secret and environment validation | `src/config/env-schema.ts`; `src/config/env.ts`; `.env.example` | Zod requires database, Clerk, Stripe, Resend, cron, app URL, and HMAC values; generated placeholder metadata is kept separate from runtime values. |
| SEC-024 | Bounded, redacted client error ingestion | `src/app/api/client-error/route.ts`; `src/server/withPublicGuard.ts` | Error reports are schema- and length-limited, rate-limited, same-origin checked, and have URL query strings removed before server logging. |
| SEC-025 | Permissioned and recorded data exports | `src/app/api/export/deliveries/route.ts`; `src/features/exports/server/exportResponse.ts` | CSV downloads require `export.csv`, and successful exports are recorded with type, row count, and actor. |
| SEC-026 | Automated repository security guardrails | `.github/workflows/agent-guardrails.yml` | Pull requests and main pushes run gitleaks, Semgrep, and pinned zizmor checks under explicitly limited GitHub token permissions. |

## Blocked areas
- Runtime behavior, deployment settings, Clerk/Stripe dashboards, and secret values were not inspected.
- CodeGraph was unavailable because the read-only source had no index.
- This is a source inventory, not a vulnerability assessment or proof that every entry point applies its intended guard.
