# P4 Aggregate Review — arm-05 (blind)

**Phase:** P4 — Cart-first order builder, address book, customer account
**Inputs:** P4-security, P4-quality, P4-rules, P4-clean-code (arm-05)
**Method:** union + dedupe by location+claim; security blockers always survive; no new findings.
**Severity map:** Critical (security) → blocker; High → major; Medium → minor (security mediums bumped to major); Low → minor; Nit → nit.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 8 |
| Minor | 26 |
| Nit | 2 |
| Informational | 2 |
| **Total** | **39** |

Pre-dedupe total: 47 (8 + 13 + 13 + 13). 9 duplicates collapsed:

1. Quality-M2 = Security-H1 (`orders.read` authorizes address writes)
2. Quality-L4 = Security-L4 (GET same-origin guard)
3. Quality-L3 = CleanCode-#9 (cart-fab `querySelector`)
4. Quality-H1 = Rules-R1 (continue-draft link broken)
5. Quality-H2 = Rules-R1 (no cancel draft)
6. Quality-M1 = Rules-R1 (no order detail view)
7. Rules-R2 = CleanCode-#2 (`formatMoney` duplication)
8. Rules-R3 = CleanCode-#8 (hardcoded Brooklyn centroid map)
9. Rules-R4 = CleanCode-#7 (magic TTLs / quantity limits)

Source tags: `[S]` security, `[Q]` quality, `[R]` rules, `[C]` clean-code. Multiple tags = same finding raised by multiple reviewers.

---

## BLOCKER

### B1 — `readDraft` ownership filter collapses to no filter when caller is unauthenticated and carries no guest token `[S]`
**Location:** `lib/order-builder.ts:142-161` (`readDraft`); consumed by `app/api/order/drafts/[draftId]/route.ts:8-13` (GET) and `lib/order-builder.ts:218-313` (`saveDraft`, PUT).
**Claim:** Any caller supplying only a `draftId` (no Clerk session, no `x-draft-access-token`) can read and overwrite any DRAFT order, including other customers' drafts and recipient PII. Empty `OR: []` is a no-op in Prisma (not FALSE); CUID draft IDs are enumerable.
**Fix:** Treat empty `OR` as `FALSE` (e.g. `OR: conditions.length ? conditions : [{ id: "__never__" }]`) and return 404 when no principal is present.

---

## MAJOR

### M1 — `orders.read` (read permission) authorizes writes to any customer's address `[S Q]`
**Location:** `app/api/addresses/[addressId]/route.ts:11-39`; `lib/permissions.ts:1-16`.
**Claim:** A staff member whose only grant is `orders.read` can mutate any address in the system. Address lookup is unscoped (no `customerId` filter at fetch), so any valid `addressId` is reachable by any `orders.read` holder.
**Fix:** Introduce a write-scoped permission (`customers.write` / `addresses.write`) and scope the `findUnique` by `customerId` for non-staff paths.

### M2 — Email-based account linking attaches a new Clerk identity to an existing Customer without re-verification `[S]`
**Location:** `lib/order-builder.ts:91-115` (`findCustomerForRequest`).
**Claim:** A Clerk user whose primary email matches a victim's `emailNormalized` is silently linked to the victim's `Customer` row, inheriting address book and order history. No verified-email check, no challenge, no audit event for the binding. Account-takeover primitive if unverified primary emails are permitted.
**Fix:** Require `emailVerified` from Clerk before linking; emit a `customer.identity_linked` audit event; on mismatch, create a new Customer instead of attaching.

### M3 — Account area missing order detail, cancel-draft, and working "continue" link `[R Q]`
**Location:** `app/components/account-dashboard.tsx:50-57`; `app/account/page.tsx`; `app/order/page.tsx`; `app/components/order-builder.tsx:88-112`.
**Claim:** Plan § P4 (R-038..R-040) and EXPECTED item 8 require "order history + detail" and "continue/pay/cancel draft". Dashboard renders only a summary list; "Continue or cancel" links to `/order` with no draft id (always boots a new draft unless `sessionStorage` happens to hold one); no `DELETE`/discard route; no order detail page or modal.
**Fix:** Add `/account/orders/[id]` detail route, `DELETE /api/order/drafts/[draftId]` (or `/discard`) wired to `discardOrder`, and pass `?draft=id` from the dashboard into the builder.

