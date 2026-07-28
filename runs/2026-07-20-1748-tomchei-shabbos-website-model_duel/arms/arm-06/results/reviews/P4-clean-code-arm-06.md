# P4 Clean-Code Review — arm-06 (blind)

**Scope:** new P4 cart-first order-builder / address-book / customer-account code under
`arms/arm-06/workspace/` — `components/order-builder/*`, `lib/orders/{drafts,resolve-lines,create-draft,guest-token,numbers,state-machine}.ts`,
`lib/customers/{addresses,session,geocode}.ts`, `app/(storefront)/{order,checkout,account/*}/*`,
`app/api/{drafts,account,addresses/validate}/*`, `components/storefront/clear-guest-draft.tsx`.

**Focus:** duplication, naming, god files, pattern drift. Findings only — no fixes.
**Severity bands:** Blocker / Major / Minor. File paths cited.

---

## Blockers

None. The P4 surface is internally coherent: one trust boundary for line resolution
(`resolveDraftLines`), one draft engine (`saveDraft`/`loadDraft`/`cancelDraft`), one
address-book engine (`saveAddress`/`updateAddress`/`deleteAddress`), one client helper
(`apiFetch`), one auth gate (`requireApiCustomer`), one rate-limit module. No file exceeds
the 500-line split trigger (largest is `order-builder-shell.tsx` at 299 lines). Ownership
and anti-enumeration (404-on-miss, never 403) are applied consistently across the drafts
and account routes.

---

## Major

### M1. Duplicated address-form UI across three dialogs
The Street / Apt / City / State / ZIP field block (with the `grid grid-cols-3 gap-3`
city-state row and the `w-32 inputMode="numeric"` ZIP input) is copy-pasted in three
independent dialogs:

- `components/order-builder/add-recipient-dialog.tsx:102-147` (autocomplete suggestions +
  optional save-to-book checkbox).
- `components/order-builder/edit-saved-address-dialog.tsx:62-92` (label + the same five
  fields).
- `app/(storefront)/account/addresses/address-book.tsx:141-166` (`AddAddressDialog` —
  label + the same five fields).

All three use the same `<label className="text-sm text-stone-700">…<Input … className="mt-1"/></label>`
wrapper and identical placeholder/aria patterns. This is a clear Rule-of-2 extraction
(3 call sites right now): a shared `AddressFields` component (label + street + apt +
city/state + ZIP) would collapse all three and remove the drift already present (the
recipient dialog hardcodes `country: "US"` and `region: "NJ"` defaults; the edit dialog
preserves `address.country`; the add-address dialog has no country field at all).
Violates `clean-code.mdc` "duplicated UI — extract shared components" and "copy-paste
patterns with minor variations — extract the pattern."

### M2. Duplicated open-season assertion between the two draft engines
`lib/orders/drafts.ts:40-47` defines `assertOpenSeason(tx, seasonId)` (findUnique →
`NotFoundError("Season", …)` → `DomainRuleError("Season … is closed; expected OPEN …")`).
`lib/orders/create-draft.ts:22-26` inlines the exact same lookup-and-guard against the
same `season.status !== "OPEN"` condition with the same error messages, instead of
calling the helper. Both engines are P4 code, both run inside a `prisma.$transaction`,
and both need the identical assertion. The `create-draft.ts` copy will drift if the
season-rule wording or the closed-season behavior changes.
Violates `clean-code.mdc` "duplicated logic — pull into `lib/` helpers."

### M3. Duplicated client-IP extraction across seven call sites
The `request.headers.get("x-forwarded-for")?.split(",")[0].trim()…` pattern is repeated
verbatim (with one drift) in seven places:

- `lib/auth.ts:90` — `.slice(0, 45) ?? null`.
- `lib/customers/session.ts:76` — `.slice(0, 45) ?? null`.
- `app/api/delivery-check/route.ts:19` — `.slice(0, 45) ?? "unknown"`.
- `app/api/drafts/route.ts:54-56` — local `clientIp()` helper, `.slice(0, 45) ?? "unknown"`.
- `app/api/subscribe/route.ts:21` — `.slice(0, 45) ?? "unknown"`.
- `app/api/addresses/validate/route.ts:13` — `.trim() ?? "unknown"` **(missing the
  `.slice(0, 45)` cap the other six apply)**.
- `lib/rate-limit.ts:5` — comment describing the convention.

`api/drafts/route.ts` already factored a local `clientIp(request)` helper, but every
other route inlines. The missing `slice(0, 45)` in `addresses/validate` is live drift —
a 200-char spoofed `x-forwarded-for` first hop lands in the rate-limit key untruncated,
while the same IP through `delivery-check` is capped. One shared `clientIp(request)`
helper in `lib/` (returning the trimmed+sliced string or `"unknown"`) would collapse all
six inline copies and remove the drift. Violates `clean-code.mdc` "duplicated logic" and
"inconsistent patterns — pick one, apply everywhere."

