# P4 Rules Review — arm-05 (blind)

Reviewer: Rules specialist
Phase: P4 — Cart-first order builder, address book, customer account
Plan ref: `shared/MERGED-BUILD-PLAN.md` § P4
Expected: `shared/phases/PHASE-P4-EXPECTED.md`
Arm rules: `.cursor/rules/{workflow,vocabulary,ponytail,clean-code,codegraph}.mdc` (all `alwaysApply: true`)
Scope: findings only — no fixes.

## Summary counts

- Critical: 1
- High: 4
- Medium: 5
- Low: 3
- Total: 13

## Findings

### R1 — Critical
**Location:** `app/components/account-dashboard.tsx:50-57`, `app/account/page.tsx`
**Claim:** P4 account area is missing required "order detail" and "cancel draft" surfaces; the only "Continue or cancel" link does not continue the specific draft.
**Evidence:** Plan § P4 deliverable: "Account area: dashboard, order history + detail, continue/pay/cancel draft (R-038..R-040); profile (ownership-enforced — R-042); saved-address account view (R-043)." `PHASE-P4-EXPECTED.md` item 8: "Account area: dashboard, order history + detail, continue/pay/cancel draft; profile ownership-enforced; saved-address account view." The dashboard renders only a summary list (`order-history` articles with `draftReference`, total, status) and a single `<Link className="button secondary" href="/order">Continue or cancel</Link>` that targets `/order` with no draft id. There is no order detail view, no cancel button, and no draft-id propagation. `app/order/page.tsx` always boots `OrderBuilder`, which on mount creates a new draft via `POST /api/order/drafts` unless `sessionStorage` happens to hold one. Opening the link in a fresh tab therefore starts a new draft rather than continuing the listed one. Violates `workflow.mdc` "Implement attached plans verbatim" and `workflow.mdc` "Completion checklist before 'done'".

### R2 — High
**Location:** `lib/order-builder.ts:52-54`, `lib/storefront.ts:5-10`, `app/components/order-builder.tsx:52-54`, `app/components/account-dashboard.tsx:14-16`, `lib/foundation.ts:7-12`
**Claim:** Money-formatting logic is duplicated four times across the codebase; P4 introduced three new copies instead of reusing the existing `centsToDollars` helper.
**Evidence:** `lib/foundation.ts` already exports `centsToDollars(cents)` (Intl.NumberFormat USD). `lib/storefront.ts` defines `formatMoney` with the identical body. `app/components/order-builder.tsx` defines a local `formatMoney` (same body). `app/components/account-dashboard.tsx` defines a local `formatMoney` (same body). Four copies of one concern. Violates `clean-code.mdc` "Duplicated logic — pull into `lib/` helpers", "One pattern per concern — one ... approach per project", and `workflow.mdc` "Read before edit -- reuse existing helpers, components, and patterns; don't introduce competing ones."

### R3 — High
**Location:** `lib/order-builder.ts:79-85`
**Claim:** `coordinatesForPostalCode` hardcodes a magic coordinate table for three zip codes.
**Evidence:** Lines 79-84 declare `const coordinates: Record<string, [number, number]> = { "11201": [...], "11205": [...], "11211": [...] }` and return `coordinates[postalCode.slice(0, 5)] ?? null`. No named constant, no config, no provider hook. This is a magic-value table masquerading as a geocode stub. Violates `clean-code.mdc` "Magic values — named constants / enums" and `ponytail.mdc` "No unrequested abstractions" (a stub with one consumer embedded in a domain module).

### R4 — High
**Location:** `lib/order-builder.ts:135`, `lib/order-builder.ts:178-180`
**Claim:** Guest-token and geocode TTLs are inline magic numbers with no named constant.
**Evidence:** Line 135: `guestAccessExpiresAt: guestToken ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) : null` (30-day guest token). Lines 178 and 180: `new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)` (90-day geocode cache TTL). Both literals appear inline with no constant. Plan § P2 R-162 calls for "geocode cache with TTLs" as a typed setting; the values belong in a named constant or the settings store. Violates `clean-code.mdc` "Magic values — named constants / enums".

