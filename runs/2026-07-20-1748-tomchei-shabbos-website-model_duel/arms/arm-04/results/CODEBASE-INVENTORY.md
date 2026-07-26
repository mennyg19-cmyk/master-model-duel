# Codebase inventory — arm-04 (merged)

Union of the five specialist inventories for this arm. Nothing here was read from
the source tree: this pass merges the partials only.

**Source described:** `.scratch/sources/tomche-shabbos-website` — a Next.js 16 /
Prisma / Postgres app for a charity's Purim "Mishloach Manos" season: public
storefront and order builder, staff back office (POS, packing, routes, inventory,
email, reports), and a phone-first driver app.

## Inputs

| Slice | File | Rows |
|---|---|---|
| product | `results/inventory-product.md` | 121 (`F-001`–`F-121`) |
| security | `results/inventory-security.md` | 81 (`F-SEC-001`–`F-SEC-081`) + 15 gap observations |
| data | `results/inventory-data.md` | 60 (`F-001`–`F-060`) |
| ui | `results/inventory-ui.md` | 112 (`F-001`–`F-112`) |
| integrations | `results/inventory-integrations.md` | 77 (`F-001`–`F-077`) |
| **total source rows** | | **451** |

**Merged features: 295.** 156 source rows collapsed into an existing row.
**Conflicts: 8 feature-level + 3 proof-of-read discrepancies.**

## Method and ID scheme

- **Union, then dedupe by meaning + evidence.** Two rows merge when they describe
  the same behavior and their evidence paths overlap or are the two halves of one
  behavior (screen + the server file behind it).
- **Granularity rule:** the merged row set uses the *finest* granularity any
  partial used. A coarser source row therefore appears in more than one merged
  row (product `F-121` covered five shared components that `ui` listed
  separately). Every source row is cited at least once; all 451 are accounted for.
- **No invented IDs.** `MF-###` is a merge index, not a new feature id. Every
  `MF` row carries the slice-qualified source ids it came from
  (`product/F-018`, `ui/F-036`, `data/F-023`, `sec/F-SEC-034`, `int/F-050`).
  No row exists without at least one source id.
- **CONFLICT** marks rows where two slices state something incompatible about the
  same evidence. Conflicts are left unresolved — resolving them needs a source
  read, which this arm's `AGENTS.md` forbids after Test 1a. Collected in the
  register below.
- Security gap observations (`G-01`–`G-15`) and the UI/integrations observation
  lists are kept as observations, not features, so they do not inflate the count.

## Features

### 1. Platform, config, and CI (22)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-001 | Single PostgreSQL datastore defined by one Prisma schema | data/F-001, int/F-072 | `prisma/schema.prisma`, `.env.example` (`DATABASE_URL`, Neon) | 1229 lines, sectioned: enums, identity, catalog, order tree, shipping, inventory, payments, email, infrastructure. |
| MF-002 | Prisma client singleton reused across hot reloads | data/F-002, int/F-072 | `src/server/db.ts` | Query logging in development, errors only in production. |
| MF-003 | Migration-first schema workflow | data/F-003 | `prisma/migrations/` (7 from `20260603000000_init`), `package.json` | No `db push` in the production path. |
| MF-004 | CI gate blocking schema changes without a migration | data/F-004, sec/F-SEC-081 | `scripts/check-schema-has-migration.mjs`, `.github/workflows/ci.yml:36` | Diffs against `GITHUB_BASE_REF` on PRs, `HEAD~1` otherwise; also catches permission/audit table changes. |
| MF-005 | On-demand migration + seed verification in a disposable schema | data/F-005 | `scripts/test-migration.mjs` | Applies migrations + seed to `rebuild_verify_<rand>`, asserts CHECK constraints and unique indexes, drops it. |
| MF-006 | Integration tests against real Postgres in a throwaway schema | data/F-006 | `src/test-support/itDatabase.ts`, `integrationGlobalSetup.ts` | Gated by `RUN_DB_IT=1`; used by locking/race tests mocks can't cover. |
| MF-007 | Fail-loud env validation at boot | sec/F-SEC-054, int/F-064 | `src/config/env.ts:20`, `src/config/env-schema.ts` | Importing `config/env` throws instead of producing a silent 500 later; `safeParseEnv()` is the non-throwing variant for the health check. |
| MF-008 | Typed env schema with critical/optional split | sec/F-SEC-055, int/F-065 | `src/config/env-schema.ts:13`, `:65`, `:78` | Ten critical keys (DB, Clerk, Stripe, Stripe webhook, Resend, app URL, cron secret, HMAC) vs seven optional (Shippo, UPS, USPS, Mapbox, Blob) that degrade gracefully. |
| MF-009 | `.env.example` generated from the schema and parity-tested | sec/F-SEC-056, int/F-066 | `scripts/gen-env-example.ts`, `src/config/env-schema.ts:250`, `src/config/env.test.ts`, `.env.example` | Placeholders only; the parity test is what makes the undeclared-env drift rows (MF-215, MF-253, MF-227) visible. |
| MF-010 | Secrets kept out of git | sec/F-SEC-057 | `.gitignore` (`.env*`), `.github/workflows/ci.yml:41` | CI runs on obvious placeholders (`sk_test_ci_placeholder`, `ci_hmac_secret`). |
| MF-011 | CI: typecheck, lint, tests, production build on placeholder keys | int/F-077 | `.github/workflows/ci.yml`, `.github/workflows/agent-guardrails.yml` | Every critical env var supplied as a fake value so the boot guard (MF-007) doesn't fail the build. |
| MF-012 | Secret scanning on every PR and push | sec/F-SEC-078 | `.github/workflows/agent-guardrails.yml:13` | gitleaks with full history (`fetch-depth: 0`). |
| MF-013 | Static application security scan | sec/F-SEC-079 | `.github/workflows/agent-guardrails.yml:28` | semgrep `p/default` with `--error`, so findings fail the build. |
| MF-014 | GitHub Actions supply-chain lint | sec/F-SEC-080 | `.github/workflows/agent-guardrails.yml:41` | zizmor, actions pinned by commit SHA, `persist-credentials: false`, least-privilege workflow `permissions:`. |
| MF-015 | Health check endpoint | product/F-113, int/F-068, sec/F-SEC-058 | `src/app/api/health/route.ts` | 200 when DB and env validation pass; 503 with `env_validation_failed` / `database_unreachable` and deliberately no variable names. |
| MF-016 | Structured logging with secret + PII redaction | sec/F-SEC-059, int/F-071 | `src/lib/logging/index.ts` | JSON lines to console. Exact-key set (password, secret, token, apikey, authorization, cookie, ssn, card, email, phone, address, names) plus substring matching (`stripeSecretKey`, `accessToken`, `…name`, `zip`), recursive through objects/arrays. Console only — no Sentry/Datadog. |
| MF-017 | Admin integration status panel | int/F-067 | `src/app/(admin)/admin/settings/page.tsx:65-100` | Configured / Missing / Not configured for Database, Clerk, Stripe, Resend, Shippo, Mapbox. Presence check only, no live ping. |
| MF-018 | Sister-environment config (test ↔ live) | int/F-074, product/F-111 | `.env.example` (`NEXT_PUBLIC_SISTER_URL`, `NEXT_PUBLIC_APP_ENV`), `src/config/env-schema.ts` | Cross-link plus the environment badge input. UI half is MF-183. |
| MF-019 | DomainError vs bug separation (`Result`) | sec/F-SEC-074, data/F-058 | `src/lib/result/index.ts`, `src/lib/result/parse.ts` | Expected failures return a `Result` with a user-safe message; real bugs keep throwing so Next.js masks them and they surface with a digest. |
| MF-020 | Zod validation at every write boundary | data/F-058, sec/F-SEC-045 | `src/server/withPublicGuard.ts:91`, `src/app/api/impersonate/route.ts:19`, `account/profile/route.ts:13`, `setup/route.ts:14`, `addresses/validate/route.ts:12`, `src/features/users/server/actions.ts:47`, `src/features/customers/server/customerActions.ts`, `src/features/orders/draftWire.ts` | Server actions validate too, not just HTTP routes. |
| MF-021 | ORM-only data access with one parameterized raw query | sec/F-SEC-065, sec/F-SEC-066 | `src/server/db.ts`, `src/server/withPublicGuard.ts:46`, all `src/features/*/server/*` | The rate-limit upsert is a Prisma tagged template (bound params); only other raw SQL is the `SELECT 1` health probe and the reporting aggregates (MF-267). |
| MF-022 | Performance budget config | ui/F-112, int/F-077 | `lighthouserc.json` | **CONFLICT:** ui reads it as active Lighthouse CI thresholds for the storefront; integrations states no workflow or npm script invokes it. |

### 2. Design system and shared UI (19)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-023 | Root app shell / layout | ui/F-001 | `src/app/layout.tsx` | Clerk provider, Inter + Playfair Display + Geist Mono, Sonner toaster (bottom-right, rich colors), `data-test-env` body attribute. |
| MF-024 | Design tokens (burgundy/gold theme) | ui/F-002 | `src/styles/tokens.css`, `src/app/globals.css` | OKLCH palette (burgundy `#722F37`, gold `#C9A84C`, cream page), radius scale, sidebar tokens, `--gold-strong` for contrast. Tailwind v4 `@theme inline`. |
| MF-025 | Test-environment green theme swap | ui/F-003 | `src/styles/tokens.css` (`body[data-test-env="true"]`) | Whole palette flips green on the sandbox so test can't be mistaken for live. |
| MF-026 | Test-environment banner | product/F-009, ui/F-004 | `src/components/storefront/test-mode-banner.tsx` | Fixed top banner when `IS_TEST_ENV` / `NEXT_PUBLIC_APP_ENV=test`; returns null in production. |
| MF-027 | Global error boundary screen | product/F-010, ui/F-005 | `src/app/error.tsx` | Centered card with Try Again / Go Home. |
| MF-028 | Client error reporting endpoint | product/F-010, int/F-070, sec/F-SEC-060 | `src/app/api/client-error/route.ts:23` | Logs message/digest/pathname with the query string stripped so URL tokens don't reach the log; message and URL capped at 2000 chars; 10/min/IP. No external error tracker wired up. |
| MF-029 | Base UI component kit | ui/F-006 | `src/components/ui/` (button, input, textarea, label, select, checkbox, switch, dialog, sheet, popover, dropdown-menu, tabs, table, card, badge, avatar, separator) | `@base-ui/react` with CVA variants and `cn()`; one styling approach across storefront, admin, messenger. |
| MF-030 | Shared feedback/layout primitives | ui/F-007, product/F-121 | `src/components/ui/empty-state.tsx`, `callout.tsx`, `confirm-dialog.tsx`, `info-hint.tsx`, `page-header.tsx` | Empty states, tone-based notices, reusable confirm modal (used on destructive actions), tap-friendly "?" help popovers, admin page title bar with an actions slot. |
| MF-031 | Responsive table pattern | ui/F-008, product/F-120 | `src/components/ui/responsive-table.tsx` | Real `<table>` at `md+`, card stack below, with mobile card rows and mobile empty state. |
| MF-032 | Sortable/searchable table header | ui/F-009, product/F-120 | `src/components/ui/sortable-table.tsx` | Client sort indicators plus a filter input; used by the audit log and other lists. |
| MF-033 | Status badge vocabulary | ui/F-010, product/F-121 | `src/components/admin/status-badges.tsx` | One place decides order, payment, catalog, and delivery-route badge colors so a status reads identically everywhere. |
| MF-034 | Money and tag display primitives | ui/F-011 | `src/components/ui/price-tag.tsx`, `pill-input.tsx`, `smart-select.tsx`, `fab.tsx` | Cents-to-dollars display with gradient variant, removable-token input (ZIP lists), label-stable select, mobile-only FAB. |
| MF-035 | Admin alert banner | ui/F-106, product/F-121 | `src/components/admin/alert-banner.tsx` | Inline warning/info strip with optional link, used on list and detail pages. |
| MF-036 | List pagination and page size | ui/F-103, product/F-120, product/F-052 | `src/components/admin/pagination.tsx`, `page-size-selector.tsx`, `list-params.ts` | "Showing X–Y of Z" with prev/next and a whitelisted page-size dropdown (10/25/50/200) shared by every admin list. |
| MF-037 | Shared list search | ui/F-104, product/F-120 | `src/components/admin/list-search.tsx` | Debounced input bound to `?q=`, resets `?page=`. |
| MF-038 | Filter-preserving back navigation | ui/F-105, product/F-120 | `src/components/admin/back-link.tsx`, `remember-list-url.tsx` | Browser history when available, href fallback; list URLs with filters stashed in sessionStorage for detail pages. |
| MF-039 | Print button shared by print views | ui/F-092 | `src/components/admin/print-button.tsx` | Opens the print dialog and hides itself when printing (`print:hidden`). |
| MF-040 | Storefront imagery assets | ui/F-110 | `public/images/hero.png`, `mission-shabbos-table.jpg`, `mission-volunteers.jpg` | Photography for the hero and mission sections. |
| MF-041 | UI smoke test | ui/F-111 | `e2e/smoke.spec.ts`, `playwright.config.ts` | Playwright coverage of the main user-visible paths; security notes it is the only spec (G-14). |

