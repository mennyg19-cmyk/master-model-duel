# P6 Clean-code Review — arm-05

**Scope:** Admin operations hub & POS — `shared/MERGED-BUILD-PLAN.md` § P6.
**Rule source:** `arms/arm-05/.cursor/rules/clean-code.mdc`.
**Method:** findings only — no fixes. Severity: `critical` / `major` / `minor` / `nit`.

## Summary

- Critical: 0
- Major: 5
- Minor: 14
- Nit: 2
- Total: 21

---

## Findings

### 1. Major — `lib/admin-operations.ts` is a god file mixing six P6 concerns

**Location:** `lib/admin-operations.ts:1-172`.

**Claim:** A single 172-line module owns six distinct P6 concerns: CSV parsing (`parseCsv`), customer/product staging (`stageImport`), atomic commit (`commitImport`), order list (`listOrders`), customer list (`listCustomers`), dashboard summary (`operationsDashboard`), and walk-in POS order creation (`createWalkInPosOrder`). The clean-code rule "split when >500 lines, mixed concerns, or a refactor command" triggers on the mixed-concerns clause. Even though the file is under the 500-line soft cap, it bundles imports, list/search, dashboard, and POS orchestration in one module.

**Evidence:** Exports span four unrelated domains: `parseCsv`/`stageImport`/`commitImport` (imports), `listOrders`/`listCustomers` (list/search), `operationsDashboard` (dashboard KPIs), and `createWalkInPosOrder` (POS order creation). A split along concern lines (e.g. `lib/admin/imports.ts`, `lib/admin/lists.ts`, `lib/admin/dashboard.ts`, `lib/admin/pos.ts`) would localize each domain and keep each file under the soft cap without changing behavior.

---

### 2. Major — `normalizeEmail` duplicated between `lib/admin-operations.ts` and `lib/foundation.ts`

**Location:** `lib/admin-operations.ts:23-25` vs `lib/foundation.ts:16-18`.

**Claim:** `normalizeEmail` is defined twice. `lib/foundation.ts:16` exports `normalizeEmail(email: string)` and is already imported by `lib/order-builder.ts:5`, `lib/newsletter.ts:3`, and `app/api/staff/route.ts:3`. `lib/admin-operations.ts:23` redefines `normalizeEmail(email: string | undefined)` locally and uses it four times (lines 57, 87, 156, 157). The only difference is the `?.` short-circuit on the optional input. Violates "duplicated logic — pull into `lib/` helpers" and Rule of 2 (5 real call sites across the codebase, 4 in admin-operations alone).

**Evidence:** `foundation.ts:16-18`: `export function normalizeEmail(email: string) { return email.trim().toLowerCase(); }`. `admin-operations.ts:23-25`: `function normalizeEmail(email: string | undefined) { return email?.trim().toLowerCase(); }`. A single helper in `foundation.ts` that accepts `string | undefined` (or a thin wrapper) would remove the duplicate.

---

### 3. Major — Walk-in POS creates a new Customer per order without email; no find-or-create parity

**Location:** `lib/admin-operations.ts:155-159`.

**Claim:** The plan (§P6) requires POS to reuse "customer lookup/find-or-create." For walk-ins without an email, `createWalkInPosOrder` fabricates `walkin-${randomUUID()}@local.test` as the `emailNormalized` key and runs an `upsert` against it. Because that key is unique per call, the `upsert` always creates a brand-new Customer row — never finds an existing one. A walk-in returning twice with the same name and no email produces two customer records and two address-book entries, defeating find-or-create. Violates "Function names describe what they DO" (`upsert` implies find-or-create) and the P6 plan's explicit POS parity requirement.

**Evidence:** Line 156: `where: { emailNormalized: normalizeEmail(parsed.email) ?? \`walkin-${randomUUID()}@local.test\` }`. The `??` fallback regenerates the UUID on every call, so the `where` clause never matches an existing row. A lookup by `firstName` + `lastName` + phone (or an explicit "anonymous walk-in" singleton customer) would match the find-or-create contract.

---

### 4. Major — Bulk "review" action is a version-increment no-op misnamed as review

**Location:** `app/api/admin/operations/route.ts:46-54` (`POST` bulk branch).

