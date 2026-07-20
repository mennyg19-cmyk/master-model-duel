# P2 Security Review — arm-02 (blind)

**Phase:** P2 — Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine
**Scope reviewed:** `prisma/schema.prisma`, `prisma/migrations/20260720180500_p2_domain_core/migration.sql`, `prisma/seed.ts`, `lib/auth/*`, `lib/env.ts`, `lib/db.ts`, `lib/audit.ts`, `lib/rate-limit.ts`, `lib/customers.ts`, `lib/domain/*`, `middleware.ts`, `instrumentation.ts`, `next.config.ts`, `app/api/**`, `app/(admin)/**`, `app/login/**`, `app/setup/**`, `.env`, `.env.example`, `.gitignore`
**Method:** Findings only — no fixes. No new scope beyond P2.
**Reviewer family:** Security specialist (blind to model name).

## Summary

P2 lands the domain schema plus a working dev-mode auth/identity surface (sessions, impersonation, staff management, audit). The strong points are HMAC-signed session tokens, scrypt password hashing, parameterized raw SQL, conditional `updateMany` concurrency guards, and atomic audit-in-transaction for most mutating routes. The main gaps are a login timing side-channel, an unconditionally trusted `x-forwarded-for` that defeats the rate limiter, a non-atomic impersonation audit, missing DB-level CHECK constraints on monetary columns, and a weak `SESSION_SECRET` policy with a real dev secret shipped in the archive tree.

## Findings

### S1 — Medium — Login timing side-channel enables staff email enumeration

**Location:** `app/api/auth/login/route.ts` lines 44–50; `lib/auth/passwords.ts` lines 10–16

The endpoint returns a single unified `Invalid email or password` message for all failure kinds, but the password check short-circuits on a missing user: `staffUser?.passwordHash && verifyPassword(...)`. When the email does not exist, `verifyPassword` (scrypt, deliberately slow) never runs, so the non-existent-user response is dramatically faster than the existing-user-with-wrong-password response. Despite the unified message, an attacker can enumerate valid staff emails by timing. Run a dummy scrypt over a fixed salt on the missing-user path to equalize timing before returning the unified error.

### S2 — Medium — `x-forwarded-for` trusted unconditionally; rate limits bypassable by header spoofing

**Location:** `lib/rate-limit.ts` lines 21–23; used by `app/api/auth/login/route.ts` line 28 and `app/api/client-error/route.ts` line 18

`clientIp` returns the first `x-forwarded-for` value with no trusted-proxy validation. Any client can set this header to a fresh value per request and evade the per-IP login throttle (20 attempts / 15 min) and the client-error throttle entirely. Combined with the in-memory per-process limiter (S4), the brute-force protection on the password login is effectively bypassable. Tie `x-forwarded-for` trust to a configured trusted proxy / hop count, or fall back to the socket peer when no trusted proxy is configured.

### S3 — Medium — Impersonation audit is not atomic with the session mutation; no step-up re-auth

**Location:** `app/api/impersonate/route.ts` lines 27–34 (POST), 42–48 (DELETE); `lib/auth/session.ts` lines 55–57

POST does `await setImpersonation(...)` then a separate `await writeAudit(gate.staff, ...)` with no surrounding transaction (unlike `staff/[id]` PATCH and `staff/[id]/overrides` PUT, which wrap mutation + audit in `db.$transaction`). If the audit write fails, impersonation is active with no audit record — violating the "no audited action without its audit entry" guarantee the rest of the codebase enforces. The same gap exists in DELETE. Separately, impersonation requires only the `staff.impersonate` permission (held by every MANAGER) with no step-up re-authentication, and it persists for the full 12-hour session TTL. A hijacked manager session can impersonate any active staff member undetected until the session expires. Wrap both operations in a transaction and consider step-up auth + a shorter impersonation TTL.

### S4 — Low — In-memory rate limiter is per-process only

**Location:** `lib/rate-limit.ts` lines 1–19 (comment acknowledges this)

The fixed-window limiter lives in a process-local `Map`. Under any multi-instance deploy, per-IP and per-account limits reset per node, so an attacker distributing requests across N nodes gets N× the configured limit. The plan defers a shared store, but flag now so production does not ship with the in-memory limiter as the only brute-force control (compounds with S2).

### S5 — Low — `SESSION_SECRET` policy is weak and a real dev secret ships in the archive tree

**Location:** `lib/env.ts` lines 7–9; `arms/arm-02/workspace/.env` line 3; `.gitignore` lines 33–45

`env.ts` enforces only `min(16)` characters for the secret that HMAC-signs every session token. Sixteen characters is well below modern guidance and there is no entropy or rotation requirement. Separately, the workspace `.env` contains a real value (`SESSION_SECRET=dev-only-secret-not-for-production-1748`). `.gitignore` excludes `.env*`, so it will not be committed, but the file is present in the run archive tree; if the archive is shared/zipped outside git the secret leaks and every HMAC-signed session token can be forged offline. Raise the minimum length / require high entropy and ensure the dev secret is treated as disposable on any sharing.

### S6 — Low — Staff page loads `passwordHash` into server memory unnecessarily

**Location:** `app/(admin)/admin/staff/page.tsx` lines 7–10

The server component runs `db.staffUser.findMany({ include: { permissionOverrides: true } })` without `omit: { passwordHash: true }`, unlike `GET /api/staff` which omits the hash. The hash is not sent to the client (only `id/name/email/role/status/overrides` are mapped into the component props), but it is loaded into server memory on every page render. Match the API route's hygiene and omit the hash at the query layer.

### S7 — Low — No DB-level CHECK constraints on monetary / quantity / counter columns

