# P4 Security Review — arm-03 (Storefront)

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Phase: P4 (cart-first order builder, address book, customer account, guest drafts)
Scope: `arms/arm-03/workspace/src` — draft APIs, address-book APIs, account APIs, auth, middleware.
Focus: draft ownership, guest tokens, IDOR on address book / orders, anti-enumeration.
Findings only — no fixes applied.

## Severity counts

```
Critical: 0
High:     1
Medium:   4
Low:      4
Info:     2
```

## What is correctly enforced (context)

- Draft load path (`loadDraftForAccess`, `src/lib/orders/draft-access.ts:44-107`) returns a uniform `404 "Draft not found"` for missing, discarded, wrong-customer, cleared-guest, and bad-token cases — no body oracle across customer / guest / staff principals.
- Order detail page (`src/app/(storefront)/account/orders/[id]/page.tsx:22-29`) scopes by `customerId` via `findFirst` and `notFound()` on miss — no IDOR on order detail.
- `GET /api/account` and `PATCH /api/account/profile` resolve the customer from the session and scope reads/writes to that `customerId` — profile ownership is enforced.
- `assignDraftLine` `address_book` / `on_order` modes scope `savedAddress` lookups by `customerId` (`src/lib/orders/drafts.ts:342-353, 357-363`) — a guest cannot reference another customer's saved address (rejected with "Saved address not found." regardless of existence).
- Staff address edit (`src/app/api/admin/addresses/[id]/route.ts`) requires `admin.access`, edits via `bypassOwnership`, and writes an `ADDRESS_STAFF_EDITED` audit entry with `actorStaffId` (UR-014 / G-019 satisfied for the address book).
- Guest token hash uses `sha256(secret:version:token)` with `timingSafeEqual` on byte-equal-length buffers (`src/lib/orders/guest-token.ts:13-33`); secret throws if unset (no public-constant fallback, unlike the P3 newsletter secret).

## Findings

### H1 — Customer account takeover via unverified-email linking
`src/lib/customers.ts:22-37` (called from `resolveCustomerId` → `src/lib/orders/draft-access.ts:16-30` and `src/app/api/customer/link/route.ts:19-24`). `linkOrCreateCustomer` links a Clerk identity to an existing `Customer` row purely on email match, and `getAuthIdentity` (`src/lib/auth.ts:55-67`) reads `primaryEmailAddress.emailAddress` without checking `verificationStatus`. If Clerk email verification is not enforced for a sign-in method (e.g., an OAuth provider that skips verification, or a tenant where verification is optional), an attacker who controls an unverified email that matches a victim's existing customer record inherits that customer's `id`, order history, drafts, and saved address book on first request — no further interaction needed. The staff-collision guard (`src/lib/customers.ts:40-48`) only blocks emails already on a `StaffUser`; it does not gate customer-to-customer linking on verification. Require `primaryEmailAddress.verification.status === "verified"` before linking by email; otherwise create a fresh customer or require a verification step.

### M1 — Guest draft token returned in the response body and cookie is not `httpOnly` / not `secure`
`src/app/api/drafts/route.ts:88-95, 111-119` and `src/lib/orders/drafts.ts:178-181`. `getOrCreateActiveDraft` returns the raw `guestAccessToken` inside the serialized draft JSON (`serializeDraft(..., { guestAccessToken })`), and the `GUEST_DRAFT_COOKIE` is set with `httpOnly: false`, no `secure`, `sameSite: "lax"`. The storefront client (`src/components/order/builder-shell.tsx:63-75`) never reads the token from the body — it relies on the browser sending the cookie automatically — so returning the raw token in the JSON is unnecessary. Consequences: (a) any XSS on the storefront origin can read `document.cookie` (httpOnly is false) and exfiltrate the token, then mutate/take over the draft via the `x-guest-draft-token` header path; (b) the raw token in the response body can be captured by proxies, browser extensions, or client-side error reporters; (c) without `secure`, the cookie is emitted over HTTP on a downgrade. Set the cookie `httpOnly: true; secure: true; sameSite: "lax"` and stop returning `guestAccessToken` in the JSON for the storefront path (keep the header path for POS only, minted through a separate flow).

### M2 — Address-book IDOR enumeration oracle (403 vs 404)
`src/app/api/addresses/[id]/route.ts:29-34` maps `updateOwnedAddress`'s `forbidden` to `403` and `not_found` to `404` (`src/lib/address/book.ts:115-119`). An authenticated customer can `PATCH /api/addresses/{id}` with arbitrary IDs and distinguish "address exists but owned by someone else" (403) from "address does not exist" (404), enumerating other customers' saved-address IDs. The same split status is not present on the admin route (uniform 404), so the leak is specific to the customer endpoint. Collapse both branches to a single `404 "Address not found."` to match the anti-enumeration posture used in `loadDraftForAccess`.

