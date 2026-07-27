# P4 Clean-code Review — arm-05

**Scope:** Cart-first order builder, address book, customer account — `shared/MERGED-BUILD-PLAN.md` § P4.
**Rule source:** `arms/arm-05/.cursor/rules/clean-code.mdc`.
**Method:** findings only — no fixes. Severity: `critical` / `major` / `minor` / `nit`.

## Summary

- Critical: 0
- Major: 3
- Minor: 6
- Nit: 4
- Total: 13

---

## Findings

### 1. Major — `lib/order-builder.ts` is a god file with mixed concerns

**Location:** `lib/order-builder.ts:1-373`.

**Claim:** A single 373-line module owns seven distinct concerns: Zod schemas (recipient/address/draft), customer resolution (`findCustomerForRequest`), guest-customer creation, draft CRUD (`createDraft`/`readDraft`/`saveDraft`), recipient resolution with geocode side-effects (`resolveRecipient`), address update with audit (`updateCustomerAddress`), account retrieval (`getAccount`), and draft serialization (`serializeDraft`). The clean-code rule "split when >500 lines, mixed concerns, or a refactor command" triggers on the mixed-concerns clause well before the 500-line ceiling.

**Evidence:** Exports span four unrelated domains: `draftSchema`/`addressSchema`/`recipientSchema` (validation), `findCustomerForRequest`/`createGuestCustomer` (identity), `createDraft`/`readDraft`/`saveDraft`/`serializeDraft` (draft lifecycle), `resolveRecipient`/`updateCustomerAddress` (address book + geocode + audit), `getAccount` (account read). `saveDraft` alone (lines 218-313) touches product lookup, inventory validation, option validation, add-on validation, recipient resolution, price calculation, and a transactional rewrite. A split along concern lines (e.g. `lib/drafts.ts`, `lib/customers.ts`, `lib/addresses.ts`, `lib/account.ts`) would localize each domain and shrink the longest file below the 500-line soft cap without changing behavior.

---

### 2. Major — `formatMoney` duplicated across five locations; `centsToDollars` ignored

**Location:** `lib/foundation.ts:7-12` (`centsToDollars`), `lib/storefront.ts:5-10` (`formatMoney`), `app/components/order-builder.tsx:52-54` (local `formatMoney`), `app/components/account-dashboard.tsx:14-16` (local `formatMoney`), `app/components/catalog-grid.tsx:16-18` (local `formatMoney`).

**Claim:** Five implementations of "format cents as USD" coexist, with two different names for the same operation. Three P4 client components redefine the helper locally instead of importing the existing one. Violates "one pattern per concern" and Rule of 2 (5 real call sites → must be a single helper). This is the same finding P3 raised; P4 added two more copies.

**Evidence:** All five bodies are `new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)` (the `catalog-grid` version omits the `cents / 100` argument shape but is functionally identical). `order-builder.tsx:52` and `account-dashboard.tsx:14` introduce new local copies in P4 files. No P4 component imports `formatMoney` from `lib/storefront` or `centsToDollars` from `lib/foundation`.

---

### 3. Major — Inventory-availability check duplicated on the client and divergent on the server

**Location:** `app/components/order-builder.tsx:151` (`addProduct`), `app/components/order-builder.tsx:175` (render), `app/components/catalog-grid.tsx:52`, `lib/order-builder.ts:236` (server-side).

**Claim:** The "is this product available?" predicate `product.inventoryItems.every((i) => i.quantityOnHand > i.quantityReserved)` is written three times in client code and a fourth time on the server with a different shape. The server version (`lib/order-builder.ts:236`) uses `product.inventoryItems[0]` — only the first inventory row — while the client uses `every(...)`. The two sides disagree on what "available" means when a product has more than one inventory row, which is exactly the kind of type/schema drift the rule calls out.

**Evidence:**
- Client (3 sites): `product.inventoryItems.every((inventory) => inventory.quantityOnHand > inventory.quantityReserved)`.
- Server (`lib/order-builder.ts:235-237`):
```ts
const inventory = product.inventoryItems[0];
if (inventory && inventory.quantityOnHand - inventory.quantityReserved < line.quantity) {
  throw new Error(`${product.name} no longer has enough stock.`);
}
```
A single `isProductAvailable(product)` helper (client) and a `getAvailableQuantity(product)` helper (server) would remove the duplication and the drift.

---

### 4. Minor — Address-coordinate write logic duplicated between `resolveRecipient` and `updateCustomerAddress`

**Location:** `lib/order-builder.ts:167-208` (`resolveRecipient` new-recipient branch), `lib/order-builder.ts:333-346` (`updateCustomerAddress`).

**Claim:** Both paths recompute `addressKey(input)`, look up `coordinatesForPostalCode(postalCode)`, then write `latitude`/`longitude`/`geocodedAt` (or null them out) and force `state.toUpperCase()`. The geocode-cache upsert is only in `resolveRecipient`, but the address-row write shape is duplicated. Rule of 2 is satisfied (2 real call sites).