### 3. Identity, authorization, audit, object-level access (45)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-042 | Clerk middleware on every non-static request | product/F-012, int/F-002, sec/F-SEC-001 | `src/middleware.ts` | `clerkMiddleware()` only makes `auth()`/`currentUser()` available; matcher skips `_next` and static assets. Protects nothing by itself — every page/route carries its own guard. |
| MF-043 | Single Clerk SDK boundary module | int/F-001, sec/F-SEC-002 | `src/integrations/clerk.ts` | `getClerkAuth()` / `getClerkUser()`; the file comment forbids importing `@clerk/*` elsewhere. **CONFLICT:** security states it is the only file allowed to import `@clerk/*`; integrations states server components/pages still import `@clerk/nextjs` UI directly (MF-045). |
| MF-044 | Hosted sign-in / sign-up routes | product/F-012, ui/F-024, int/F-003, sec/F-SEC-003 | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `sign-up/[[...sign-up]]/page.tsx` | Clerk `<SignIn/>` / `<SignUp/>` centered full-screen; URLs from `NEXT_PUBLIC_CLERK_*_URL` with defaults. No hand-rolled credential handling anywhere. |
| MF-045 | Clerk account widget in all three shells | int/F-004, ui/F-023 | `src/app/layout.tsx`, `src/components/storefront/user-menu.tsx`, `src/app/(admin)/admin/admin-shell.tsx`, `src/app/(messenger)/messenger/layout.tsx` | `<UserButton/>` under a root `<ClerkProvider>`. |
| MF-046 | Effective-user resolution (identity → role + overrides) | sec/F-SEC-004 | `src/features/auth/server/resolveUser.ts` | `getEffectiveUser()` is the single input to every guard: role, per-user overrides, `canDrive`, confirmation state, default store. |
| MF-047 | Staff invite self-healing link by normalized email | sec/F-SEC-005, product/F-105 | `src/features/auth/server/resolveUser.ts:34` | Links a Clerk id onto a staff row invited by email on first sign-in. No auto-creation — a non-staff signer-in stays non-staff. |
| MF-048 | Unconfirmed / revoked staff downgraded to `customer` | sec/F-SEC-006 | `src/features/auth/server/resolveUser.ts:80`, `requirePermission.test.ts:107` | Overrides and `canDrive` are not applied at all (the override query does not run), closing privilege retention on revoke. |
| MF-049 | Clerk user auto-linked to a Customer row | int/F-005, sec/F-SEC-007, product/F-006 | `src/features/auth/server/ensureCustomer.ts`, `customer.ts` | Matches by `clerkUserId` or normalized email, back-fills `clerkUserId` on a pre-existing (imported) customer, else creates one. Only rows with a null `clerkUserId` are linkable, so a claimed customer can't be hijacked by email match. |
| MF-050 | Per-session login stamp without audit spam | sec/F-SEC-009, product/F-049 | `src/features/auth/server/staff.ts:57` | `logSessionLogin()` dedupes by Clerk session id (bounded 1000-entry set) and swallows failures so it can't break the admin layout. |
| MF-051 | Deliberate non-logging of routine logins | sec/F-SEC-062 | `src/features/auth/server/staff.ts:50` | `lastLoginAt` column instead of an audit row per login — a documented decision, not an omission. |
| MF-052 | Role model with linear rank | product/F-107, sec/F-SEC-010, data/F-007 | `src/config/permissions.ts:16`, `prisma/schema.prisma` (`StaffUser`, `StaffRole`) | **CONFLICT:** product and security describe six ranked roles including `customer` (developer > admin > manager > clerk > messenger > customer, displayed as Owner/Manager/Staff/Driver/Customer); data lists the `StaffRole` enum as five (developer, admin, manager, clerk, messenger). Unclear from the partials whether `customer` exists in the DB enum or only in the permission rank. |
| MF-053 | Central permission catalog (~35 keys) | sec/F-SEC-011, product/F-107 | `src/config/permissions.ts:52` | A string value means "this role and above"; an array is an explicit allow-list (messenger route carve-outs). |
| MF-054 | Per-user permission overrides (grant/deny) | product/F-106, ui/F-099, sec/F-SEC-012, data/F-008 | `src/config/permissions.ts:122`, `prisma/schema.prisma:206` (`PermissionOverride`), `src/app/(admin)/admin/users/permission-overrides-dialog.tsx` | `canWithOverrides()`; unique on `(staffUserId, permissionKey)`, cascade-deleted with the staff row. An explicit deny beats the role default. |
| MF-055 | Override allow-list — role-locked powers are ungrantable | product/F-106, sec/F-SEC-013 | `src/config/permissions.ts:180`, `src/features/users/server/actions.ts:209` | `getOverridablePermissions()` is derived from the override UI groups, so `impersonate`, `users.edit`, `settings.edit` can never arrive via an override row. |
| MF-056 | Server-side permission gates | product/F-107, sec/F-SEC-014 | `src/features/auth/server/requirePermission.ts` | `requirePermission()` throws for actions/routes, `requirePagePermission()` redirects for pages, `userCan()` for a resolved user. Hidden UI is explicitly not the boundary. |
| MF-057 | Driver carve-out with explicit-deny precedence | product/F-107, sec/F-SEC-015, data/F-008 | `src/features/auth/server/requirePermission.ts:23`, `src/config/permissions.ts:135` | `canDrive` grants only `routes.viewOwn` / `routes.completeStop`; an explicit deny override still wins. |
| MF-058 | Hard staff gate | sec/F-SEC-016 | `src/features/auth/server/staff.ts:18` | `requireStaffUser()` throws unless the caller is confirmed clerk+. |
| MF-059 | Denied-permission logging | sec/F-SEC-017 | `src/features/auth/server/requirePermission.ts:36` | Logs `auth.permission.denied` with permission, role, staff id, and reason (`no_session` vs `role_denied`). |
| MF-060 | Admin area gate + pending-confirmation screen | product/F-049, ui/F-047, sec/F-SEC-018 | `src/app/(admin)/admin/layout.tsx:24`, `src/features/auth/server/staff.ts` | Unauthenticated → `/sign-in`; unconfirmed → "waiting for approval"; messenger → `/messenger`; non-staff → `/`. Resolves the impersonated role before rendering. |
| MF-061 | Messenger area gate via permission, not rank | ui/F-107, sec/F-SEC-019 | `src/app/(messenger)/messenger/layout.tsx:25` | `userCan(user, "routes.viewOwn")`, so the `canDrive` carve-out and per-user denies both apply; manager+ also passes. |
| MF-062 | Self-target protection on user administration | sec/F-SEC-020 | `src/features/users/server/actions.ts:37`, `:114`, `:131`, `:151` | `assertNotSelf()` blocks self role-change, self delete, self revoke server-side even though the UI hides them. |
| MF-063 | Self-override editing restricted to developer | sec/F-SEC-021 | `src/features/users/server/actions.ts:201` | Everyone else can only change other people's override rows. |
| MF-064 | Server-side role allow-list on assignment | sec/F-SEC-022 | `src/features/users/server/actions.ts:135`, `:47` | Client-supplied role re-checked against `ASSIGNABLE_ROLES`, rejected as a `DomainError` rather than crashing. |
| MF-065 | Authorization unit tests | sec/F-SEC-023 | `src/features/auth/server/requirePermission.test.ts`, `src/config/permissions.test.ts` | Role allow/deny, missing session, canDrive carve-out, deny-override precedence, unconfirmed-staff denial, page redirect. |
| MF-066 | Staff accounts administration | product/F-105, ui/F-099, data/F-007 | `src/app/(admin)/admin/users/page.tsx`, `users-client.tsx`, `add-staff-dialog.tsx`, `src/features/users/server/actions.ts`, `prisma/schema.prisma` (`StaffUser`) | Invite by email, pending-vs-active tables with row action menus, confirm, change role, revoke, delete, duplicate-email check. `emailNormalized` unique; role, confirmation state, and driver flag on the row. |
| MF-067 | Developer-only "view as" impersonation | product/F-108, ui/F-100, int/F-007, sec/F-SEC-024 | `src/app/(admin)/admin/impersonate/page.tsx`, `impersonate-button.tsx`, `src/features/auth/server/impersonation.ts:26` | Gated by the `impersonate` permission, which is developer-rank and not overridable. Staff grid with "View as [name]" and a loading state. |
| MF-068 | Impersonation cookie hardening | sec/F-SEC-025 | `src/features/auth/server/impersonation.ts:38` | `httpOnly`, `sameSite: lax`, `secure` in production, `path: /`, 8-hour max age. |
| MF-069 | Impersonation target must be confirmed staff | sec/F-SEC-026 | `src/features/auth/server/impersonation.ts:29`, `:72` | Both start and role-resolution require `isConfirmed: true`. |
| MF-070 | Forged impersonation cookie ignored for non-developers | sec/F-SEC-027 | `src/features/auth/server/impersonation.ts:66`, `src/features/auth/server/audit.ts:27` | Role re-checked on every read, so a planted cookie neither swaps the UI role nor pollutes the audit trail. |
| MF-071 | Impersonation start/stop API with audited transitions | product/F-108, int/F-007, sec/F-SEC-028 | `src/app/api/impersonate/route.ts`, `src/features/auth/server/impersonation.ts:46` | POST starts, DELETE stops; writes `impersonation.start` / `impersonation.stop`; unauthorized returns 401. |
| MF-072 | Impersonation bar | product/F-108, ui/F-051 | `src/components/admin/impersonation-bar.tsx` | Amber bar naming the impersonated user and role with "Stop impersonating". |
| MF-073 | Audit log writer that never breaks the action | product/F-109, sec/F-SEC-029, data/F-011 | `src/features/auth/server/audit.ts` | Actor Clerk id, optional impersonated id, action, entity type/id, JSON details; all failures swallowed by design. Impersonation target recorded only for developers. |
| MF-074 | AuditLog storage model | data/F-011, sec/F-SEC-030 | `prisma/schema.prisma:267` | Indexed on `userId` and `createdAt`; carries `impersonatedUserId` for attribution. |
| MF-075 | Admin activity / audit-log viewer | product/F-109, ui/F-102, sec/F-SEC-031 | `src/app/(admin)/admin/audit-log/page.tsx`, `audit-table.tsx` | Last 200 actions, staff names resolved, client-side sort and filter, shows who was being impersonated. |
| MF-076 | First-run setup screen | product/F-011, ui/F-025 | `src/app/(storefront)/setup/page.tsx` | Bootstrap form for the first developer account; only reachable on an empty staff table. |
| MF-077 | First-run setup route, self-disabling | product/F-011, int/F-075, sec/F-SEC-008 | `src/app/api/setup/route.ts` | The only intentionally unauthenticated write route; 409 no-op once any `StaffUser` exists. No rate limit or origin guard (see G-04, G-08). |
| MF-078 | Order ownership gate with three actor kinds | product/F-031, sec/F-SEC-032 | `src/features/orders/server/orderAccess.ts` | `assertOrderAccess()` admits the signed-in owning customer, a guest holding the signed token, or staff with the required permission. Documented as the fix for the original app's always-true guest check. |
| MF-079 | Existence masking on denial | sec/F-SEC-033 | `src/features/orders/server/orderAccess.ts:23`, `src/features/customers/server/savedAddresses.ts:52` | Denials read "Order not found" / "Address not found" so a prober can't confirm an id exists. |
| MF-080 | HMAC checkout token for guest draft ownership | product/F-031, sec/F-SEC-034 | `src/features/checkout/server/checkoutToken.ts` | SHA-256 HMAC over `orderId:checkout`, base64url, verified with `timingSafeEqual` plus a length pre-check; the purpose string prevents cross-use with unsubscribe tokens. |
| MF-081 | Guest token only valid for guest customers | sec/F-SEC-035 | `src/features/orders/server/orderAccess.ts:87` | A token can't be used to reach a registered customer's order. |
| MF-082 | Saved-address ownership gate | product/F-016, sec/F-SEC-036 | `src/features/customers/server/savedAddresses.ts:61` | Every read/create/update/delete runs `assertCustomerAccess()` — you, or staff with `orders.create`. |
| MF-083 | Address edits scoped to the owner's own drafts | product/F-016, sec/F-SEC-037 | `src/features/customers/server/savedAddresses.ts:180` | The cascading `fulfillmentGroup.updateMany` is filtered by `order.customerId`, so an edit can't write into someone else's draft. |
| MF-084 | Customer self-cancel with ownership + status race guard | product/F-015, sec/F-SEC-038 | `src/features/orders/server/cancelOwnDraft.ts:32` | Ownership check plus `expectedFrom: "draft"` on the transition closes the confirm-mid-click race. Drafts only — placed orders use the admin cancel flow. |
| MF-085 | Profile update ownership check | product/F-017, int/F-006, sec/F-SEC-039 | `src/app/api/account/profile/route.ts:41` | 401 without `userId`; 403 unless the submitted `customerId` maps to a row whose `clerkUserId` is the caller. |
| MF-086 | Order-access integration tests | sec/F-SEC-040 | `src/features/orders/server/orderAccess.integration.test.ts`, `src/features/customers/server/customerActions.integration.test.ts` | Database-backed coverage of the access rules. |

