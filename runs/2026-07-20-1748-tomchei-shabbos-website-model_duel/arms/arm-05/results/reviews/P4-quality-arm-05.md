# P4 Quality Review — arm-05

Reviewer: Quality specialist (blind — no model names).
Scope: P4 — Cart-first order builder, address book, customer account.
Plan ref: `shared/MERGED-BUILD-PLAN.md` § P4; `shared/phases/PHASE-P4-EXPECTED.md`.

Format: severity · location · claim · evidence. Findings only — no fixes.

---

## Summary counts

- Critical: 0
- High: 2
- Medium: 5
- Low: 4
- Informational: 2
- Total: 13

---

## High

### H1 — Continue-draft link from account does not resume the selected draft

- **Severity:** High
- **Location:** `app/components/account-dashboard.tsx:55` (the `<Link href="/order">Continue or cancel</Link>` on DRAFT rows); `app/order/page.tsx`; `app/components/order-builder.tsx:88-112`
- **Claim:** The account area's "Continue or cancel" action on a DRAFT order links to `/order` with no draft identifier in the URL or session, so the builder cannot resume the chosen draft — it falls back to whatever is in `sessionStorage` or creates a brand-new draft, orphaning the clicked draft.
- **Evidence:** `account-dashboard.tsx` line 55 renders `<Link className="button secondary" href="/order">Continue or cancel</Link>` with no query param and no draft id. `order-builder.tsx` lines 88-112 only read `sessionStorage.getItem("tomchei-order-draft")` and, on miss, POST `/api/order/drafts` to create a new draft. There is no code path that accepts a draft id from the URL (no `?draft=`, no `/order/drafts/[id]` route). EXPECTED item 8 requires "continue/pay/cancel draft"; "continue" is effectively broken for any draft that is not already the one in the current browser's `sessionStorage` (e.g. a returning customer on a new device, or multiple drafts).

### H2 — No UI or API route to cancel/discard a draft

- **Severity:** High
- **Location:** `app/api/order/drafts/[draftId]/route.ts` (only GET + PUT); `app/components/account-dashboard.tsx`; `app/components/order-builder.tsx`
- **Claim:** EXPECTED item 8 and plan R-040 require "continue/pay/cancel draft" in the account area. The `discardOrder` helper exists in `lib/orders.ts:50-66`, but no API route exposes it and no UI element triggers it; "Continue or cancel" is a single link to `/order` with no cancel action.
- **Evidence:** `api/order/drafts/[draftId]/route.ts` defines only `GET` and `PUT`; there is no `DELETE` and no `/discard` route. `account-dashboard.tsx` has no cancel button. `order-builder.tsx` has a per-line `×` (line 194) that removes a cart line, not the draft. A customer with a DRAFT they no longer want cannot discard it from the UI.

---

## Medium

### M1 — No order detail view in the account area

- **Severity:** Medium
- **Location:** `app/account/page.tsx` (single `page.tsx`, no `orders/[id]` route); `app/components/account-dashboard.tsx:50-58`
- **Claim:** EXPECTED item 8 and plan R-039 require "order history + detail". Only a summary list is rendered; there is no order detail page or detail modal.
- **Evidence:** `app/account/` contains only `page.tsx` (no `orders/` subtree). `account-dashboard.tsx` lines 50-58 render each order as a one-line article: `draftReference`, total gift count, `formatMoney(order.totalCents)`, and status — with no link to a detail view. Line items, recipients, addresses, add-ons, and per-line totals are not shown anywhere for a placed/draft order.

### M2 — Staff address edits gated by `orders.read` (read permission for a write)

- **Severity:** Medium
- **Location:** `app/api/addresses/[addressId]/route.ts:21,33`; `lib/permissions.ts:1-16`
- **Claim:** UR-014/G-019 require staff address-book edits to be audited, and the plan implies a write-scoped permission. Here the only permission available for staff is `orders.read`, so any STAFF role (whose sole permission is `orders.read`) can mutate any customer's address. The audit row is written, but the authorization scope is a read permission authorizing a write.
- **Evidence:** `permissions.ts` defines only `staff.manage`, `audit.read`, `settings.manage`, `orders.read` — there is no `customers.write` / `addresses.write`. `addresses/[addressId]/route.ts` line 21 calls `authorize(request, "orders.read")` for non-owner edits, and line 33 passes `staff.staffMember.id` to `updateCustomerAddress` which writes the `customer.address_updated` audit event. A read-only orders staffer can edit customer addresses.

### M3 — No "edit saved address mid-order" UI in the builder

- **Severity:** Medium
- **Location:** `app/components/order-builder.tsx:217-231`
- **Claim:** Plan R-024/R-029 require "edit saved address mid-order". The builder exposes a recipient dropdown for `self`/`saved` and inline fields only for `new`; there is no edit affordance for an existing saved address from within the builder.
- **Evidence:** Lines 227-231 render an `<select>` of saved addresses when `kind === "self" || "saved"`, with no edit/patch control. The PATCH endpoint `/api/addresses/[addressId]` exists and `updateCustomerAddress` is unit-tested in `scripts/smoke-p4.ts:68-91`, but the builder never calls it. A customer mid-order cannot edit a saved address without leaving the flow.

### M4 — No shared storefront/POS builder shell

- **Severity:** Medium
- **Location:** `app/order/page.tsx`; `app/components/order-builder.tsx`; (no `app/admin/pos/` or shared builder shell)
- **Claim:** Plan R-031 and EXPECTED item 7 require a "shared storefront/POS builder shell". Only the storefront `/order` builder exists; there is no POS builder surface and no shared shell abstraction the POS can reuse.
- **Evidence:** `app/admin/` contains only `audit/`, `catalog/`, `settings/`, `staff/` — no `pos/`. `order-builder.tsx` is a single client component bound to `/order` with storefront-only assumptions (guest tokens, `sessionStorage` draft, storefront shell). Nothing is factored for POS reuse.