**Evidence:** `resolveRecipient` lines 183-208 and `updateCustomerAddress` lines 337-347 share the same `latitude: coordinates ? new Prisma.Decimal(coordinates[0]) : null` triple plus `state: recipient.state.toUpperCase()` and `normalizedAddress`. A shared `addressWriteData(input, coordinates)` helper would collapse both writes and remove the risk of one path forgetting to uppercase state.

---

### 5. Minor — Inconsistent error-handling pattern across P4 API routes

**Location:** `app/api/order/drafts/route.ts:8-24` (try/catch + `maskError`), `app/api/order/drafts/[draftId]/route.ts:8-13` (GET: no try/catch), `app/api/order/drafts/[draftId]/route.ts:15-27` (PUT: try/catch + `maskError`), `app/api/addresses/[addressId]/route.ts:11-39` (try/catch only around `updateCustomerAddress`), `app/api/account/route.ts:4-8` (no try/catch at all).

**Claim:** Three of the five P4 route handlers wrap domain calls in `try { ... } catch (error) { return NextResponse.json({ error: maskError(error) }, { status: 400 }) }`; two do not. The `account` GET and the drafts GET leak unhandled prisma errors as 500s with stack traces in dev. Violates "one error-handling approach per project."

**Evidence:** `app/api/account/route.ts` is four lines with no try/catch; `app/api/order/drafts/[draftId]/route.ts` GET calls `readDraft` (which hits prisma) with no try/catch, while the PUT handler in the same file wraps `saveDraft` in try/catch. The pattern is inconsistent within a single file.

---

### 6. Minor — Status code inferred from substring matching on an error message

**Location:** `app/api/order/drafts/[draftId]/route.ts:25`.

**Claim:** The PUT handler decides between 404 and 400 by string-matching the masked error text: `message.includes("not found") || message.includes("access")`. Error messages are user-facing strings; using them as control flow couples HTTP status to wording and breaks if `maskError` ever rewords or localizes the message. Anti-AI-tics ("no 'just in case' code — every line must have a reason") and pattern drift from the `Authorization` discriminated union already returned by `authorize`.

**Evidence:**
```ts
const message = maskError(error);
return NextResponse.json({ error: message }, { status: message.includes("not found") || message.includes("access") ? 404 : 400 });
```
`saveDraft` and `readDraft` should return a discriminated result (`{ ok: false; code: "not_found" | "forbidden" | "conflict" }`) instead of throwing `Error` and re-parsing the message.

---

### 7. Minor — Magic TTLs and quantity limits duplicated without named constants

**Location:** `lib/order-builder.ts:135` (guest access expiry), `lib/order-builder.ts:178,180` (geocode cache TTL), `lib/order-builder.ts:36-37,40` and `app/components/order-builder.tsx:197` (max quantity 100), `lib/order-builder.ts:41` (max add-ons 10, max add-on quantity 20).

**Claim:** `1000 * 60 * 60 * 24 * 30` (30 days) and `1000 * 60 * 60 * 24 * 90` (90 days) are written inline as magic numbers. The `100` max quantity appears in both the server `draftSchema` and the client `<input max="100">` — two sources of truth for the same limit. The `2`-char state length and the postal-code regex are duplicated between `recipientSchema` and `addressSchema`.

**Evidence:**
- `lib/order-builder.ts:135`: `guestAccessExpiresAt: guestToken ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) : null`
- `lib/order-builder.ts:178,180`: `expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)` (twice in the same upsert)
- `lib/order-builder.ts:36`: `quantity: z.number().int().min(1).max(100)` vs `app/components/order-builder.tsx:197`: `<input min="1" max="100" ...>`
- `lib/order-builder.ts:17,28`: `state: z.string().trim().length(2)` and `postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/)` repeated in `recipientSchema` and `addressSchema`.

Named constants (`GUEST_ACCESS_TTL_MS`, `GEOCODE_CACHE_TTL_MS`, `MAX_LINE_QUANTITY`, `STATE_REGEX`, `ZIP_REGEX`) would remove the drift.

---

### 8. Minor — Hardcoded Brooklyn postal-centroid map with no provider abstraction

**Location:** `lib/order-builder.ts:78-85` (`coordinatesForPostalCode`).

**Claim:** A `Record<string, [number, number]>` literal with three Brooklyn zip codes (`11201`, `11205`, `11211`) is the entire geocode provider for P4. The values are magic data — the same three zips appear again in `lib/storefront.ts:3` as `defaultDeliveryZipCodes`. The plan defers real geocoding to later phases, but the hardcoded table is neither named as a fallback nor isolated behind a provider interface, so a future Mapbox swap requires touching order-builder internals.