### 4. Public API trust boundary (7)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-087 | `withPublicGuard` — shared wrapper for public routes | product/F-119, int/F-069, sec/F-SEC-041 | `src/server/withPublicGuard.ts` | Same-origin check → per-IP rate limit → JSON parse → Zod parse → handler, with a catch-all that logs and returns a generic 500. No per-route copy-paste. **CONFLICT:** security titles it "one wrapper for every public route"; integrations (and security's own G-04) state `addresses/validate`, `setup`, and `impersonate` parse bodies directly without it. Confirmed users: checkout, offline checkout, subscribe, unsubscribe, client-error. |
| MF-088 | Same-origin enforcement on public writes | sec/F-SEC-042 | `src/server/withPublicGuard.ts:27` | Compares `Origin` against `NEXT_PUBLIC_APP_URL`; malformed origin rejected, **missing** origin allowed through (G-02). |
| MF-089 | Database-backed per-IP rate limiting | data/F-048, sec/F-SEC-043, int/F-069 | `src/server/withPublicGuard.ts:38`, `prisma/schema.prisma:1185` (`RateLimitBucket`) | Single atomic `INSERT … ON CONFLICT DO UPDATE` per IP-minute with a 60-second sliding window, so it works across serverless instances with no new vendor. Fails closed — a DB error denies. |
| MF-090 | Per-route rate budgets | sec/F-SEC-044, product/F-007 | `subscribe/route.ts:21` (5/min), `client-error/route.ts:21` (10/min), `checkout/route.ts:37` (20/min), `checkout/offline/route.ts:35` (30/min), `unsubscribe/route.ts:24` (30/min) | Budget scaled to abuse potential. |
| MF-091 | Staff-only endpoints re-check permission server-side | sec/F-SEC-046 | `customers/search/route.ts:15`, `customers/find-or-create/route.ts`, `media/route.ts:17`, `route-builder/refresh-coords/route.ts:18`, `export/*/route.ts` | Uniform pattern: `requirePermission()` in a try/catch returning 401. |
| MF-092 | Search-on-demand customer lookup instead of a bulk dump | product/F-058, sec/F-SEC-047 | `src/app/api/customers/search/route.ts` | Requires `customers.view`, needs ≥2 characters, caps at 25 rows, excludes guests — only matching PII leaves the server. |
| MF-093 | Generic 500 body on unhandled route errors | sec/F-SEC-075 | `src/server/withPublicGuard.ts:101` | Path and message to the server log; the client sees `Internal server error`. |

### 5. Storefront (16)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-094 | Storefront shell (header + footer) | product/F-006, ui/F-012 | `src/app/(storefront)/layout.tsx` | Sticky translucent burgundy header with brand initials, desktop nav (Packages / Mission / How It Works), signed-in user menu vs Sign In + Order Now CTAs, 3-column footer with quick links, 501(c)(3) notice, subscribe form. |
| MF-095 | Storefront mobile menu | product/F-006, ui/F-022 | `src/components/storefront/mobile-menu.tsx` | Right-side sheet drawer with all nav plus account links and a staff-only Admin Portal link. |
| MF-096 | Storefront user menu | product/F-006, ui/F-023 | `src/components/storefront/user-menu.tsx` | Clerk `UserButton` extended with My Orders, Saved Addresses, and (staff) Admin Portal. |
| MF-097 | Season model and one season rule | data/F-012 | `prisma/schema.prisma` (`Season`), `src/lib/season/index.ts` | `Season.year` is the PK; `currentSeasonWhere()` is the single season rule. |
| MF-098 | Season open/closed gate and closed banner | product/F-002, ui/F-013 | `src/features/storefront/server/storeStatus.ts`, `src/app/(storefront)/layout.tsx` | One source of truth read by home, packages, builder, and checkout. Closed = browse-only, ordering CTAs off, amber strip above the header with the season's custom closed message. |
| MF-099 | Home page | product/F-001, ui/F-014 | `src/app/(storefront)/page.tsx` | Hero with split Purim/Shabbos imagery and dual CTAs, impact bar, How It Works (three gold-connected steps), live season package grid, mission rows, testimonials, closing CTA. CTAs change target when ordering is closed. |
| MF-100 | Animated impact stats bar | product/F-001, ui/F-015 | `src/components/storefront/home-impact-bar.tsx` | Numbers count up once when scrolled into view (IntersectionObserver). |
| MF-101 | Package catalog page | product/F-003, ui/F-016 | `src/app/(storefront)/packages/page.tsx`, `packages-grid.tsx` | Category filter pills with `aria-pressed`, price sort (default / low-high / high-low), sold-out badges, keyboard-accessible card buttons, empty state. |
| MF-102 | Packages loading skeleton | ui/F-017, product/F-003 | `src/app/(storefront)/packages/loading.tsx` | Six animated placeholder cards in the same responsive grid. |
| MF-103 | Storefront product quick-view modal | product/F-003, ui/F-018 | `src/components/storefront/product-quick-view.tsx` | Render-prop dialog: image, price, description, option badges with price adjustments, send / full-details CTAs. Distinct from the builder's quick view (MF-121). |
| MF-104 | Package detail page | product/F-004, ui/F-019 | `src/app/(storefront)/packages/[id]/page.tsx` | Large image, price, description, option badges with price adjustments, deep-link CTA into the builder, back link. |
| MF-105 | Past collections archive | product/F-005, ui/F-020 | `src/app/(storefront)/past-collections/page.tsx` | Read-only year-by-year gallery, newest first, no buy buttons. Items still sold this season are hidden; repeats appear only under their most recent year. |
| MF-106 | Footer email subscribe form | product/F-007, ui/F-021 | `src/components/storefront/email-subscribe.tsx` | Inline form with toast feedback for new / already-subscribed / resubscribed, then a thank-you state. |
| MF-107 | Public subscribe endpoint | product/F-007, int/F-030 | `src/app/api/subscribe/route.ts`, `src/features/email/server/upsertSubscriber.ts` | Distinguishes new / already-subscribed / resubscribed; 5 requests per minute per IP. |
| MF-108 | Unsubscribe preference centre | product/F-008, ui/F-026 | `src/app/(storefront)/unsubscribe/page.tsx`, `unsubscribe-form.tsx`, `src/app/api/unsubscribe/route.ts` | Three choices (off entirely with reason / only-if-not-ordered / once-yearly) plus an error state for forged links. |
| MF-109 | HMAC-signed unsubscribe links | product/F-008, int/F-031, sec/F-SEC-067 | `src/features/email/server/unsubscribeToken.ts`, `src/app/api/unsubscribe/route.ts:26` | SHA-256 HMAC over `email:purpose`, `timingSafeEqual` compare, 403 on forged or mismatched token; the route also requires the token's email to equal the submitted email so a valid token can't unsubscribe a third party. Supports downgrade preferences, not just full unsubscribe. |

### 6. Customer account area (6)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-110 | Customer account shell | product/F-013, ui/F-029 | `src/app/(storefront)/account/layout.tsx`, `account/page.tsx` | Auth-gated; side nav on desktop, horizontal scroll pills on mobile, Admin Portal link for staff; `/account` redirects to orders. |
| MF-111 | Customer order history | product/F-014, ui/F-030 | `src/app/(storefront)/account/orders/page.tsx` | Cards with order number, recipient count, date, total, status badges, first four recipients; drafts get a dashed amber border and "Continue Order". |
| MF-112 | Customer order detail + cancel UI | product/F-015, ui/F-031 | `src/app/(storefront)/account/orders/[id]/page.tsx`, `cancel-draft-button.tsx` | Status banners, recipient cards, payment info, Edit/Checkout for drafts, confirm-then-cancel with inline failure text. Ownership enforced server-side (MF-084). |
| MF-113 | Saved addresses page | product/F-016, ui/F-033 | `src/app/(storefront)/account/addresses/page.tsx` | Address cards with list/add/edit/delete. |
| MF-114 | SavedAddress model with cached geocode columns | data/F-010 | `prisma/schema.prisma` (`SavedAddress`), `src/features/customers/server/savedAddresses.ts` | lat/lng + `geocodedAt`, `isDefault`; new complete addresses are added quietly on draft save. |
| MF-115 | Profile edit form | product/F-017, ui/F-034 | `src/app/(storefront)/account/profile/page.tsx`, `profile-form.tsx` | Name/phone/email with change detection — Save appears only once something changed. |

