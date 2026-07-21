# Aggregate Review — P4 — arm-03

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-03
**Phase:** P4 (cart-first order builder, address book, customer account, guest drafts)
**Inputs:** P4-security, P4-quality, P4-rules, P4-clean-code (arm-03)
**Method:** Union + dedupe by location+claim. Security blockers always survive. No new findings.

## Counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 11 |
| Minor | 29 |
| **Total** | **41** |

Source totals (pre-dedupe): security 11, quality 10, rules 15, clean-code 11 = 47. 6 findings merged into 6 cross-source clusters; net 41 unique.

## Blockers (1)

### B1 — Account takeover via unverified-email linking
**Sources:** security H1
**Location:** `lib/customers.ts:22-37` + `lib/auth.ts:55-67` (called from `resolveCustomerId` → `lib/orders/draft-access.ts:16-30` and `app/api/customer/link/route.ts:19-24`)
**Claim:** `linkOrCreateCustomer` links a Clerk identity to an existing `Customer` row purely on email match, and `getAuthIdentity` reads `primaryEmailAddress.emailAddress` without checking `verificationStatus`. If Clerk email verification is not enforced for a sign-in method (OAuth provider that skips verification, or a tenant where verification is optional), an attacker who controls an unverified email matching a victim's existing customer record inherits that customer's `id`, order history, drafts, and saved address book on first request — no further interaction. The staff-collision guard only blocks emails already on a `StaffUser`; it does not gate customer-to-customer linking on verification. Require `primaryEmailAddress.verification.status === "verified"` before linking by email; otherwise create a fresh customer or require a verification step.

## Majors (11)

### M1 — Guest draft token returned in response body and cookie is not httpOnly / not secure
**Sources:** security M1
**Location:** `app/api/drafts/route.ts:88-95, 111-119` + `lib/orders/drafts.ts:178-181`
**Claim:** `getOrCreateActiveDraft` returns the raw `guestAccessToken` inside the serialized draft JSON, and the `GUEST_DRAFT_COOKIE` is set with `httpOnly: false`, no `secure`, `sameSite: "lax"`. The storefront client never reads the token from the body (relies on the cookie), so returning it is unnecessary. XSS on the storefront origin can read `document.cookie` and exfiltrate the token, then mutate/take over the draft via the `x-guest-draft-token` header path; the raw token in the body can be captured by proxies, extensions, or client-side error reporters; without `secure`, the cookie is emitted over HTTP on a downgrade. Set the cookie `httpOnly: true; secure: true; sameSite: "lax"` and stop returning `guestAccessToken` in the JSON for the storefront path (keep the header path for POS only, minted through a separate flow).

### M2 — Address-book IDOR enumeration oracle (403 vs 404)
**Sources:** security M2
**Location:** `app/api/addresses/[id]/route.ts:29-34` + `lib/address/book.ts:115-119`
**Claim:** The customer PATCH maps `updateOwnedAddress`'s `forbidden` to `403` and `not_found` to `404`. An authenticated customer can `PATCH /api/addresses/{id}` with arbitrary IDs and distinguish "address exists but owned by someone else" (403) from "address does not exist" (404), enumerating other customers' saved-address IDs. The admin route uses a uniform 404, so the leak is specific to the customer endpoint. Collapse both branches to a single `404 "Address not found."` to match the anti-enumeration posture used in `loadDraftForAccess`.

### M3 — Unbounded unauthenticated guest-draft creation
**Sources:** security M3
**Location:** `app/api/drafts/route.ts:76-124` + `lib/orders/drafts.ts:119-182`
**Claim:** `POST /api/drafts` for a guest always calls `getOrCreateActiveDraft({ asGuest: true })`, which only dedupes existing drafts when `customerId` is provided — the guest branch has no "find existing" step. Each call mints a token, inserts an `Order` row, and writes a `DRAFT_CREATED` audit entry. No rate limit, no auth gate. An attacker can create thousands of orphan guest drafts, bloating `Order`, `AuditLog`, and the guest-token index. Either reuse the existing guest draft for the calling token (the GET path already finds it) or cap guest-draft creation per IP / session.

