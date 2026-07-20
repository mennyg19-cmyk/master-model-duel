# P4 Security Review — arm-02 (blind)

**Phase:** P4 — Cart-first order builder, address book, customer account, guest draft tokens.
**Scope:** `arms/arm-02/workspace/` — files touched by P4 (draft API, account/auth APIs, address book, builder, autocomplete, middleware, auth libs).
**Method:** Findings only, no fixes. Trust boundaries, auth, secrets, IDOR, injection.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 3 |
| Informational | 2 |
| **Total** | **8** |

## Findings

### H1 — Account takeover via phone collision at registration
**File:** `app/api/account/register/route.ts` (L31–43) + `lib/customers.ts` `findOrLinkCustomer` (L32–48).

`register` calls `findOrLinkCustomer({ email, name, phone })`, which matches an existing `Customer` by `email` **or** `phoneNormalized`. When a customer row exists with a `phoneNormalized` but no `passwordHash` (any staff/admin-created customer, or any seeded customer with a phone), the caller supplies the phone and the lookup returns that row; `register` then **sets the password and overwrites `name`** on it and issues a session for the attacker. The attacker now owns the victim's `Customer` record — including its `CustomerAddress` book, `OrderDraft`s, and `Order`s — without ever proving ownership of the phone number or the original email. Phone "linking" must not grant password-setting to an unverified caller. Precondition: a passwordless customer with a phone exists (created by admin/staff/seed); the code path is live in P4 regardless.

### M1 — Account enumeration via registration response
**File:** `app/api/account/register/route.ts` L36–38.

When `findOrLinkCustomer` returns a customer that already has `passwordHash`, the endpoint returns `409 "An account with this email already exists. Sign in instead."`. Login (L38–41) is careful to return one identical message for every failure kind; register is not — it directly confirms which emails are registered. An attacker can probe arbitrary emails to map the customer base.

### M2 — Rate-limit bypass via spoofable `X-Forwarded-For`
**File:** `lib/rate-limit.ts` `clientIp` (L21–23).

`clientIp` reads `request.headers.get("x-forwarded-for")?.split(",")[0]` with no trusted-proxy check. Any client can set the `X-Forwarded-For` header to a fresh random value per request and get a brand-new rate-limit key, defeating every IP-scoped limiter: `customer-login:ip`, `register:ip`, `autocomplete:ip`, `draft-save:ip`. The per-email login limiter (10/15min) still throttles per-account password brute force, but IP-only limits (registration spam, autocomplete hammering, draft-write flooding) are fully bypassable.

### L1 — Guest draft cookie survives sign-in and reappears after sign-out
**File:** `lib/order-builder/draft-store.ts` (GUEST_DRAFT_COOKIE, `saveDraft` L71–80, `discardDraft` L89–92) + `app/api/account/login/route.ts` / `register/route.ts`.

Login and register call `createCustomerSession` but never clear `tomchei_guest_draft`. After sign-in, `resolveDraftOwner` prefers the customer, so the guest draft is hidden; after sign-out (`destroyCustomerSession` only deletes the customer cookie), the still-present guest cookie re-attaches the prior guest draft. On a shared device this leaks the previous guest's in-progress order (recipient names, addresses, cart) to the next user. The guest cookie is `httpOnly` so it isn't directly readable by JS, but the draft API surfaces its contents.

### L2 — `OrderDraft` has no uniqueness guard on (customerId, seasonId, ACTIVE)
**File:** `lib/order-builder/draft-store.ts` `saveDraft` (L54–82) + `prisma/schema.prisma` `OrderDraft` (L604–617).

`saveDraft` does `findActiveDraft` then `create` if none — a classic TOCTOU. Two concurrent PUTs from two browsers on the same customer+season can create two `ACTIVE` drafts (no `@@unique` on `(customerId, seasonId, status)`). Both belong to the same customer (no cross-user leak), but the orphaned `ACTIVE` row lingers and `findActiveDraft`'s `orderBy: updatedAt desc` silently picks one. Data-integrity / confusion rather than privilege.

### L3 — No rate limit on auth-gated account mutations
**Files:** `app/api/account/profile/route.ts`, `app/api/account/addresses/route.ts`, `app/api/account/addresses/[id]/route.ts`, `app/api/account/logout/route.ts`, `app/api/admin/customers/[id]/addresses/[addressId]/route.ts`.

None of these call `rateLimit`. A signed-in customer (or a staff member with `customers.manage`) can hammer profile/address/staff-edit endpoints without throttling. Impact is bounded to the caller's own data for the customer routes, so low; the staff route is audited per call but unthrottled, enabling audit-log flooding.

### I1 — In-memory rate limiter is per-process only
**File:** `lib/rate-limit.ts` (L1–19). Documented as a known dev limitation. Under any multi-instance deploy the per-IP/per-email limits reset per node, so effective thresholds multiply by instance count. Informational for the single-node dev target; flag for any scale-out.

### I2 — `requirePermissionApi` 403 body echoes the internal permission name
**File:** `lib/auth/current-user.ts` L67–73. The 403 body is `Missing permission: ${permission}`, exposing internal permission slugs (`customers.manage`, `staff.impersonate`, …) to any authenticated caller. Minor info disclosure; not exploitable on its own.

## Out of scope / explicitly cleared

- **IDOR on addresses/orders:** `findOwnAddress` returns identical 404 for foreign and missing ids (L9–17); `AccountOrderDetailPage` 404s on `order.customerId !== customer.id` (L27); `applyAssignmentRules` drops foreign `addressBook` assignments to null (L94–97). No IDOR found.
- **Client-trusted pricing:** `priceCart` re-derives every price server-side from DB (L65–182); client `Cart` amounts are never trusted.
- **Session token storage:** customer and staff sessions store only HMAC-SHA256(`SESSION_SECRET`, token); a DB dump is not replayable as a cookie. `verifyPassword` uses `scryptSync` + `timingSafeEqual`. Good.
- **CSRF on JSON routes:** all state-changing routes parse `request.json()` with `Content-Type: application/json` (non-simple request → CORS preflight fails, no CORS headers set), so cross-site form CSRF is not feasible; SameSite=lax on the cookies is additional mitigation.
- **SQL injection:** all queries go through Prisma; no `$queryRaw`/string interpolation in P4 files.