### 7. Order builder (17)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-116 | Order builder page (storefront) | product/F-018, ui/F-035 | `src/app/(storefront)/order/page.tsx`, `order/order-builder.tsx` | Loads season catalog, add-ons, saved addresses, and any resumable draft; closed-store visitors see the closed message instead of the builder. |
| MF-117 | Deep link into the builder | product/F-029 | `src/app/(storefront)/order/page.tsx` (`?product=`, `?draft=`), home + packages CTAs | Preselect a product or resume a specific draft. |
| MF-118 | Shared builder shell (storefront + POS) | product/F-018, ui/F-036 | `src/features/order-builder/components/OrderBuilderShell.tsx`, `src/app/(admin)/admin/pos/pos-builder.tsx` | Product panel left, cart right on desktop, floating cart on mobile; owns the builder dialogs and Review & Pay routing for both surfaces. POS injects a customer bar into the top slot. |
| MF-119 | Product panel with search, filters, donations strip | product/F-019, ui/F-037 | `src/features/order-builder/components/ProductPanel.tsx`, `src/features/order-builder/catalog.ts` | Search matches name/description/category/price; category pills; donations live in a separate strip because they aren't delivered. |
| MF-120 | Product tile in the builder | product/F-020, ui/F-038 | `src/features/order-builder/components/ProductCard.tsx` | Image/name as a real button for keyboard users, category badge, price, option names, stock badge (out / low / available), "Send" vs "Donate" CTA. |
| MF-121 | Builder quick view | product/F-020, ui/F-039 | `src/features/order-builder/components/ProductQuickView.tsx` | Larger preview with options and price adjustments; sold-out products can't be sent. |
| MF-122 | Recipient assign dialog | product/F-021, ui/F-040 | `src/features/order-builder/components/RecipientAssignDialog.tsx` | Option, quantity, greeting, add-ons plus seven ship-to modes: assign later, customer pickup, new address, saved address, my recipients, existing destination in this order, myself. Donations get a reduced form. |
| MF-123 | Add-recipient dialog (recipient book) | product/F-022, ui/F-041 | `src/features/order-builder/components/AddRecipientDialog.tsx` | Two tabs (saved address or new address) adding a destination with no packages yet; survives reload. |
| MF-124 | Edit a saved address without leaving the builder | product/F-027, ui/F-042 | `src/features/order-builder/components/EditSavedAddressDialog.tsx` | Pre-filled edit dialog that keeps draft groups pointing at that address in sync. |
| MF-125 | Order cart sidebar | product/F-023, ui/F-043 | `src/features/order-builder/components/OrderSidebar.tsx`, `src/features/order-builder/orderDraftSelectors.ts` | Destination cards with their lines, donations section, unassigned section with three assign paths (drag, inline menu, bulk select). Footer shows subtotal + delivery count; Review & Pay disabled until every non-donation line is assigned. Donation-only orders allowed. |
| MF-126 | Mobile cart FAB + bottom sheet | product/F-024, ui/F-044 | `src/features/order-builder/components/MobileCartFab.tsx` | Floating button with delivery count and subtotal opening the full cart as a sheet. |
| MF-127 | Draft autosave and guest resume | product/F-025, ui/F-045, data/F-023 | `src/features/order-builder/components/AutoSave.tsx`, `ClearGuestDraftOnSuccess.tsx` | Debounced 1.5s background save; guests get an id + signed token stashed under `tomchei:{web\|pos}-draft` in localStorage so a refresh resumes; cleared after a successful checkout. |
| MF-128 | Server-side draft save / load | product/F-026, data/F-023 | `src/features/orders/server/saveDraft.ts`, `loadDraft.ts` | Lines → `OrderLine`, destinations → `FulfillmentGroup`. Signed-in shoppers resume their latest web draft automatically. |
| MF-129 | Draft reference numbers claimed at draft creation | product/F-026, data/F-021 | `prisma/schema.prisma` (`DraftNumberSequence`, `Order.draftNumber`), `src/features/orders/server/saveDraft.ts`, `src/lib/ids/index.ts` | `D-0243` style; drafts never burn a real order number. |
| MF-130 | Discard a draft | product/F-030 | `src/features/orders/server/discardDraft.ts` | Same ownership gate as saving; drafts only. |
| MF-131 | Address autocomplete + manual fields | product/F-028, ui/F-046, int/F-050 | `src/components/ordering/address-autocomplete.tsx`, `address-fields.tsx` | ARIA combobox over Mapbox geocode v6 forward (debounced, minimum query length, arrow keys / Enter / Escape); hand-typed fields always work and the widget renders nothing when the public token is absent. One shared address form for every dialog. |
| MF-132 | Address validation endpoint (USPS placeholder) | product/F-028, int/F-045 | `src/app/api/addresses/validate/route.ts` | Documented stub: checks non-empty fields and the ZIP, then echoes the address back. No USPS call, no `withPublicGuard`, no rate limit (G-04, G-15). **CONFLICT:** product says 5-digit ZIP; integrations says 5(+4) digit. |

### 8. Catalog, customers, and order data model (14)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-133 | Product records with pricing, dimensions, inventory flags | data/F-013 | `prisma/schema.prisma` (`Product`, `ProductStatus`, `ProductKind`) | Integer `priceCents`, weight/dims for label math, `maxItemsPerBox`, `tracksInventory`, donation kind. |
| MF-134 | Product options with price adjustments | data/F-014 | `prisma/schema.prisma` (`ProductOption`) | Referenced by `OrderLine.productOptionId` with `onDelete: Restrict`. |
| MF-135 | Add-ons with per-product eligibility | product/F-075, data/F-015 | `prisma/schema.prisma` (`AddOn`, `ProductAddOn`, `AddOnRestrictionMode`) | include / exclude / none restriction mode; kitchen flag; price. |
| MF-136 | Season-aware product replacement chain (model) | data/F-016, product/F-074 | `prisma/schema.prisma` (`ProductReplacement`), `src/features/orders/server/repeat/replacementChain.ts` | Unique per `(fromProductId, seasonYear)`; cycle protection in domain code; also groups item sales across years. |
| MF-137 | MediaUpload rows backed by Vercel Blob | data/F-017, int/F-054 | `prisma/schema.prisma` (`MediaUpload`) | jpeg/png/gif/webp, 2 MB cap; product and add-on images reference media with `onDelete: SetNull`. |
| MF-138 | Normalized order tree with no legacy recipient model | data/F-018 | `prisma/schema.prisma` (`Order`, `OrderLine`, `OrderLineAddOn`, `FulfillmentGroup`, `FulfillmentLine`) | Destinations are fulfillment groups; a line joins a destination through `FulfillmentLine` (unique per group+line). |
| MF-139 | Price snapshots frozen onto order lines | data/F-019, product/F-036 | `prisma/schema.prisma` (`OrderLine.unitPriceCentsSnapshot`, `pricedAt`, `snapshotSource`), `src/features/orders/server/finalizeOrder.ts` | `snapshotSource` distinguishes live / import / manual pricing. |
| MF-140 | Collision-free sequential order numbers per season | data/F-020 | `prisma/schema.prisma` (`OrderNumberSequence`), `src/features/orders/server/finalizeOrder.ts`, `src/lib/ids/index.ts` | Sequence incremented inside the finalize transaction; `YYNNNN` with volume-adaptive padding. |
| MF-141 | Fulfillment methods as editable data instead of an enum | data/F-024 | `prisma/schema.prisma` (`FulfillmentMethod`, `FulfillmentCategory`), `prisma/seed.ts` | Category drives code branches; the method key is staff-editable data. |
| MF-142 | Pickup locations as catalog data | data/F-027, product/F-100 | `prisma/schema.prisma` (`PickupLocation`), `src/features/settings/server/actions.ts` | Staff CRUD deactivates rather than deletes; referenced by fulfillment groups and quote options with `onDelete: SetNull`. |
| MF-143 | Customer records with normalized match keys and duplicate hints | data/F-009, data/F-057 | `prisma/schema.prisma` (`Customer`), `src/lib/normalize/index.ts` | `phoneNormalized` / `emailNormalized` indexed; `isGuest`; `notDuplicateOf` array suppresses false dupe matches. |
| MF-144 | Canonical normalization of contact data on write | data/F-057 | `src/lib/normalize/index.ts`, `src/features/customers/server/customerActions.ts`, `src/features/email/server/upsertSubscriber.ts` | Lowercased emails and digits-only phones (US country code dropped) feed the indexed `*Normalized` columns. |
| MF-145 | Customer merge and delete with referential safety | product/F-060, data/F-059 | `src/features/customers/server/customerActions.ts` | Delete blocked when orders exist; merge moves orders, addresses, and subscribers to the keeper, fills blank keeper fields, then removes the duplicate. |
| MF-146 | Deliberate delete policies across the graph | data/F-060 | `prisma/schema.prisma` (`onDelete` annotations, payments section comment) | Restrict on catalog and customer references, Cascade down the order tree so an abandoned draft can be removed without orphans, SetNull for optional links. |

### 9. Checkout, payments, refunds (28)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-147 | Shared checkout screen (web + POS) | product/F-031, product/F-032, ui/F-027 | `src/app/(storefront)/checkout/page.tsx`, `src/features/checkout/components/CheckoutClient.tsx`, `src/features/checkout/server/checkoutView.ts` | Per-recipient summary cards, donations, totals taken from the order (never client-computed), payment choice (card always, cash/check when enabled). Same component serves storefront and POS. |
| MF-148 | Per-recipient shipping selection with short-lived quotes | product/F-035, data/F-025 | `src/features/checkout/server/shipping.ts`, `shippingRates.ts`, `prisma/schema.prisma` (`ShippingQuote`, `ShippingQuoteOption`), `src/features/shipping/server/rateResolution.ts` | Options per destination; the price is re-derived server-side and written onto each group. Checkout can only submit a real unexpired option row — closes the "unknown rate ships free" hole. |
| MF-149 | Stock + price-change guard at checkout | product/F-036, sec/F-SEC-077 | `src/features/checkout/server/checkoutValidation.ts`, `checkout/route.ts:81`, `checkout/offline/route.ts:77` | Read-only warnings on page load, authoritative gate before money moves, and a price snapshot so the charge and the recorded total can't drift. Stripe line items are rebuilt from the frozen snapshot. |
| MF-150 | Order money math in integer cents with DB guards | product/F-037, data/F-037 | `src/features/checkout/server/pricing.ts`, `src/lib/money/index.ts`, `prisma/migrations/20260603000000_init/migration.sql:1346-1357` | Snapshot prices after finalize, discount clamped to subtotal + shipping; non-negative CHECKs on order totals, payments, intents, quote options; positive CHECKs on refunds and quantities. |
| MF-151 | Hosted Stripe Checkout session for card payment | product/F-033, int/F-009 | `src/app/api/checkout/route.ts` | Line items from frozen price snapshots plus a "Shipping" line, success/cancel URLs, `metadata.orderId`. The order is finalized in the webhook, not here, so a failed Stripe call can't strand a confirmed order. 20/min/IP. |
| MF-152 | Stripe client construction | int/F-008, int/F-021, product/F-033 | `src/integrations/stripe.ts`, `src/app/api/checkout/route.ts:26`, `src/app/api/webhooks/stripe/route.ts:20`, `src/features/orders/server/adminPayments.ts:39` | Shared lazy `getStripe()` exists. **CONFLICT:** product cites `src/integrations/stripe.ts` as evidence for the card-payment path; integrations reports four separate client constructions with only `runReconciliation` using the shared one, and no pinned `apiVersion` anywhere. |
| MF-153 | Stripe coupon used for order discounts | int/F-010 | `src/app/api/checkout/route.ts` (`stripe.coupons.create`) | One-off `amount_off` coupon per session; skipped when discount is 0. |
| MF-154 | Local mirror of the Stripe payment intent | int/F-011, data/F-034 | `prisma/schema.prisma` (`PaymentIntent`, `PaymentIntentStatus`), `src/app/api/checkout/route.ts` | Unique `stripePaymentIntentId` and `stripeCheckoutSessionId`; stores the exact server-computed amount for later comparison. Cash/check/comp have no intent. |
| MF-155 | Cash / check (offline) payment | product/F-034 | `src/app/api/checkout/offline/route.ts` | Finalize → record offline payment → recalc status. Offered only when the store enables those methods. 30/min/IP. |
| MF-156 | Server-side re-check of client-hidden payment options | sec/F-SEC-076 | `src/app/api/checkout/offline/route.ts:59` | Cash/check availability re-read from settings for non-staff callers, so a crafted request can't use a disabled method. |
| MF-157 | Stripe webhook signature verification on the raw body | product/F-038, int/F-012, sec/F-SEC-048 | `src/app/api/webhooks/stripe/route.ts:40` | Missing signature → 400; `constructEvent` failure logs `webhook.stripe.signature_failed` and returns 400 without detail. Raw body read before parsing. |
| MF-158 | Webhook replay protection | product/F-038, int/F-013, data/F-046, sec/F-SEC-049 | `src/app/api/webhooks/stripe/route.ts:53`, `src/features/payments/server/webhookIdempotency.ts`, `prisma/schema.prisma:1118` (`ProcessedWebhookEvent`) | Insert-first on unique `(provider, eventId)`; only P2002 counts as duplicate → 200. The claim row is deleted if the handler throws so Stripe's retry re-runs it; handler failures return 500. |
| MF-159 | `checkout.session.completed` handling | int/F-014 | `src/app/api/webhooks/stripe/route.ts` | Marks the intent succeeded and recalculates the order's payment status. |
| MF-160 | `payment_intent.succeeded` → payment row + order finalization | int/F-015 | `src/app/api/webhooks/stripe/route.ts` | Upserts the Payment then finalizes a still-draft order as `system:stripe-webhook`. This is where a paid order actually becomes confirmed. |
| MF-161 | Charged-amount tamper / stale-session auto-refund | int/F-016, sec/F-SEC-050 | `src/app/api/webhooks/stripe/route.ts:163` (`autoRefund`, `expectedChargeCents`) | If the frozen snapshots no longer add up to what was charged, the charge is auto-refunded instead of finalizing an order at a different price. |
| MF-162 | Inventory-failure auto-refund safety net | int/F-017 | `src/app/api/webhooks/stripe/route.ts` (`autoRefund` in the finalize catch) | Paid but allocation failed → refund with `idempotencyKey: auto-refund-<pi>`, write the Refund row + `refund_notification` outbox event in one transaction, drain immediately. |
| MF-163 | `charge.refunded` reconciliation, including dashboard refunds | int/F-018 | `src/app/api/webhooks/stripe/route.ts` (`reconcileStripeRefund`) | Re-lists refunds from Stripe rather than trusting the event payload; creates a local Refund row for dashboard-issued refunds; never downgrades an already-posted row. |
| MF-164 | Payment rows that physically cannot double-credit | data/F-035 | `prisma/schema.prisma` (`Payment.stripePaymentIntentId @unique`), `src/features/payments/server/webhookIdempotency.ts` | Nullable unique column lets many offline payments coexist while blocking duplicate webhook credits. |
| MF-165 | Order finalization | product/F-039 | `src/features/orders/server/finalizeOrder.ts` | Snapshot, validate all lines assigned, compute totals, confirm, allocate inventory, recalc payment — reverts to draft if allocation or recalc fails. |
| MF-166 | Checkout success page | product/F-040, ui/F-028 | `src/app/(storefront)/checkout/success/page.tsx` | Green confirmation with recipient count and total, "Place Another Order" / Back to Home; never shows raw ids. |
| MF-167 | Payment status derivation | product/F-041, data/F-022 | `src/features/payments/server/paymentMath.ts`, `recalcOrderPayment.ts`, `prisma/schema.prisma` (`Order.paymentStatus`) | unpaid / pending / partial / paid plus dominant method, always derived from posted payment rows; the column is a cache recomputed for fast list filtering. |
| MF-168 | Order status rules + audit trail | product/F-042 | `src/features/orders/server/orderStateMachine.ts`, `transitionOrder.ts` | One chokepoint for status changes; cancelling releases inventory in the same transaction. |
| MF-169 | Admin money and shipment action UI | ui/F-060, product/F-054 | `src/app/(admin)/admin/orders/[id]/order-money-actions.tsx`, `shipment-actions.tsx` | Record payment / refund / cancel dialogs with dollar inputs and toast failures; shipment row shows Buy cheapest label, Check address, Print label, Refresh tracking, confirm-guarded Void label, or a "connect Shippo" note. |
| MF-170 | Manual cash / check / comp payments | product/F-054 | `src/features/orders/server/adminPayments.ts` | Staff-recorded offline payments. |
| MF-171 | Refund records with reason, method, status | product/F-054, data/F-036 | `prisma/schema.prisma` (`Refund`, `RefundReason`, `RefundMethod`, `RefundStatus`), `src/features/refunds/server/createRefund.ts` | Cash / check / store credit / write-off / back to card. Unique `stripeRefundId`, amount CHECK > 0; the order row is locked so two simultaneous refunds can't both pass. |
| MF-172 | Card refund through Stripe with idempotency | product/F-054, int/F-019, sec/F-SEC-051 | `src/features/orders/server/adminPayments.ts` (`refundToCard`), `src/app/api/webhooks/stripe/route.ts:342`, `:253` | Refund row written first, its id used as the Stripe idempotency key and carried in `metadata.refundRowId`; definitive rejections mark the row failed, ambiguous network errors leave it pending; a status guard never downgrades an already-posted refund. |
| MF-173 | Stripe reconciliation (report-only) | product/F-097, ui/F-095, int/F-020, data/F-038 | `src/app/(admin)/admin/reconciliation/page.tsx`, `run-button.tsx`, `src/features/reconciliation/server/runReconciliation.ts`, `matcher.ts`, `prisma/schema.prisma` (`ReconciliationReport`) | Pulls 40 days of charges/refunds (auto-paging, 1000 cap, `truncated` flag), compares against local rows, stores discrepancies per run. Recent runs plus the latest run's discrepancies on screen. Never moves money. |
| MF-174 | Drift: Stripe browser SDKs installed but unused | int/F-022 | `package.json` (`@stripe/react-stripe-js`, `@stripe/stripe-js`) | No `loadStripe` / `@stripe/*` import exists in `src/`; checkout is a hosted redirect, so these are dead weight. |

