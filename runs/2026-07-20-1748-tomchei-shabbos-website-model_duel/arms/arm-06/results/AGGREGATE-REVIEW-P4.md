# P4 Aggregate Review — arm-06 (blind)

**Phase:** P4 — cart-first order builder, address book, customer account, guest checkout tokens
**Scope:** `arms/arm-06/workspace/`
**Sources (specialist reviews, findings only — no new findings):**
- `reviews/P4-security-arm-06.md`
- `reviews/P4-quality-arm-06.md`
- `reviews/P4-rules-arm-06.md`
- `reviews/P4-clean-code-arm-06.md`

**Method:** Union + dedupe by location+claim. Security blockers always survive. Severity kept at the highest band any source assigned; sources tagged on each item.

---

## Counts summary

| Band | Pre-dedupe (S+Q+R+CC) | Post-dedupe |
|---|---|---|
| Blocker | 0 + 0 + 0 + 0 | **0** |
| Major | 2 + 3 + 1 + 4 | **10** |
| Minor | 6 + 5 + 5 + 6 | **19** |
| **Total** | 32 | **29** |

Dedup merges (3):
- Guest-draft localStorage key magic string → CC M4 + Q m5 + R m-3 (CC rated Major; kept Major).
- Client-IP extraction inconsistency → CC M3 (seven sites, live drift) + S m6 (same drift, security lens); kept Major.
- No other location+claim overlaps.

No security blockers. No new findings introduced.

---

## Blockers

None.

---

## Major (10)

