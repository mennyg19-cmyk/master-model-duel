# P4 Quality Review — arm-03

**Reviewer specialist:** Quality
**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-03
**Phase:** P4 (Cart-first order builder, address book, customer account)
**EXPECTED ref:** `shared/phases/PHASE-P4-EXPECTED.md`
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED. Blind to model name. Findings only, no fixes.

Smoke S1–S3 (`.scratch/PHASE-P4-SMOKE.md`, driven by `scripts/smoke-p4.mjs`) report 15/15 PASS. Findings below are quality defects surfaced by reading the implementation, not by smoke failure. The smoke script drives the API directly and does not exercise several UI/race/upgrade paths flagged here.

## Findings

### F1 — Migration backfill `addressNorm` diverges from app `buildAddressNorm` for non-clean inputs (dedupe breaks on upgrade)
`prisma/migrations/20260721220000_p4_builder/migration.sql:14-23` vs `src/lib/address/normalize.ts:11-26`
The backfill computes the dedupe key as `lower(trim(both FROM concat_ws('|', …fields…)))` — lowercased and outer-trimmed, but with **no per-field trim** and **no internal whitespace collapse**. The app's `buildAddressNorm` runs `part()` on each field (`trim().toLowerCase().replace(/\s+/g, ' ')`) then joins with `|`. For any pre-existing `SavedAddress` row with leading/trailing whitespace on a mid-field, or double-spaced input ("100  Main St"), the backfilled key differs from the app-computed key → the unique constraint does not fire on next save → a **duplicate address-book entry** is created, breaking UR-014 dedupe. The fresh-seed smoke never trips this because the seed writes via the app function on a clean table. A real upgrade with existing addresses would misbehave silently. (Same shape as arm-02 F1.)

### F2 — Add-on stock is never checked in `addDraftLine` (sold-out tracked add-ons can be added)
`src/lib/orders/drafts.ts:184-246`, `prisma/schema.prisma:319-334`
`AddOn.tracksInventory Boolean @default(true)` and `AddOn.inventory InventoryItem?` exist in the schema, but `addDraftLine` only validates the allow-list and `addOn.isActive` when constructing `addOnCreates`. There is **no `availableUnits` check for add-ons** at all — a sold-out tracked add-on can be added to any line. EXPECTED #4 calls for "inventory-aware live stock in builder"; add-on stock is not inventory-aware. (arm-02 F4 at least checked per-line; arm-03 checks not at all.)

### F3 — Product stock check is per-line, not cart-aggregated (builder allows oversell)
`src/lib/orders/drafts.ts:205-210` (add), `277-282` (qty update); `src/lib/inventory/reserve.ts:75-77`
Both `addDraftLine` and `updateDraftLineQty` check `availableUnits(inventory) = onHand - reserved` against the single line's quantity only. `reserved` is only incremented at checkout reserve (P5), so during draft building two lines of the same tracked product (or a qty increase on a second line) each pass individually while their combined demand exceeds `onHand`. The builder's "live stock" gate (EXPECTED #4) does not prevent oversell at draft stage. Smoke S1b adds `FAMILY-BOX` twice at qty 1 with `onHand=25`, so the collision is unexercised.

### F4 — No "edit saved address mid-order" flow in the builder (missing vs EXPECTED #2)
`src/components/order/assign-dialog.tsx:145-161`, `src/components/order/builder-shell.tsx:250-257`
EXPECTED #2 explicitly calls for "edit saved address mid-order". `AssignDialog` only supports `on_order` / `address_book` (pick from dropdown) / `new_recipient`. There is no edit affordance on a saved address from within the builder; the user must leave to `/account/addresses` (which itself only PATCHes, no delete). The mid-order edit path is unimplemented and unexercised by smoke.

### F5 — `on_order` mode server-errors with no inline recovery when the customer has no default address
`src/lib/orders/drafts.ts:354-366`, `src/components/order/assign-dialog.tsx:120-143`
`assignDraftLine` `on_order` resolves the customer's default (or most-recent) saved address and returns `err("address", "Add a default address to your account first.")` when none exists. The `AssignDialog` enables "On order (self)" for any signed-in user (`disabled={value !== "new_recipient" && !signedIn}`) with no preflight, so a signed-in customer with no saved addresses clicks the button and gets a raw error string with no path forward except navigating away. No fallback to the new-recipient form.

### F6 — `cancelDraft` is not audited (inconsistent with `markGuestDraftSuccess`)
`src/lib/orders/drafts.ts:474-490` vs `446-472`
`markGuestDraftSuccess` writes an `AuditAction.DRAFT_GUEST_CLEARED` row, but `cancelDraft` (status → `DISCARDED`, `discardedAt`, token clear) writes no audit entry. Discarding a draft is a silent state change. G-019/audit expectations are inconsistent across the two draft-terminal paths.

### F7 — Guest draft creation race can orphan a draft and lose lines
`src/components/order/builder-shell.tsx:63-75,100-119`
`ensureDraft` does GET-then-POST. For a guest with no cookie yet, two concurrent calls (e.g. a rapid double-click on Add before first load completes, or React strict-mode double-invoke) both GET `null`, both POST → two guest drafts are created. The second response overwrites the `guest_draft_token` cookie, orphaning the first draft and any lines added to it. The server's `getOrCreateActiveDraft` dedupes by `customerId+season` for auth drafts but not for guest drafts (each guest POST mints a new token). Smoke creates the guest draft once, serially, so the race is unexercised.

### F8 — `CartSidebar` quantity/remove silently swallow failures and have no debounce
`src/components/order/cart-sidebar.tsx:37-55,105-113`
`updateQty` fires a PATCH on every `onChange` keystroke (typing "12" sends `1` then `12`) with no debounce, and `if (json.ok) onRefresh(json.draft)` silently drops non-OK responses — a stock-denied qty increase or network blip leaves the input showing the requested value while the server kept the old quantity, with no error surfaced. EXPECTED #5 calls for "autosave drafts"; the autosave has no error/recovery UI (cf. arm-02 F5).

### F9 — `autocompleteAddresses` is a 4-row hardcoded stub (no real provider)
`src/lib/address/geocode.ts:82-130`
The autocomplete backing `/api/addresses/autocomplete` GET returns a fixed list of four Brooklyn addresses filtered by `includes`. EXPECTED #2 lists "address autocomplete + server validation"; the validation path is real (`validateAddressInput` + geocode), but the autocomplete suggestions are a deterministic stand-in (like the P3 media-stub flagged for arm-03). Works for smoke; not a real autocomplete backend.

### F10 — `account/orders/[id]` detail page does not filter by status (draft detail reachable as "order")
`src/app/(storefront)/account/orders/[id]/page.tsx:22-29`
The detail page uses `db.order.findFirst({ where: { id, customerId } })` with no status filter. Ownership is enforced (customerId filter, R-042), so it is not a cross-customer leak, but a customer can navigate to `/account/orders/<draftId>` and render a DRAFT as if it were a placed order. The account API only lists non-DRAFT/non-DISCARDED orders in `orders`, so the index is correct, but the detail route is status-agnostic.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 4 (F1, F2, F3, F4) |
| Low | 4 (F5, F6, F7, F8) |
| Info | 2 (F9, F10) |
| **Total** | **10** |

No Critical/High. No regressions vs P3. EXPECTED checklist items 1–8 are all implemented and smoke-verified (15/15 PASS); the defects above are quality issues in the implementation, not missing scope. Out-of-scope items (payment/Stripe, repeat orders) are correctly held.