### 10. Repeat orders (5)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-175 | Customer repeat order | product/F-043, ui/F-032 | `src/app/(storefront)/account/orders/[id]/repeat/page.tsx`, `src/components/ordering/repeat-review.tsx` | Review screen shows last year beside this year with swap / quantity / greeting / remove before anything is saved. |
| MF-176 | Staff repeat order | product/F-044, ui/F-062 | `src/app/(admin)/admin/orders/[id]/repeat/page.tsx` | Same review screen; confirm creates a POS draft and drops the staffer into the POS builder. |
| MF-177 | Bulk repeat across several past orders | product/F-045, ui/F-063 | `src/app/(admin)/admin/orders/repeat-bulk/page.tsx`, `bulk-repeat-form.tsx` | Customer-scoped; tick multiple past orders and merge them into one draft, deduping recipients. Submit disabled until something is selected. |
| MF-178 | Cross-season product matching | product/F-046, data/F-016 | `src/features/orders/server/repeat/matcher.ts`, `replacementChain.ts`, `buildRepeatPlan.ts` | Priority: explicit replacement chain → exact name → category + nearest price + keyword overlap → nearest price. Cycle-protected chain walk. |
| MF-179 | Repeat preview / confirm actions | product/F-047 | `src/features/orders/server/repeat/repeatOrder.ts` | Preview writes nothing; confirm applies the user's overrides through the normal saveDraft path. |

### 11. Admin shell and landing surfaces (9)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-180 | Admin shell | product/F-048, ui/F-048 | `src/app/(admin)/admin/admin-shell.tsx` | Sticky 64-wide sidebar on desktop, sheet nav on mobile, header row with Help, tour, env switch, visit store, Clerk user button. |
| MF-181 | Permission-aware sidebar nav | product/F-048, ui/F-049 | `src/components/admin/admin-sidebar.tsx`, `src/components/admin/sidebar-config.ts` | Today and Dashboard pinned, then collapsible groups; sections auto-open on the active route and hide when the user can see none of their links; every link carries a plain-English hint; hidden items are cosmetic only. **CONFLICT:** product reads five groups (Sales, Products, Packing & delivery, Settings, Developer); ui reads six (adds Reports) and notes the file's own header comment still says five. ui also reports the Developer links in `sidebar-config.ts` omit the `settings.view` permission that the unused `src/features/auth/nav.ts` copy requires. |
| MF-182 | Admin mobile nav | product/F-048, ui/F-050 | `src/components/admin/mobile-nav.tsx` | Hamburger opens the identical sidebar inside a sheet. |
| MF-183 | Live / test environment switch link | product/F-111, ui/F-052, int/F-074 | `src/components/admin/env-switch-link.tsx`, `src/app/(admin)/admin/env-switch/route.ts` | "Switch to Test" / "Back to Live" to the sister deployment; only rendered when the sister URL is configured; sets an `envOverride` cookie and lands on `/admin` (see G-07). |
| MF-184 | Visit store link | ui/F-053 | `src/components/admin/visit-store-link.tsx` | Icon or text link opening the storefront in a new tab. |
| MF-185 | Guided tours | product/F-112, ui/F-054 | `src/features/tours/tours.ts`, `admin-tour.tsx`, `run-driver.ts` | Test-env-only driver.js walkthroughs: site tour plus per-page tours, auto-started from `?tour=`, driver.js lazy-loaded, missing targets skipped. |
| MF-186 | Help centre | product/F-112, ui/F-055 | `src/app/(admin)/admin/help/page.tsx`, `help-content.tsx`, `help-articles.ts` | Searchable, category-filtered how-to articles with step lists and "Show me" buttons that launch the matching tour. |
| MF-187 | Admin dashboard | product/F-050, ui/F-056 | `src/app/(admin)/admin/page.tsx`, `src/features/orders/server/dashboardStats.ts` | Orders today, need-to-pack, season revenue, unpaid; permission-gated action tiles; last 5 orders. |
| MF-188 | Today work queue | product/F-051, ui/F-057 | `src/app/(admin)/admin/today/page.tsx`, `src/features/today/server/workQueue.ts` | Eight permission-gated cards, each with a count, an "all clear" state, relative dates, and a deep link: orders to confirm, pickups, labels, deliveries to dispatch, routes in progress, production batches, follow-up calls, staff alerts. |

### 12. Orders admin, POS, customers, imports (12)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-189 | Orders list | product/F-052, ui/F-058 | `src/app/(admin)/admin/orders/page.tsx`, `orders-search-bar.tsx`, `src/components/admin/list-params.ts` | Search, filter presets, status/payment dropdowns, alert banners, whitelisted page sizes, pagination, CSV export button. |
| MF-190 | Order detail (admin) | product/F-053, ui/F-059 | `src/app/(admin)/admin/orders/[id]/page.tsx` | Customer block, status badges, per-recipient fulfillment cards, totals, payment summary, follow-up controls, staff notes, admin actions. |
| MF-191 | Packing slip print view | product/F-055, ui/F-061 | `src/app/(admin)/admin/orders/[id]/packing-slip/page.tsx` | One section per recipient with items, options, add-ons, greeting; print-only layout. |
| MF-192 | POS / counter and phone order taking | product/F-056, ui/F-064 | `src/app/(admin)/admin/pos/page.tsx`, `pos-builder.tsx` | The same builder shoppers use, wrapped with a customer bar (search, walk-in, create new, draft reference badge), staff-only notes, cancel-draft. Resumes via `?draftId=`. |
| MF-193 | POS checkout | product/F-057, ui/F-065 | `src/app/(admin)/admin/pos/checkout/[orderId]/page.tsx` | Shared `CheckoutClient` in `mode: pos` for cash/check/card at the counter. |
| MF-194 | Staff customer lookup / find-or-create | product/F-058 | `src/app/api/customers/search/route.ts`, `src/app/api/customers/find-or-create/route.ts` | Search returns up to 25 non-guest matches with addresses; creation auto-subscribes the email. |
| MF-195 | Follow-up call list | product/F-059, ui/F-068 | `src/app/(admin)/admin/follow-up/page.tsx`, `follow-up-filters.tsx`, `follow-up-list.tsx` | Unpaid invoices, overdue pickups, and lapsed customers as expandable card rows with call and email shortcuts. Pill tabs (unpaid / pickup / lapsed / all) plus a snoozed toggle, all URL-synced. Driven by the follow-up policy settings. |
| MF-196 | Customers list | product/F-060, ui/F-066 | `src/app/(admin)/admin/customers/page.tsx`, `customer-search.tsx`, `add-customer-dialog.tsx` | Debounced `?q=` search, paginated table with order count and total spent, Add Customer dialog, CSV import. |
| MF-197 | Customer detail | product/F-060, ui/F-067 | `src/app/(admin)/admin/customers/[id]/page.tsx`, `customer-detail-client.tsx` | Contact info, order history, saved addresses, duplicate detection, new-order and delete actions. |
| MF-198 | Shared CSV import dialog | product/F-061, ui/F-083 | `src/components/admin/csv-import-dialog.tsx` | Sample download, upload, success/error reporting; reused by customers, products, add-ons, subscribers. |
| MF-199 | Staged import pipeline with all-or-nothing commit | product/F-061, data/F-051, sec/F-SEC-070 | `prisma/schema.prisma` (`ImportBatch`, `ImportBatchRow`), `src/features/imports/server/batchEngine.ts`, `actions.ts:345`, `:354`, `:363` | Stage → validate → FK pre-check → single-transaction commit, with per-kind validator/committer plug-ins and ordering rules (products before orders). Products/add-ons need `products.edit`, customers need `customers.create`. |
| MF-200 | Legacy Nexternal data migration scripts | data/F-052, int/F-076 | `scripts/nexternal/customers/importCustomers.ts`, `historical/importHistorical.ts`, `products/importProducts.ts`, `shared/excel.ts` | Excel workbooks in (`xlsx` dep), dry-run by default, `--apply` to write; customer/address/product matching, unmatched CSV report, `fix-order-numbers.ts` repair script, `npm run import:*`. Offline file import, not a live API. |