### M4. Guest-draft storage key duplicated as a magic string
`components/order-builder/use-auto-save.ts:11` exports `GUEST_DRAFT_KEY = "arm06_guest_draft"`.
`components/storefront/clear-guest-draft.tsx:12` re-inlines the literal
`localStorage.removeItem("arm06_guest_draft")` instead of importing the constant. The two
strings must stay byte-identical for the guest-draft clear-on-success contract (S2) to
hold; a rename in one file silently breaks the other. Violates `clean-code.mdc` "magic
values — named constants" and the single-source-of-truth discipline.

---

## Minor

### m1. `RecipientState` construction inlined in two mapping sites
The `RecipientState` literal is built by hand from a `BookAddress` in
`recipient-assign-dialog.tsx:99-112` and from a server `order.recipients[i]` in
`app/(storefront)/order/page.tsx:43-56`. Both sites repeat the same
`clientId/source/name/line1/line2/city/region/postalCode/country/addressId/saveToBook/label`
shape with the same field order. A pair of helpers (`recipientFromBook(address)`,
`recipientFromOrder(row)`) would centralize the mapping (Rule of 2) and make the
`source`/`saveToBook` defaults explicit in one place.

### m2. Inline structural product type repeated in `draft-reducer.ts`
`lineTotalCents` (`draft-reducer.ts:82`) and `cartTotalCents` (`draft-reducer.ts:97`)
each declare their own inline structural product type
(`{ basePriceCents; options: { values: { id; priceDeltaCents }[] }[]; addOns: { id; priceCents }[] }`)
instead of referencing `BuilderProduct` from `./types` (or a shared `PricedProduct` subset).
The two inline literals are byte-identical today; a future field on `BuilderProduct`
(e.g. a tax code) won't surface here unless both are updated. Violates `clean-code.mdc`
"type/schema drift — centralize types, single source of truth."

### m3. `CategoryChip` and `FilterButton` are the same chip
`components/order-builder/product-panel.tsx:51-66` (`CategoryChip`) and
`app/(storefront)/packages/packages-grid.tsx:251-267` (`FilterButton`) render the same
`aria-pressed` pill with the same `rounded-full border px-3 py-1 text-sm font-medium`
classes and the same active/inactive class split. Two components doing one job; a shared
`FilterChip` (or moving `FilterButton` to `components/ui/`) would let the builder and the
storefront grid share it.

### m4. `lowestPriceCents` / `priceLabel` duplicated between builder and storefront
`components/order-builder/product-card.tsx:19-23` computes
`Math.min(0, ...product.options.flatMap(o => o.values.map(v => v.priceDeltaCents)))` and
the `from ${formatCents(base + lowestDelta)}` label. `app/(storefront)/packages/packages-grid.tsx:26-37`
defines `lowestPriceCents` and `priceLabel` with the identical math and identical "from"
formatting. The builder's `BuilderProduct` and the grid's `GridProduct` overlap on exactly
the priced fields; a shared `lowestPriceCents(product)` + `priceLabel(product)` pair in
`lib/money.ts` (or a `lib/storefront/pricing.ts`) would remove the copy.

### m5. `order-builder-shell.tsx` is approaching mixed-concerns
`components/order-builder/order-builder-shell.tsx` (299 lines) holds the reducer wiring,
the autosave subscription, the checkout navigation flow, the guest-identity collection,
and defines `GuestIdentityDialog` in the same file. It is under the 500-line split
trigger, but the guest-identity flow (`GuestIdentityDialog` + `submitGuestIdentity` +
the `guestIdentityOpen`/`checkoutError` state) is a self-contained concern that would
read more clearly as its own module. Not urgent — flagged for the next refactor pass.

### m6. `proceedToCheckout` and `submitGuestIdentity` share an error/busy skeleton
`order-builder-shell.tsx:105-122` (`proceedToCheckout`) and `:124-140`
(`submitGuestIdentity`) both follow `setCheckoutError(null)` → `setCheckoutBusy(true)` →
`try { … router.push(/checkout?ref=…) }` → `catch (error) { setCheckoutError(error
instanceof Error ? error.message : "Checkout failed") }` → `finally
setCheckoutBusy(false)`. The two differ only in whether they call `saveNow()` or
`saveNow({ guest })` and the token suffix. A small `runCheckoutFlow(redirect)` wrapper
would remove the duplicated try/catch/finally scaffolding.

---

## Summary

| Band   | Count |
|--------|-------|
| Blocker | 0     |
| Major   | 4     |
| Minor   | 6     |

The dominant theme is **duplication that crossed the Rule-of-2 threshold inside P4**:
the address-form UI (M1, three dialogs), the open-season assertion (M2, two engines),
the client-IP extraction (M3, seven sites with live drift), and the guest-draft storage
key (M4, two files). The minor findings are the same shape at smaller scale — recipient
mapping, the priced-product type, the filter chip, the price-label math — plus one
approaching-mixed-concerns file (`order-builder-shell.tsx`) and one duplicated
checkout-flow skeleton. No naming-hygiene violations in the new P4 surface (no banned
standalone names; `RecipientState`/`CartLine`/`BuilderProduct` read as their domain).
No competing patterns introduced: `apiFetch`, `parseBody`, `requireApiCustomer`,
`addressInputSchema`, and `resolveDraftLines` are reused consistently across the new
routes and components.