**Claim:** The `action: "bulk"` handler increments `version` on FINALIZED orders where the version matches, then writes an `orders.bulk_reviewed` audit event. It does not inspect, mutate, or annotate any order — it only probes optimistic-version conflicts. The audit action name says "reviewed" but nothing was reviewed. Violates "Function names describe what they DO (`calculateInvoiceTotal`, not `processData`)" and "No 'just in case' code — every line must have a reason." The UI button label "Run bounded review batch" (`operations/page.tsx:92`) compounds the misnaming.

**Evidence:** Lines 48-51: `const updated = await prisma.order.updateMany({ where: { id: orderId, status: "FINALIZED", version: bulk.versions[orderId] }, data: { version: { increment: 1 } } }); return { orderId, outcome: updated.count === 1 ? "processed" : "conflict" };`. The only state change is `version: { increment: 1 }`. No review field is touched. Either the action should perform a real review step (e.g. mark `reviewedAt`) or the action/audit name should be `orders.bulk_version_probe` and the UI label "Run bounded conflict probe."

---

### 5. Major — `createWalkInPosOrder` reuses the Stripe checkout flow then rewrites the payment to offline with no comment

**Location:** `lib/admin-operations.ts:163-170` → `lib/checkout.ts:319-340` (`createPosOrder`).

**Claim:** `createWalkInPosOrder` builds an `Order` + `OrderLine` + `Address`, then calls `createPosOrder`, which calls `startCheckout` (creates a `CheckoutSession` and a `Payment` with `method: "STRIPE"`), then `completeCheckout` (finalizes the order, reserves inventory, creates a `StripePaymentIntent`), then in a *second* transaction deletes the `StripePaymentIntent` and rewrites `Payment.method` to `CASH`/`CHECK` with `externalId: null`. The three-step dance (fabricate Stripe session → finalize → rewrite to offline) is non-obvious; the only signal is `notes: "Posted through staff POS."` This is the same pattern flagged in the P5 review (finding 13) and P6 adds a *new* caller (`createWalkInPosOrder`) that widens the surface. Violates "Comments only for non-obvious intent."

**Evidence:** `admin-operations.ts:170` calls `createPosOrder(order.id, { donationCents: 0, recipients: [{ addressId: address.id, method: "PICKUP", greeting: "Walk-in order" }] }, parsed.method, actorId, requestUrl)`. `checkout.ts:326-339` runs `startCheckout(..., true)` → `completeCheckout(...)` → `prisma.$transaction(...)` that deletes the `StripePaymentIntent` and rewrites the payment. No comment explains why a cash/check walk-in goes through the Stripe session path. A reader has to infer that `startCheckout`+`completeCheckout` is being borrowed for its staleness/stock/finality validation, not for its payment.

---

### 6. Minor — `operationsDashboard` returns `recentOrders` that the page never reads

**Location:** `lib/admin-operations.ts:135-143` vs `app/admin/operations/page.tsx:20-28`.

**Claim:** `operationsDashboard` queries the 5 most recent finalized orders with `include: { customer: true }` and returns them as `recentOrders`. The operations page only reads `dashboard.orderCount`, `dashboard.todayCount`, and `dashboard.paidCents` (lines 26-28, 82-84). `recentOrders` is fetched on every dashboard call and shipped to a client that never renders it. Violates "Dead code — delete, don't comment out."

**Evidence:** `admin-operations.ts:137`: `prisma.order.findMany({ where: { status: "FINALIZED" }, take: 5, orderBy: { updatedAt: "desc" }, include: { customer: true } })`. `operations/page.tsx:26`: `setSummary(dashboard)` where `summary` state is `{ orderCount, todayCount, paidCents }` — `recentOrders` is dropped. The orders shown on the page come from `listOrders` (`?view=orders`), not from the dashboard.

---

### 7. Minor — `todayCount` field name is the opposite of what it counts

**Location:** `lib/admin-operations.ts:138,142` vs `app/admin/operations/page.tsx:83`.

**Claim:** `todayCount` is computed as drafts *older* than 24 hours (`updatedAt: { lt: ... }`), i.e. stale drafts, not today's drafts. The UI label "Drafts waiting for follow-up" (page.tsx:83) is correct, but the field name `todayCount` reads as "drafts created today." Violates "Function names describe what they DO."

**Evidence:** Line 138: `updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }`. The filter is `<` (older than), not `>` (today). `staleDraftCount` or `overdueDraftCount` would match the query and the UI label.

