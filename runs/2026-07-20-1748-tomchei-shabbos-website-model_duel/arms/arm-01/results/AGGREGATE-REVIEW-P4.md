# Aggregate Review — P4 — arm-01

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-01`
**Phase:** P4 — Cart-first order builder, address book, customer account, guest draft access
**Output:** `arms/arm-01/results/AGGREGATE-REVIEW-P4.md`

**Inputs aggregated:**
- `results/reviews/P4-security-arm-01.md` (9 findings: 0 High, 2 Med, 5 Low, 2 Info)
- `results/reviews/P4-quality-arm-01.md` (11 findings: 3 High, 4 Med, 4 Low)
- `results/reviews/P4-rules-arm-01.md` (11 findings: 3 Violations + 8 Minors)
- `results/reviews/P4-clean-code-arm-01.md` (9 findings: Rule-of-2 + magic-value + god-file)

**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings introduced during aggregation.

**Severity mapping:** security High + quality High = **blocker**; security Med + quality Med + rules Violation + clean-code Rule-of-2/god-file = **major**; security Low + quality Low + rules Minor + clean-code magic-value = **minor**; Informational = **minor (info)**.

---

## Counts

| Severity | Count |
|---|---|
| Blocker | 3 |
| Major | 9 |
| Minor | 19 |
| **Total** | **31** |

---

## Blockers (3)

### B1 — ON_ORDER recipient picker falls back to first address-book entry
**Sources:** Q F1, RULES clean-code MINOR (onOrderAddresses fallback)
**Locations:** `src/components/order-builder.tsx:392-402`
**Claim:** When a line is the first to be assigned, `onOrderAddresses` is empty so the picker renders `addresses.slice(0, 1)` — the customer's first saved address presented under "Already on this order." The smoke test bypasses the UI (POSTs lines directly with `recipientSource: "ON_ORDER"`), so S1 passes without exercising this path. The real flow misrepresents the source and lets the user "assign to on-order" by picking an unrelated address-book entry.

### B2 — New-recipient dialog receives stale `null` draftId for guests on first add
**Sources:** Q F2
**Locations:** `src/components/order-builder.tsx:374-377, 450`
**Claim:** `ensureDraft().then(() => setAddressDialog({...}))` fires before `setDraftId` has flushed into the closure, so `RecipientAddressDialog` is rendered with `draftId={null}`. For a guest, the dialog POSTs `/api/account/addresses` with `draftId: null`; `resolveCustomerId` returns null and the save fails with 404 "Address book not found." The first new-recipient add for a guest is broken; subsequent adds work once `draftId` state has settled.

### B3 — localStorage draft is not scoped by customer (cross-customer data leak)
**Sources:** Q F3
**Locations:** `src/components/order-builder.tsx:59, 89-104`
**Claim:** `STORAGE_KEY = "tomchei-p4-draft"` is shared across every customer on the browser. On `/order` (no `?draft=`), the restore effect reads the persisted `{draftId, draftVersion, lines}` and adopts them regardless of who is signed in. Customer B signing in on a browser where customer A left a draft loads A's `draftId` and line items, then every autosave PATCHes `/api/order/drafts/{A's id}` → 404, leaving B staring at A's cart contents behind a "Draft could not be saved" error. Product names and quantities leak across identities.

---

## Majors (9)

### A1 — Inventory availability check is non-atomic (TOCTOU) in draft PATCH
**Sources:** SEC M1, SEC I1 (pairs to enable oversell)
**Locations:** `src/app/api/order/drafts/[draftId]/route.ts:74-180`
**Claim:** `PATCH /api/order/drafts/[draftId]` reads each product's `inventoryItem.onHand - reserved` outside the transaction (lines 75-84), validates `line.quantity <= availableQuantity` in plain JS (lines 103-108, 120-125), then opens `db.$transaction` and writes order lines without re-checking stock or reserving anything inside the transaction (lines 141-180). Two concurrent PATCH calls on two drafts can both observe the same `availableQuantity` and both succeed, committing demand beyond on-hand stock. P4 EXPECTED requires "inventory-aware live stock in builder"; the live read is correct but the save path is racy. Pairs with I1: PATCH performs no write to `inventoryItem.reserved`, so the inventory-aware check is display-only at save time.

### A2 — Unauthenticated guest draft creation with no rate limiting or dedup
**Sources:** SEC M2
**Locations:** `src/app/api/order/drafts/route.ts:11-60`
**Claim:** `POST /api/order/drafts` is fully public (no auth, no Clerk session) and, for guests, creates a brand-new `Customer` row plus an `Order` row on every call (lines 27-45). No dedup by `email`/`emailNormalized`, no per-IP or per-token rate limit, no proof-of-work/captcha. A script can hammer the endpoint and grow the `Customer` and `Order` tables unboundedly, and each call mints a 30-day guest access token. The endpoint must exist for guest checkout; the finding is the missing abuse controls.

### A3 — Guest access token returned in response body and accepted via Bearer header
**Sources:** SEC L1, Q F7
**Locations:** `src/app/api/order/drafts/route.ts:46-58`; `src/lib/customer-access.ts:19-30`
**Claim:** The 30-day guest bearer is set as an `httpOnly`, `sameSite=lax`, prod-`secure` cookie (good), but the same token is also returned in the JSON body (`accessToken`, line 47) and `getDraftAccessToken` additionally accepts it from an `Authorization: Bearer` header (lines 20-23). The UI never reads the body token (relies on the cookie), so the body copy only exposes the bearer to any JS that can read the fetch response — defeating the httpOnly protection for no client benefit. The Bearer path broadens the disclosure surface beyond the httpOnly cookie.

### A4 — Guest address book is not rehydrated on refresh
**Sources:** Q F4
**Locations:** `src/app/(storefront)/order/page.tsx:25-30`; `src/components/order-builder.tsx:75`
**Claim:** `initialAddresses` is `[]` for guests (only authenticated customers get `db.customerAddress.findMany`). A guest who creates a new recipient mid-order and then refreshes loses every address from the picker, even though persisted draft lines still reference those address IDs and the server still owns them. The "edit saved address mid-order" capability silently degrades to "no addresses available" for guests after refresh.

### A5 — PATCH drafts deletes and recreates every line on each debounced save
**Sources:** Q F5
**Locations:** `src/app/api/order/drafts/[draftId]/route.ts:151-175`
**Claim:** Each autosave (500 ms debounce) issues `orderLine.deleteMany` + a `create` loop for every line. For a cart-first builder where quantity keystrokes trigger autosave, this churns the DB, breaks line `id` stability (the server-assigned line id changes on every save), and widens the race window: a stale `version` produces a 409 the client does not recover from (see A6). No per-line upsert/patch path exists.

### A6 — Client does not recover from 409 draft conflict
**Sources:** Q F6
**Locations:** `src/components/order-builder.tsx:163-180`
**Claim:** `saveDraft` catches a non-OK response and only writes the error message into `saveState`. On a 409 ("This draft changed in another browser. Reload before saving.") the client keeps its stale `draftVersionRef`, so every subsequent save also 409s and the user is stuck with a "Draft could not be saved" banner and no path forward short of a hard reload.

### A7 — `formatDraftReference` is dead code; drafts route uses an ad-hoc random format
**Sources:** RULES clean-code VIOLATION, CC F4
**Locations:** `src/domain/order-engine.ts:15-21`; `src/app/api/order/drafts/route.ts:41`
**Claim:** `formatDraftReference(sequence)` (validates positive integer, pads to 8, `D-` prefix) has zero call sites. The drafts route inlines `D-${randomInt(1, 100_000_000).toString().padStart(8, "0")}` instead. Dead code + duplicated logic + pattern drift: the helper implies a sequential-safe guarantee the live code does not provide (random, collision-prone). Either route the POST through `formatDraftReference` or delete the helper.

### A8 — Duplicated `tomchei-p4-draft` localStorage key across two files
**Sources:** RULES clean-code VIOLATION, CC F8
**Locations:** `src/components/order-builder.tsx:59`; `src/components/account-actions.tsx:17`
**Claim:** `STORAGE_KEY = "tomchei-p4-draft"` is re-typed as the bare literal `"tomchei-p4-draft"` in `account-actions.tsx` (`window.localStorage.removeItem(...)`). Rule of 2 met; one source of truth needed. Lift to a shared constant in `src/lib/` and import from both. The `p4` segment is also a change-explanation artifact — the storage key is a long-lived client contract and will outlive this phase; rename to `tomchei-order-draft`.

### A9 — `.scratch/phase-plan.md` is still the P3 plan
**Sources:** RULES workflow VIOLATION
**Locations:** `arms/arm-01/workspace/.scratch/phase-plan.md`
**Claim:** Workflow (Expectation Files) requires the rolling phase plan to be rewritten per phase with todos + per-todo EXPECTED blocks written before building. The surviving `phase-plan.md` lists P3 items only; P4-STATUS.md carries the EXPECTED checklist instead, but the rolling artifact was not updated for P4. Carried process gap from P3, now visible because the stale file survives.

---

## Minors (19)

### m1 — Guest draft customer accepts arbitrary caller-supplied email with no verification
**Sources:** SEC L2
**Locations:** `src/app/api/order/drafts/route.ts:18-34`; `src/lib/normalize.ts:1-3`
**Claim:** A guest supplies `displayName` and `email` in the request body and they are persisted verbatim (normalized) onto a new `Customer` row. No email-ownership verification, no rate limit. A caller can register draft customer records under a victim's email, polluting the customer table with arbitrary PII. No account takeover (join is on `clerkUserId`, not email), so impact is data pollution.

### m2 — `recipientSource` not cross-validated against `recipientAddressId` / on-order membership
**Sources:** SEC L3, Q F10
**Locations:** `src/app/api/order/drafts/[draftId]/route.ts:61-133`
**Claim:** The PATCH validates that `recipientSource` is a member of `RecipientAssignmentSource` and that `recipientAddressId` belongs to the draft's `customerId`, but never checks the address is consistent with the chosen source — e.g., a line labeled `ON_ORDER` may point at any own address-book entry, and `ADDRESS_BOOK` may reference an address already assigned elsewhere on the order. The three-way picker's integrity constraint is not enforced server-side; only "owned by this customer" is. The account order detail page then renders "Recipient not assigned" for a line the user believes they assigned.

### m3 — Guest token-clear endpoint is gated on `status: "DRAFT"`, unreachable after finalization
**Sources:** SEC L4
**Locations:** `src/app/api/order/drafts/[draftId]/success/route.ts:10-18`; `src/lib/customer-access.ts:41-59`
**Claim:** `POST .../success` clears `guestAccessTokenHash` / `guestAccessExpiresAt` and expires the cookie, but it locates the draft via `findAccessibleDraft`, which requires `status: "DRAFT"`. Once an order is finalized, the endpoint returns 404, so the explicit clear cannot run in the intended post-success flow. The token is dead anyway (FINALIZED drafts also 404 from `findAccessibleDraft`), so residual risk is limited to the 30-day cookie persisting on the client with no server-side revocation path.

### m4 — Residual test-auth `__local_manager__` shortcut and spoofable host gate
**Sources:** SEC L5
**Locations:** `src/lib/auth.ts:23-57, 59-71`
**Claim:** The P3 test-auth header is now HMAC-signed (`TEST_AUTH_SECRET`, 5-minute expiry, `timingSafeEqual`), mitigating the prior H1. Two residuals remain: (1) `getCurrentStaffUser` still maps `clerkUserId === "__local_manager__"` to "first active MANAGER" (lines 65-71), granting a full manager identity without a real Clerk session; (2) the test-auth gate still trusts the client-sent `Host` header (`127.0.0.1`/`localhost`) and a single env boolean. The `.env` in this run does not set `TEST_AUTH_SECRET`, so the path currently throws rather than authenticates — but if a deployment sets the secret and `ENABLE_TEST_AUTH=true` with `NODE_ENV != production`, any holder of the secret can forge `__local_manager__`. Downgraded from P3 High to Low due to the signing.

### m5 — (info) Saving a draft does not reserve inventory
**Sources:** SEC I1
**Locations:** `src/app/api/order/drafts/[draftId]/route.ts:141-180`
**Claim:** `PATCH .../drafts/[draftId]` updates `subtotalCents`/`totalCents`/`version` and rewrites order lines but performs no write to `inventoryItem.reserved`. "Inventory-aware live stock in builder" is display-only at save time. Design choice for P4 (capture is P5), not a vulnerability; flagged because it pairs with A1 to enable oversell.

### m6 — (info) Impersonation cookie-clear omits attributes present on set
**Sources:** SEC I2
**Locations:** `src/app/api/admin/impersonation/route.ts:97-100`
**Claim:** `DELETE /api/admin/impersonation` clears the cookie with only `path: "/"` and `maxAge: 0`, omitting the `httpOnly`, `secure`, and `sameSite` attributes used when setting it (lines 51-57). Some browsers scope cookie deletion by attribute set, so the clear can be unreliable. The DB session is also left with `endedAt: null` if the cookie fails to clear, though `getCurrentStaffUser` re-validates against the actor.

### m7 — Address dialog hardcodes `countryCode: "US"`
**Sources:** Q F8, RULES clean-code MINOR, CC F7
**Locations:** `src/components/recipient-address-dialog.tsx:75`; `src/domain/customer-address.ts:39, 53`
**Claim:** `validateAddress` supports non-US postal codes (only applies the 5-digit regex when country is US), but the dialog forces `countryCode: "US"` with no input. Non-US recipients cannot be created through the builder; the validator's international branch is dead code in the UI. Editing a non-US saved address silently overwrites its country. Define `const DEFAULT_COUNTRY = "US"` in `domain/customer-address.ts` and pass through `address?.countryCode`.

### m8 — Quantity input accepts non-integer values
**Sources:** Q F9
**Locations:** `src/components/order-builder.tsx:318-322`
**Claim:** `Math.max(1, Number(event.target.value))` admits `1.5`; the server later rejects with `Number.isSafeInteger` → 400 "Every draft line must be valid." The user can type a fractional quantity, see it accepted in the UI, then hit a save error with no field-level indication of which line is invalid.

### m9 — Orphaned guest `Customer` rows on every draft
**Sources:** Q F11
**Locations:** `src/app/api/order/drafts/route.ts:25-34`
**Claim:** Each guest POST creates a permanent `Customer` row (`displayName: "Guest customer"`, no email) plus any addresses they add. Success revokes the token but leaves the customer and address book behind with no reclamation path. P4 has no cleanup; the table accumulates one row per abandoned guest draft.

### m10 — Ladder tags absent on P4 shortcuts
**Sources:** RULES ponytail MINOR
**Locations:** `src/lib/customer-access.ts:1-17`; `src/app/api/order/drafts/route.ts:1`
**Claim:** `customer-access.ts` uses `node:crypto` `randomBytes`/`createHash` (stdlib, rung 2) and the drafts route uses `randomInt` for draft refs. The rule asks deliberate ladder choices to carry a `ponytail:` comment (name ceiling + upgrade path). None present. Carried pattern from P2/P3.

### m11 — Modal a11y still incomplete (ponytail "never cut a11y")
**Sources:** RULES ponytail MINOR
**Locations:** `src/components/recipient-address-dialog.tsx:88-93`; `src/components/builder-product-card.tsx:72-77`
**Claim:** `RecipientAddressDialog` and `ProductQuickView` set `role="dialog"`/`aria-modal="true"`, but neither moves focus into the dialog on open, traps focus, nor closes on Escape. Same gap as the P3 catalog quick-view. The close affordance is keyboard-reachable only by Tabbing in from outside.

### m12 — `order-builder.tsx` is a mixed-concerns god file
**Sources:** RULES ponytail MINOR, CC F5
**Locations:** `src/components/order-builder.tsx` (486 lines)
**Claim:** 486 lines and four concerns in one component: draft lifecycle (create/restore/autosave/version ref/localStorage), line CRUD, subtotal memo, and the full cart + recipient-assignment JSX. Trips the ponytail god-file trigger ("mixed concerns") and will cross 500 on the next feature. Split candidates: `useDraftPersistence(initialDraftId)` hook, `useOrderLines()` hook, `CartLineCard` component (lines 282-419), `CartAside` component. Each new file has a single concern; none is a size-only split.

### m13 — Hand-retyped client types drift from Prisma
**Sources:** RULES clean-code MINOR
**Locations:** `src/components/order-builder.tsx:14-57`
**Claim:** `BuilderAddress`, `BuilderProduct`, `BuilderLine` re-declare shapes Prisma already generates. Use `Prisma.XGetPayload<{ select: ... }>` (or a shared `Pick`) so the client tracks schema changes — especially `version`, which both the address PATCH and draft PATCH rely on for optimistic concurrency. Carried P1→P4.

### m14 — `eslint-disable-line react-hooks/exhaustive-deps` masks the real fix
**Sources:** RULES clean-code MINOR
**Locations:** `src/components/order-builder.tsx:191`
**Claim:** The autosave effect disables the rule because `saveDraft`/`ensureDraft` are recreated every render and aren't memoized. Extract those into `useCallback` (or the `useDraftAutosave` hook above) so the dependency array is honest. Inconsistent with the "one state management pattern" aim.

### m15 — Duplicated address-book query (Rule of 2 met)
**Sources:** CC F1
**Locations:** `src/app/(storefront)/order/page.tsx:25-30`; `src/app/(storefront)/account/addresses/page.tsx:10-13`; `src/app/api/account/addresses/route.ts:25-28`
**Claim:** The identical `db.customerAddress.findMany({ where: { customerId }, orderBy: [{ label: "asc" }, { recipientName: "asc" }] })` query is copy-pasted across three call sites. Extract a `getCustomerAddresses(customerId)` helper into `lib/customer-access.ts` (already the customer-domain module) and call it from all three. Risk otherwise: orderBy drift the next time someone wants to change sort order.

### m16 — Duplicated line unit-price calculation — client/server drift risk
**Sources:** CC F2
**Locations:** `src/components/order-builder.tsx:220-234`; `src/app/api/order/drafts/[draftId]/route.ts:134-138`
**Claim:** The client computes the subtotal inline (reduce over lines, summing `product.priceCents + option.priceAdjustmentCents + addOns.priceCents` × quantity); the server re-implements the same formula in the PATCH. Two call sites, same logic, no shared source. Extract `computeLineUnitPriceCents(product, option, addOns)` (and a `computeSubtotalCents` reducer) into `domain/order-engine.ts` so the client preview and the server source-of-truth cannot diverge.

### m17 — `getAvailableQuantity` not reused on the write path
**Sources:** CC F3
**Locations:** `src/app/api/order/drafts/[draftId]/route.ts:103-108, 120-125`; `src/lib/storefront.ts`
**Claim:** `lib/storefront.ts` already exports `getAvailableQuantity` (used by `catalog/page.tsx` and `order/page.tsx`), but the PATCH draft route re-implements the math inline twice (product + add-ons) and without the `Math.max(0, …)` floor or the `tracksInventory ? null : …` contract. The inline version drops the `Math.max(0, …)` floor the shared helper enforces, so the two paths already disagree on negative stock. Reuse `getAvailableQuantity` on the server; do not re-derive.

### m18 — Duplicated draft-access resolution
**Sources:** CC F6
**Locations:** `src/app/api/account/addresses/route.ts:12-17`; `src/app/api/account/addresses/[addressId]/route.ts:18-22`
**Claim:** Both routes implement "authenticated customer, else fall back to `findAccessibleDraft(request, draftId).customerId`"; the `[addressId]` route inlines a narrower version. Extract `resolveCustomerId(request, draftId?)` into `lib/customer-access.ts` and use it from both — rule-of-2 met and the two will otherwise drift on the guest-vs-authenticated policy.

### m19 — `geocodeProvider` magic string + `geocodedAt = new Date()` masquerading as geocode
**Sources:** CC F9
**Locations:** `src/domain/customer-address.ts:56-57`; `src/app/(storefront)/account/addresses/page.tsx:35-37`
**Claim:** `"server-postal-validation"` is a magic string repeated at the write site and rendered in the addresses page; pull it into a constant. Setting `geocodedAt = new Date()` on every save — including pure label edits — claims a geocode happened when only postal regex ran. Either gate `geocodedAt` on actual geocoding or rename the provider to `postal-format` and leave `geocodedAt` null until a real geocode runs.

---

## Process notes (not scored as findings)

- **codegraph:** index present in workspace (`.codegraph/`); the rule's process requirement (CodeGraph MCP/CLI for all structural lookups, no grep-for-symbols) governs the development process and cannot be confirmed from the build artifact alone. Non-evaluable for process adherence. Same as P2/P3.
- **vocabulary:** PASS — P4 terms ("cart-first", "address book", "recipient", "on-order / address-book / new recipient", "draft", "guest access token", "account dashboard", "continue and pay", "cancel draft") used consistently across README, status, and code. No refactor/tidy/rebuild commands issued this phase.
- **grill-protocol:** PASS — deferred scope (P5 payment capture, fulfillment commitment) honestly delineated; no invented product direction.
- **workflow (smoke):** PASS — `.scratch/PHASE-P4-SMOKE.md` covers S1–S3 with exact command, raw JSON, page probes, and per-check PASS notes. P4-STATUS logs `npm run ci` 13/13 and `npm run build` pass. Clear improvement over P3.

---

## Dedupe map (specialist → aggregate)

| Specialist finding | Aggregate ID |
|---|---|
| SEC M1 (+ I1 pair) | A1 |
| SEC M2 | A2 |
| SEC L1 + Q F7 | A3 |
| SEC L2 | m1 |
| SEC L3 + Q F10 | m2 |
| SEC L4 | m3 |
| SEC L5 | m4 |
| SEC I1 | m5 (info) |
| SEC I2 | m6 (info) |
| Q F1 + RULES clean-code MINOR (onOrderAddresses) | B1 |
| Q F2 | B2 |
| Q F3 | B3 |
| Q F4 | A4 |
| Q F5 | A5 |
| Q F6 | A6 |
| Q F8 + RULES clean-code MINOR + CC F7 | m7 |
| Q F9 | m8 |
| Q F11 | m9 |
| RULES ponytail (ladder tags) | m10 |
| RULES ponytail (modal a11y) | m11 |
| RULES ponytail (god file) + CC F5 | m12 |
| RULES clean-code VIOLATION (formatDraftReference) + CC F4 | A7 |
| RULES clean-code VIOLATION (localStorage key) + CC F8 | A8 |
| RULES clean-code MINOR (hand-retyped types) | m13 |
| RULES clean-code MINOR (eslint-disable) | m14 |
| RULES workflow VIOLATION (phase-plan) | A9 |
| CC F1 (address-book query) | m15 |
| CC F2 (unit-price calc) | m16 |
| CC F3 (getAvailableQuantity) | m17 |
| CC F6 (draft-access resolution) | m18 |
| CC F9 (geocodeProvider) | m19 |



