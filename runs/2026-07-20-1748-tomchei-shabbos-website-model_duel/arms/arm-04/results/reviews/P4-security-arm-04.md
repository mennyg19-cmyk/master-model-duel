# P4 Security Review — arm-04 (blind)

**Reviewer:** External security specialist
**Scope:** P4 delta only — cart-first builder, address book, customer account, guest draft tokens, draft ownership anti-enumeration, staff audit, profile ownership, cart claim on sign-in.
**Source:** `arms/arm-04/workspace/` (P1–P4 reviewed; P4 delta in focus).
**Method:** Static review of trust boundaries, ownership filters, token handling, audit attribution, and redirect/URL handling. No fixes proposed.

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 0 |
| minor | 5 |

The P4 trust boundary is well-built. Ownership is enforced consistently through `DraftOwner` + `ownerFilter` on every draft/line read and write, guest tokens are 32-byte random + SHA-256 hashed and stored httpOnly/sameSite=lax, anti-enumeration holds (404 for both "not yours" and "does not exist" across drafts and orders), address-book IDOR is closed by `customerId` scoping on every `findFirst`/`findUnique`, staff edits flow through the same `saveCustomerAddress` with the staff `AuditActor` attached (G-019), and profile edits resolve the customer from the session with no id in the form (R-042). The findings below are hardening gaps, not exploitable holes.

## Findings

### 1. minor — `claimGuestDraft` TOCTOU can leave a customer with two drafts
**File:** `src/lib/orders/cart-service.ts:172-203`

`claimGuestDraft` checks `findOwnedDraft({ kind: 'customer', customerId }, seasonId)` (returns null), then `db.order.update` re-parents the guest draft to the customer. No lock is held between the check and the update. A concurrent `addToCartAction` from the same browser (now signed in, so `resolveDraftOwner` returns the customer) calls `getOrCreateDraft`, which also sees no customer draft and creates a new one. Both commits succeed; the customer now owns two DRAFT rows for the season.