---

### 8. Minor — `take = 25` page-size magic value duplicated in `listOrders` and `listCustomers`

**Location:** `lib/admin-operations.ts:109,122`.

**Claim:** Both list helpers declare `const take = 25;` locally. The page size is a shared admin-list constant with two real call sites. Violates "magic values — named constants / enums" and Rule of 2. Drift risk: if one is changed to 50 and the other stays at 25, the two lists cap differently.

**Evidence:** Line 109 (`listOrders`): `const take = 25;`. Line 122 (`listCustomers`): `const take = 25;`. A shared `ADMIN_LIST_PAGE_SIZE = 25` constant would remove the duplicate.

---

### 9. Minor — `OperationsPage` has two duplicated fetch-all-three paths (`load` and `useEffect`)

**Location:** `app/admin/operations/page.tsx:19-29` (`load`) and `:31-48` (`useEffect`).

**Claim:** Both functions fetch dashboard + orders + customers in parallel, check `dashboard.error || orderList.error || customerList.error`, and call `setSummary`/`setOrders`/`setCustomers`. The `useEffect` adds `AbortController`; `load` does not. Two near-identical code blocks for the same three-fetch orchestration. Violates "duplicated logic — pull into `lib/` helpers" (or in-component helper) and Rule of 2.

**Evidence:** `load` (lines 19-29) and `useEffect` (lines 31-48) share the same `Promise.all([fetch(dashboard), fetch(orders), fetch(customers)])` shape and the same error/setState chain. A single `loadAll(signal?)` helper called from both `useEffect` and the "Search" button would remove the duplicate.

---

### 10. Minor — `operations/route.ts` POST bulk path has no transaction boundary

**Location:** `app/api/admin/operations/route.ts:46-54`.

**Claim:** The bulk handler runs `Promise.all(bulk.orderIds.map(async (orderId) => prisma.order.updateMany(...)))` with no `prisma.$transaction` wrapper. Each `updateMany` is its own query; if one fails mid-batch, earlier ones are committed and later ones are not, leaving the batch partially applied. The audit event is created after all promises resolve. Inconsistent with the rest of P6 (`commitImport`, `createPosOrder`, `refundStripePayment` all use `prisma.$transaction`). Violates "one pattern per concern."

**Evidence:** Lines 47-53: `const outcomes = await Promise.all(bulk.orderIds.map(async (orderId) => { const updated = await prisma.order.updateMany(...); return { orderId, outcome: ... }; })); await prisma.auditEvent.create(...)`. No transaction wraps the loop. A `prisma.$transaction(async (tx) => { ... })` with `tx.order.updateMany` would make the batch atomic.

---

### 11. Minor — `operations/route.ts` POST `pos` path does not validate `input` at the boundary

**Location:** `app/api/admin/operations/route.ts:7-10,43-44`.

**Claim:** The route's `postSchema` declares `input: z.unknown()` — it accepts any payload and forwards it to `createWalkInPosOrder`, which re-parses with its own Zod schema (`admin-operations.ts:146-153`). The boundary does not enforce the shape, so a malformed `input` gets a 200-route-internal 400 from the lib function rather than a clean 400 at the route. Other P6 routes (`imports/route.ts:6-9`) validate fully at the boundary. Violates "inconsistent patterns — pick one, apply everywhere."

**Evidence:** Line 8: `z.object({ action: z.literal("pos"), input: z.unknown() })`. Line 44: `createWalkInPosOrder(parsed.data.input, ...)`. The `imports/route.ts` route uses a discriminated union with full field validation at the boundary. The pos path should embed `createWalkInPosOrder`'s schema in `postSchema` instead of `z.unknown()`.

---

### 12. Minor — `operations/route.ts` GET `view=products` is permission-scope drift

**Location:** `app/api/admin/operations/route.ts:12-13,26-32`.

**Claim:** The route authorizes with `orders.read` for every `view`, including `view=products` which returns the full active product catalog (`prisma.product.findMany`). A staff member with `orders.read` but no catalog permission can read every product's name and price. The catalog admin route (`app/api/admin/catalog/route.ts`) presumably requires a separate permission. Also, the products query is inline in the route, not in `lib/admin-operations.ts` like `listOrders`/`listCustomers`. Violates "one pattern per concern" and the least-privilege stance in `permissions.ts`.