### MAJ-1. Guest draft save attaches to an existing customer account by email/phone with no verification
**Sources:** Security M1
**Where:** `app/api/drafts/route.ts` (guest branch, ~95–105) → `lib/customers/dedupe.ts` `findOrCreateCustomer` → `lib/orders/drafts.ts` `writeRecipients` → `saveAddress`.
**Claim:** Unauthenticated guest path dedupes on normalized email/phone and returns the existing `Customer` row when the email/phone belongs to someone else; `customerId` is set to that (possibly victim's) id, and `saveDraft` creates order + recipients under it. `recipient.saveToBook === true` injects rows into the victim's address book. No PII is read back (gated routes need `requireApiCustomer`), but it is attacker-driven account/order/address-book pollution against a known email with no ownership proof. Integrity violation.

### MAJ-2. Guest draft access token (bearer secret) carried in the URL query string
**Sources:** Security M2
**Where:** `app/(storefront)/order/page.tsx`, `app/(storefront)/checkout/page.tsx`, `components/order-builder/order-builder-shell.tsx` (`proceedToCheckout` / `submitGuestIdentity`), `app/api/drafts/[draftRef]/route.ts` `accessFrom`.
**Claim:** 32-byte HMAC bearer granting load/cancel/save access is passed as `?token=…` via `router.push`. Bearer secrets in URLs leak via browser history, server access logs (Vercel logs query strings by default), and `Referer` on subsequent navigation. Avoidable channel — a short-lived httpOnly cookie or body/header channel would keep the bearer out of logs/history.

### MAJ-3. Autosave never persists an emptied cart
**Sources:** Quality M1
**Where:** `components/order-builder/use-auto-save.ts:96` — `if (input.state.lines.length === 0) return;`.
**Claim:** Signed-in customer who removes every line never sends the empty state to the server; `POST /api/drafts` is never called and the stored draft keeps stale lines. Account dashboard then shows a draft with items no longer in the cart. The only empty-state save is `saveNow()` on checkout, but checkout is disabled when `lines.length === 0`, so the stale draft persists indefinitely. Correctness gap vs EXPECTED §5 ("autosave drafts").

### MAJ-4. `EditSavedAddressDialog` skips the deliverability probe
**Sources:** Quality M2
**Where:** `components/order-builder/edit-saved-address-dialog.tsx:31` → `PATCH /api/account/addresses/[id]`; `lib/customers/addresses.ts:102` `updateAddress`.
**Claim:** `AddRecipientDialog` calls `POST /api/addresses/validate` and surfaces the ZIP-allowlist result before creating a recipient, but `EditSavedAddressDialog` PATCHes directly with no validate call. `updateAddress` normalizes and geocodes but does not run `isDeliverable` against the shipping ZIP allowlist. A customer can edit a saved address to an out-of-area ZIP with no warning; the mid-order edit (EXPECTED §2) inherits the same blind spot. Validation seam exists, just not invoked on the edit path.

### MAJ-5. `AddRecipientDialog` adds the recipient even when undeliverable, with a P5 stub message
**Sources:** Quality M3
**Where:** `components/order-builder/add-recipient-dialog.tsx:71-73`.
**Claim:** When `deliverable === false`, the dialog sets an error string but still calls `onCreated(...)`, so the recipient lands on the draft regardless. The message references "pickup … at checkout," which is a P5 feature explicitly out of scope this phase. Customers are told a fulfillment option exists that the product does not yet offer. Either block the add or drop the forward-reference. Stub-ish behavior vs EXPECTED §2.

### MAJ-6. Customer session TTL drifts from the documented value (30d actual vs 12h documented)
**Sources:** Rules M-1
**Where:** `lib/customers/session.ts:15` — `CUSTOMER_SESSION_TTL_HOURS = 24 * 30` (720h / 30d). README § "Customer auth" and `.scratch/PHASE-P4-STATUS.md` both state "12h, revocable".
**Claim:** The constant is the source of truth for both the cookie `maxAge` and `CustomerSession.expiresAt`. A reviewer/operator trusting the README would believe customer sessions expire in half a day when they actually persist for a month — 60× drift on a security-relevant value. Either align the constant to 12h (mirroring staff) or correct the docs to 30 days; the two must agree.

### MAJ-7. Duplicated address-form UI across three dialogs
**Sources:** Clean-code M1
**Where:** `components/order-builder/add-recipient-dialog.tsx:102-147`, `components/order-builder/edit-saved-address-dialog.tsx:62-92`, `app/(storefront)/account/addresses/address-book.tsx:141-166` (`AddAddressDialog`).
**Claim:** The Street / Apt / City / State / ZIP field block (with the `grid grid-cols-3 gap-3` city-state row and the `w-32 inputMode="numeric"` ZIP input) is copy-pasted in three independent dialogs with the same `<label className="text-sm text-stone-700">…<Input … className="mt-1"/></label>` wrapper. Rule-of-2 extraction (3 call sites now): a shared `AddressFields` component would collapse all three and remove drift already present (recipient dialog hardcodes `country: "US"`/`region: "NJ"` defaults; edit dialog preserves `address.country`; add-address dialog has no country field).

### MAJ-8. Duplicated open-season assertion between the two draft engines
**Sources:** Clean-code M2
**Where:** `lib/orders/drafts.ts:40-47` (`assertOpenSeason`) vs `lib/orders/create-draft.ts:22-26` (inlined same lookup + `season.status !== "OPEN"` guard + same error messages).
**Claim:** Both engines are P4 code, both run inside `prisma.$transaction`, both need the identical assertion. `create-draft.ts` inlines instead of calling the helper; the copy will drift if the season-rule wording or closed-season behavior changes.

### MAJ-9. Duplicated client-IP extraction across seven call sites, with live drift
**Sources:** Clean-code M3 + Security m6
**Where:** `lib/auth.ts:90`, `lib/customers/session.ts:76`, `app/api/delivery-check/route.ts:19`, `app/api/drafts/route.ts:54-56`, `app/api/subscribe/route.ts:21`, `app/api/addresses/validate/route.ts:13` (missing `.slice(0, 45)`), `lib/rate-limit.ts:5` (comment).
**Claim:** The `request.headers.get("x-forwarded-for")?.split(",")[0].trim()…` pattern is repeated verbatim (with one drift) in seven places. `api/drafts/route.ts` already factored a local `clientIp(request)` helper but every other route inlines. The missing `slice(0, 45)` in `addresses/validate` is live drift — a 200-char spoofed first hop lands in the rate-limit key untruncated while the same IP through `delivery-check` is capped. One shared `clientIp(request)` helper in `lib/` would collapse all six inline copies and remove the drift. Security lens adds: the uncapped variant can produce arbitrarily long map keys and the rate-limit key shape varies per route.

### MAJ-10. Guest-draft storage key duplicated as a magic string
**Sources:** Clean-code M4 + Quality m5 + Rules m-3
**Where:** `components/order-builder/use-auto-save.ts:11` exports `GUEST_DRAFT_KEY = "arm06_guest_draft"`; `components/storefront/clear-guest-draft.tsx:12` re-inlines `localStorage.removeItem("arm06_guest_draft")`.
**Claim:** The two strings must stay byte-identical for the guest-draft clear-on-success contract (S2) to hold; a rename in one file silently breaks the other. `ClearGuestDraftOnSuccess` also re-implements the remove inline instead of calling the existing `clearGuestDraft()` helper, so there are two "clear the guest draft" implementations. Importing `GUEST_DRAFT_KEY` (and ideally calling `clearGuestDraft`) collapses both to one source of truth. Severity kept at the highest band assigned (CC Major); Q and R rated Minor.

---

## Minor (19)

### MIN-1. `POST /api/addresses/validate` is unauthenticated and reconstructs the delivery-ZIP allowlist
**Sources:** Security m1
**Where:** `app/api/addresses/validate/route.ts`.
**Claim:** Returns `{ deliverable: bool }` for any normalized ZIP. Checkout only publishes the count of delivery ZIPs, not the list — this endpoint lets an attacker probe arbitrary ZIPs to rebuild the allowlist (business information). Rate-limited 30/min per IP, but per-instance on serverless (MIN-3) and trivially parallelizable across IPs. Re-flagged from P3 `delivery-check` because P4 adds a second unauthenticated probe path.

### MIN-2. `POST /api/addresses/validate` upserts a GeocodeCache row on every call
**Sources:** Security m2
**Where:** `lib/customers/geocode.ts` `geocodeAddress` → `prisma.geocodeCache.upsert`.
**Claim:** Unauthenticated caller can bloat the `GeocodeCache` table with arbitrary normalized keys (one row per distinct address string). Rate-limited but per-instance (MIN-3); the table grows unbounded with attacker-chosen keys. The validate route does not need to persist a cache entry — it only returns the point + deliverability.

### MIN-3. Rate limiter is in-memory per-instance
**Sources:** Security m3
**Where:** `lib/rate-limit.ts` — fixed-window buckets in module scope (`new Map`).
**Claim:** On Vercel serverless each instance keeps its own map. Per-IP caps on `drafts`, `addresses/validate`, `delivery-check`, and `subscribe` are only a speed bump across instances; a determined caller rotating across instances/IPs bypasses the intended ceiling. The code comment acknowledges this for `subscribe`, but it applies to every unauthenticated rate-limited route added in P3/P4.

### MIN-4. Guest draft token stored in `localStorage`
**Sources:** Security m4
**Where:** `components/order-builder/use-auto-save.ts` `GUEST_DRAFT_KEY = "arm06_guest_draft"` persists `{ …, guestToken }` as JSON in `localStorage`.
**Claim:** Any XSS (now or via a future dependency) exfiltrates the bearer and gains draft load/save/cancel. The token is also written to the URL (MAJ-2). `localStorage` is reachable from JS by design; a session-style httpOnly cookie would not be. Distinct channel from MAJ-2 (URL) — both need addressing.

### MIN-5. Guest draft token never expires on the order row
**Sources:** Security m5
**Where:** `lib/orders/guest-token.ts`, `lib/orders/drafts.ts` — `guestTokenHash` stored on `Order` with no `expiresAt`; `loadOrderForCheckout` accepts the token for any status including `FINALIZED`.
**Claim:** A token that leaks once (logs, history, XSS) grants permanent read access to the draft and its recipient PII. A short TTL (or clearing `guestTokenHash` on `FINALIZED`) would bound the exposure.

### MIN-6. `ProductQuickView` supports only one option value across all of a product's options
**Sources:** Quality m1
**Where:** `components/order-builder/product-quick-view.tsx:22` — single `optionValueId` state shared across every option.
**Claim:** Picking a value from a second option overwrites the first. Matches the single-FK `OrderLine.optionValueId` schema (P3 shape, unchanged in P4), so it is a latent design gap rather than a P4 regression, but any future multi-option product will have a confusing builder UX. No seeded product currently has >1 option, so smoke does not catch it.

### MIN-7. `RecipientAssignDialog` creates a new recipient per pick with no dedupe
**Sources:** Quality m2
**Where:** `components/order-builder/recipient-assign-dialog.tsx:99` (book pick) and `:62` (on-order pick).
**Claim:** Picking the same book address (or the same on-order recipient) for two different lines creates two distinct `RecipientState` entries with fresh `clientId`s; the cart's recipient list then shows duplicates. Not a data bug (each line links correctly), but UX noise that the cart panel echoes.

### MIN-8. `OrderDetailPage` uses `order.draftRef!` non-null assertion
**Sources:** Quality m3
**Where:** `app/(storefront)/account/orders/[id]/page.tsx:60`.
**Claim:** `draftRef` is `String?` in the schema; drafts always have one (claimed at creation), but the assertion is unguarded. A future non-draft path through this component would crash. Low risk today.

### MIN-9. `account/orders/page.tsx` orders drafts-first by incidental string sort
**Sources:** Quality m4
**Where:** `app/(storefront)/account/orders/page.tsx:17` — `orderBy: [{ status: "asc" }, { updatedAt: "desc" }]`.
**Claim:** Puts DRAFT before FINALIZED only because "DRAFT" < "FINALIZED" alphabetically (DISCARDED is filtered out). Works, but it is an implicit status priority, not an explicit one; adding a new `OrderStatus` value could silently reorder the list.

### MIN-10. Inconsistent unique-violation handling (string-match vs `P2002`)
**Sources:** Rules m-2
**Where:** `lib/customers/addresses.ts:91-97` — `saveAddress` string-matches `error.message.includes("customerId_label")`. Compare `lib/customers/dedupe.ts:68-70` and `app/api/account/profile/route.ts:42` (both use `Prisma.PrismaClientKnownRequestError && error.code === "P2002"`).
**Claim:** String-matching a Prisma error message is fragile (message text is not a contract and can change across Prisma versions); the codebase already has the robust `P2002` pattern in two other P4 files. The dedupe pre-check makes this branch rare in practice, hence Minor.

### MIN-11. Vague parameter name `result`
**Sources:** Rules m-4
**Where:** `components/order-builder/order-builder-shell.tsx:88` (`const result = await apiFetch<...>(...)`) and `:99` (`if (!result.ok || !result.body.draftRef)`).
**Claim:** `result` is on the banned standalone-names list (`clean-code.mdc`). `saveResult` or `response` would pass and read clearer at the two call sites. Standing pattern of `result` usage in this arm to clean up.

### MIN-12. Vague setter callback name `value`
**Sources:** Rules m-5
**Where:** `components/order-builder/product-quick-view.tsx:121` (`setQty((value) => Math.max(1, value - 1))`) and `:132` (`setQty((value) => value + 1)`).
**Claim:** `value` is the conventional React setter-callback parameter and is arguably "universal in the domain," so this is borderline. `qty` or `nextQty` would describe what the number is. A maintainer may legitimately keep `value` here.

### MIN-13. `findDuplicate` full-scans a customer's addresses in memory
**Sources:** Rules m-6
**Where:** `lib/customers/addresses.ts:53-63` — `db.address.findMany({ where: { customerId } })` then in-memory `.find` against `addressDedupeKey(address)`.
**Claim:** The normalized dedupe key is computed in JS, not stored as a column, so a server-side filter is impossible without a schema change. For a typical customer this is a handful of rows and the function is called once per save. Flagged only because the scan grows with book size and an indexed `dedupeKey` column would make it O(1) — a design note, not a gate blocker.

### MIN-14. `RecipientState` construction inlined in two mapping sites
**Sources:** Clean-code m1
**Where:** `components/order-builder/recipient-assign-dialog.tsx:99-112` (from `BookAddress`) and `app/(storefront)/order/page.tsx:43-56` (from server `order.recipients[i]`).
**Claim:** Both sites repeat the same `clientId/source/name/line1/line2/city/region/postalCode/country/addressId/saveToBook/label` shape with the same field order. A pair of helpers (`recipientFromBook(address)`, `recipientFromOrder(row)`) would centralize the mapping (Rule of 2) and make the `source`/`saveToBook` defaults explicit in one place.

### MIN-15. Inline structural product type repeated in `draft-reducer.ts`
**Sources:** Clean-code m2
**Where:** `draft-reducer.ts:82` (`lineTotalCents`) and `:97` (`cartTotalCents`).
**Claim:** Each declares its own inline structural product type (`{ basePriceCents; options: { values: { id; priceDeltaCents }[] }[]; addOns: { id; priceCents }[] }`) instead of referencing `BuilderProduct` from `./types` (or a shared `PricedProduct` subset). The two inline literals are byte-identical today; a future field on `BuilderProduct` (e.g. a tax code) won't surface here unless both are updated.

### MIN-16. `CategoryChip` and `FilterButton` are the same chip
**Sources:** Clean-code m3
**Where:** `components/order-builder/product-panel.tsx:51-66` (`CategoryChip`) and `app/(storefront)/packages/packages-grid.tsx:251-267` (`FilterButton`).
**Claim:** Both render the same `aria-pressed` pill with the same `rounded-full border px-3 py-1 text-sm font-medium` classes and the same active/inactive class split. Two components doing one job; a shared `FilterChip` (or moving `FilterButton` to `components/ui/`) would let the builder and the storefront grid share it.

### MIN-17. `lowestPriceCents` / `priceLabel` duplicated between builder and storefront
**Sources:** Clean-code m4
**Where:** `components/order-builder/product-card.tsx:19-23` and `app/(storefront)/packages/packages-grid.tsx:26-37`.
**Claim:** Both compute `Math.min(0, ...product.options.flatMap(o => o.values.map(v => v.priceDeltaCents)))` and the `from ${formatCents(base + lowestDelta)}` label with identical math and formatting. A shared `lowestPriceCents(product)` + `priceLabel(product)` pair in `lib/money.ts` (or `lib/storefront/pricing.ts`) would remove the copy.

### MIN-18. `order-builder-shell.tsx` is approaching mixed-concerns
**Sources:** Clean-code m5
**Where:** `components/order-builder/order-builder-shell.tsx` (299 lines).
**Claim:** Holds reducer wiring, autosave subscription, checkout navigation flow, guest-identity collection, and defines `GuestIdentityDialog` in the same file. Under the 500-line split trigger, but the guest-identity flow (`GuestIdentityDialog` + `submitGuestIdentity` + `guestIdentityOpen`/`checkoutError` state) is a self-contained concern that would read more clearly as its own module. Not urgent — flagged for the next refactor pass.

### MIN-19. `proceedToCheckout` and `submitGuestIdentity` share an error/busy skeleton
**Sources:** Clean-code m6
**Where:** `components/order-builder/order-builder-shell.tsx:105-122` and `:124-140`.
**Claim:** Both follow `setCheckoutError(null)` → `setCheckoutBusy(true)` → `try { … router.push(/checkout?ref=…) }` → `catch (error) { setCheckoutError(error instanceof Error ? error.message : "Checkout failed") }` → `finally setCheckoutBusy(false)`. The two differ only in whether they call `saveNow()` or `saveNow({ guest })` and the token suffix. A small `runCheckoutFlow(redirect)` wrapper would remove the duplicated try/catch/finally scaffolding.

---

## Source index

| Tag | Specialist file |
|---|---|
| Security | `reviews/P4-security-arm-06.md` |
| Quality | `reviews/P4-quality-arm-06.md` |
| Rules | `reviews/P4-rules-arm-06.md` |
| Clean-code | `reviews/P4-clean-code-arm-06.md` |