### M3 — Unbounded unauthenticated guest-draft creation
`src/app/api/drafts/route.ts:76-124` and `src/lib/orders/drafts.ts:119-182`. `POST /api/drafts` for a guest always calls `getOrCreateActiveDraft({ asGuest: true })`, which only dedupes existing drafts when `customerId` is provided — the guest branch has no "find existing" step. Each call mints a token, inserts an `Order` row, and writes a `DRAFT_CREATED` audit entry. There is no rate limit and no auth gate (the route is reachable by any unsigned caller in dev mode, and by any signed-in Clerk caller in prod since `/api/drafts` is not in `isPublic` but `auth.protect()` still permits a brand-new account). An attacker can create thousands of orphan guest drafts, bloating `Order`, `AuditLog`, and the guest-token index. Either reuse the existing guest draft for the calling token (the `GET` path already finds it) or cap guest-draft creation per IP / session.

### M4 — `guest_success` PATCH is client-callable with no link to an actual placed order
`src/app/api/drafts/[draftRef]/route.ts:75-86` and `src/lib/orders/drafts.ts:447-472`. The `guest_success` action is the P4 stand-in for "clear guest access after checkout success," but it is exposed as a plain client-callable PATCH and `markGuestDraftSuccess` only checks `status === DRAFT` (via `assertCanMutateDraft`) — it does not verify the draft was finalized/placed (no `OrderStatus.PLACED` gate, because finalize is P5). A guest can call `PATCH .../drafts/{ref}` with `{action:"guest_success"}` on their own still-open draft, which nulls `guestAccessTokenHash`, bumps `guestTokenVersion`, and sets `guestClearedAt`, permanently locking themselves out of the draft while it is still `DRAFT`. Until P5 wires this to a real finalize, gate the action behind a server-side precondition (e.g., only allow it once `status` has left `DRAFT`), or disable the client path and only invoke it from the finalize transaction.

### L1 — Staff draft mutations are not attributed in the audit log
`src/lib/orders/drafts.ts:257-262` (`addDraftLine`), and the `assignDraftLine` / `updateDraftLineQty` / `removeDraftLine` paths. The `DRAFT_UPDATED` audit entries are written with no `actorId` and no `actorKind`, so when a staff member with `admin.access` mutates a customer's draft through `loadDraftForAccess` (which returns `actor.kind === "staff"`), the mutation is indistinguishable from a customer-self mutation in the audit trail. The address-book path got staff attribution for UR-014/G-019; the draft-mutation path did not. Thread `actor` (or at least `actorStaffId`) from `assertCanMutateDraft` into these audit writes.

### L2 — `GET /api/drafts` guest path scans up to 25 drafts per request with early-exit match
`src/app/api/drafts/route.ts:52-68`. For a guest caller, the handler loads the 25 most-recent guest drafts (`customerId: null`, `status: DRAFT`, `guestClearedAt: null`) and runs `guestTokenMatches` in a `.find` loop. `guestTokenMatches` is constant-time per call, but the loop short-circuits on the first match, so response time varies with match position, and every request scans up to 25 rows plus their `draftInclude` graph. The result is `draft: null` either way (no body oracle), so this is a timing / cost side channel rather than a content leak. Index `guestAccessTokenHash` and look up by hash directly (store a derived lookup key, not the raw hash) instead of scanning.

### L3 — `/api/addresses/autocomplete` POST writes to `geocodeCache` with no rate limit
`src/app/api/addresses/autocomplete/route.ts:29-45` and `src/lib/address/geocode.ts:48-80`. The POST validate path upserts a `GeocodeCache` row on every call. In dev mode the middleware short-circuits (`src/middleware.ts:68-72`) so the endpoint is fully unauthenticated; in prod it is behind Clerk `auth.protect()` but the handler does not distinguish customer vs. staff and has no throttle. Any caller can flood the cache with arbitrary `queryKey` rows. Not a takeover vector, but an unbounded DB-write surface. Add a rate limit and require a customer session for the validate/write path.

### L4 — `serializeDraft` and `/api/account` expose internal UUIDs
`src/lib/orders/drafts.ts:100-116` returns `id` (order UUID) and `customerId` in the draft payload; `src/app/api/account/route.ts:37-45` returns `profile.id` (customer UUID). These are internal Prisma IDs reused as the `/account/orders/[id]` path parameter and the `/api/addresses/[id]` target. Exposing them is what makes the M2 enumeration probe possible in the first place, and they let a client correlate rows across seasons. Prefer the public `draftRef` / `orderNumber` for client-facing identifiers and keep the row `id` server-side.

### I1 — Staff-collision guard checks raw `email`, not `emailNorm`
`src/lib/customers.ts:41`. `db.staffUser.findUnique({ where: { email } })` uses the normalized email returned from `normalizeEmail`, but the lookup key is `email` (not `emailNorm`). If `StaffUser.email` is ever stored with different casing than `Customer.emailNorm`, a same-mail collision could bypass the guard. Confirm `StaffUser.email` is normalized on insert, or query by `emailNorm` if that column exists.

### I2 — `cancelDraft` does not bump `guestTokenVersion`
`src/lib/orders/drafts.ts:474-490`. On cancel, `guestAccessTokenHash` is set to `null` (so `guestTokenMatches` returns false), but `guestTokenVersion` is not incremented. Functionally safe today because the null hash blocks all matches, but inconsistent with `markGuestDraftSuccess` (which does bump the version). If a future change re-uses the hash column without re-reading version, a stale token could revive. Bump the version on cancel for symmetry.