**Location:** `prisma/migrations/20260720180500_p2_domain_core/migration.sql` (table definitions); only CHECK added is `InventoryItem_target_xor` (line 511)

The migration creates all P2 tables but adds no `>= 0` / `> 0` CHECK constraints on: `Order.totalCents`, `OrderLine.quantity`, `OrderLine.unitPriceCents`, `OrderLineOption.priceAdjustmentCents`, `OrderLineAddOn.quantity`, `OrderLineAddOn.unitPriceCents`, `Payment.amountCents`, `StripePaymentIntent.amountCents`, `ShippingQuoteOption.amountCents`, `Season.orderCounter`, `InventoryItem.quantityOnHand`, `InventoryItem.reserved`. Negative amounts are persistable at the DB layer; a negative `Payment.amountCents` is a fraud surface (a posted "payment" that reduces a balance), and a negative `Order.totalCents` breaks downstream money math. Defense-in-depth — enforce non-negativity at the DB layer, not only in application code that may not yet exist.

### S8 — Low — `Payment` has no optimistic versioning or state-transition guard

**Location:** `prisma/schema.prisma` lines 382–392; migration lines 212–223

`Payment` carries a `PaymentState` enum (POSTED/VOIDED) but no `version` column and no DB-level guard against double-void or re-post. Concurrent staff actions (post + void, or two voids) can both succeed, with the second overwriting `voidedAt` and producing duplicate audit rows. The plan defers payment lifecycle logic to a later phase, but the schema landed in P2 without a `version` column; adding one now would let that phase enforce single-winner transitions the same way `Package` and `InventoryItem` do.

### S9 — Informational — Public endpoints disclose auth state

**Location:** `app/api/setup/route.ts` lines 13–16; `app/api/health/route.ts` lines 4–18

`GET /api/setup` returns `{ locked: staffCount > 0 }` and `GET /api/health` returns `authMode` (dev/clerk). Both are unauthenticated. An attacker learns whether first-run bootstrap is still open (targeting the setup endpoint) and which auth backend the deployment uses (targeting surface). Low impact, but consider hiding `authMode` behind an authenticated route or dropping it from the public health payload.

### S10 — Informational — Dev middleware gate is cookie-presence only and excludes `/api/*`

**Location:** `middleware.ts` lines 6–22

In dev mode the edge gate only checks that the `tomchei_session` cookie exists (any value, no DB validation), and the matcher covers only `/admin/:path*` and `/driver/:path*` — not `/api/*`. This is acceptable because every mutating API route calls `requirePermissionApi` (DB-backed), and admin pages re-validate via `requirePermissionPage`. But the edge gate provides no real protection on its own; a future API route that forgets the gate is unprotected at the edge. Defense-in-depth: consider validating the session at the edge or extending the matcher to `/api/*`.

### S11 — Informational — `findOrLinkCustomer` links by email/phone without verifying identity ownership

**Location:** `lib/customers.ts` lines 16–59

In dev mode (no `authUserId`), `findOrLinkCustomer` matches an existing customer by email, then by normalized phone, and links the new identity into the existing record. This is the intended dedupe for staff-created phone orders, but there is no verification step. When customer auth lands in a later phase, a user who controls an email or phone that was previously used by staff for a phone-order customer would inherit that customer's order history. Flag for the customer-auth phase to require email/phone verification before linking, and to refuse silent linking when the incoming identity is a self-signup vs. a staff-created record.

## Positive observations (no action)

- Session tokens are HMAC-signed with `SESSION_SECRET` (not a plain hash), so a leaked `Session` table alone cannot forge lookups, and rotating the secret revokes all sessions (`lib/auth/session.ts` lines 11–13).
- Session cookies are `httpOnly`, `sameSite: "lax"`, and `secure` in production (`lib/auth/session.ts` lines 25–31).
- Passwords use scrypt with a random 16-byte salt and `timingSafeEqual` on verification (`lib/auth/passwords.ts`).
- Raw SQL in `reserveInventory`, `releaseReservation`, and `claimNextOrderNumber` uses Prisma tagged templates — `${quantity}` / `${inventoryItemId}` / `${seasonId}` are parameterized; no string interpolation, no injection vector.
- `InventoryItem_target_xor` CHECK constraint enforces exactly-one-of `productId`/`addOnId` at the DB layer (migration line 511).
- `finalizeOrder` and `discardOrder` use conditional `updateMany` with `count` assertions so two concurrent finalizations of the same order cannot both succeed (`lib/domain/finalize.ts` lines 23–29, 40–46).
- `claimNextOrderNumber` takes a row lock on the season via a single atomic `UPDATE ... RETURNING`, so concurrent finalizations queue and each get a distinct number (`lib/domain/order-numbers.ts`).
- Audit rows commit in the same transaction as the mutation in `setup`, `staff` POST, `staff/[id]` PATCH, and `staff/[id]/overrides` PUT.
- Role / status / permission-override changes delete the target's live sessions so the old privilege set cannot outlive the change.
- Self-edit guards prevent a user from changing their own role/status/overrides (`staff/[id]` PATCH line 16, overrides PUT line 22).
- `client-error` route strips control characters (incl. CR/LF) to defend against log forging and is volume-bounded per IP (`app/api/client-error/route.ts` lines 11–13).
- `health` route keeps raw Prisma/Postgres error detail server-side and returns a generic 503 (`app/api/health/route.ts` lines 13–18).
- Login `?next=` is constrained to same-site relative paths to prevent open redirect (`app/login/page.tsx` line 35).
- `Order.draftReference` is generated from 8 random bytes over a 32-char unambiguous alphabet (~64 bits of entropy), so it is not enumerable like a sequential reference.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 5 |
| Informational | 3 |
| **Total** | **11** |