**Evidence:**
```ts
const coordinates: Record<string, [number, number]> = {
  "11201": [40.6953, -73.9893],
  "11205": [40.6947, -73.9663],
  "11211": [40.7128, -73.9582],
};
return coordinates[postalCode.slice(0, 5)] ?? null;
```
The same three zips are in `lib/storefront.ts:3` as `defaultDeliveryZipCodes = ["11201", "11205", "11211"]`. Two sources of truth for the same domain constant.

---

### 9. Minor — `cart-fab` button uses `document.querySelector` instead of a React ref

**Location:** `app/components/order-builder.tsx:250`.

**Claim:** The mobile cart FAB scrolls the sidebar into view by calling `document.querySelector(".cart-sidebar")?.scrollIntoView(...)`. Direct DOM querying from inside a React component is an anti-pattern: it bypasses the React tree, couples behavior to a CSS class string, and breaks if a second `.cart-sidebar` ever mounts. A `useRef` on the aside (or an `id`) is the established React pattern.

**Evidence:**
```ts
<button className="cart-fab" onClick={() => document.querySelector(".cart-sidebar")?.scrollIntoView({ behavior: "smooth" })} type="button">Cart · {formatMoney(total)}</button>
```
No other P4 component uses `document.querySelector`; this is a pattern drift within the arm.

---

### 10. Nit — Repeated `Extract<Recipient, { kind: "new" }>` cast in recipient field bindings

**Location:** `app/components/order-builder.tsx:233,234,235,236,237`.

**Claim:** Five consecutive `onChange` handlers each cast `line.recipient as Extract<Recipient, { kind: "new" }>` to spread it before patching one field. The cast is repeated per field instead of being hoisted to a `setNewRecipientField(index, field, value)` helper that already knows the recipient is `kind: "new"`.

**Evidence:**
```ts
onChange={(event) => changeLine(index, { recipient: { ...(line.recipient as Extract<Recipient, { kind: "new" }>), recipientName: event.target.value } })}
```
Repeated for `line1`, `city`, `state`, `postalCode`. A single helper would remove five casts and shrink the JSX.

---

### 11. Nit — Nested ternary in recipient-kind `onChange`

**Location:** `app/components/order-builder.tsx:218-221`.

**Claim:** The recipient-kind select handler nests two ternaries to pick between `new`, `saved`, and `self`. The clean-code rule "if a function has more than 3 levels of nesting, refactor it" applies to the JSX expression; the nested ternary is also hard to read at a glance.

**Evidence:**
```ts
changeLine(index, { recipient: kind === "new" ? defaultRecipient([]) : kind === "saved" && draft?.addresses[0] ? { kind, addressId: draft.addresses[0].id } : defaultRecipient(draft?.addresses ?? []) });
```
A `recipientForKind(kind, addresses)` helper would make the intent explicit and remove the nesting.

---

### 12. Nit — Local `Address`/`Product` types drift between P4 components

**Location:** `app/components/order-builder.tsx:5-27` (`Address`, `Product`), `app/components/account-dashboard.tsx:6-12` (inline `Account` with `addresses` shape), `app/components/catalog-grid.tsx:5-14` (`CatalogProduct`).

**Claim:** Each P4 client component declares its own ad-hoc shape for `Address` and `Product`. `order-builder.tsx`'s `Address` has `label: string | null`; `account-dashboard.tsx`'s inline address shape omits `label` entirely. `order-builder.tsx`'s `Product` and `catalog-grid.tsx`'s `CatalogProduct` overlap but differ in `kind`, `media`, `options`. Type/schema drift — the rule calls for centralized types, single source of truth.

**Evidence:** Three local `Address`-ish shapes and two local `Product`-ish shapes exist in P4 alone; none are shared. A `lib/types.ts` (or colocated types in `lib/storefront.ts` next to the existing query) would let all three components import the same shape.

---

### 13. Nit — `guestCustomer!` non-null assertion relies on an invariant the compiler can't see

**Location:** `lib/order-builder.ts:132`.

**Claim:** `customer?.customerId ?? guestCustomer!.id` uses a `!` assertion. The non-nullness is guaranteed by the ternary two lines above (`const guestCustomer = customer ? null : await createGuestCustomer()`), but the compiler can't prove it across the `customer ? ... : ...` boundary. Restructuring to `customer ? { customerId: customer.customerId } : { customerId: (await createGuestCustomer()).id }` would remove the assertion.

**Evidence:**
```ts
const guestToken = customer ? null : makeGuestAccessToken();
const guestCustomer = customer ? null : await createGuestCustomer();
const draft = await prisma.order.create({
  data: {
    ...
    customerId: customer?.customerId ?? guestCustomer!.id,
```
Anti-AI-tics rule: "no redundant type assertions the compiler already guarantees" — here the assertion is the opposite (the compiler does *not* guarantee it), which is a stronger smell.
