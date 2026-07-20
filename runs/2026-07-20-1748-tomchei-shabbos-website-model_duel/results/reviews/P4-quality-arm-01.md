# P4 Quality Review — arm-01

**Reviewer specialist:** Quality
**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-01
**Phase:** P4 (Cart-first order builder, address book, customer account)
**EXPECTED ref:** `shared/phases/PHASE-P4-EXPECTED.md`
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.

Smoke S1–S3 (`.scratch/PHASE-P4-SMOKE.md`) all PASS; `npm run ci` 13/13; build emits `/order`, account routes, P4 API. Findings below are quality defects surfaced by reading the implementation, not by smoke failure.

## Findings

### F1 — ON_ORDER recipient picker falls back to first address-book entry
`src/components/order-builder.tsx:392-402`
When a line is the first to be assigned, no other line has a recipient yet, so `onOrderAddresses` is empty and the picker renders `addresses.slice(0, 1)` — the customer's first saved address presented as if it were "already on this order." The smoke test bypasses the UI (POSTs lines directly with `recipientSource: "ON_ORDER"`), so S1 passes without exercising this path. The real flow misrepresents the source and lets the user "assign to self/on-order" by picking an unrelated address-book entry.

### F2 — New-recipient dialog receives stale `null` draftId for guests on first add
`src/components/order-builder.tsx:374-377, 450`
`ensureDraft().then(() => setAddressDialog({...}))` fires before `setDraftId` has flushed into the closure, so `RecipientAddressDialog` is rendered with `draftId={null}` (the value captured at render time). For a guest, the dialog POSTs `/api/account/addresses` with `draftId: null`; `resolveCustomerId` returns null and the save fails with 404 "Address book not found." The first new-recipient add for a guest is broken; subsequent adds work once `draftId` state has settled.

### F3 — localStorage draft is not scoped by customer
`src/components/order-builder.tsx:59, 89-104`
`STORAGE_KEY = "tomchei-p4-draft"` is shared across every customer on the browser. On `/order` (no `?draft=`), the restore effect reads the persisted `{draftId, draftVersion, lines}` and adopts them regardless of who is signed in. Customer B signing in on a browser where customer A left a draft will load A's `draftId` and line items, then every autosave PATCHes `/api/order/drafts/{A's id}` → 404, leaving B staring at A's cart contents behind a "Draft could not be saved" error. Product names and quantities leak across identities.

### F4 — Guest address book is not rehydrated on refresh
`src/app/(storefront)/order/page.tsx:25-30`, `src/components/order-builder.tsx:75`
`initialAddresses` is `[]` for guests (only authenticated customers get `db.customerAddress.findMany`). A guest who creates a new recipient mid-order and then refreshes loses every address from the picker, even though persisted draft lines still reference those address IDs and the server still owns them. The "edit saved address mid-order" capability silently degrades to "no addresses available" for guests after refresh.

### F5 — PATCH drafts deletes and recreates every line on each debounced save
`src/app/api/order/drafts/[draftId]/route.ts:151-175`
Each autosave (500 ms debounce) issues `orderLine.deleteMany` + a `create` loop for every line. For a cart-first builder where quantity keystrokes trigger autosave, this churns the DB, breaks line `id` stability (the server-assigned line id changes on every save), and widens the race window: a stale `version` produces a 409 the client does not recover from (see F6). No per-line upsert/patch path exists.

### F6 — Client does not recover from 409 draft conflict
`src/components/order-builder.tsx:163-180`
`saveDraft` catches a non-OK response and only writes the error message into `saveState`. On a 409 ("This draft changed in another browser. Reload before saving.") the client keeps its stale `draftVersionRef`, so every subsequent save also 409s and the user is stuck with a "Draft could not be saved" banner and no path forward short of a hard reload.

### F7 — Guest access token returned in response body
`src/app/api/order/drafts/route.ts:46-49`
The guest `accessToken` is already set as an `httpOnly` cookie (good), but it is also returned in the JSON body. The UI never reads the body token (it relies on the cookie), so the body field only exposes the bearer to any XSS that can intercept fetch responses — defeating the httpOnly protection for no client benefit. The smoke test uses the body token; switch the test to the cookie or a one-time header.

### F8 — Address dialog hardcodes `countryCode: "US"`
`src/components/recipient-address-dialog.tsx:75`
`validateAddress` supports non-US postal codes (it only applies the 5-digit regex when country is US), but the dialog forces `countryCode: "US"` with no input. Non-US recipients cannot be created through the builder; the validator's international branch is dead code in the UI.

### F9 — Quantity input accepts non-integer values
`src/components/order-builder.tsx:318-322`
`Math.max(1, Number(event.target.value))` admits `1.5`; the server later rejects with `Number.isSafeInteger` → 400 "Every draft line must be valid." The user can type a fractional quantity, see it accepted in the UI, then hit a save error with no field-level indication of which line is invalid.

### F10 — PATCH drafts does not validate recipientSource / recipientAddressId consistency
`src/app/api/order/drafts/[draftId]/route.ts:61-72`
A line may be persisted with `recipientSource: "ON_ORDER"` and `recipientAddressId: null`, or `recipientSource: null` with an address id. The account order detail page then renders "Recipient not assigned" for a line the user believes they assigned. No invariant ties the source enum to the presence of an address.

### F11 — Orphaned guest `Customer` rows on every draft
`src/app/api/order/drafts/route.ts:25-34`
Each guest POST creates a permanent `Customer` row (`displayName: "Guest customer"`, no email) plus any addresses they add. Success revokes the token but leaves the customer and address book behind with no reclamation path. P4 has no cleanup; the table accumulates one row per abandoned guest draft.

## Severity summary

| ID | Severity | Area |
|---|---|---|
| F1 | High | Builder UX / data correctness |
| F2 | High | Guest new-recipient flow broken on first add |
| F3 | High | Cross-customer data leak via localStorage |
| F4 | Medium | Guest address book lost on refresh |
| F5 | Medium | DB churn + line id instability |
| F6 | Medium | No 409 recovery, user stuck |
| F7 | Medium | Security — token exposed to XSS |
| F8 | Low | International addresses unreachable |
| F9 | Low | Fractional quantity UX |
| F10 | Low | Source/address invariant missing |
| F11 | Low | Data retention — guest customer rows |

**Finding count: 11.**