### M4 — `lib/order-builder.ts` is a god file with mixed concerns `[C]`
**Location:** `lib/order-builder.ts:1-373`.
**Claim:** One 373-line module owns seven distinct concerns: Zod schemas, customer resolution, guest-customer creation, draft CRUD, recipient resolution with geocode side-effects, address update with audit, account retrieval, draft serialization. Mixed-concerns clause of the clean-code rule triggers before the 500-line ceiling.
**Fix:** Split along concern lines: `lib/drafts.ts`, `lib/customers.ts`, `lib/addresses.ts`, `lib/account.ts`, `lib/schemas.ts`.

### M5 — `formatMoney` / `centsToDollars` duplicated across five locations `[C R]`
**Location:** `lib/foundation.ts:7-12` (`centsToDollars`), `lib/storefront.ts:5-10` (`formatMoney`), `app/components/order-builder.tsx:52-54`, `app/components/account-dashboard.tsx:14-16`, `app/components/catalog-grid.tsx:16-18`.
**Claim:** Five implementations of "format cents as USD" coexist under two names. Three P4 client components redefine the helper locally instead of importing the existing one. Same finding P3 raised; P4 added two more copies.
**Fix:** Export a single `formatMoney` from `lib/foundation.ts` (or `lib/money.ts`) and import it everywhere; delete the local copies.

### M6 — Inventory-availability check duplicated and divergent between client and server `[C]`
**Location:** `app/components/order-builder.tsx:151,175`; `app/components/catalog-grid.tsx:52`; `lib/order-builder.ts:236`.
**Claim:** Client uses `product.inventoryItems.every(i => i.quantityOnHand > i.quantityReserved)`; server uses `product.inventoryItems[0]` only. The two sides disagree on "available" when a product has more than one inventory row — type/schema drift.
**Fix:** Add `isProductAvailable(product)` (client) and `getAvailableQuantity(product)` (server) helpers; share via `lib/inventory.ts`.

### M7 — Address edits do not detect normalized-address collisions; smoke does not exercise the case `[R]`
**Location:** `lib/order-builder.ts:327-359` (`updateCustomerAddress`); `app/api/addresses/[addressId]/route.ts:28-38`; `schema.prisma:255` (`@@unique([customerId, normalizedAddress])`).
**Claim:** If an edit normalizes to a key matching a different address owned by the same customer, Prisma throws `P2002`, masked in production to a generic "Something went wrong." `smoke-p4.ts:68-75` only edits to the same key it already owns, so dedupe is never tested.
**Fix:** Pre-check for collision and return a 409 with a clear message; add a smoke case that edits to a colliding key.

### M8 — React list key mixes `productId` with array index `[R]`
**Location:** `app/components/order-builder.tsx:193`.
**Claim:** `key={`${line.productId}-${index}`}` is unstable when lines are removed; the same `productId` can appear on multiple lines (smoke adds `products[0]` twice), and the remove button filters by index. State/input can follow the wrong item after removal.
**Fix:** Use a stable client-side line id (e.g. `crypto.randomUUID()` assigned when the line is created) and key on that.

---

## MINOR

### m1 — Guest draft access token lifetime is 30 days `[S]`
**Location:** `lib/order-builder.ts:135` (`createDraft`).
**Claim:** A leaked guest token keeps recipient PII readable for 30 days — far longer than a checkout session. Tokens are 32 random bytes hashed with SHA-256 (good), but the window is too long.
**Fix:** Reduce TTL to a checkout-scoped window (e.g. 24h) and expose a rotate/revoke endpoint.

### m2 — Address existence enumeration via status-code divergence `[S]`
**Location:** `app/api/addresses/[addressId]/route.ts:16-24`.
**Claim:** `findUnique` returns 404 when absent; ownership failure returns 401/403. Divergent codes are an oracle.
**Fix:** Return a uniform 404 for both "not found" and "not authorized".

### m3 — Staff address-edit audit event omits before/after values `[S]`
**Location:** `lib/order-builder.ts:348-357` (`updateCustomerAddress`).
**Claim:** Only the new normalized address is recorded; prior field values are not captured, weakening forensic review of staff-driven mutations (UR-014/G-019).
**Fix:** Capture and store the prior address fields in the audit `details`.

### m4 — No rate limiting on unauthenticated draft creation `[S]`
**Location:** `app/api/order/drafts/route.ts:6-25` (POST).
**Claim:** A bot can create unbounded guest drafts (and guest `Customer` rows) without throttling. R-122 is allocated to P5, but P4 introduces the unauthenticated surface.
**Fix:** Add a per-IP rate limit on POST `/api/order/drafts` now; do not wait for P5.