### M4 — `guest_success` PATCH is client-callable with no link to a placed order
**Sources:** security M4
**Location:** `app/api/drafts/[draftRef]/route.ts:75-86` + `lib/orders/drafts.ts:447-472`
**Claim:** The `guest_success` action is the P4 stand-in for "clear guest access after checkout success," but it is exposed as a plain client-callable PATCH and `markGuestDraftSuccess` only checks `status === DRAFT` (via `assertCanMutateDraft`) — it does not verify the draft was finalized/placed (no `OrderStatus.PLACED` gate, because finalize is P5). A guest can call `PATCH .../drafts/{ref}` with `{action:"guest_success"}` on their own still-open draft, which nulls `guestAccessTokenHash`, bumps `guestTokenVersion`, and sets `guestClearedAt`, permanently locking themselves out of the draft while it is still `DRAFT`. Until P5 wires this to a real finalize, gate the action behind a server-side precondition (e.g., only allow it once `status` has left `DRAFT`), or disable the client path and only invoke it from the finalize transaction.

### M5 — Migration backfill `addressNorm` diverges from app `buildAddressNorm` (dedupe breaks on upgrade)
**Sources:** quality F1
**Location:** `prisma/migrations/20260721220000_p4_builder/migration.sql:14-23` vs `lib/address/normalize.ts:11-26`
**Claim:** The backfill computes the dedupe key as `lower(trim(both FROM concat_ws('|', …fields…)))` — lowercased and outer-trimmed, but with no per-field trim and no internal whitespace collapse. The app's `buildAddressNorm` runs `part()` on each field (`trim().toLowerCase().replace(/\s+/g, ' ')`) then joins with `|`. For any pre-existing `SavedAddress` row with leading/trailing whitespace on a mid-field, or double-spaced input ("100  Main St"), the backfilled key differs from the app-computed key → the unique constraint does not fire on next save → a duplicate address-book entry is created, breaking UR-014 dedupe. The fresh-seed smoke never trips this because the seed writes via the app function on a clean table. A real upgrade with existing addresses would misbehave silently. (Same shape as arm-02 F1.)

### M6 — Add-on stock is never checked in `addDraftLine` (sold-out tracked add-ons can be added)
**Sources:** quality F2
**Location:** `lib/orders/drafts.ts:184-246`, `prisma/schema.prisma:319-334`
**Claim:** `AddOn.tracksInventory Boolean @default(true)` and `AddOn.inventory InventoryItem?` exist in the schema, but `addDraftLine` only validates the allow-list and `addOn.isActive` when constructing `addOnCreates`. There is no `availableUnits` check for add-ons at all — a sold-out tracked add-on can be added to any line. EXPECTED #4 calls for "inventory-aware live stock in builder"; add-on stock is not inventory-aware. (arm-02 F4 at least checked per-line; arm-03 checks not at all.)