Not a cross-customer access (the second draft is the customer's own), but it breaks the "one draft per customer per season" invariant `findOwnedDraft`/`getOrCreateDraft` assume, and the schema does not enforce it (no unique index on `customerId`+`seasonId`+`status` for DRAFT). The builder will keep showing the older draft; the newer one is orphaned. A serialized transaction or an upsert-with-conflict on `(customerId, seasonId)` where status='DRAFT' would close it.

### 2. minor — `safeDestination` whitelist bypassed by path traversal
**File:** `src/app/(storefront)/account/sign-in/actions.ts:65-72`

```ts
const allowed = CUSTOMER_DESTINATION_ROOTS.some(
  (root) => candidate === root || candidate.startsWith(`${root}/`),
);
return allowed ? candidate : '/account';
```

`candidate = '/account/../admin'` satisfies `startsWith('/account/')` and is returned unchanged. The browser normalizes to `/admin`. Admin routes are gated by `requirePermission` (401/403), so a customer is not granted staff access — but the whitelist's intent ("customers only land on customer roots") is bypassed. `//evil.example` and backslash variants are correctly rejected. Fix: canonicalize/normalize the path (e.g. `new URL(candidate, APP_URL).pathname`) before the prefix test, or match on path segments rather than raw `startsWith`.

### 3. minor — `saveBuilderAddressAction` skips `requireOpenStore`
**File:** `src/app/(storefront)/order/actions.ts:108-135`

Every other action in this file (`addToCartAction`, `changeQuantityAction`, `removeLineAction`, `assignLineAction`, `unassignLineAction`) gates on `requireOwner()` → `requireOpenStore()`. `saveBuilderAddressAction` only resolves `getCurrentCustomer()`. A signed-in customer can therefore mutate their address book through the builder's server action while the store is closed. This is not an ordering mutation (no cart/line change), and address-book management off-season is reasonable, but the inconsistency is a trap for a P5 author who assumes every action exported from `(storefront)/order/actions.ts` is store-gated. Either gate it for parity or move it to `account/actions.ts` where the other address writes live.

### 4. minor — `discardDraft`/`transitionOrder` accept a bare `orderId` with no owner filter
**File:** `src/lib/orders/order-service.ts:114-158`

`transitionOrder(orderId, to, actor)` and `discardDraft(orderId, actor)` look up the order by `id` alone. The only P4 caller (`cancelDraftAction` in `src/app/(storefront)/account/actions.ts:82-91`) checks ownership first via `findOwnedOrder({ kind: 'customer', customerId }, orderId)`, so P4 is safe. But the service layer is IDOR-by-design: a future caller that forgets the pre-check would let any authenticated customer discard/transition any order id. Defense-in-depth: take a `DraftOwner` argument and fold `ownerFilter` into the `where`, the way `cart-service` and `assignment` already do.

### 5. minor — `claimGuestDraft` audit logged as `system`, not the customer
**File:** `src/lib/orders/cart-service.ts:195-200`

`recordAudit(null, { action: 'order.draft_claimed', ... })`. This matches the audit module's convention ("customer/cron actions are `system`"), so it is not a bug. But the `order.draft_claimed` event is the only place a guest cart changes hands, and the audit row cannot distinguish "customer just signed in and claimed" from a hypothetical system-triggered claim. If a future investigator needs to attribute a claim, they have no actor. Acceptable for P4; flag for P5/P12 review when audit retention is finalized.

## Trust-boundary checklist (what passed)

- **Guest draft tokens** (`draft-access.ts`): 32-byte `randomBytes` base64url, SHA-256 hashed at rest, unique index on `guestTokenHash`, httpOnly + sameSite=lax cookie, 30-day max-age, cleared only on successful claim. A DB dump yields no working tokens; a URL id never resolves without the cookie. R-023 satisfied.
- **Draft ownership anti-enumeration** (`draft-access.ts:96-127`, `customer-orders.ts:90-98`): every draft/order read goes through `ownerFilter`; `findOwnedOrder` returns null for both "not yours" and "missing", and callers emit 404/`missing-draft` identically. Smoke S2e confirms. R-121 satisfied.
- **Address-book IDOR** (`address-book.ts:65-140`, `assignment.ts:232-245`): `saveCustomerAddress`, `archiveCustomerAddress`, `findCustomerAddress` all scope by `customerId`; a foreign `addressId` returns `ADDRESS_NOT_FOUND` (same answer as missing). Staff actions pass `customerId` from the form but `saveCustomerAddress` re-scopes every query on `input.customerId`, so a mismatched post cannot reach another customer's rows. Customer's own `saveAddressAction`/`archiveAddressAction` resolve `customerId` from the session, never the form.
- **Staff audit** (`address-book.ts:120-125`, `audit.ts:62-79`, `customers/actions.ts:15-42`): staff edits pass the `StaffContext` (actor + acting + isImpersonating) as `AuditActor`; `recordAudit` writes `actorStaffUserId`, `actorLabel` as `Name <email>`, and `impersonatedStaffUserId` when impersonating. Customer edits pass `null` → `system`. G-019 satisfied.
- **Profile ownership** (`customers.ts:159-199`, `account/profile/page.tsx`, `account/actions.ts:12-26`): `updateCustomerProfile(customer, input)` takes the `Customer` row resolved by `requireSignedInCustomer`; no customer id appears in the form. Phone uniqueness failure returns a generic message that does not leak which record holds the number. R-042 satisfied.
- **Cart claim on sign-in** (`sign-in/actions.ts:49-58`, `cart-service.ts:172-203`): claim only clears the guest cookie on `claimed.ok`; a customer who already has a draft keeps it, and the guest cart survives with its cookie intact (S2d). `safeDestination` blocks `//` and backslash open-redirect variants.
- **Cart-line ownership** (`cart-service.ts:214-219`, `assignment.ts:70-73,117-119`): `findOwnedLine` filters by `order: { status: 'DRAFT', ...ownerFilter(owner) }`; a line is only reachable through its owner draft. The `OrderLine_assignment_complete` CHECK constraint makes half-assignment unstoreable.
- **Option/add-on validation** (`cart-service.ts:264-320`): form-posted options and add-on ids are re-validated against the product's offered options and the season's active add-ons with restriction scoping. No client trust.
- **Signed cookies** (`auth/signed-cookie.ts`, `auth/local-session.ts`): HMAC-SHA256 with `timingSafeEqual` on the signature; `startLocalSession` refuses to run outside loopback/non-production. Local sign-in is dev-only by construction.

## Out of scope

Payment capture, Stripe checkout, fulfillment commitment (P5); POS cash/check posting (P5/P6); repeat orders and replacement-mapping admin (P10); package board, printing, shipping labels, routes (P7–P9); middleware/edge auth (P1); rate limiting on public endpoints (R-122 — P5 per plan); IP logging (no P4 caller passes `ipAddress`).