### m5 — Missing same-origin guard on read endpoints returning PII `[S Q]`
**Location:** `app/api/order/drafts/[draftId]/route.ts:8-13` (GET); `app/api/account/route.ts:4-8` (GET).
**Claim:** Only POST/PUT routes call `hasSameOrigin`. GET routes rely on Clerk SameSite=Lax cookies — defense-in-depth gap, especially for the custom-header draft token path.
**Fix:** Call `hasSameOrigin(request)` in both GET handlers.

### m6 — No "edit saved address mid-order" UI in the builder `[Q]`
**Location:** `app/components/order-builder.tsx:217-231`.
**Claim:** Plan R-024/R-029 require "edit saved address mid-order". The PATCH endpoint and `updateCustomerAddress` exist and are unit-tested, but the builder never calls them; a customer mid-order cannot edit a saved address without leaving the flow.
**Fix:** Add an "Edit" affordance on saved-recipient rows that opens the inline form pre-filled and PATCHes on save.

### m7 — No shared storefront/POS builder shell `[Q]`
**Location:** `app/order/page.tsx`; `app/components/order-builder.tsx` (no `app/admin/pos/`).
**Claim:** Plan R-031 and EXPECTED item 7 require a "shared storefront/POS builder shell". Only the storefront builder exists; nothing is factored for POS reuse.
**Fix:** Extract the builder into a shared shell parameterized by surface (storefront/POS); add `app/admin/pos/` consuming it.

### m8 — Builder product cards have no quick view `[Q]`
**Location:** `app/components/order-builder.tsx:173-188`.
**Claim:** Plan R-026 requires "builder product panel/cards/quick view". Builder cards render name/description/price/Add only — no quick view (it exists in `catalog-grid.tsx`, not the builder).
**Fix:** Reuse the `catalog-grid` quick-view component in the builder card.

### m9 — Address fields lack `autoComplete` attributes / address autocomplete `[Q]`
**Location:** `app/components/order-builder.tsx:232-238`; `app/api/addresses/[addressId]/route.ts`.
**Claim:** Plan R-025 requires "address autocomplete + server validation". Server validation (Zod) is present; inputs have no `autoComplete` hints and there is no suggestion service.
**Fix:** Add `autoComplete` hints (e.g. `address-line1`, `postal-code`, `given-name`) at minimum; defer real autocomplete to a later phase.

### m10 — Add-recipient uses inline form, not the dialog the plan names `[Q]`
**Location:** `app/components/order-builder.tsx:232-238`.
**Claim:** Plan R-027/R-028 name "recipient assignment + add-recipient dialogs". The flow is an inline expanded form, not a `<dialog>`/modal. Functionally equivalent; not the specified shape.
**Fix:** Wrap the new-recipient form in a `<dialog>` element (or modal portal) to match the spec.

### m11 — Mobile cart FAB scrolls to sidebar instead of opening a drawer `[Q C]`
**Location:** `app/components/order-builder.tsx:250`.
**Claim:** Plan R-030 expects a "mobile cart FAB". The FAB only `scrollIntoView`s the always-rendered sidebar via `document.querySelector(".cart-sidebar")` — not a true cart drawer, and a React anti-pattern.
**Fix:** Use a `useRef` on the aside and toggle a cart drawer/sheet on narrow viewports.

### m12 — `addressKey` hardcodes `"US"` and ignores `Address.country` `[R]`
**Location:** `lib/order-builder.ts:72`; `schema.prisma:247`.
**Claim:** Country suffix is the literal `"US"`, not read from `Address.country`. Magic value + schema drift; smoke bakes in `|us`.
**Fix:** Read `address.country` (defaulting to `"US"`); centralize the country list.

### m13 — `createGuestCustomer` is a one-line helper with a single call site `[R]`
**Location:** `lib/order-builder.ts:117-121`.
**Claim:** One call site (line 128), no abstraction boundary. Violates Rule of 2 and ponytail "no unrequested abstractions".
**Fix:** Inline into `createDraft`.

### m14 — Selecting "saved" silently resets the recipient to the first address `[R]`
**Location:** `app/components/order-builder.tsx:218-221`.
**Claim:** The `onChange` handler forces `addressId` to `draft.addresses[0].id` regardless of any previously selected saved address. Reopening the dropdown snaps the selection back to the first.
**Fix:** Preserve the current `addressId` if it is still in the saved list; only default to `[0]` on first selection.