### M5 — Builder product cards have no quick view

- **Severity:** Medium
- **Location:** `app/components/order-builder.tsx:173-188`
- **Claim:** Plan R-026 requires "builder product panel/cards/quick view". The builder's product cards render name, description, price, and an Add-to-cart button only — no quick view. (Quick view exists in `catalog-grid.tsx`, not in the builder.)
- **Evidence:** Lines 173-188 map products to `<article className="product-card">` with eyebrow, `<h2>`, description, `<strong>` price, and an add button. There is no `quickView` state, no details modal, and no option/add-on preview in the builder card. `catalog-grid.tsx:23,69-83` has the quick view — but that is the catalog, not the order builder.

---

## Low

### L1 — Address fields lack autocomplete attributes / address autocomplete

- **Severity:** Low
- **Location:** `app/components/order-builder.tsx:232-238` (new-recipient inputs); also `app/api/addresses/[addressId]/route.ts`
- **Claim:** Plan R-025 requires "address autocomplete + server validation". Server validation is present (Zod in `lib/order-builder.ts:23-31`), but the address inputs carry no `autoComplete` hints and there is no address suggestion/autocomplete service.
- **Evidence:** Lines 233-237 render `<input onChange=...>` for recipientName, line1, city, state, postalCode with no `autoComplete` attribute and no datalist/suggestion API. Geocoding is stubbed to three hardcoded Brooklyn ZIPs in `coordinatesForPostalCode` (`lib/order-builder.ts:78-85`), which is fine for P4 but is not "autocomplete".

### L2 — Add-recipient uses inline form, not the dialog the plan names

- **Severity:** Low
- **Location:** `app/components/order-builder.tsx:232-238`
- **Claim:** Plan R-027/R-028 name "recipient assignment + add-recipient dialogs". The builder implements the new-recipient flow as an inline expanded form rather than a dialog/modal.
- **Evidence:** Lines 232-238 render a `<div className="address-fields">` inline within the order-line card when `kind === "new"`. There is no `<dialog>` or modal portal. Functionally equivalent, but not the specified interaction shape.

### L3 — Mobile cart FAB scrolls to sidebar instead of opening a drawer

- **Severity:** Low
- **Location:** `app/components/order-builder.tsx:250`
- **Claim:** Plan R-030 expects a "mobile cart FAB". The FAB exists but its only behavior is `scrollIntoView` of the always-rendered sidebar — not a true mobile cart drawer/sheet.
- **Evidence:** Line 250: `<button className="cart-fab" onClick={() => document.querySelector(".cart-sidebar")?.scrollIntoView({ behavior: "smooth" })}>Cart · {formatMoney(total)}</button>`. The sidebar is in the same layout (`<aside className="cart-sidebar">` at line 243), so on narrow viewports the FAB just scrolls rather than presenting a dedicated cart surface.

### L4 — GET draft endpoint has no same-origin guard

- **Severity:** Low
- **Location:** `app/api/order/drafts/[draftId]/route.ts:8-13`
- **Claim:** PUT and POST on the drafts API enforce `hasSameOrigin`; GET does not. P4 doesn't require full public-endpoint hardening (R-122 is P5), but the asymmetry is a latent gap.
- **Evidence:** Line 16 calls `hasSameOrigin` for PUT; lines 8-13 (GET) call `readDraft` directly with no origin check. Anti-enumeration still holds via cuid + ownership/token, so impact is limited.

---

## Informational

### I1 — Guest draft clear-on-success cannot be exercised in P4

- **Severity:** Informational
- **Location:** `lib/order-builder.ts` (no clear-on-success path); `arms/arm-05/workspace/.scratch/PHASE-P4-SMOKE.md:8`
- **Claim:** EXPECTED item 5 says "guest draft cleared only after success". There is no checkout/success event in P4 (checkout is P5), so the clear-on-success path is unimplemented and untestable this phase.
- **Evidence:** `order-builder.ts` has no `clearGuestDraft`/discard-on-success function. The smoke file explicitly states the guest draft "remained until the later checkout phase." Acceptable for P4; flagged so P5 must close it.

### I2 — Inventory "live stock in builder" is render-time only

- **Severity:** Informational
- **Location:** `app/components/order-builder.tsx:150-160,175`; `lib/order-builder.ts:236-238`
- **Claim:** R-020 asks for "inventory-aware live stock in builder". Stock is checked at page render and re-validated server-side on save, but the builder does not poll or re-fetch stock while the user is mid-order.
- **Evidence:** `addProduct` (line 151) checks `product.inventoryItems` from the initial render. `saveDraft` (lines 236-238) re-checks server-side. No websocket/poll/refetch on a timer. Acceptable for P4; P5 should add a stock re-check before checkout commit.

---

## Smoke reconciliation

- S1 (three-way assignment): smoke passes; code path matches (`lib/order-builder.ts:163-216`, `app/components/order-builder.tsx:217-238`).
- S2 (draft persistence): smoke passes for auth + guest; anti-enumeration confirmed (`lib/order-builder.ts:142-161`). Clear-on-success deferred (I1).
- S3 (address edit audit): smoke passes; audit event written for staff actor (`lib/order-builder.ts:348-357`). Permission scope mismatch noted (M2).

---

## Out-of-scope confirmation (not flagged)

- Payment capture, Stripe, fulfillment, POS posting — correctly absent (P5/P6).
- Repeat orders, replacement mapping admin — correctly absent (P10).
- Package board, printing, shipping, routes — correctly absent (P7-P9).