**Evidence:** Line 13: `const authorization = await authorize(request, "orders.read");`. Lines 27-31: `if (view === "products") return NextResponse.json({ products: await prisma.product.findMany({ where: { isActive: true, season: { status: "OPEN" } }, ... }) });`. The catalog read should require a catalog permission, and the query should live in `lib/admin-operations.ts` (or `lib/admin/lists.ts`) next to the other list helpers.

---

### 13. Minor — `listOrders` and `listCustomers` have inconsistent signatures for the same shape of work

**Location:** `lib/admin-operations.ts:108` (`listOrders({ query, status, page })`) vs `:121` (`listCustomers(query, page)`).

**Claim:** Two list helpers doing the same kind of work (search + paginate a list) use different calling conventions: `listOrders` takes an options object with `status`, `listCustomers` takes positional args. A caller looking for "the list helper signature" has to read both. Violates "inconsistent patterns — pick one, apply everywhere."

**Evidence:** Line 108: `export async function listOrders({ query, status, page }: { query?: string; status?: string; page: number })`. Line 121: `export async function listCustomers(query: string | undefined, page: number)`. One options-object shape (with optional `status`) for both would align the pattern.

---

### 14. Minor — `importRowSchema` is one shared schema for customer and product rows (type drift)

**Location:** `lib/admin-operations.ts:6-14`.

**Claim:** A single Zod schema marks `email`, `phone`, `firstName`, `lastName` (customer fields) AND `sku`, `productName`, `priceCents` (product fields) all optional. For a customer import, the product fields are silently ignored; for a product import, the customer fields are silently ignored. A customer CSV with a stray `sku` column passes validation. Single schema for two distinct row shapes. Violates "type/schema drift — centralize types, single source of truth."

**Evidence:** Lines 6-14 define `importRowSchema` with all seven fields optional. Lines 41-48 add kind-specific guards *after* parsing. A discriminated union on `kind` (`customers` vs `products`) would make the row shape depend on the import kind and let the compiler catch the `!` assertions in finding 15.

---

### 15. Minor — `commitImport` product path uses `!` non-null assertions to compensate for the loose schema

**Location:** `lib/admin-operations.ts:98`.

**Claim:** `commitImport` writes `sku: product.sku!, name: product.productName!, priceCents: product.priceCents!`. The `!` assertions are required because `importRowSchema` marks those fields optional. The compiler cannot verify them; the runtime guard lives in `parseCsv` (line 41). Violates "No redundant type assertions the compiler already guarantees" — these are not redundant, they compensate for a too-loose schema, which is the real fix.

**Evidence:** Line 98: `await transaction.product.create({ data: { seasonId: season.id, sku: product.sku!, name: product.productName!, priceCents: product.priceCents!, kind: "PACKAGE" } })`. Three `!` on one line. Tightening `importRowSchema` per finding 14 (discriminated union by `kind`) would make the assertions unnecessary and the compiler would enforce the guard.

---

### 16. Minor — `app/admin/layout.tsx` "Back to admin overview" is a hardcoded back link

**Location:** `app/admin/layout.tsx:19`.

**Claim:** The clean-code UI rule states "Back navigation: back buttons go to where the user came from, not a hardcoded route." Every admin page renders `<Link href="/admin">← Back to admin overview</Link>` regardless of where the user arrived. A user who clicks into `/admin/pos` from `/admin/operations` gets sent to `/admin`, not back to operations. The rule allows "explicit exceptions" documented in the README; none is documented here.

**Evidence:** Line 19: `<p><Link href="/admin">← Back to admin overview</Link></p>`. The link is rendered by the layout for every admin child route. Either use `router.back()` with a fallback, or document the "always returns to admin root" exception in the project README.

---

### 17. Minor — `app/admin/layout.tsx` alert banner is a static string, not a manager-configurable alert

**Location:** `app/admin/layout.tsx:18`.

**Claim:** The plan (§P6, R-106) calls for an "alert banner" as part of admin chrome. The implementation hardcodes "Staff workspace · changes to orders, payments, and imports are audited." — a fixed string, not a manager-configurable alert read from settings. Scope drift: the banner is present but not wired to live config like the other P6 chrome (settings hub tabs).