### 13. Email (15)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-201 | Email hub with five tabs | product/F-062, ui/F-069 | `src/app/(admin)/admin/email/page.tsx`, `email-tabs.tsx` | URL-synced tabs. **CONFLICT (minor):** product lists the order as campaigns, subscribers, lists, templates, triggered; ui lists Campaigns, Triggered, Lists, Subscribers, Templates. Same five tabs, different stated order. |
| MF-202 | WYSIWYG campaign builder | product/F-063, ui/F-070 | `src/app/(admin)/admin/email/campaign-builder.tsx`, `campaign-blocks.ts`, `new/page.tsx`, `[id]/edit/page.tsx` | Full-screen block editor (heading, paragraph, button, image, divider, spacer) with reordering, per-block style overrides, merge variables, click-to-scroll live preview, inline-styled HTML output for email clients. |
| MF-203 | Campaign CRUD, duplicate, send | product/F-064, ui/F-071 | `src/features/email/server/marketingActions.ts`, `src/app/(admin)/admin/email/campaign-actions.tsx`, `campaigns-tab.tsx` | Send with confirmation and recipient count, duplicate, delete. |
| MF-204 | Campaign delivery honouring subscriber preferences | product/F-065, int/F-029 | `src/features/email/server/campaignSend.ts` | `all` / `if_not_ordered` / `once_yearly`; batches of 10 with `allSettled`; stamps `lastEmailedAt`; claims the campaign atomically so it can't send twice. |
| MF-205 | Mailing lists and membership | product/F-066, ui/F-074, data/F-040 | `src/app/(admin)/admin/email/lists-tab.tsx`, `list-editors.tsx`, `src/features/email/server/marketingActions.ts`, `prisma/schema.prisma` (`MailingList`, `MailingListMember`) | Create/update/delete lists, pick members from a searchable checkbox dialog, member counts shown. Unique per (list, subscriber). |
| MF-206 | Subscriber management with per-person preference | product/F-067, ui/F-075, data/F-039 | `src/app/(admin)/admin/email/subscribers-tab.tsx`, `subscriber-controls.tsx`, `src/features/email/server/upsertSubscriber.ts`, `prisma/schema.prisma` (`EmailSubscriber`, `EmailPreference`) | Add, remove, CSV import with a downloadable sample, preference editing. Single upsert path keyed on the normalized email; unsubscribe timestamp and reason recorded. |
| MF-207 | Branding templates | product/F-068, ui/F-073, data/F-041 | `src/app/(admin)/admin/email/templates-tab.tsx`, `email-editors.tsx`, `src/features/email/server/templateActions.ts`, `templateRender.ts`, `prisma/schema.prisma` (`EmailTemplate`) | Colours, logo, footer; server-rendered preview, set-default, delete. Every email body is wrapped in the chosen layout. |
| MF-208 | Editable transactional (triggered) emails | product/F-069, ui/F-072, int/F-027, data/F-041 | `src/app/(admin)/admin/email/triggered-tab.tsx`, `triggered/[key]/edit/page.tsx`, `src/features/email/server/triggeredEmailDefaults.ts`, `prisma/schema.prisma` (`TriggeredEmailOverride`) | Per-template subject/body overrides with the WYSIWYG blocks and reset-to-default; rows show customized state. Defaults live in code, overrides in the DB. |
| MF-209 | Automatic order emails | product/F-070, int/F-026 | `src/features/email/server/orderEmails.ts`, `orderSummaryHtml.ts`, `src/server/outbox.ts` | Order confirmation, payment request for unpaid orders, auto-refund notice, each with an itemized summary. Registered as outbox handlers `confirmation_email`, `payment_link`, `refund_notification`. |
| MF-210 | Single email dispatcher, claim-first idempotent | product/F-071, int/F-024, data/F-042 | `src/features/email/server/dispatchEmail.ts`, `prisma/schema.prisma` (`SentEmail` unique on `templateKey`+`dedupeKey`) | Row created before sending, claim released on failure — makes the outbox safe to re-run. |
| MF-211 | Resend sender factory | int/F-023 | `src/integrations/resend.ts` | `createResendSender(from)`; the only file importing `resend`; throws with the provider's message on `response.error`. |
| MF-212 | Test-mode email capture instead of real sends | int/F-025, data/F-043, product/F-110 | `src/features/email/server/dispatchEmail.ts`, `prisma/schema.prisma` (`EmailLog`) | When `IS_TEST_ENV` the HTML is written to `EmailLog` and Resend is never called; production never writes here. |
| MF-213 | HTML escaping for email templates | sec/F-SEC-063, product/F-071 | `src/features/email/server/htmlEscape.ts` | Escapes `& < > " '` for every user-supplied string interpolated into an HTML email body. |
| MF-214 | Admin "send test email" | product/F-104, int/F-032 | `src/features/settings/server/actions.ts` (`sendTestEmail`), `src/app/(admin)/admin/settings/email-tab.tsx` | Dynamically imports the Resend sender and passes the provider error through so a bad key is visible. |
| MF-215 | Drift: test email reads undeclared env vars | int/F-033 | `src/features/settings/server/actions.ts:246-250` vs `src/config/env-schema.ts` | Uses `EMAIL_FROM_NAME` / `EMAIL_FROM_ADDRESS`, in neither `envSchema` nor `.env.example` (the rest of the app uses `RESEND_FROM_EMAIL`), so the button always fails on a schema-conformant deployment. |

### 14. Products, add-ons, media administration (12)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-216 | Products list with season switcher | product/F-072, ui/F-076 | `src/app/(admin)/admin/products/page.tsx`, `season-select.tsx` | Paginated, searchable catalog with price, category, status, inventory, units sold and revenue per season; past seasons read-only behind a banner. |
| MF-217 | Product create / edit form | product/F-073, ui/F-077 | `src/app/(admin)/admin/products/product-form.tsx`, `new/page.tsx`, `[id]/edit/page.tsx`, `src/features/products/server/productActions.ts` | Catalog fields, inline options editor, image picker, attachable add-ons, dimensions/weight, season inventory goal, status, "replaces last year's item" link, delete. |
| MF-218 | Product row actions | ui/F-079 | `src/app/(admin)/admin/products/product-actions.tsx` | Edit link, activate/deactivate toggle, delete with confirmation. |
| MF-219 | Product detail + replacement editor | product/F-074, ui/F-078 | `src/app/(admin)/admin/products/[id]/page.tsx`, `replacement-editor.tsx` | Read-only detail (options, add-ons, inventory summary) for past seasons except the "replaced by" link, which stays editable so the chain can be fixed after a new catalog lands. |
| MF-220 | Add-ons management | product/F-075, ui/F-080 | `src/app/(admin)/admin/addons/page.tsx`, `addon-actions.tsx`, `src/features/products/server/addOnActions.ts` | Table with price, restriction mode, kitchen flag, status; create/edit dialog, CRUD, CSV import. |
| MF-221 | Media library page | product/F-076, ui/F-081 | `src/app/(admin)/admin/media/page.tsx`, `media-actions.tsx`, `needs-photos-panel.tsx` | Responsive image grid with size and usage count, multi-file upload with progress, delete confirmation, and a "needs photos" panel that assigns an image to this season's imageless products in two clicks. |
| MF-222 | Media picker for forms | product/F-076, ui/F-082 | `src/components/admin/media-picker.tsx` | Thumbnail plus dialog to search the library or upload on the spot; used by product and add-on forms. |
| MF-223 | Image upload to Vercel Blob with validation | int/F-053, sec/F-SEC-068, data/F-017 | `src/app/api/media/route.ts:34` | Requires `products.edit`; MIME allow-list (jpeg/png/gif/webp), 2 MB cap, filename sanitized to `[a-zA-Z0-9._-]` and truncated to 200 chars, stored under `media/<ts>-<safe name>` with `access: "public"`. |
| MF-224 | Media library listing and search endpoint | int/F-054 | `src/app/api/media/route.ts` (GET) | Newest-first, 100 max, optional case-insensitive filename query; feeds the picker. |
| MF-225 | Media delete removes blob and row | int/F-055, sec/F-SEC-069 | `src/app/api/media/[id]/route.ts:32` | Requires `products.edit`; a Blob-delete failure still removes the row and logs. GET on this route is unauthenticated (G-05). |
| MF-226 | Blob host allow-listed for `next/image` | int/F-056 | `next.config.ts` | `*.public.blob.vercel-storage.com`. |
| MF-227 | One-off migration: relink images from the previous Blob store | int/F-057 | `scripts/link-old-product-images.ts` | Lists the old store with `OLD_BLOB_TOKEN` (not in `env-schema.ts`), matches blobs to products by slug, dry-run unless `--apply`. |

### 15. Inventory and production (11)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-228 | Inventory overview | product/F-077, ui/F-084 | `src/app/(admin)/admin/inventory/page.tsx`, `inventory-tabs.tsx`, `overview-tab.tsx`, `src/features/inventory/server/dashboard.ts` | URL-driven Overview/Production tabs; four summary cards (goal, sold, need to produce, still to make) plus per-item product and add-on tables. Production tab hidden for read-only staff. |
| MF-229 | Production tab and daily batch entry | product/F-078, ui/F-085 | `src/app/(admin)/admin/inventory/production-tab.tsx`, `daily-batch-dialog.tsx`, `inventory-controls.tsx`, `src/features/inventory/server/production.ts` | Deficit-sorted batch entry (made/received + damaged per row), status table with progress bars, receive-stock flow for purchased add-ons, damage reporting. New units FIFO-bind to the oldest waiting orders. |
| MF-230 | Production history with undo | product/F-078, ui/F-086 | `src/app/(admin)/admin/inventory/production-history.tsx` | Newest-first rail of batch and damage entries with who logged them and confirm-then-undo; undo refused if a label was already printed. |
| MF-231 | Production batches and reservation lifecycle | data/F-032, product/F-078 | `prisma/schema.prisma` (`ProductionBatch`, `InventoryReservation`, `ReservationState`), `src/features/inventory/server/allocate.ts`, `release.ts`, `production.ts` | waiting_on_production → reserved → released / consumed; CHECK enforces exactly one reservation target. |
| MF-232 | One inventory table for products and add-ons, enforced by a DB CHECK | data/F-030 | `prisma/schema.prisma` (`InventoryItem`), `prisma/migrations/20260603000000_init/migration.sql:1340` | `InventoryItem_one_target CHECK (num_nonnulls("productId","addOnId") = 1)` structurally forbids the add-on asymmetry bug. |
| MF-233 | Atomic compare-and-set inventory counters | product/F-079, data/F-031 | `src/features/inventory/server/reserve.ts`, `prisma/schema.prisma` (`InventoryItem.version`) | Raw SQL because Prisma `where` can't compare two columns; fixes the read-then-write oversell race. |
| MF-234 | Oversell-safe allocation | product/F-079 | `src/features/inventory/server/allocate.ts` | Two callers racing for the last unit can't both win; over-target demand rejected with a per-item error. |
| MF-235 | Inventory release on cancel | product/F-080 | `src/features/inventory/server/release.ts` | Idempotent — safe to run more than once. |
| MF-236 | Damage / write-off with undo | product/F-081, data/F-033 | `src/features/inventory/server/writeoff.ts`, `actions.ts`, `prisma/schema.prisma` (`WriteOff`) | Can't write off a unit already bound to a shipment; quantity CHECK > 0, per product or add-on per season. |
| MF-237 | "Deliver now" shortfall override | product/F-082 | `src/features/inventory/server/shortfall.ts` | Pulls free stock first, then cannibalizes units reserved by other label-not-printed shipments; donors drop back to waiting on production. |
| MF-238 | Inventory goal (target) editing | product/F-083 | `src/features/inventory/server/actions.ts` (`setInventoryTarget`), `overview-tab.tsx` | Editable season goal per item. |