### R5 — High
**Location:** `lib/order-builder.ts:327-359` (`updateCustomerAddress`), `app/api/addresses/[addressId]/route.ts:28-38`
**Claim:** Address edits do not detect normalized-address collisions with another existing address for the same customer; the unique constraint surfaces as a generic masked error.
**Evidence:** `updateCustomerAddress` computes `normalizedAddress = addressKey(addressInput)` and runs `prisma.address.update({ where: { id }, data: { ..., normalizedAddress } })`. The schema enforces `@@unique([customerId, normalizedAddress])` (`schema.prisma:255`). If the edit normalizes to a key that matches a different address owned by the same customer, Prisma throws `P2002`. The PATCH route catches via `maskError`, which in production returns `"Something went wrong. Please try again."` (`lib/foundation.ts:27`). `PHASE-P4-EXPECTED.md` S3 requires verifying "normalized dedupe"; `scripts/smoke-p4.ts:68-75` only edits the address to the same key it already owns, so the dedupe path is never exercised. Violates `clean-code.mdc` "Error messages say what went wrong AND what the expected state was" and `workflow.mdc` "Verify in the running app — never mark done from code alone" (the smoke check claims dedupe is verified but does not test the collision case).

### R6 — High
**Location:** `app/components/order-builder.tsx:193`
**Claim:** React list key mixes `productId` with the array index, which is unstable when lines are removed.
**Evidence:** `key={`${line.productId}-${index}`}` on the `<section className="card order-line">`. The same `productId` can appear on multiple lines (the smoke test adds `products[0]` twice — `scripts/smoke-p4.ts:38-39`), so `productId` alone is not unique; the index disambiguates. But line 194 renders a remove button that filters by index, so the array can shrink. React's key-warning guidance: keys that include the index cause state/input to follow the wrong item after a removal. Violates `clean-code.mdc` "Anti-AI-Tics — No copy-paste patterns with minor variations" and the React key-stability contract.

### R7 — Medium
**Location:** `lib/order-builder.ts:72`
**Claim:** `addressKey` hardcodes `"US"` as the country suffix and ignores the `Address.country` field.
**Evidence:** Line 72: `[address.line1, address.line2, address.city, address.state, address.postalCode, "US"].filter(...)`. The `Address` model has `country String @default("US")` (`schema.prisma:247`), but `addressKey` does not read it. The smoke test asserts the normalized key ends with `|us` (`scripts/smoke-p4.ts:51`) so the literal is baked in. Magic value plus schema drift. Violates `clean-code.mdc` "Magic values" and "Type/schema drift — centralize types, single source of truth".

### R8 — Medium
**Location:** `lib/order-builder.ts:117-121` (`createGuestCustomer`)
**Claim:** One-line helper with a single call site.
**Evidence:** `async function createGuestCustomer() { return prisma.customer.create({ data: { firstName: "Guest", lastName: "Checkout" } }); }` is called only from `createDraft` (line 128). One call site, no abstraction boundary. Violates `clean-code.mdc` "Rule of 2 — needs 2+ real call sites right now" and `ponytail.mdc` "No unrequested abstractions".

### R9 — Medium
**Location:** `app/components/order-builder.tsx:218-221`
**Claim:** Selecting "saved" silently resets the recipient to the first address in the book instead of preserving the currently selected addressId.
**Evidence:** The `onChange` handler for the recipient `<select>` does: `kind === "new" ? defaultRecipient([]) : kind === "saved" && draft?.addresses[0] ? { kind, addressId: draft.addresses[0].id } : defaultRecipient(draft?.addresses ?? [])`. When the user picks "saved", the addressId is forced to `draft.addresses[0].id` regardless of any previously selected saved address. If the user had picked the second saved address and then reopened the dropdown, the selection snaps back to the first. Violates `clean-code.mdc` "No defensive code for conditions that can't happen" (the defensive fallback clobbers real state) and the P4 requirement R-027/R-028 for recipient assignment dialogs.

