# P4 Security Review — arm-05 (blind)

**Phase:** P4 — Cart-first order builder, address book, customer account
**Scope:** trust boundaries, guest draft tokens, ownership anti-enumeration, IDOR, injection
**Reviewer:** Security specialist
**Findings only — no fixes.**

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 1 |
| Medium | 2 |
| Low | 4 |
| **Total** | **8** |

---

## CRITICAL

### C1 — `readDraft` ownership filter collapses to no filter when caller is neither authenticated nor carrying a guest token

**Location:** `lib/order-builder.ts:142-161` (`readDraft`), consumed by `app/api/order/drafts/[draftId]/route.ts:8-13` (GET) and `lib/order-builder.ts:218-313` (`saveDraft`, PUT).

**Claim:** Any caller who supplies only a `draftId` (no Clerk session, no `x-draft-access-token`) can read and overwrite any DRAFT order, including other customers' drafts and their recipient PII.

**Evidence:** The `where` clause is built with a dynamic `OR`:

```ts
OR: [
  ...(customer ? [{ customerId: customer.customerId }] : []),
  ...(guestToken ? [{ guestAccessTokenHash: tokenHash(guestToken), guestAccessExpiresAt: { gt: new Date() } }] : []),
],
```

When `findCustomerForRequest` returns `null` (unauthenticated) and the `x-draft-access-token` header is absent, the array is empty. Prisma treats an empty `OR: []` as a no-op (not as `FALSE`), so the effective query becomes `WHERE id = ? AND status = 'DRAFT'`. The `id` column is a CUID — not a cryptographically unguessable identifier (timestamp + counter + fingerprint) — so draft IDs are enumerable. The GET route returns `serializeDraft(draft)`, which includes `addresses` (recipient names, street lines, city, state, ZIP) and `lines`. The PUT route then mutates that draft via `saveDraft`. This is a direct IDOR across the customer trust boundary and the guest-token trust boundary. The smoke note "a request without the guest access token could not read the guest draft" (S2) does not exercise the unauthenticated-with-no-token path against an authenticated customer's draft.

---

## HIGH

### H1 — `orders.read` (a read permission) authorizes writes to any customer's address

**Location:** `app/api/addresses/[addressId]/route.ts:11-39`; permission catalog `lib/permissions.ts:1-16`.

**Claim:** A staff member whose only grant is `orders.read` can mutate any address in the system, including addresses belonging to customers they have no operational relationship with.

**Evidence:**

```ts
const isOwner = customer?.customerId === address.customerId;
const staff = isOwner ? null : await authorize(request, "orders.read");
if (!isOwner && !staff?.ok) { ... }
```

`authorize(request, "orders.read")` gates the PATCH, and `updateCustomerAddress` then performs `prisma.address.update` and writes an audit event. A read-scoped permission is being used to authorize a write. The role table confirms `STAFF` carries only `orders.read` — so a default Staff user can edit any customer's address book. The address lookup `prisma.address.findUnique({ where: { id: addressId } })` is also unscoped (no `customerId` filter at fetch time), so any valid `addressId` in the system is reachable by any `orders.read` holder.

---

## MEDIUM

### M1 — Email-based account linking can attach a new Clerk identity to an existing Customer without re-verification

**Location:** `lib/order-builder.ts:91-115` (`findCustomerForRequest`).

**Claim:** A Clerk user whose primary email matches a victim's `emailNormalized` is silently linked to the victim's existing `Customer` row, inheriting the victim's address book and order history.

**Evidence:**

```ts
const existingCustomer = email
  ? await prisma.customer.findUnique({ where: { emailNormalized: email } })
  : null;
const customer = existingCustomer ?? await prisma.customer.create({ ... });
await prisma.customerIdentity.upsert({
  where: { clerkUserId: authentication.userId },
  create: { clerkUserId: authentication.userId, email: ..., customerId: customer.id },
  update: { ... customerId: customer.id },
});
```