### M7 — Product stock check is per-line, not cart-aggregated (builder allows oversell)
**Sources:** quality F3
**Location:** `lib/orders/drafts.ts:205-210` (add), `277-282` (qty update); `lib/inventory/reserve.ts:75-77`
**Claim:** Both `addDraftLine` and `updateDraftLineQty` check `availableUnits(inventory) = onHand - reserved` against the single line's quantity only. `reserved` is only incremented at checkout reserve (P5), so during draft building two lines of the same tracked product (or a qty increase on a second line) each pass individually while their combined demand exceeds `onHand`. The builder's "live stock" gate (EXPECTED #4) does not prevent oversell at draft stage. Smoke S1b adds `FAMILY-BOX` twice at qty 1 with `onHand=25`, so the collision is unexercised.

### M8 — No "edit saved address mid-order" flow in the builder (missing vs EXPECTED #2)
**Sources:** quality F4
**Location:** `components/order/assign-dialog.tsx:145-161`, `components/order/builder-shell.tsx:250-257`
**Claim:** EXPECTED #2 explicitly calls for "edit saved address mid-order". `AssignDialog` only supports `on_order` / `address_book` (pick from dropdown) / `new_recipient`. There is no edit affordance on a saved address from within the builder; the user must leave to `/account/addresses` (which itself only PATCHes, no delete). The mid-order edit path is unimplemented and unexercised by smoke.

### M9 — YAGNI: `lib/orders/finalize.ts` is speculative P5 code with no P4 caller
**Sources:** rules ponytail MEDIUM
**Location:** `lib/orders/finalize.ts` (`finalizeOrder` 344, `discardDraft` 424, `transitionOrder` 482, plus private `materializePackages`, `reserveOrderInventory`, `claimNextOrderNumber`)
**Claim:** A repo-wide grep for `finalizeOrder|transitionOrder|discardDraft` finds definitions only — zero call sites. P4's draft success path is `markGuestDraftSuccess` (in `drafts.ts`); order placement / package materialization / inventory reservation are P5 concerns (per `PHASE-P4-EXPECTED.md` "Out of scope: payment capture, fulfillment commitment (P5)"). ponytail § "No boilerplate 'for later.'"

### M10 — Duplicated `draftInclude` Prisma include (3 files)
**Sources:** rules clean-code MEDIUM, clean-code F1
**Location:** `lib/orders/drafts.ts:13`, `app/api/drafts/route.ts:12`, `app/api/drafts/[draftRef]/route.ts:11`
**Claim:** The same 13-line `lines: { include: { product, productOption, addOns, savedAddress, fulfillmentMethod } }, customer, season` object is byte-identical in three files. Drift risk on any schema change. Export once (e.g. from `lib/orders/draft-wire`, already imported by this module) and reuse. § duplicated logic / type-schema drift.

### M11 — DECISION-LOG.md missing (silent business-logic choices)
**Sources:** rules workflow VIOLATION
**Location:** `arms/arm-03/` (workspace root, `.scratch/`, arm root all checked — no `DECISION-LOG.md`)
**Claim:** P4 made several silent business-logic choices: draft≠Order lifecycle, `guestTokenVersion` rotation on clear, fake deterministic geocoder as the P4 provider, `on_order` = customer's default address, guest cookie `httpOnly: false` + 14-day maxAge, "checkout / pay ships in P5" gating. Workflow § "Never silently choose business logic — log in DECISION-LOG.md and flag." None are logged or flagged.

## Minors (29)

### m1 — Staff draft mutations are not attributed in the audit log
**Sources:** security L1
**Location:** `lib/orders/drafts.ts:257-262` (`addDraftLine`), and `assignDraftLine` / `updateDraftLineQty` / `removeDraftLine`
**Claim:** The `DRAFT_UPDATED` audit entries are written with no `actorId` and no `actorKind`, so when a staff member with `admin.access` mutates a customer's draft through `loadDraftForAccess` (which returns `actor.kind === "staff"`), the mutation is indistinguishable from a customer-self mutation in the audit trail. The address-book path got staff attribution for UR-014/G-019; the draft-mutation path did not. Thread `actor` (or at least `actorStaffId`) from `assertCanMutateDraft` into these audit writes.

### m2 — `GET /api/drafts` guest path scans up to 25 drafts per request with early-exit match
**Sources:** security L2
**Location:** `app/api/drafts/route.ts:52-68`
**Claim:** For a guest caller, the handler loads the 25 most-recent guest drafts and runs `guestTokenMatches` in a `.find` loop. The loop short-circuits on the first match, so response time varies with match position, and every request scans up to 25 rows plus their `draftInclude` graph. The result is `draft: null` either way (no body oracle), so this is a timing / cost side channel rather than a content leak. Index `guestAccessTokenHash` and look up by hash directly (store a derived lookup key, not the raw hash) instead of scanning.

### m3 — `/api/addresses/autocomplete` POST writes to `geocodeCache` with no rate limit
**Sources:** security L3
**Location:** `app/api/addresses/autocomplete/route.ts:29-45` + `lib/address/geocode.ts:48-80`
**Claim:** The POST validate path upserts a `GeocodeCache` row on every call. In dev mode the middleware short-circuits so the endpoint is fully unauthenticated; in prod it is behind Clerk `auth.protect()` but the handler does not distinguish customer vs. staff and has no throttle. Any caller can flood the cache with arbitrary `queryKey` rows. Not a takeover vector, but an unbounded DB-write surface. Add a rate limit and require a customer session for the validate/write path.

### m4 — `serializeDraft` and `/api/account` expose internal UUIDs
**Sources:** security L4
**Location:** `lib/orders/drafts.ts:100-116`, `app/api/account/route.ts:37-45`
**Claim:** `serializeDraft` returns `id` (order UUID) and `customerId` in the draft payload; `/api/account` returns `profile.id` (customer UUID). These internal Prisma IDs are reused as the `/account/orders/[id]` path parameter and the `/api/addresses/[id]` target. Exposing them is what makes the M2 enumeration probe possible in the first place, and they let a client correlate rows across seasons. Prefer the public `draftRef` / `orderNumber` for client-facing identifiers and keep the row `id` server-side.

### m5 — Staff-collision guard checks raw `email`, not `emailNorm`
**Sources:** security I1
**Location:** `lib/customers.ts:41`
**Claim:** `db.staffUser.findUnique({ where: { email } })` uses the normalized email returned from `normalizeEmail`, but the lookup key is `email` (not `emailNorm`). If `StaffUser.email` is ever stored with different casing than `Customer.emailNorm`, a same-mail collision could bypass the guard. Confirm `StaffUser.email` is normalized on insert, or query by `emailNorm` if that column exists.

### m6 — `cancelDraft` does not bump `guestTokenVersion` (and is not audited)
**Sources:** security I2, quality F6
**Location:** `lib/orders/drafts.ts:474-490` vs `446-472`
**Claim:** On cancel, `guestAccessTokenHash` is set to `null` (so `guestTokenMatches` returns false), but `guestTokenVersion` is not incremented — inconsistent with `markGuestDraftSuccess` (which does bump the version). Functionally safe today because the null hash blocks all matches, but if a future change re-uses the hash column without re-reading version, a stale token could revive. Separately, `cancelDraft` writes no audit entry while `markGuestDraftSuccess` writes `DRAFT_GUEST_CLEARED` — discarding a draft is a silent state change (G-019/audit expectations inconsistent across the two draft-terminal paths). Bump the version on cancel for symmetry and add an audit row.

### m7 — `on_order` mode server-errors with no inline recovery when the customer has no default address
**Sources:** quality F5
**Location:** `lib/orders/drafts.ts:354-366`, `components/order/assign-dialog.tsx:120-143`
**Claim:** `assignDraftLine` `on_order` resolves the customer's default (or most-recent) saved address and returns `err("address", "Add a default address to your account first.")` when none exists. `AssignDialog` enables "On order (self)" for any signed-in user with no preflight, so a signed-in customer with no saved addresses clicks the button and gets a raw error string with no path forward except navigating away. No fallback to the new-recipient form.

### m8 — Guest draft creation race can orphan a draft and lose lines
**Sources:** quality F7
**Location:** `components/order/builder-shell.tsx:63-75, 100-119`
**Claim:** `ensureDraft` does GET-then-POST. For a guest with no cookie yet, two concurrent calls (rapid double-click on Add before first load completes, or React strict-mode double-invoke) both GET `null`, both POST → two guest drafts are created. The second response overwrites the `guest_draft_token` cookie, orphaning the first draft and any lines added to it. The server's `getOrCreateActiveDraft` dedupes by `customerId+season` for auth drafts but not for guest drafts (each guest POST mints a new token). Smoke creates the guest draft once, serially, so the race is unexercised. Related to M3 (unbounded guest creation) but a distinct race/orphan claim.

### m9 — `CartSidebar` quantity/remove silently swallow failures and have no debounce
**Sources:** quality F8, rules clean-code MINOR
**Location:** `components/order/cart-sidebar.tsx:37-55, 105-113`; also `components/account/account-dashboard.tsx:84-91` (`cancelDraft`)
**Claim:** `updateQty` fires a PATCH on every `onChange` keystroke (typing "12" sends `1` then `12`) with no debounce, and `if (json.ok) onRefresh(json.draft)` silently drops non-OK responses — a stock-denied qty increase or network blip leaves the input showing the requested value while the server kept the old quantity, with no error surfaced. `account-dashboard.tsx` `cancelDraft` fires PATCH without checking `res.ok` either. EXPECTED #5 calls for "autosave drafts"; the autosave has no error/recovery UI. (cf. arm-02 F5.)

### m10 — `autocompleteAddresses` is a 4-row hardcoded stub (no real provider)
**Sources:** quality F9
**Location:** `lib/address/geocode.ts:82-130`
**Claim:** The autocomplete backing `/api/addresses/autocomplete` GET returns a fixed list of four Brooklyn addresses filtered by `includes`. EXPECTED #2 lists "address autocomplete + server validation"; the validation path is real (`validateAddressInput` + geocode), but the autocomplete suggestions are a deterministic stand-in (like the P3 media-stub flagged for arm-03). Works for smoke; not a real autocomplete backend.

### m11 — `account/orders/[id]` detail page does not filter by status (draft detail reachable as "order")
**Sources:** quality F10
**Location:** `app/(storefront)/account/orders/[id]/page.tsx:22-29`
**Claim:** The detail page uses `db.order.findFirst({ where: { id, customerId } })` with no status filter. Ownership is enforced (customerId filter, R-042), so it is not a cross-customer leak, but a customer can navigate to `/account/orders/<draftId>` and render a DRAFT as if it were a placed order. The account API only lists non-DRAFT/non-DISCARDED orders in `orders`, so the index is correct, but the detail route is status-agnostic.

### m12 — `finalize.ts` god-file bloat via double-blank-line formatting
**Sources:** rules ponytail MINOR
**Location:** `lib/orders/finalize.ts`
**Claim:** The file inserts a blank line between every statement, inflating ~270 lines of logic to 538. That pushes it past the ponytail/clean-code "split when >500 lines" trigger on a file that is pure padding. clean-code § Anti-AI-tics: "no over-verbose code that does in 10 lines what could be done in 3." Reformat to single-spaced and the file drops under the split line. (Moot if M9 deletes the file.)

### m13 — `ponytail:` ladder marker absent on P4 shortcuts
**Sources:** rules ponytail MINOR
**Location:** `lib/address/geocode.ts:27` (`fakeGeocode`, local ZIP-centroid provider), `autocompleteAddresses:121` (hard-coded Brooklyn street index)
**Claim:** Deliberate stdlib/native shortcuts with the upgrade path named in a comment but no `ponytail:` tag. Same gap as arm-01 / arm-02 P4.

### m14 — Duplicated address Zod schema (4 sites)
**Sources:** rules clean-code MINOR, clean-code F2
**Location:** `app/api/addresses/route.ts:8-19`, `app/api/addresses/[id]/route.ts:10-21`, `app/api/admin/addresses/[id]/route.ts:10-21`, `app/api/drafts/[draftRef]/assign/route.ts:9-20` (plus a narrower variant in `app/api/addresses/autocomplete/route.ts:19-27`)
**Claim:** The same 10-field `addressSchema` is hand-copied in four routes; a fifth narrower variant sits in autocomplete. Extract a shared `addressInputSchema` in `lib/address/normalize.ts` (which already owns `validateAddressInput`) and reuse. § duplicated logic / type-schema drift.

### m15 — `SavedAddress` client type defined 4× with drifting shapes
**Sources:** clean-code F3
**Location:** `components/order/builder-shell.tsx:11-20` (8 fields), `components/order/assign-dialog.tsx:6-15` (identical 8 fields, copy-pasted), `components/account/account-dashboard.tsx:14-26` (adds `latitude`/`longitude`/`geocodeStatus`/`addressNorm`), `app/(storefront)/account/addresses/page.tsx:7-20` (yet another shape `Address`)
**Claim:** Four hand-rolled client types describe the same SavedAddress entity. The first two are byte-identical; the latter two each drift a different subset. Centralize one `ClientSavedAddress` type (and an `AccountAddress` extension if the dashboard truly needs the geo fields) in `lib/address/types.ts` and import everywhere. API returns one shape, client redeclares it four times.

### m16 — `"US"` magic string repeated 6× as the default country
**Sources:** clean-code F4
**Location:** `lib/orders/drafts.ts:336`, `lib/address/normalize.ts:24`, `lib/address/normalize.ts:37`, `lib/address/geocode.ts:21`, `lib/orders/grouping.ts:29`, `lib/orders/finalize.ts:148`
**Claim:** `"US"` is inlined as the default country across the address/order domain. `lib/constants.ts` already exists but holds only `SETUP_LOCK_KEY`. Define `export const DEFAULT_COUNTRY = "US"` there and import it at all six sites. The value has domain meaning (the only supported country in P4) and a future country addition would require a six-site edit.

### m17 — Dead code: `void allowedIds;`
**Sources:** rules clean-code MINOR, clean-code F5
**Location:** `lib/orders/drafts.ts:219-232`
**Claim:** `const allowedIds = new Set(product.allowedAddOns.map((a) => a.addOnId))` is built but never read — the loop validates each add-on via `product.allowedAddOns.find(...)`. The trailing `void allowedIds;` exists solely to suppress the unused-variable lint. Delete both the `Set` construction and the `void`. § dead code / Anti-AI-tics ("just in case" code).

### m18 — Dead import: `void AuthError;`
**Sources:** rules clean-code MINOR, clean-code F6
**Location:** `app/(storefront)/account/orders/[id]/page.tsx:3, 32`
**Claim:** `AuthError` is imported only to be `void`-ed; the comment on line 31 ("Ownership already enforced by customerId filter") narrates the `where: { id, customerId }` filter two lines above. Drop the import and the `void` line. The `findFirst({ where: { id, customerId } })` already conveys the ownership guarantee.

### m19 — Redundant nested ternary — staff and guest branches identical
**Sources:** rules clean-code MINOR, clean-code F7
**Location:** `app/api/drafts/[draftRef]/assign/route.ts:35-40`
**Claim:** Both the `staff` and `else` (guest) arms return `order.customerId`, so `actor.kind === "staff"` is a dead check. Collapses to `actor.kind === "customer" ? actor.customerId : order.customerId`. The staff-vs-guest distinction has no effect here; keeping it implies a difference that does not exist (anti-AI-tics: no copy-paste patterns with minor variations).

### m20 — Duplicated guest-cookie set block
**Sources:** rules clean-code MINOR
**Location:** `app/api/drafts/route.ts:88-95` and `112-119`
**Claim:** The same 7-line `res.cookies.set(GUEST_DRAFT_COOKIE, ..., { path, httpOnly: false, sameSite, maxAge })` block is repeated. Extract a `setGuestCookie(res, token)` helper. § duplicated logic. (Note: the `httpOnly: false` flag here is the same defect as M1 — fixing M1 should update this helper.)

### m21 — Magic number `200` debounce
**Sources:** rules clean-code MINOR
**Location:** `components/order/assign-dialog.tsx:68`
**Claim:** A bare `200` ms debounce. Other P4 timings live as named constants; this one is inline. § magic values. Hoist to a named constant alongside the other P4 timing constants.

### m22 — Inconsistent button styling despite shared `<Button>` primitive
**Sources:** rules clean-code MINOR
**Location:** `components/order/cart-sidebar.tsx:97-116` (Remove, qty, Assign), `components/order/product-panel.tsx:89-110` (Quick view, Add), `components/order/assign-dialog.tsx:128-142` (mode picker), `components/account/account-dashboard.tsx:142-191`
**Claim:** A shared `components/ui/button.tsx` (primary/secondary/danger/ghost variants) exists, but P4 screens mix raw `<button>` + hand-rolled Tailwind. `assign-dialog` uses the shared `<Input>` but not `<Button>`. README § Patterns: "Styling: Tailwind + CSS variables." § UI Consistency / one styling approach.

### m23 — No `.scratch/run-state.md`
**Sources:** rules workflow MINOR
**Location:** `arms/arm-03/workspace/.scratch/` (absent)
**Claim:** P4 is a multi-phase feature; workflow § "Run checkpoint" says keep `run-state.md` for multi-phase / autonomous runs. `PHASE-P4-STATUS.md` exists but is a static gate summary, not the rolling `protocol / phase / last_gate_passed / next_action` checkpoint.

### m24 — No `.scratch/phase-plan.md` with EXPECTED blocks
**Sources:** rules workflow MINOR
**Location:** `arms/arm-03/workspace/.scratch/` (only `PHASE-P4-SMOKE.md` + `PHASE-P4-STATUS.md`)
**Claim:** Workflow § "Expectation Files" requires a rolling phase plan with an EXPECTED block written before each todo (route, control, behavior — observable). The shared `PHASE-P4-EXPECTED.md` exists, but the arm-03 `.scratch/` has no pre-todo expectation file. The smoke evidence (15/15 PASS, real HTTP) is good, but the "written before building" discipline is not shown.

### m25 — `assignDraftLine` copies 7 address fields field-by-field in 3 branches
**Sources:** clean-code F8
**Location:** `lib/orders/drafts.ts:339-398`
**Claim:** `assignDraftLine` sets `recipientName`/`addressLine1`/`addressLine2`/`city`/`state`/`postalCode`/`country`/`savedAddressId` in three sequential branches. The `address_book` branch (339-353) and the `on_order` branch (354-374) are near-identical: both destructure a `SavedAddress` row into the same eight locals. Extract `addressFieldsFromSaved(addr)` and call it from both branches; the `new_recipient` branch (375-397) differs enough to stay inline. Rule-of-2 met; the two saved-address branches will otherwise drift on the next field addition.

### m26 — Double address validation in autocomplete POST
**Sources:** clean-code F9
**Location:** `app/api/addresses/autocomplete/route.ts:29-35`
**Claim:** Zod (`validateSchema.parse`) checks `recipientName`/`line1`/`city`/`state`/`postalCode`/`country`, then `validateAddressInput` (hand-rolled regexes in `lib/address/normalize.ts:31-40`) re-checks the same fields plus the US-only constraint. Two validators for one shape — same class as P3 F5 (double email validation). Pick one: either move the `STATE_RE`/`ZIP_RE`/US-only rules into `.refine`s on the shared zod schema (m14) and drop `validateAddressInput`, or keep `validateAddressInput` as the sole validator and reduce zod to a raw shape check. Do not run both.

### m27 — Vague name `quick` (repeat of P3 F10 in a new file)
**Sources:** clean-code F10
**Location:** `components/order/product-panel.tsx:43-46`
**Claim:** `quick` is on the naming-rule ban list (vague standalone name) and the P3 review already flagged the identical name in `catalog-browser.tsx:38`. It holds the currently-selected quick-view product. Rename to `quickViewProduct` for grepability and to match the surrounding `quickViewId` / `data-testid="builder-quick-view"` naming.

### m28 — `normalizePart` / `part` — identical normalizer duplicated 2×
**Sources:** clean-code F11
**Location:** `lib/orders/grouping.ts:16-18` (`normalizePart`), `lib/address/normalize.ts:11-13` (`part`)
**Claim:** Byte-identical bodies, different names: `(value ?? "").trim().toLowerCase().replace(/\s+/g, " ")`. `lib/normalize.ts` already exists (it exports `normalizeEmail`) and is the natural home for a shared `normalizePart` helper. Rule-of-2 met; export once and import in both modules.

### m29 — Smoke coverage gaps (unexercised paths)
**Sources:** quality (implicit from F4, F7, F8, M2/M3 above)
**Location:** `.scratch/PHASE-P4-SMOKE.md` / `scripts/smoke-p4.mjs`
**Claim:** Smoke S1–S3 report 15/15 PASS but drive the API directly and do not exercise: the on_order no-default-address error path (m7), the guest draft creation race (m8), the cart-sidebar autosave error/no-debounce path (m9), the address-book 403-vs-404 enumeration oracle (M2), the unbounded guest-draft creation (M3), the add-on stock check (M6), the cart-aggregated product stock collision (M7), or the mid-order saved-address edit flow (M8). EXPECTED S1–S3 satisfied as written; the defects above have no smoke guardrail.

## Dedupe map

| Aggregate | Merged sources |
|---|---|
| M10 | rules clean-code MEDIUM ; clean-code F1 |
| M11 | rules workflow VIOLATION |
| m6 | security I2 ; quality F6 |
| m9 | quality F8 ; rules clean-code MINOR |
| m14 | rules clean-code MINOR ; clean-code F2 |
| m17 | rules clean-code MINOR ; clean-code F5 |
| m18 | rules clean-code MINOR ; clean-code F6 |
| m19 | rules clean-code MINOR ; clean-code F7 |

All other aggregate IDs are single-source. No new findings introduced.

## Pass notes (not counted)

- **Dependency discipline** (rules ponytail PASS): no new packages for P4; existing zod / prisma / node:crypto reused. `DRAFT_ACCESS_SECRET` reuses `NEWSLETTER_HMAC_SECRET` as fallback rather than adding infrastructure.
- **Running-app verification** (rules workflow PASS): `PHASE-P4-SMOKE.md` shows 15/15 PASS with real HTTP evidence (draft refs, status codes, subtotal recomputation, geocode lat/long, audit id, anti-enumeration 404s). Not "done from code alone."
- **Security basics** (rules workflow PASS): `.env*` in `.gitignore` with `!.env.example` exception; `DRAFT_ACCESS_SECRET` required (fail-closed); guest tokens HMAC-hashed with `timingSafeEqual`; ownership + uniform-404 anti-enumeration on drafts (`loadDraftForAccess`); staff address edit writes an atomic `ADDRESS_STAFF_EDITED` audit row (UR-014 / G-019).
- **Term accuracy** (rules vocabulary PASS): P4 terms (cart-first, three-way picker, on-order / address-book / new recipient, draft, guest access token, address book, account dashboard, continue / pay / cancel draft) used consistently across README, status, code, and UI copy. "Pay (P5)" placeholder correctly scopes the deferred feature.
- **Codegraph index** (rules codegraph PASS): `arms/arm-03/workspace/.codegraph/codegraph.db` exists (864 KB) with `.gitignore`. Unlike arm-02 P4 (which never initialized), arm-03 has the index. The init obligation is met; whether the contestant queried the graph vs. grepping cannot be proven from artifacts.

No Critical. No regressions vs P3. EXPECTED checklist items 1–8 are all implemented and smoke-verified (15/15 PASS); the defects above are quality/security issues in the implementation, not missing scope. Out-of-scope items (payment/Stripe, repeat orders) are correctly held.
