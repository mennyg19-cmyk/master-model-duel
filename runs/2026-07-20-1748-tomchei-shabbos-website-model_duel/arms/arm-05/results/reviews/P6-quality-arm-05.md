# P6 Quality Review — arm-05

Reviewer specialist: Quality. Scope: P6 only. Findings only — no fixes.

Plan ref: `shared/MERGED-BUILD-PLAN.md` § P6. Expected ref: `shared/phases/PHASE-P6-EXPECTED.md`.

Severity scale: critical / high / medium / low / info.

## Summary counts

- critical: 0
- high: 5
- medium: 10
- low: 9
- info: 0

## Findings

### H1 — high — Order detail UI missing

- Location: `app/admin/orders/` (no file), `app/admin/operations/page.tsx:89-93`
- Claim: EXPECTED #2 requires "full order detail with money actions and Stripe refund path". The order detail page does not exist as a UI.
- Evidence: `Glob arms/arm-05/workspace/app/admin/orders/**` returns 0 files. Only an API route exists at `app/api/admin/orders/[orderId]/route.ts` (GET detail, POST refund). The operations page renders order rows as flat `<div className="ops-row">` with no link to a detail view and no refund control. Refund is only reachable via direct API call.

### H2 — high — Customer detail + order history UI missing

- Location: `app/admin/customers/` (no file), `app/admin/operations/page.tsx:94-97`
- Claim: EXPECTED #4 requires "Customer directory + detail + order history". Customer detail and order history views do not exist.
- Evidence: `Glob arms/arm-05/workspace/app/admin/customers/**` returns 0 files. The operations page renders only a directory list (`customers.map(...)` showing name + email/phone + `_count.orders`). No link to a per-customer detail page, no order history view. `listCustomers` in `lib/admin-operations.ts:121-133` returns only paginated customers with `_count`, no orders.

### H3 — high — POS does not reuse cart-first builder

- Location: `app/admin/pos/page.tsx:19-40`, `lib/admin-operations.ts:145-171`
- Claim: EXPECTED #3 and plan R-059 require POS to reuse the same cart-first builder as storefront. The POS UI is a flat one-product form, not the cart-first builder.
- Evidence: `PosPage.submit` sends a single `productId` + `quantity` + customer fields to `action: "pos"`. `createWalkInPosOrder` in `lib/admin-operations.ts:145-171` directly creates an `Order` with one `OrderLine` via `prisma.order.create`, bypassing `lib/order-builder.ts` entirely. No cart, no multi-line, no recipient assignment, no add-on selection. Storefront `app/components/order-builder.tsx` is not imported by POS.

### H4 — high — Bulk action is a no-op

- Location: `app/api/admin/operations/route.ts:46-55`, `app/admin/operations/page.tsx:65-74`
- Claim: EXPECTED #6 requires "Bounded list queries and bulk actions with deterministic conflict reporting". The bulk action has no business effect — it only increments `version`.
- Evidence: The POST `bulk` branch runs `prisma.order.updateMany({ where: { id, status: "FINALIZED", version }, data: { version: { increment: 1 } } })`. No status change, no refund, no fulfillment update, no money action. The UI button is labeled "Run bounded review batch" but reviewing nothing. Conflict reporting works (count === 1 → "processed", else "conflict") but the action itself is empty.

### H5 — high — Smoke S4 incomplete vs EXPECTED

- Location: `scripts/smoke-p6.ts:52-64`, `.scratch/PHASE-P6-SMOKE.md:12`
- Claim: EXPECTED S4 requires "two conflicting bulk actions report skipped/conflicts deterministically". The smoke never runs two conflicting bulk actions.
- Evidence: `verifySmoke` creates 1000 orders + 5000 packages, calls `listOrders({ page: 1 })`, asserts `pageSize === 25` and counts. No call to the bulk POST endpoint, no version-mismatch test, no conflict assertion. The smoke file marks S4 as PASS despite not exercising the conflict path.

### M1 — medium — Dashboard "Today work queue" mislabeled

- Location: `lib/admin-operations.ts:135-143`, `app/admin/operations/page.tsx:83`
- Claim: EXPECTED #1 requires a "Today work queue" (R-050). The dashboard computes "stale drafts older than 24h" and labels it "Drafts waiting for follow-up".
- Evidence: `operationsDashboard` returns `todayCount: prisma.order.count({ where: { status: "DRAFT", updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })`. The card label is "Drafts waiting for follow-up". This is a stale-drafts count, not today's work queue. Page title "Today's order desk" is inconsistent with the metric.

