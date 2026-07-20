# P4 Security Review — arm-01

**Reviewer specialist:** Security
**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-01` (blind)
**Tree / phase:** `arms/arm-01/workspace/` — P4 (Cart-first order builder, address book, customer account, guest draft access)
**Scope:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes. No scope beyond P4.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 2 |
| Low | 5 |
| Informational | 2 |
| **Total** | **9** |

Draft ownership is enforced cleanly through `findAccessibleDraft` (`src/lib/customer-access.ts:41-59`): authenticated callers are scoped by `customerId`, guests by a SHA-256-hashed, expiring `draft_access_token` cookie, and both paths return a uniform 404 on miss — anti-enumeration is solid. Address mutations scope every write by `customerId` (or a token-validated draft), so no IDOR was found on the customer address-book or draft endpoints. Staff address edits are permission-gated (`settings:manage`) and audit-logged with the impersonator recorded (UR-014 / G-019 satisfied). The findings cluster around (a) a non-atomic inventory availability check that allows concurrent oversell, (b) an unauthenticated, un-deduped guest-draft creation endpoint that doubles as a DB-pollution / availability abuse vector, and (c) lower-severity token-handling and integrity gaps in the new builder flow.

---

## Medium

### M1 — Inventory availability check is non-atomic (TOCTOU) in draft PATCH
**File:** `src/app/api/order/drafts/[draftId]/route.ts:74-140`

`PATCH /api/order/drafts/[draftId]` reads each product's `inventoryItem.onHand - reserved` **outside** the transaction (`products` query at lines 75-84), validates `line.quantity <= availableQuantity` in plain JS (lines 103-108, 120-125), then opens `db.$transaction` and writes order lines without re-checking stock or reserving anything inside the transaction (lines 141-180). Two concurrent PATCH calls on two drafts can both observe the same `availableQuantity` and both succeed, committing demand beyond on-hand stock. The P4 EXPECTED requires "inventory-aware live stock in builder"; the live read is correct but the save path is racy. Business-logic / integrity issue, not a classic auth/IDOR bug, but it crosses the trust boundary that the inventory check is meant to enforce.

### M2 — Unauthenticated guest draft creation with no rate limiting or dedup
**File:** `src/app/api/order/drafts/route.ts:11-60`

`POST /api/order/drafts` is fully public (no auth, no Clerk session required) and, for guests, creates a brand-new `Customer` row plus an `Order` row on every call (lines 27-45). There is no dedup by `email`/`emailNormalized`, no per-IP or per-token rate limit, and no proof-of-work / captcha. A script can hammer the endpoint and grow the `Customer` and `Order` tables unboundedly, and each call also mints a 30-day guest access token. The endpoint must exist for guest checkout, so the finding is the missing abuse controls, not the endpoint itself.

---

## Low

### L1 — Guest draft access token returned in response body and accepted via Bearer header
**File:** `src/app/api/order/drafts/route.ts:46-58`; `src/lib/customer-access.ts:19-30`

The 30-day guest bearer is set as an `httpOnly`, `sameSite=lax`, prod-`secure` cookie (good), but the same token is also returned in the JSON body (`accessToken`, line 47) **and** `getDraftAccessToken` additionally accepts it from an `Authorization: Bearer` header (lines 20-23). The body copy exposes the token to any JS that can read the response, and the Bearer path means a leaked body/log copy is sufficient to exercise the capability, broadening the disclosure surface beyond the httpOnly cookie.

### L2 — Guest draft customer accepts arbitrary caller-supplied email with no verification
**File:** `src/app/api/order/drafts/route.ts:18-34`; `src/lib/normalize.ts:1-3`

A guest supplies `displayName` and `email` in the request body and they are persisted verbatim (normalized) onto a new `Customer` row. There is no email-ownership verification and no rate limit. A caller can register draft customer records under a victim's email (`emailNormalized` populated), polluting the customer table with arbitrary PII. No account takeover was found — `getAuthenticatedCustomer` joins on `clerkUserId`, not email — so impact is data pollution rather than privilege escalation.

### L3 — `recipientSource` not cross-validated against `recipientAddressId` / on-order membership
**File:** `src/app/api/order/drafts/[draftId]/route.ts:61-133`

The PATCH validates that `recipientSource` is a member of `RecipientAssignmentSource` (lines 67-69) and that `recipientAddressId` belongs to the draft's `customerId` (lines 86-96, 128-133), but it never checks that the address is actually consistent with the chosen source — e.g., a line labeled `ON_ORDER` may point at any own address-book entry, and `ADDRESS_BOOK` may reference an address already assigned elsewhere on the order. The three-way picker's integrity constraint is not enforced server-side; only "owned by this customer" is.

### L4 — Guest token-clear endpoint is gated on `status: "DRAFT"`, unreachable after finalization
**File:** `src/app/api/order/drafts/[draftId]/success/route.ts:10-18`; `src/lib/customer-access.ts:41-59`

`POST .../success` clears `guestAccessTokenHash` / `guestAccessExpiresAt` and expires the cookie, but it locates the draft via `findAccessibleDraft`, which requires `status: "DRAFT"`. Once an order is finalized (FINALIZED), the endpoint returns 404, so the explicit clear cannot run in the intended post-success flow. In practice the token is dead anyway (FINALIZED drafts also 404 from `findAccessibleDraft`), so the residual risk is limited to the 30-day cookie persisting on the client with no server-side revocation path.

### L5 — Residual test-auth `__local_manager__` shortcut and spoofable host gate
**File:** `src/lib/auth.ts:23-57`, `src/lib/auth.ts:59-71`

The P3 test-auth header is now HMAC-signed (`TEST_AUTH_SECRET`, 5-minute expiry, `timingSafeEqual`), which mitigates the prior H1. Two residuals remain: (1) `getCurrentStaffUser` still maps `clerkUserId === "__local_manager__"` to "first active MANAGER" (lines 65-71), granting a full manager identity without a real Clerk session; and (2) the test-auth gate still trusts the client-sent `Host` header (`127.0.0.1`/`localhost`) and a single env boolean. The `.env` in this run does not set `TEST_AUTH_SECRET`, so the path currently throws rather than authenticates — but if a deployment sets the secret and `ENABLE_TEST_AUTH=true` with `NODE_ENV != production`, any holder of the secret can forge `__local_manager__`. Downgraded from P3 High to Low due to the signing.

---

## Informational

### I1 — Saving a draft does not reserve inventory
**File:** `src/app/api/order/drafts/[draftId]/route.ts:141-180`

`PATCH .../drafts/[draftId]` updates `subtotalCents`/`totalCents`/`version` and rewrites order lines but performs no write to `inventoryItem.reserved`. "Inventory-aware live stock in builder" is therefore display-only at save time. Design choice for P4 (capture is P5), not a vulnerability; flagged because it pairs with M1 to enable oversell.

### I2 — Impersonation cookie-clear omits attributes present on set
**File:** `src/app/api/admin/impersonation/route.ts:97-100`

`DELETE /api/admin/impersonation` clears the cookie with only `path: "/"` and `maxAge: 0`, omitting the `httpOnly`, `secure`, and `sameSite` attributes used when setting it (lines 51-57). Some browsers scope cookie deletion by attribute set, so the clear can be unreliable. Minor hygiene; the DB session is also left with `endedAt: null` if the cookie fails to clear, though `getCurrentStaffUser` re-validates against the actor.

---

## Out of scope (noted, not scored)

- Payment capture, Stripe checkout, and fulfillment commitment are P5+ and were not reviewed.
- `finalizeOrder` / `discardDraft` in `src/domain/order-engine.ts` use optimistic `updateMany` with status guards and serializable isolation on finalization; no P4-facing endpoint invokes finalization, so the concurrency path is not exercised this phase.
- No secrets were found in committed files; `.env` is gitignored at both workspace (`arms/arm-01/workspace/.gitignore:34`) and repo root (`.gitignore:6,12-14`).