### 16. Fulfillment, shipping, routes, geocoding (28)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-239 | Packing & fulfillment overview | product/F-084, ui/F-087 | `src/app/(admin)/admin/fulfillment/page.tsx`, `src/features/fulfillment/server/fulfillmentPool.ts` | Three channel cards (pickups, deliveries, shipments) with status counts, from one shared counter so dashboard, Today, and this page never disagree. |
| MF-240 | Mark a channel fulfilled | product/F-085, ui/F-087 | `src/app/(admin)/admin/fulfillment/channel-action-button.tsx`, `src/features/fulfillment/server/fulfillmentActions.ts` | Confirm-guarded bulk "mark done" per channel. |
| MF-241 | Shipment, box, and package-type records | data/F-028 | `prisma/schema.prisma` (`Shipment`, `ShipmentBox`, `PackageType`) | Stores rates JSON, Shippo ids, tracking, label URL, savings vs cheapest, planner box count. |
| MF-242 | Box packing for shipments | product/F-087 | `src/features/shipping/server/binPacking.ts`, `shipmentPlanning.ts` | First-fit-decreasing under a max weight and an optional per-product max per box; add-on weight included. |
| MF-243 | Ship-from address from env, validated before any carrier call | int/F-042 | `src/features/shipping/server/shipmentPlanning.ts` (`validateShipFrom`), `.env.example` (`SHIP_FROM_*`) | Names the missing fields; env defaults ship blank on purpose. |
| MF-244 | Buy the cheapest carrier label | product/F-086, int/F-036 | `src/features/fulfillment/server/shipmentActions.ts` (`buyLabelForGroup`), `src/integrations/shippo.ts` | Packs boxes, rates, buys cheapest, records `savingsCents` vs what the customer was charged. |
| MF-245 | Compare-and-set lock against double label purchase | int/F-037 | `src/features/fulfillment/server/shipmentActions.ts` (claim on `labelPrintedAt`, `releaseClaim`) | Two concurrent clicks can't both buy; the claim is released if rating or buying fails. |
| MF-246 | Auto-void compensation when the label can't be saved | int/F-038 | `src/features/fulfillment/server/shipmentActions.ts` (catch around the transaction) | Dual-write failure → void the purchased label; if the void also fails, the error hands staff the Shippo transaction id instead of silently buying a second label. |
| MF-247 | Void a purchased label | product/F-086, int/F-039 | `src/features/fulfillment/server/shipmentActions.ts` (`voidLabelForGroup`) | Blocked once the group is shipped/delivered; resets the group to pending. |
| MF-248 | Carrier tracking refresh drives fulfillment status | product/F-086, int/F-040 | `src/features/fulfillment/server/shipmentActions.ts` (`refreshGroupTracking`) | `DELIVERED` → delivered, `TRANSIT` → shipped; never moves a group backwards. |
| MF-249 | Carrier address validation for a shipment | int/F-041 | `src/features/fulfillment/server/shipmentActions.ts` (`validateGroupAddress`), `src/integrations/shippo.ts` (`validateAddress`) | Creates a Shippo address with `validate:true` purely to read the verdict. |
| MF-250 | Single Shippo wrapper with configured-check | int/F-035 | `src/integrations/shippo.ts` | `isShippoConfigured`, `rateShipment`, `buyLabel`, `voidLabel`, `trackShipment`, `validateAddress`; every call returns `{ok:false}` instead of throwing without `SHIPPO_API_KEY`; converts dollar strings to integer cents. |
| MF-251 | Shipping-off degradation surfaced in the UI | product/F-086, int/F-043, ui/F-060 | `src/app/(admin)/admin/orders/[id]/page.tsx:42` (`isShippoConfigured`) | Label controls adapt to a friendly "shipping not configured" / "connect Shippo" note. |
| MF-252 | Carrier rate-id classification | int/F-044 | `src/features/shipping/server/rateResolution.ts` | Maps `shippo`/`usps`/`ups`/`fedex`-prefixed rate ids to method + cost; unknown ids return null rather than being accepted. |
| MF-253 | Drift: UPS and USPS credentials declared but never read | int/F-046 | `src/config/env-schema.ts` (`UPS_CLIENT_ID/SECRET/ACCOUNT_NUMBER`, `USPS_USER_ID`), `.env.example` | No code reads these four vars anywhere in `src/` or `scripts/`. |
| MF-254 | Configurable shipping pricing rules | product/F-094, data/F-026 | `src/features/shipping/server/ruleEngine.ts`, `rateResolution.ts`, `prisma/schema.prisma` (`ShippingRule`), `src/config/settings.ts` | Admin rules evaluated in position order, first match wins; otherwise flat local/carrier rates, a free-shipping threshold, local-delivery ZIP allowlist, and optional live carrier fallback. |
| MF-255 | Short-lived shipping quotes with selectable option rows | data/F-025 | `prisma/schema.prisma` (`ShippingQuote`, `ShippingQuoteOption`) | See MF-148 — the model half. |
| MF-256 | Route builder with map | product/F-088, ui/F-088, int/F-051 | `src/app/(admin)/admin/fulfillment/build-route/page.tsx`, `route-builder.tsx`, `src/integrations/mapbox.ts`, `src/app/globals.css` (`.route-pin`) | Groups unrouted local-delivery stops into a driver's route: Mapbox map (`mapbox-gl` via dynamic import, token passed from the server) with selectable pins, ordered stop list with reorder controls, messenger assignment, save. Degrades to a plain checklist with a callout when no token is set. |
| MF-257 | Routes list, detail, and assignment | product/F-089, ui/F-089, data/F-029 | `src/app/(admin)/admin/routes/page.tsx`, `[id]/page.tsx`, `reassign-button.tsx`, `src/features/fulfillment/server/routeActions.ts`, `prisma/schema.prisma` (`DeliveryRoute`, `RouteStop`, `DeliveryRouteStatus`) | Active/finished sections, ordered stop rows with recipient and status, messenger assign/reassign/clear, stop reordering, multi-stop Google Maps link. Unique stop per (route, fulfillment group); timestamps for assigned/started/completed/cancelled. |
| MF-258 | Printable driver sheet | product/F-090, ui/F-090 | `src/app/(admin)/admin/routes/[id]/print/page.tsx` | Ordered stops with address, phone, neighbourhood, items, sign-off box. |
| MF-259 | Printable greeting cards | product/F-091, ui/F-091 | `src/app/(admin)/admin/routes/[id]/greeting-cards/page.tsx` | One card per line that carries a greeting. |
| MF-260 | Messenger (driver) app shell | product/F-092, ui/F-107 | `src/app/(messenger)/messenger/layout.tsx` | Phone-first, no admin chrome; gated to messenger role, `canDrive`, or manager+. |
| MF-261 | Messenger route list | product/F-092, ui/F-108 | `src/app/(messenger)/messenger/page.tsx` | Assigned and in-progress routes with progress bars plus a "Finished today" section; managers see all routes. |
| MF-262 | Messenger route detail and delivery | product/F-092, ui/F-109 | `src/app/(messenger)/messenger/routes/[id]/page.tsx`, `deliver-button.tsx`, `start-route-button.tsx`, `src/features/fulfillment/server/markDelivered.ts` | Ordered stop cards with tap-to-call, tap-to-map, items, greeting text, office-notes banner, Start Route, and a large Delivered button that auto-completes the route on the last stop. |
| MF-263 | Server-side Mapbox geocoding provider | int/F-047 | `src/integrations/mapbox.ts` | Geocoding v5 `mapbox.places`, US-only, limit 1; a missing token returns a clean failure instead of throwing. |
| MF-264 | Geocode cache with success and failure TTLs | product/F-093, data/F-047, int/F-048 | `src/features/shipping/server/geocode.ts`, `prisma/schema.prisma` (`GeocodeCache`) | 7-day success TTL, 6-hour failure retry with `retryAfter`; the route builder reads cache only and never blocks on a live lookup. |
| MF-265 | Async geocode refresh through the outbox | int/F-049 | `src/features/shipping/server/geocodeRefresh.ts`, `src/server/outbox.ts` (`geocode_refresh`), `src/features/customers/server/savedAddresses.ts` | Saving an address clears coords and queues the refresh; coords are copied onto draft orders' fulfillment groups. |
| MF-266 | Stub: route-builder coord refresh does no geocoding | product/F-093, int/F-052 | `src/app/api/route-builder/refresh-coords/route.ts` | Finds up to 500 local-delivery groups missing lat/lng and returns `{refreshed: 0}`; the geocoding call is a TODO even though MF-263 exists (G-15). |

### 17. Reports and exports (5)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-267 | Season reports with drill-downs | product/F-095, ui/F-093, data/F-054 | `src/app/(admin)/admin/reports/page.tsx`, `src/features/reports/server/seasonReports.ts` | This year vs the average of past years, a year-by-year table, item-level sales lined up across seasons via the replacement chain; `?drill=` opens lapsed customers and item winners/losers. Raw SQL for per-year orders/revenue/customers. |
| MF-268 | CSV export page with download history | product/F-096, ui/F-094 | `src/app/(admin)/admin/export/page.tsx` | Five export cards (deliveries, year-end, year metrics, item sales, lapsed customers) plus a history table of who downloaded what. |
| MF-269 | CSV export endpoints with export recording | product/F-096, data/F-053, sec/F-SEC-071 | `src/app/api/export/{deliveries,year-end,year-metrics,item-sales,lapsed-customers}/route.ts`, `src/features/exports/server/exportResponse.ts`, `prisma/schema.prisma` (`ExportLog`) | Each route requires `export.csv` and calls `recordExport()` with row count and actor. Exports share the reports loaders so screen and download always match; files are not stored. |
| MF-270 | CSV formula-injection neutralization | data/F-053, sec/F-SEC-064 | `src/lib/csv.ts:18` | Cells starting with `= + - @ tab CR LF` are prefixed with `'`; numbers passed as numbers untouched; quote/comma/newline escaping handled separately. |
| MF-271 | Per-season sales aggregates for the catalog | data/F-054, product/F-072 | `src/features/products/server/seasonSales.ts` | Units sold and revenue per product per season, shared with the products list. |

### 18. Settings (10)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-272 | Settings hub with four tabs | product/F-098, ui/F-096 | `src/app/(admin)/admin/settings/page.tsx`, `orders-tab.tsx`, `shipping-tab.tsx`, `email-tab.tsx`, `developer-tab.tsx` | Orders, shipping, email, developer; Developer visible to developers only. |
| MF-273 | Settings registry backed by a key/value table | data/F-044 | `src/config/settings.ts`, `prisma/schema.prisma` (`Setting`), `src/features/settings/server/actions.ts`, `prisma/seed.ts` | One registry defines key, type (boolean/number/daylist/cents/text), default, and UI group; typed readers prevent key drift. |
| MF-274 | Store open/closed control | product/F-099, ui/F-097 | `src/app/(admin)/admin/settings/store-status-card.tsx`, `src/features/settings/server/actions.ts` (`toggleStoreOpen`) | With a custom closed message shown on the storefront. |
| MF-275 | Package types CRUD | product/F-100, ui/F-097 | `src/app/(admin)/admin/settings/package-types-card.tsx`, `src/features/settings/server/actions.ts` | Box sizes used by the shipment planner. |
| MF-276 | Pickup locations CRUD | product/F-100, ui/F-097, data/F-027 | `src/app/(admin)/admin/settings/pickup-locations-card.tsx`, `src/features/settings/server/actions.ts` | Deactivates rather than deletes. |
| MF-277 | Shipping rates and free-shipping threshold | product/F-101, ui/F-097 | `src/app/(admin)/admin/settings/shipping-rates-card.tsx`, `src/config/settings.ts` | Local delivery fee, carrier fee, free-shipping threshold, smart-merge same-address shipments, carrier fallback toggle. |
| MF-278 | Delivery ZIP allowlist | product/F-101, ui/F-097 | `src/app/(admin)/admin/settings/delivery-zips-card.tsx` | Pill input of local-delivery ZIPs. |
| MF-279 | Shipping rules ordered editor | product/F-094, ui/F-097 | `src/app/(admin)/admin/settings/shipping-rules-card.tsx` | Ordered rule list with move up/down; staff can create, edit, delete, reorder. |
| MF-280 | Follow-up policy settings | product/F-102, ui/F-097 | `src/app/(admin)/admin/settings/follow-up-settings.tsx`, `src/config/settings.ts` | Unpaid auto-cancel on/off + days, reminder day list, staff-alert threshold; separate pickup expiry and pickup reminder policy. |
| MF-281 | New season wizard | product/F-103, ui/F-098 | `src/app/(admin)/admin/settings/new-season-wizard.tsx` | Dialog that rolls the catalog into a new season year. |