**Evidence:** Line 18: `<p className="admin-alert">Staff workspace · changes to orders, payments, and imports are audited.</p>`. No `AppSetting` read, no settings UI for the alert text. The other P6 chrome (operations/POS links, visit-store link) is wired; the alert is the one piece that is static.

---

### 18. Minor — `.admin-alert` and `.notice` CSS classes are near-identical

**Location:** `app/styles.css:27,31`.

**Claim:** Both classes apply `background: #fff0e9; border-left: 4px solid var(--accent); margin...; padding...`. The only differences are `margin: 0 0 20px` vs `margin-bottom: 20px` and `padding: 10px 12px` vs `padding: 12px`. Two classes for the same visual pattern (callout banner). Violates "duplicated UI — extract shared components" and "inline styles / repeated class strings — tokenize or componentize."

**Evidence:** Line 27: `.admin-alert { background: #fff0e9; border-left: 4px solid var(--accent); margin: 0 0 20px; padding: 10px 12px; }`. Line 31: `.notice { background: #fff0e9; border-left: 4px solid var(--accent); margin-bottom: 20px; padding: 12px; }`. A single `.callout` class with size variants, or one class with the smaller as a modifier, would remove the duplicate.

---

### 19. Minor — POS page uses a different data-fetching pattern from the operations page

**Location:** `app/admin/pos/page.tsx:13-17` vs `app/admin/operations/page.tsx:20-24`.

**Claim:** The POS page fetches with `.then(async (response) => ({ ok: response.ok, body: await response.json() }))` and destructures `{ ok, body }`. The operations page fetches with `.then((response) => response.json())` and reads `dashboard.error` directly. Two data-fetching patterns in the same P6 phase for the same kind of admin GET. Violates "one data-fetching pattern per project."

**Evidence:** `pos/page.tsx:14-16`: `.then(async (response) => ({ ok: response.ok, body: await response.json() })).then(({ ok, body }) => ok ? setProducts(body.products) : setMessage(body.error))`. `operations/page.tsx:21`: `fetch("/api/admin/operations").then((response) => response.json())`. One shared `fetchJson` helper (or a small SWR-style hook) for admin pages would align the pattern.

---

### 20. Nit — `OperationsPage` `Order` and `Customer` types are defined inline, not shared with the API

**Location:** `app/admin/operations/page.tsx:7-8`.

**Claim:** The page redefines `Order` and `Customer` types inline instead of importing them from `lib/admin-operations.ts`. The API helpers (`listOrders`, `listCustomers`) return inferred shapes; the page hand-maintains a parallel type. Type drift if the API changes a field. Violates "type/schema drift — centralize types, single source of truth."

**Evidence:** Lines 7-8 define `type Order = { id; draftReference; orderNumber; status; totalCents; version; customer; payments }` and `type Customer = { id; firstName; lastName; emailNormalized; phoneNormalized; _count }`. `listOrders`/`listCustomers` return `Prisma`-inferred types. Exporting `OrderListItem`/`CustomerListItem` from `lib/admin-operations.ts` and importing them would remove the parallel type.

---

### 21. Nit — `smoke-p6.ts` asserts `>= 2` for `payment.offline_posted` audit events

**Location:** `scripts/smoke-p6.ts:39`.

**Claim:** The assertion `await prisma.auditEvent.count({ where: { actorId: staff.id, action: "payment.offline_posted" } }) >= 2` couples the smoke to the exact number of POS payments in the run, not just "at least one." If the S1 `createPosOrder` step is removed or restructured, the smoke fails with a confusing count rather than a clear "no POS payment audit found." Minor test brittleness.

**Evidence:** Line 39: `assert.equal(await prisma.auditEvent.count({ where: { actorId: staff.id, action: "payment.offline_posted" } }) >= 2, true);`. The `>= 2` matches the two POS payments (S1 cash + S2 check) but encodes the run structure into the assertion. A per-step assertion (`>= 1` after S1, `>= 2` after S2) would be tighter.

---

## Scope notes

- P6-only scope per task. Findings about `lib/checkout.ts` (P5) are included only where P6 adds a new caller (`createWalkInPosOrder` → `createPosOrder`) that widens the existing P5 finding 13 surface.
- No fixes were applied. Each finding lists a location, a claim tied to a clean-code rule, and evidence from the file.
- `clean-code.mdc` is present in `arms/arm-05/.cursor/rules/`, so the review is in scope (not N/A).