### M2 — medium — Dashboard `recentOrders` fetched but not rendered

- Location: `lib/admin-operations.ts:136-142`, `app/admin/operations/page.tsx:81-85`
- Claim: EXPECTED #1 requires "KPIs, recent orders" on the dashboard.
- Evidence: `operationsDashboard` returns `recentOrders` (5 most recent finalized orders with customer). The operations page only renders three KPI cards (`orderCount`, `todayCount`, `paidCents`). `recentOrders` is fetched over the network on mount but never rendered.

### M3 — medium — POS walk-in customer find-or-create is partial

- Location: `lib/admin-operations.ts:155-159`
- Claim: EXPECTED #3 requires "customer lookup/find-or-create". Walk-in POS only looks up by email; no-email walk-ins always create new customers and there is no phone-based lookup.
- Evidence: `prisma.customer.upsert({ where: { emailNormalized: normalizeEmail(parsed.email) ?? `walkin-${randomUUID()}@local.test` }, ... })`. When `parsed.email` is undefined, the `where` clause uses a fresh random UUID per call, so every no-email walk-in creates a distinct customer record. The POS form (`app/admin/pos/page.tsx:52`) makes email optional. No phone field on the POS form at all.

### M4 — medium — Settings hub: Email and Developer tabs are dead stubs

- Location: `app/admin/settings/page.tsx:36-44`
- Claim: EXPECTED #5 requires "settings hub tabs wired to live config". Email and Developer tabs render static text only.
- Evidence: The `<section id="email">` says "Newsletter preferences are live; campaigns and transactional email arrive in P11." The `<section id="developer">` says "Health, environment validation, and the local test database are available now." Neither section contains any control or fetch. Tabs exist but are not wired.

### M5 — medium — Settings hub: package types, pickup locations, follow-up not wired

- Location: `app/admin/settings/page.tsx:38`
- Claim: EXPECTED #5 says "settings hub tabs already opened in P3 are wired to live config here". The Orders tab only wires store status.
- Evidence: The Orders section contains only a `storeStatus` select. The helper text says "Package types, pickup locations, and follow-up rules will be connected in later operations phases." No controls for package types, pickup locations, or follow-up — all three are P6 deliverables per plan R-094..R-096.

### M6 — medium — Imports: no preview UI for errors

- Location: `app/admin/operations/page.tsx:50-56, 98-102`
- Claim: EXPECTED S3 requires "preview errors". The UI shows only a count of invalid rows, not the errors themselves.
- Evidence: `stageImport` returns `{ batchId, accepted, errors }` where `errors` is a string array. The UI sets message to `Staged ${body.accepted} rows. ${body.errors.length} invalid.` — the actual error strings (`errors[i]`) are never rendered. The user cannot see which rows failed or why.

### M7 — medium — Imports: staged batches not listable or recoverable

- Location: `app/api/admin/imports/route.ts` (POST only), `app/admin/operations/page.tsx:17, 55`
- Claim: Staged batches are stored in `AppSetting` but there is no GET endpoint to list or recover them.
- Evidence: The imports route defines only `POST`. `batchId` is held in React state (`useState("")`). If the user navigates away before committing, the staged batch is orphaned in `AppSetting` with no UI to retrieve it. `commitImport` requires the `batchId` to be known.

### M8 — medium — Imports: products commit hardcodes `kind: "PACKAGE"` and skips duplicate checks

- Location: `lib/admin-operations.ts:54-65, 93-101`
- Claim: EXPECTED #4 requires "staged atomic CSV import (customers/products) with preview + audit". The products path is incomplete.
- Evidence: `stageImport` only runs duplicate detection for `kind === "customers"` (lines 56-65). For `kind === "products"`, no duplicate SKU detection at stage time. `commitImport` for products creates with `kind: "PACKAGE"` hardcoded (line 98), ignoring any kind field. No explicit check for existing SKU in the season before `product.create`.

### M9 — medium — Smoke S3 does not test products import path

- Location: `scripts/smoke-p6.ts:42-50`
- Claim: EXPECTED S3 requires "Stage CSV with valid/duplicate/invalid rows; preview errors; atomic commit; import audit" for both customers and products.
- Evidence: `verifySmoke` calls `stageImport(..., "customers", ...)` and `commitImport(...)` for customers only. No call with `kind: "products"`. The products branch in `lib/admin-operations.ts:93-101` is never exercised by smoke.

