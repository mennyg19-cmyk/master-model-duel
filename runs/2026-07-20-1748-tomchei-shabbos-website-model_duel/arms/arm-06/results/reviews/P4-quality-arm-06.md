# P4 Quality Review — arm-06 (blind)

**Phase:** P4 — Cart-first order builder, address book, customer account
**Scope:** `arms/arm-06/workspace/` against `shared/phases/PHASE-P4-EXPECTED.md`
**Reviewer focus:** correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.
**Findings only — no fixes.**

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 5 |

P4 EXPECTED §1–8 are all present and wired through smoke S1–S3 (35/35, transcript in `.scratch/PHASE-P4-SMOKE.md`). The cart-first flow, three-way recipient picker, address-book autosave, staff audit (G-019), guest tokens (R-023), anti-enumeration (404-not-403), desktop sidebar + mobile FAB, and the account area (dashboard / orders / detail / profile / addresses) all function. No blockers. The findings below are correctness gaps and inconsistencies in the validation/autosave seams.

## Major

### M1 — Autosave never persists an emptied cart
`components/order-builder/use-auto-save.ts:96`
```96:96:components/order-builder/use-auto-save.ts
    if (input.state.lines.length === 0) return;
```
The autosave effect bails when the cart has zero lines. A signed-in customer who removes every line never sends the empty state to the server, so `POST /api/drafts` is never called and the stored draft keeps its stale lines. The customer's account dashboard then shows a draft with items that are no longer in their cart. The only way the empty state reaches the server is the explicit `saveNow()` on checkout — but checkout is disabled when `lines.length === 0`, so the stale draft persists indefinitely. **Correctness gap vs EXPECTED §5 ("autosave drafts").**

### M2 — `EditSavedAddressDialog` skips the deliverability probe
`components/order-builder/edit-saved-address-dialog.tsx:31` — `AddRecipientDialog` calls `POST /api/addresses/validate` and surfaces the ZIP-allowlist result before creating a recipient, but `EditSavedAddressDialog` PATCHes `/api/account/addresses/[id]` directly with no validate call. `updateAddress` (`lib/customers/addresses.ts:102`) normalizes and geocodes but does **not** run `isDeliverable` against the shipping ZIP allowlist. A customer can edit a saved address to an out-of-area ZIP with no warning, and the mid-order edit (EXPECTED §2 "edit saved address mid-order") inherits the same blind spot. The validation seam exists; it is just not invoked on the edit path. **Inconsistent enforcement of EXPECTED §2 ("server validation").**

### M3 — `AddRecipientDialog` adds the recipient even when undeliverable, with a P5 stub message
`components/order-builder/add-recipient-dialog.tsx:71`
```71:73:components/order-builder/add-recipient-dialog.tsx
    if (result.body.deliverable === false) {
      setError("That ZIP is outside our delivery area — pickup will be offered at checkout.");
    }
    onCreated({
```
When `deliverable === false`, the dialog sets an error string but still calls `onCreated(...)`, so the recipient lands on the draft regardless. The message references "pickup … at checkout," which is a P5 feature explicitly out of scope this phase (`PHASE-P4-EXPECTED.md` §"Out of scope"). Customers are told a fulfillment option exists that the product does not yet offer. Either block the add or drop the forward-reference. **Stub-ish behavior vs EXPECTED §2.**

## Minor

### m1 — `ProductQuickView` supports only one option value across all of a product's options
`components/order-builder/product-quick-view.tsx:22` — a single `optionValueId` state is shared across every option on the product; picking a value from a second option overwrites the first. This matches the single-FK `OrderLine.optionValueId` schema (P3 shape, unchanged in P4), so it is a latent design gap rather than a P4 regression, but any future multi-option product will have a confusing builder UX. No seeded product currently has >1 option, so smoke does not catch it.

### m2 — `RecipientAssignDialog` creates a new recipient per pick with no dedupe
`components/order-builder/recipient-assign-dialog.tsx:99` (book pick) and `:62` (on-order pick) — picking the same book address (or the same on-order recipient) for two different lines creates two distinct `RecipientState` entries with fresh `clientId`s. The cart's recipient list then shows duplicates. Not a data bug (each line links correctly), but UX noise that the cart panel echoes.

### m3 — `OrderDetailPage` uses `order.draftRef!` non-null assertion
`app/(storefront)/account/orders/[id]/page.tsx:60` — `draftRef` is `String?` in the schema; drafts always have one (claimed at creation), but the assertion is unguarded. A future non-draft path through this component would crash. Low risk today.

### m4 — `account/orders/page.tsx` orders drafts-first by incidental string sort
`app/(storefront)/account/orders/page.tsx:17` — `orderBy: [{ status: "asc" }, { updatedAt: "desc" }]` puts DRAFT before FINALIZED only because "DRAFT" < "FINALIZED" alphabetically (DISCARDED is filtered out). It works, but it is an implicit status priority, not an explicit one; adding a new `OrderStatus` value could silently reorder the list.

### m5 — `clear-guest-draft.tsx` hardcodes the localStorage key
`components/storefront/clear-guest-draft.tsx:12` — `localStorage.removeItem("arm06_guest_draft")` duplicates the literal that `use-auto-save.ts` exports as `GUEST_DRAFT_KEY`. The constant exists; this file should import it instead of re-stringing it. Drift risk if the key ever changes.

## What is not a finding

- **No server-side stock cap on draft save.** Drafts don't reserve (`lib/inventory/reserve.ts` is the finalize-time seam); the builder's `overStock` guard is a soft UI cap, with hard enforcement at finalize. Matches the existing P2/P3 reservation design.
- **`FINALIZED` is unreachable in P4.** `checkout/page.tsx` handles it for the P5 handoff; smoke S2i flips it via the `set-status` DB helper, which is the documented test seam. Not a stub — the transition is P5 scope.
- **Customer auth on the dev-auth seam.** Mirrors staff P1; Clerk swap point is the session codec. Documented deviation #1.
- **Geocode is a deterministic dev provider.** Documented deviation #2; the live-provider seam (`deriveGeoPoint`) is the only swap point.