Linking is keyed on `emailNormalized` alone; there is no check that the Clerk email is verified, no challenge, and no audit event for the identity-to-customer binding. Severity is conditional on Clerk's email-verification policy for this instance; if unverified primary emails are permitted, this is an account-takeover primitive.

### M2 — Guest draft access token lifetime is 30 days

**Location:** `lib/order-builder.ts:135` (`createDraft`).

**Claim:** A leaked guest draft token keeps recipient PII readable for 30 days.

**Evidence:**

```ts
guestAccessExpiresAt: guestToken ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) : null,
```

The token is 32 random bytes (good entropy) and stored only as a SHA-256 hash (good), but the 30-day window is far longer than a checkout session. Guest tokens are passed in `sessionStorage` and the `x-draft-access-token` header; any leak (shared device, screenshot, referrer/header logging) leaves the draft's recipient data exposed for the full window. The plan's R-022/R-123 framing implies a short-lived checkout-scoped token, not a month-long credential.

---

## LOW

### L1 — Address existence enumeration via status-code divergence

**Location:** `app/api/addresses/[addressId]/route.ts:16-24`.

**Claim:** An unauthenticated or non-owner caller can distinguish "address exists" from "address does not exist" by status code.

**Evidence:** `findUnique` returns 404 when the address is absent; ownership failure returns 401 (unauthenticated) or 403 (authenticated non-owner). CUIDs are hard to guess, but the divergent status codes are an oracle. Returning a uniform 404 for both "not found" and "not authorized" would close it.

### L2 — Staff address-edit audit event omits before/after values

**Location:** `lib/order-builder.ts:348-357` (`updateCustomerAddress`).

**Claim:** The `customer.address_updated` audit trail cannot reconstruct what a staff member changed.

**Evidence:**

```ts
details: { customerId, normalizedAddress },
```

Only the new normalized address is recorded; prior field values (line1, city, recipientName, etc.) are not captured. Per UR-014/G-019 staff edits must be audited; the current record proves an edit happened but not what was altered, which weakens forensic review of staff-driven address mutations.

### L3 — No rate limiting on unauthenticated draft creation

**Location:** `app/api/order/drafts/route.ts:6-25` (POST).

**Claim:** A bot can create unbounded guest drafts (and guest `Customer` rows) without throttling.

**Evidence:** POST `/api/order/drafts` performs no auth, no IP rate limit, and each call inserts a `Customer` + `Order`. R-122 (IP rate limit, public endpoint guards) is allocated to P5, but P4 introduces the unauthenticated surface; until P5 lands there is no abuse control on this endpoint.

### L4 — Missing same-origin guard on read endpoints that return PII

**Location:** `app/api/order/drafts/[draftId]/route.ts:8-13` (GET), `app/api/account/route.ts:4-8` (GET).

**Claim:** Read endpoints returning draft and account PII do not call `hasSameOrigin`.

**Evidence:** Only POST/PUT routes call `hasSameOrigin(request)`. The GET routes rely on Clerk's SameSite=Lax cookies for CSRF protection on reads. This is defense-in-depth only — SameSite mitigates cross-site credentialed reads — but the inconsistency is a gap worth closing, especially for GET `/api/order/drafts/[draftId]` where the access token is a custom header (CORS preflight would block cross-site inclusion of the header, but a credentialed same-origin XSS path is unchanged).

---

## Notes / out of scope

- `maskError` (lib/foundation.ts:26-29) redacts error text in production — good.
- Guest token hashing uses SHA-256 (lib/order-builder.ts:61-63) — acceptable; the underlying concern is the empty-OR collapse (C1), not the hash.
- Dev-auth (lib/dev-auth.ts) is gated on `NODE_ENV === "development"` + `DEV_AUTH_MODE === "true"` + secret presence, with HMAC + `timingSafeEqual` — acceptable for dev; out of scope for P4 security posture in production.
- Stock validation in `saveDraft` (lib/order-builder.ts:236-238) runs outside the transaction; that is a correctness/race concern, not a P4 trust-boundary issue.