### 19. Scheduling and delivery reliability (9)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-282 | Five Vercel cron jobs | int/F-058, sec/F-SEC-053 | `vercel.json` | `payment-reminders` daily 14:00; `outbox-sweep` / `pickup-expiry` / `purge-email-log` daily 00:00; `reconcile-stripe` monthly on the 1st at 06:00. Paths match the secret-guarded routes. |
| MF-283 | Cron bearer-secret verification | product/F-118, int/F-059, sec/F-SEC-052 | `src/server/verifyCronSecret.ts`, all five `src/app/api/cron/*/route.ts` | Missing `CRON_SECRET` returns false (fails closed). Plain `===` compare, not constant-time (G-11). |
| MF-284 | Payment reminders + auto-cancel (daily) | product/F-114, int/F-028 | `src/app/api/cron/payment-reminders/route.ts` | Escalates reminder level 0→1→2 then auto-cancels; dedupe key `<orderId>_level<n>`; skips snoozed orders; orders flagged `autoCancelExempt` still get reminders but are never cancelled. Writes a `JobRun`. |
| MF-285 | Pickup expiry (daily) | product/F-115, int/F-063 | `src/app/api/cron/pickup-expiry/route.ts` | Policy-driven reminders as the deadline approaches, then auto-cancel past the window; respects snooze and `autoCancelExempt`. |
| MF-286 | Transactional outbox with retry and give-up | product/F-116, data/F-045, int/F-060 | `src/server/outbox.ts`, `prisma/schema.prisma` (`OutboxEvent`, `OutboxStatus`) | Enqueued in the same commit as the state change; linear backoff (attempts × 60s), attempts/errors recorded, parked as `failed` after 10 attempts. |
| MF-287 | Dual drain: inline plus cron sweep | int/F-061, product/F-116 | `src/server/outbox.ts` (`drainOutboxForEntity`), `src/app/api/cron/outbox-sweep/route.ts` | Sweep takes 50 events per run; handlers are idempotent so an inline/cron race is safe. |
| MF-288 | Email / webhook log retention purge (daily) | product/F-117, int/F-034, data/F-050, sec/F-SEC-061 | `src/app/api/cron/purge-email-log/route.ts` | One transaction: `EmailLog` > 30 days, `SentEmail` > 90, `ProcessedWebhookEvent` > 90; recorded as a `JobRun`. |
| MF-289 | Monthly Stripe reconciliation cron | product/F-118, int/F-020 | `src/app/api/cron/reconcile-stripe/route.ts` | The same report-only run as the admin button (MF-173). |
| MF-290 | Cron / job run history | data/F-049, int/F-062 | `prisma/schema.prisma` (`JobRun`), cron routes | Name, status, processed count, error, finish time. |

### 20. Test-environment tooling (5)

| ID | Name | Source IDs | Evidence path(s) | Notes |
|---|---|---|---|---|
| MF-291 | Test-mode tools page | product/F-110, ui/F-101 | `src/app/(admin)/admin/test-mode/page.tsx`, `seed-buttons.tsx`, `reset-button.tsx`, `clear-emails-button.tsx` | Captured emails with sandboxed HTML preview, seed a demo season, wipe test data, typed-confirmation DB reset, clear emails — all with toast/loading feedback. Gated on `IS_TEST_ENV` plus developer. |
| MF-292 | Test-environment data endpoints, double-gated | int/F-073, sec/F-SEC-072 | `src/app/api/admin/reset-test-db/route.ts:16`, `wipe-test-data/route.ts:14`, `seed-test-season/route.ts` | Requires `IS_TEST_ENV` **and** the developer-only `impersonate` permission; a production hit returns 403 before auth is consulted. |
| MF-293 | Guarded test-data wipe helper | sec/F-SEC-073, data/F-056 | `src/features/testdata/server/wipeTestData.ts:33`, `scripts/reset-test-db.ts` | Defense in depth behind the route guard; the flag is typed `isTestEnv: true` so a caller can't pass `false`. Orders-only mode keeps customers/catalog/settings; full mode keeps settings, methods, seasons, templates. |
| MF-294 | Deterministic test-season seeder | data/F-055, product/F-110 | `src/features/testdata/server/seedTestSeason.ts`, `generators.ts`, `scripts/seed-test-season.ts` | Seeded PRNG, idempotent via `test-{entity}-{seed}-{index}` ids: products, add-ons, 50–100 customers, orders in every status, routes, subscribers. |
| MF-295 | Repeatable base seed | data/F-055 | `prisma/seed.ts` | Upsert-only: fulfillment methods, settings registry defaults, email template defaults. |

## Conflict register

Eight feature-level conflicts. None were resolved: resolving them needs a source
read, which `AGENTS.md` forbids for this arm after Test 1a. A build or plan phase
should settle each one against the source before relying on either claim.

| # | Row | Slice A claim | Slice B claim | Shared evidence |
|---|---|---|---|---|
| CF-01 | MF-181 | product/F-048: **five** collapsible sidebar groups (Sales, Products, Packing & delivery, Settings, Developer) | ui/F-049: **six** groups (adds Reports); notes the file's own header comment still says five | `src/components/admin/sidebar-config.ts` |
| CF-02 | MF-052 | product/F-107 + sec/F-SEC-010: **six** roles including `customer`, ranked in `permissions.ts` | data/F-007: `StaffRole` enum lists **five** (developer, admin, manager, clerk, messenger) | `src/config/permissions.ts:16` vs `prisma/schema.prisma` (`StaffRole`) |
| CF-03 | MF-043 | sec/F-SEC-002: `src/integrations/clerk.ts` is the **only** file allowed to import `@clerk/*` | int/F-001: server components/pages **still import** `@clerk/nextjs` UI directly | `src/integrations/clerk.ts`, `src/app/layout.tsx`, `src/components/storefront/user-menu.tsx` |
| CF-04 | MF-087 | sec/F-SEC-041: one wrapper for **every** public route | int/F-069 (and sec's own G-04): **not** used by `addresses/validate`, `setup`, `impersonate` | `src/server/withPublicGuard.ts` |
| CF-05 | MF-152 | product/F-033 cites the shared `src/integrations/stripe.ts` as evidence for the card-payment path | int/F-021: **four** separate Stripe client constructions; only `runReconciliation` uses `getStripe()`; no pinned `apiVersion` | `src/integrations/stripe.ts`, `src/app/api/checkout/route.ts:26` |
| CF-06 | MF-022 | ui/F-112: Lighthouse CI thresholds for the storefront (implies enforced) | int/F-077: `lighthouserc.json` exists but **no workflow or npm script invokes it** | `lighthouserc.json` |
| CF-07 | MF-201 | product/F-062 tab order: campaigns, subscribers, lists, templates, triggered | ui/F-069 tab order: Campaigns, Triggered, Lists, Subscribers, Templates | `src/app/(admin)/admin/email/email-tabs.tsx` |
| CF-08 | MF-132 | product/F-028: checks a **5-digit** ZIP | int/F-045: checks a **5(+4) digit** ZIP | `src/app/api/addresses/validate/route.ts` |

### Proof-of-read discrepancies (not features)

Recorded because they change how much of the source each slice actually saw.
They do not count toward the feature or conflict totals above.

| # | Disagreement | Slices |
|---|---|---|
| PR-01 | API route file count: **24** vs **29** | security ("all 24 route files reviewed or classified") vs integrations ("all 29 route files listed") |
| PR-02 | Source size: **216 files under `src/`** vs **571 paths under `src/`** | ui vs security (may be files-only vs files+directories, unresolved) |
| PR-03 | Rules files read: **6** vs **5** — whether `grill-protocol.mdc` applies to this arm | product + security counted it; data says it is not in `ARM.md`'s rule list; ui says it is load-on-demand and does not apply to an inventory pass |

## Security gaps carried forward (observations, not features)

From the security slice, unchanged. A build arm should treat these as open
decisions rather than settled behavior.

| # | Observation | Evidence |
|---|---|---|
| G-01 | No security response headers anywhere — no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy. No `headers()` block or edge header injection. | `next.config.ts`, `vercel.json`, `src/middleware.ts` |
| G-02 | CSRF protection on public JSON routes rests entirely on `Origin`, and a **missing** `Origin` is treated as same-origin, so non-browser clients bypass it. | `src/server/withPublicGuard.ts:27` |
| G-03 | Rate limiting keys on `x-forwarded-for` / `x-real-ip` with an `"unknown"` fallback — spoofable behind an untrusted proxy, and all header-less callers share one bucket. | `src/server/withPublicGuard.ts:19` |
| G-04 | Rate limiting applies only to `withPublicGuard` routes. `POST /api/setup`, `/api/addresses/validate`, `/api/impersonate` parse bodies directly with no rate limit or origin check. | those three route files |
| G-05 | `GET /api/media/[id]` is unauthenticated and redirects to a public Blob URL; enumerating cuids exposes uploaded media. | `src/app/api/media/[id]/route.ts:17`, `media/route.ts:78` |
| G-06 | The impersonation cookie stores a raw Clerk user id and is not signed. The developer recheck on every read mitigates it; the cookie itself has no integrity. | `src/features/auth/server/impersonation.ts:38` |
| G-07 | `envOverride` cookie is set `httpOnly: false` by an unauthenticated `GET` inside the admin segment. | `src/app/(admin)/admin/env-switch/route.ts:18` |
| G-08 | `POST /api/setup` is unauthenticated by design; its only guard is `staffCount === 0`, so whoever reaches an empty deployment first becomes developer. | `src/app/api/setup/route.ts:31` |
| G-09 | One HMAC secret signs both unsubscribe and checkout tokens; the purpose string separates them, but there is no rotation or key-id mechanism. | `checkoutToken.ts:15`, `unsubscribeToken.ts:13` |
| G-10 | Checkout and unsubscribe tokens carry no expiry or revocation — a leaked checkout link grants order access indefinitely. | `src/features/checkout/server/checkoutToken.ts:24` |
| G-11 | `verifyCronSecret` compares the bearer token with `===` rather than a constant-time compare. | `src/server/verifyCronSecret.ts:14` |
| G-12 | No dependency vulnerability scanning in CI (`npm audit` / Dependabot absent). Semgrep covers code, not the dependency tree. | both workflows, `package.json` |
| G-13 | Audit coverage is manual — no evidence of audit rows on role change, permission-override save, refund, or destructive test-data wipes. | `src/features/users/server/actions.ts`, `wipe-test-data/route.ts` |
| G-14 | No automated authorization test at the HTTP layer; `e2e/smoke.spec.ts` is the only Playwright spec. | `e2e/smoke.spec.ts` |
| G-15 | `POST /api/addresses/validate` echoes arbitrary well-formed input back as "valid" with no auth; the geocode refresh route counts but does not refresh. | `addresses/validate/route.ts:38`, `route-builder/refresh-coords/route.ts:33` |

## Other observations carried forward

From the ui and integrations slices, unchanged.

- **Duplicate navigation source (ui).** `src/features/auth/nav.ts` defines a second admin nav structure (`ADMIN_NAV_SECTIONS`, `buildAdminNav`) that no component imports — the shell uses `src/components/admin/sidebar-config.ts`. Only `nav.test.ts` references it, and the copies have drifted (`sidebar-config.ts` Developer links omit the `settings.view` permission `nav.ts` requires). Related to CF-01.
- **Empty scaffold folders (ui).** `src/components/feedback/`, `src/components/forms/`, `src/components/layout/`, `src/features/.gitkeep`, `src/integrations/.gitkeep`, `src/components/ui/.gitkeep`.
- **Two product quick-view components (ui).** MF-103 and MF-121 render similar dialogs for different call sites.
- **One module per third party except Stripe (integrations).** Everything else sits behind a single `src/integrations/` module; Stripe is instantiated four times (CF-05).
- **Optional integrations degrade instead of throwing (integrations).** Shippo and Mapbox return `{ok:false}`, the map and autocomplete hide themselves; only Blob's absence would surface as a raw upload error.
- **Three idempotency mechanisms guard money and mail (integrations).** Stripe idempotency keys, unique DB constraints (`ProcessedWebhookEvent`, `SentEmail`, `Refund.stripeRefundId`), and compare-and-set claims (label purchase, campaign send).
- **Two documented stubs return success-shaped responses (integrations).** MF-132 and MF-266 do no external work; a rebuild trusting the route names alone would inherit silent no-ops.

## Blocked / not covered

- **Nothing blocked.** All five partials were readable and complete.
- **No source read in this pass.** Per this arm's `AGENTS.md`, the source codebase was not opened after Test 1a, so conflicts are surfaced rather than resolved and no evidence path was verified beyond what the partials cite.
- **No runtime verification anywhere in the chain.** Every partial states the source was read only — no install, build, dev server, or database. Behavior notes come from code and the source's own file-header comments.
- **No CodeGraph index.** All five slices report `codegraph status` = not initialized on the source, and all five deliberately skipped `codegraph init` because it would write `.codegraph/` into a read-only tree. Structure came from directory listings, targeted reads, and text search.
- **Coverage gaps none of the partials claimed:** `src/lib/*` pure helpers and `src/components/ui/*` primitives are inventoried only where a slice attached a behavior to them; build/deploy config beyond `vercel.json`, `next.config.ts`, `lighthouserc.json`, and the two workflows was not enumerated; email HTML output (`src/features/email/server/*Html*`) is described but its rendered result was never inspected.