### R10 — Medium
**Location:** `lib/order-builder.ts:233-264` (`saveDraft` validation), `lib/order-builder.ts:267-309` (`$transaction`)
**Claim:** Product and inventory validation runs outside the write transaction, so the validated state can drift before commit.
**Evidence:** Lines 221-264 fetch products, options, addons, and inventory, and check `inventory.quantityOnHand - inventory.quantityReserved < line.quantity` outside the `$transaction` block. The transaction (line 267) only deletes and recreates `OrderLine` rows; it does not re-validate stock. P4 drafts do not reserve inventory, so this is not a correctness bug today, but the structure sets up a TOCTOU race for P5 reservation. Violates `ponytail.mdc` "Never cut — data-loss prevention" (the pattern will leak) and `clean-code.mdc` "Inconsistent patterns" (validation and write use different scopes).

### R11 — Medium
**Location:** `lib/order-builder.ts:107`
**Claim:** Customer display name is derived by splitting the email on `@` and silently truncating to 80 chars.
**Evidence:** `const displayName = email?.split("@")[0] || "Customer"; ... data: { firstName: displayName.slice(0, 80), lastName: "", ... }`. Magic 80, magic fallback string `"Customer"`, and a heuristic that turns `john.doe+orders@example.com` into `john.doe+orders`. No named constant; the truncation is silent. Violates `clean-code.mdc` "Magic values" and "Error handling — No defensive code for conditions that can't happen" (the slice guards against a length the schema does not enforce).

### R12 — Low
**Location:** `app/api/order/drafts/route.ts:11-19`
**Claim:** POST response includes a hardcoded `addresses: []` field that is always empty and unused.
**Evidence:** The POST handler returns `{ draft: { ..., addresses: [], lines: [] }, guestToken }`. The client immediately calls `loadDraft(body.draft.id)` (`order-builder.tsx:109`), which GETs the draft and overwrites `draft` with `serializeDraft`'s output (`addresses: draft.customer?.addresses ?? []`). The POST `addresses` is dead data. Violates `clean-code.mdc` "Dead code — delete, don't comment out" and `ponytail.mdc` "Deletion over addition."

### R13 — Low
**Location:** `lib/order-builder.ts:233-251`
**Claim:** Per-line validation runs in parallel via `Promise.all` with side-effecting `resolveRecipient` upserts; a later-throwing line leaves earlier addresses created.
**Evidence:** `Promise.all(input.lines.map(async (line) => { ... await resolveRecipient(...); ... }))` runs all lines concurrently. `resolveRecipient` for `kind === "new"` performs `prisma.address.upsert` and `prisma.geocodeCache.upsert` (lines 171-208). If line N throws after line M's upsert committed, line M's address remains in the customer's address book even though the draft save failed. P4 has no compensating delete. Violates `clean-code.mdc` "No unrequested abstractions" (parallelism without a rollback boundary) and `ponytail.mdc` "Never cut — data-loss prevention" (orphan records).

## Out of scope (noted, not counted)

- `app/api/order/drafts/route.ts` and `app/api/order/drafts/[draftId]/route.ts` lack IP rate limiting. R-122 (public endpoint guards — same-origin, IP rate limit, Zod) is allocated to P5 in the plan, so this is not a P4 finding.
- `Order.version` field exists (`schema.prisma:277`) but `saveDraft` does not check it. Optimistic versioning is a P2 concern on inventory/package mutations; drafts are last-write-wins in P4.
- `app/api/account/route.ts` GET has no `hasSameOrigin` check. Reads behind cookie auth and default CORS are not a CSRF leak.