### m15 — Product/inventory validation runs outside the write transaction `[R]`
**Location:** `lib/order-builder.ts:233-264` (validation); `lib/order-builder.ts:267-309` (`$transaction`).
**Claim:** Validation is outside the transaction; the transaction only rewrites `OrderLine` rows. Not a correctness bug today (P4 drafts don't reserve), but sets up a TOCTOU race for P5 reservation.
**Fix:** Move stock validation inside the `$transaction` and use a `SELECT ... FOR UPDATE`-equivalent (or version check) before commit.

### m16 — Customer display name derived by splitting email on `@` with silent 80-char truncation `[R]`
**Location:** `lib/order-builder.ts:107`.
**Claim:** Magic 80, magic fallback `"Customer"`, heuristic that turns `john.doe+orders@example.com` into `john.doe+orders`. Silent truncation guards a length the schema does not enforce.
**Fix:** Use a named constant; surface truncation in an audit event or pick a different default.

### m17 — POST draft response includes dead `addresses: []` field `[R]`
**Location:** `app/api/order/drafts/route.ts:11-19`.
**Claim:** POST returns `{ draft: { ..., addresses: [] }, guestToken }` but the client immediately calls `loadDraft(body.draft.id)` which overwrites `draft` with `serializeDraft`'s output. The POST `addresses` is dead data.
**Fix:** Remove `addresses` from the POST response.

### m18 — Per-line validation runs in parallel with side-effecting `resolveRecipient` upserts `[R]`
**Location:** `lib/order-builder.ts:233-251`.
**Claim:** `Promise.all(input.lines.map(...))` runs `resolveRecipient` concurrently; a later-throwing line leaves earlier addresses created as orphans. No compensating delete in P4.
**Fix:** Either run sequentially, defer address writes to the transaction, or add a compensating delete on failure.

### m19 — Address-coordinate write logic duplicated between `resolveRecipient` and `updateCustomerAddress` `[C]`
**Location:** `lib/order-builder.ts:167-208`; `lib/order-builder.ts:333-346`.
**Claim:** Both paths recompute `addressKey`, look up `coordinatesForPostalCode`, write `latitude`/`longitude`/`geocodedAt`, and force `state.toUpperCase()`. Rule of 2 satisfied.
**Fix:** Extract `addressWriteData(input, coordinates)` helper.

### m20 — Inconsistent error-handling pattern across P4 API routes `[C]`
**Location:** `app/api/order/drafts/route.ts:8-24`; `app/api/order/drafts/[draftId]/route.ts:8-13,15-27`; `app/api/addresses/[addressId]/route.ts:11-39`; `app/api/account/route.ts:4-8`.
**Claim:** Three of five handlers wrap in `try/catch + maskError`; two do not. `account` GET and drafts GET leak unhandled prisma errors as 500s with stack traces in dev.
**Fix:** Wrap every P4 route handler in the same `try/catch + maskError` shape, or move to a single `withErrorHandler` wrapper.

### m21 — HTTP status inferred from substring matching on error message `[C]`
**Location:** `app/api/order/drafts/[draftId]/route.ts:25`.
**Claim:** PUT handler decides 404 vs 400 by `message.includes("not found") || message.includes("access")`. Couples HTTP status to user-facing wording; breaks if `maskError` rewords.
**Fix:** Have `saveDraft`/`readDraft` return a discriminated result `{ ok: false, code: "not_found" | "forbidden" | "conflict" }` and map to status.

### m22 — Magic TTLs and quantity limits duplicated without named constants `[C R]`
**Location:** `lib/order-builder.ts:135,178,180,36-37,40,41`; `app/components/order-builder.tsx:197`.
**Claim:** 30-day guest TTL, 90-day geocode TTL, max quantity 100 (server schema + client input), max add-ons 10, max add-on qty 20, state length 2, ZIP regex — all inline magic numbers, some duplicated across server/client.
**Fix:** Named constants (`GUEST_ACCESS_TTL_MS`, `GEOCODE_CACHE_TTL_MS`, `MAX_LINE_QUANTITY`, `STATE_REGEX`, `ZIP_REGEX`) in `lib/schemas.ts` and import on both sides.

### m23 — Hardcoded Brooklyn postal-centroid map with no provider abstraction `[C R]`
**Location:** `lib/order-builder.ts:78-85` (`coordinatesForPostalCode`); `lib/storefront.ts:3` (`defaultDeliveryZipCodes`).
**Claim:** Three Brooklyn zips are magic data in two places. Not named as a fallback, not isolated behind a provider interface; a future Mapbox swap touches order-builder internals.
**Fix:** Move the centroid table to `lib/geocode.ts` as a named fallback constant; reuse `defaultDeliveryZipCodes` as the single source.

### m24 — `cart-fab` button uses `document.querySelector` instead of a React ref `[C Q]`
**Location:** `app/components/order-builder.tsx:250`.
**Claim:** Direct DOM querying from inside a React component bypasses the React tree, couples behavior to a CSS class string, and breaks if a second `.cart-sidebar` ever mounts. Pattern drift within the arm.
**Fix:** Use `useRef` on the aside (or an `id`) and call `ref.current?.scrollIntoView(...)`.

### m25 — Repeated `Extract<Recipient, { kind: "new" }>` cast in recipient field bindings `[C]`
**Location:** `app/components/order-builder.tsx:233-237`.
**Claim:** Five consecutive `onChange` handlers each cast `line.recipient as Extract<Recipient, { kind: "new" }>` to spread before patching one field.
**Fix:** Hoist a `setNewRecipientField(index, field, value)` helper that already knows the recipient is `kind: "new"`.

### m27 — Local `Address`/`Product` types drift between P4 components `[C]`
**Location:** `app/components/order-builder.tsx:5-27`; `app/components/account-dashboard.tsx:6-12`; `app/components/catalog-grid.tsx:5-14`.
**Claim:** Each P4 client component declares its own ad-hoc `Address`/`Product` shape with drift (`label` present/absent, `Product` vs `CatalogProduct` differ on `kind`/`media`/`options`).
**Fix:** Centralize types in `lib/types.ts` (or colocate next to the existing query in `lib/storefront.ts`) and import everywhere.

---

## NIT

### n1 — Nested ternary in recipient-kind `onChange` `[C]`
**Location:** `app/components/order-builder.tsx:218-221`.
**Claim:** Two nested ternaries pick between `new`/`saved`/`self`; hard to read.
**Fix:** Extract `recipientForKind(kind, addresses)` helper.

### n2 — `guestCustomer!` non-null assertion relies on an invariant the compiler can't see `[C]`
**Location:** `lib/order-builder.ts:132`.
**Claim:** `customer?.customerId ?? guestCustomer!.id` uses `!` across a ternary boundary the compiler cannot prove.
**Fix:** Restructure to `customer ? { customerId: customer.customerId } : { customerId: (await createGuestCustomer()).id }`.

---

## INFORMATIONAL (no fix this phase)

### i1 — Guest draft clear-on-success cannot be exercised in P4 `[Q]`
**Location:** `lib/order-builder.ts` (no clear-on-success path); `arms/arm-05/workspace/.scratch/PHASE-P4-SMOKE.md:8`.
**Claim:** EXPECTED item 5 says "guest draft cleared only after success". Checkout is P5, so the path is unimplemented and untestable this phase. P5 must close it.

### i2 — Inventory "live stock in builder" is render-time only `[Q]`
**Location:** `app/components/order-builder.tsx:150-160,175`; `lib/order-builder.ts:236-238`.
**Claim:** R-020 asks for "inventory-aware live stock in builder". Stock is checked at render and re-validated server-side on save, but not polled/refetched mid-order. Acceptable for P4; P5 should add a stock re-check before checkout commit.

---

## Prioritized fix list (ONE pass)

1. **B1** — Close empty-OR IDOR in `readDraft` (blocker; PII exposure).
2. **M1** — Add write-scoped permission for address edits; scope `findUnique` by `customerId`.
3. **M2** — Require verified email before linking Clerk identity to existing Customer; audit the binding.
4. **M3** — Add order detail route, cancel-draft API + UI, and `?draft=id` continue link.
5. **M6** — Unify inventory-availability predicate (client/server divergence is a latent correctness bug).
6. **M7** — Pre-detect normalized-address collisions and return 409; add smoke case.
7. **M8** — Stable React keys for order lines.
8. **M5** — Single `formatMoney` helper; delete local copies.
9. **M4** — Split `lib/order-builder.ts` by concern.
10. **m1–m27** — Minor cleanup pass (TTLs, autocomplete, audit before/after, rate limit, same-origin GET, dead `addresses: []`, parallel-upsert orphan risk, etc.).
11. **n1–n2** — Nit polish (nested ternary, `!` assertion).
12. **i1–i2** — Tracked for P5 (clear-on-success, live stock re-check).

---