### M10 — medium — Bulk API does not require a version per orderId

- Location: `app/api/admin/operations/route.ts:7-10, 46-53`
- Claim: EXPECTED #6 requires "deterministic conflict reporting". The schema permits missing version entries, which silently bypasses conflict detection.
- Evidence: `postSchema` for `bulk` defines `versions: z.record(z.string(), z.number().int().positive())` with no check that every `orderIds[i]` has a matching key. Inside the handler, `where: { id: orderId, status: "FINALIZED", version: bulk.versions[orderId] }`. If `versions[orderId]` is `undefined`, Prisma treats `version: undefined` as "no filter", so the update succeeds regardless of the stored version — reported as "processed" instead of "conflict".

### L1 — low — Admin back link is hardcoded

- Location: `app/admin/layout.tsx:19`
- Claim: The clean-code rule says "Back buttons go to where the user came from, not a hardcoded route."
- Evidence: `<p><Link href="/admin">← Back to admin overview</Link></p>` is rendered for every admin page. The link always navigates to `/admin` regardless of the referrer.

### L2 — low — Order list: no pagination controls in UI

- Location: `app/admin/operations/page.tsx:89-93`, `lib/admin-operations.ts:108-119`
- Claim: EXPECTED #2 requires "paginated order list". Pagination is server-side only.
- Evidence: `listOrders` returns `{ total, page, pageSize, orders }` with `take: 25`. The operations page renders `orders.map(...)` and ignores `total`, `page`, and `pageSize`. No next/prev controls, no page indicator. The user cannot leave page 1 from the UI.

### L3 — low — Order list: no status filter control in UI

- Location: `app/admin/operations/page.tsx:87-88`, `app/api/admin/operations/route.ts:17-21`
- Claim: EXPECTED #2 requires "searchable/filterable" order list.
- Evidence: The API accepts a `status` query param. The UI has a single text input labeled "Search orders or customers" and no status filter control. Status filtering is unreachable from the UI.

### L4 — low — Customer list: no pagination controls in UI

- Location: `app/admin/operations/page.tsx:94-97`, `lib/admin-operations.ts:121-133`
- Evidence: `listCustomers` returns `{ total, page, pageSize, customers }` with `take: 25`. The UI renders `customers.map(...)` only. No pagination controls.

### L5 — low — Operations search has no Enter-key submit

- Location: `app/admin/operations/page.tsx:87-88`
- Evidence: The search input is a standalone `<label><input ... /></label>` with `onChange`. There is no `<form>` wrapping it, so pressing Enter does not call `load()`. The user must click the "Search" button.

### L6 — low — `bulkReview` silently truncates to 100 finalized orders

- Location: `app/admin/operations/page.tsx:65-74`
- Evidence: `orders.filter((order) => order.status === "FINALIZED").slice(0, 100)` truncates without notice. The API also caps at 100. The UI does not tell the user that only the first 100 of N finalized orders will be reviewed.

### L7 — low — Audit page renders nested details as `[object Object]`

- Location: `app/admin/audit/page.tsx:22`
- Evidence: `Object.entries(audit.details).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")`. For the bulk-review audit event, `details.outcomes` is an array of objects; `String([...])` produces `[object Object]` per element. The audit trail for P6 bulk actions is unreadable.

### L8 — low — `parseCsv` is naive

- Location: `lib/admin-operations.ts:27-52`
- Evidence: `line.split(",")` does not handle quoted values, escaped commas, or RFC 4180. A customer named `"Last, First"` will split into two columns and likely fail validation with a misleading error.

### L9 — low — `createWalkInPosOrder` does not check `product.isActive` before order creation

- Location: `lib/admin-operations.ts:154-170`
- Evidence: `prisma.product.findUniqueOrThrow({ where: { id: parsed.productId }, include: { inventoryItems: true } })` returns the product regardless of `isActive`. The inactive-product check happens later inside `assertLiveOrder` (`lib/checkout.ts:83`), after the order and address rows are already created. The error message `${line.productNameSnapshot} is no longer available.` reaches the user after side effects.

## Notes

- `.scratch/PHASE-P6-STATUS.md` declares P6 "complete" and lists `npm run smoke:p6` passing S1–S4. The smoke file and source contradict parts of that claim (see H5, M9).
- The status note about Clerk credentials being required for manual traversal is fair, but the smoke suite substitutes dev-session tokens and does not exercise the cart-first POS parity path (H3) or customer/order detail UIs (H1, H2).
