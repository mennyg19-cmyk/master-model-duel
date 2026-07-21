# P10 Clean-Code Review — arm-03 (blind)

Reviewer: external clean-code specialist
Phase: P10
Tree: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-03/workspace`
Scope: duplication, naming, god files, pattern drift
Mode: findings only — NO fixes

## Summary counts

| Category | Findings |
|---|---|
| Duplication | 11 |
| Naming | 6 |
| God files | 4 |
| Pattern drift | 10 |
| **Total** | **31** |

All file paths are relative to the workspace tree root.

## 1. Duplication

### D-01 `clampPageSize` redefined across ops modules
- `src/lib/ops/packages.ts:33` defines `clampPageSize(raw?: number)` with `DEFAULT_PAGE=50`, `MAX_PAGE=100`.
- `src/lib/ops/orders.ts:20` exports `clampPageSize(raw?: number)` with `DEFAULT_PAGE_SIZE=50`, `MAX_PAGE_SIZE=100`.
- `src/lib/ops/customers.ts:10` inlines the same logic (`Math.min(MAX_PAGE, Math.max(1, input.pageSize ?? DEFAULT_PAGE))`) without a helper.
Three copies of the same clamp with three different constant names.

### D-02 `DELIVERY_CODES` set + `isDelivery`/`isDeliveryCode` duplicated
- `src/lib/routes/service.ts:23` defines `DELIVERY_CODES = new Set(["DELIVERY","BULK_DELIVERY","PER_PACKAGE_DELIVERY"])` and `isDeliveryCode(code)`.
- `src/lib/routes/method-switch.ts:8` redefines the same `DELIVERY_CODES` set and `isDelivery(code)`.
Same set, same predicate, two files, two names.

### D-03 `recipientKey` fallback expression copy-pasted
The expression `customer?.emailNorm || customer?.phoneNorm || customer?.id || pkg.orderId` (or `... || order.id`) appears verbatim in:
- `src/lib/routes/service.ts:495`
- `src/lib/pickup/service.ts:68`
- `src/lib/pickup/bulk.ts:25, 80, 168`
Five call sites, no shared helper.

### D-04 Cron-run wrapper duplicated in `pickup/bulk.ts`
`runPickupExpiryCron` (lines 6–60) and `runPaymentReminderCron` (lines 62–114) share the same `cronRunLog.create(RUNNING) → try { …update SUCCEEDED } catch { …update FAILED; throw }` skeleton. The wrapper is inlined twice.

### D-05 Repeat-order Zod `choices` schema duplicated
- `src/app/api/admin/orders/[id]/repeat/route.ts:14-24` defines `choices` inside `bodySchema`.
- `src/app/api/account/orders/[id]/repeat/route.ts:37-49` defines `confirmSchema` with an identical `choices` array shape.
Same field set (`sourceLineId`, `action`, `toProductId`, `keepRecipient`, `savedAddressId`), two schemas.

### D-06 Smoke-test helpers re-implemented per phase
Every `scripts/smoke-pN.mjs` redefines `cookieHeader`, `req`, `push`, `evidence`, `db`, `base` (8 phase scripts + `smoke.mjs`). `cookieHeader` alone has 9 copies with subtly different signatures (e.g. `smoke-p4.mjs` adds `extra`, `smoke-p9.mjs` defaults `userId`). No shared `scripts/_helpers.mjs`.

### D-07 `SavedAddress` client type duplicated
- `src/components/order/assign-dialog.tsx:6` declares `type SavedAddress`.
- `src/components/order/builder-shell.tsx:11` declares `type SavedAddress` with the same shape (assign-dialog adds `line2?`).
No shared client type from `lib/address/book.ts` (which already imports the Prisma `SavedAddress`).

### D-08 `part` / `normalizePart` normalizer duplicated
- `src/lib/address/normalize.ts:11` defines `part(value)` = trim + lowercase + collapse whitespace.
- `src/lib/orders/grouping.ts:16` defines `normalizePart(value)` with the identical body.
Two names, identical implementation.

### D-09 "Address parts → joined key" pattern duplicated 5+ times
Same normalize-then-join-with-`|` pattern (with slight field variations) in:
- `src/lib/address/normalize.ts:16` `buildAddressNorm`
- `src/lib/orders/grouping.ts:21` `buildGroupingKey`
- `src/lib/checkout/greetings.ts:8` `recipientMemoryKey` (then sha256)
- `src/lib/address/geocode.ts:14` `queryKey` (then sha256)
- `src/lib/checkout/delivery.ts:67` `destinationKey` and `:79` `addressOnlyKey`
- `src/lib/routes/geo.ts:65` inline normalizer in `sameStreetCluster`
Each picks a different subset of fields and a different hashing choice; no shared builder.

### D-10 Direct `auditLog.create` bypassing `writeAudit`
`src/lib/audit.ts:6` exports `writeAudit(input, client)`, but many call sites call `tx.auditLog.create` / `db.auditLog.create` directly:
- `src/lib/ops/refunds.ts:75, 172, 213`
- `src/lib/ops/print-batch.ts:324`
- `src/lib/ops/packages.ts:313, 426, 501`
- `src/lib/orders/package-stages.ts:107`
- `src/lib/payments/webhook.ts:120, 233, 256, 297`
- `src/lib/orders/drafts.ts:222, 324, 548`
- `src/lib/payments/offline.ts:105, 131, 180`
- `src/lib/address/book.ts:71, 97, 150`
- `src/lib/orders/finalize.ts:390, 458, 516`
- `src/lib/inventory/reserve.ts:41`
~20 direct writes vs ~30 `writeAudit` calls — inconsistent use of the helper.

### D-11 `P2002` unique-violation check duplicated
The `error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"` check is inlined in:
- `src/lib/payments/webhook.ts:42` (as `isUniqueViolation`)
- `src/lib/notify/outbox.ts:49`
- `src/lib/ops/customers.ts:159`
- `src/lib/ops/import.ts:327, 362, 421`
- `src/app/api/setup/route.ts:48`
Only `webhook.ts` bothered to name it; the rest inline the same predicate.

## 2. Naming

### N-01 `lib/customers.ts` vs `lib/ops/customers.ts` — split concern, same noun
- `src/lib/customers.ts` exports `linkOrCreateCustomer` (Clerk-linking path).
- `src/lib/ops/customers.ts` exports `listCustomers`, `getCustomerDetail`, `findOrCreateCustomer`, `attachOrCreatePosCustomer`, `searchCustomersForPos`.
Both files are named "customers" but live at different depths and own different concerns (auth-linking vs POS/listing). No naming convention signals the split; importers must remember which "customers" module to use.

### N-02 `normalizeEmail` and `normalizePhone` live in unrelated modules
- `src/lib/normalize.ts` exports only `normalizeEmail` (3-line file).
- `src/lib/phone.ts` exports only `normalizePhone` (6-line file).
Both are contact-info normalizers but split across two files with different naming conventions (`normalize` vs `phone`). `lib/normalize.ts` is a near-empty grab-bag.

### N-03 `availableUnits` — same name, two different contracts
- `src/lib/inventory/reserve.ts:75` `availableUnits(item: Pick<InventoryItem,"onHand"|"reserved">): number` — returns raw `onHand - reserved` (can be negative).
- `src/lib/storefront/catalog-shared.ts:21` `availableUnits(product: CatalogProductCard): number | null` — returns `null` when not tracked, `0` when no inventory, `Math.max(0, …)` otherwise.
Same identifier, different signatures, different semantics (nullable, clamped, different arg type). Callers must know which import path they used to know what the result means.

### N-04 `formatCents` imported via two different paths
- `@/lib/storefront/catalog-shared` (direct) — used by `components/account/*`, `components/order/*`, `components/checkout/*`.
- `@/lib/storefront/catalog` (re-export) — used by `app/(storefront)/catalog/[slug]/page.tsx`, `app/(storefront)/archive/[slug]/[productSlug]/page.tsx`.
`catalog.ts` re-exports `formatCents` from `catalog-shared.ts`. Same function, two import paths; no convention on which is canonical.

### N-05 `lockPackage` vs `lockPackageForUpdate` — same idea, two names
- `src/lib/ops/packages.ts:224` defines `lockPackage(tx, packageId, seasonId)` (wraps `requirePackageInSeasonLocked` + `findUniqueOrThrow`).
- `src/lib/orders/package-stages.ts:63` defines `lockPackageForUpdate(tx, packageId, seasonId)` with the same body (different `include`).
Both wrap `requirePackageInSeasonLocked` from `lib/orders/lock.ts`; neither reuses the other.

### N-06 `normalizeZip` misplaced in `settings-keys.ts`
`src/lib/storefront/settings-keys.ts:47` exports `normalizeZip` (and `isDeliveryZipAllowed`), but the file's name advertises "settings keys". The normalizer is imported by `checkout/delivery.ts`, `checkout/greetings.ts`, `shipping/checkout-rates.ts` — none of which care about settings keys. A ZIP normalizer is a domain helper, not a settings-keys constant.

## 3. God files

### G-01 `src/lib/routes/service.ts` (29,734 bytes, ~996 lines)
Single module owns: route listing, route detail, route creation (nearest-neighbor TSP), reassignment, magic-link issuance/verification, PIN hashing + throttling, day-of notifications, stop delivery, printed-fallback PDF generation, reroute suggestions, reroute confirmation (with label void + method switch), stop removal, printed-fallback delivery. Mixes routing, security (PIN/token hashing), geocoding orchestration, PDF rendering, notification dispatch, and audit logging in one file.

### G-02 `src/lib/ops/repeat.ts` (23,160 bytes, ~676 lines)
Owns: preview, draft-from-choices, confirm, single-order auto-repeat, bulk-repeat, bulk status update. The `createDraftFromChoices` helper alone handles product mapping, option fallback, recipient clearing, saved-address resolution, and order-line creation. Multiple distinct bulk flows share one file.

### G-03 `src/lib/orders/drafts.ts` (18,815 bytes, ~574 lines)
Owns: draft include definition, draft serialization (`serializeDraft`), guest-draft token lookup, cart-demand aggregation, get-or-create active draft (customer + guest), add/update/remove line, assign line. Spans guest auth, inventory checks, line mutation, and serialization.

### G-04 `src/lib/checkout/session.ts` (18,170 bytes)
Owns: order loading for checkout, fee-line mapping, delivery-fee resolution, ZIP-block validation, line/add-on price refresh, greeting resolution + memory, grouping-key building, Stripe hosted-checkout creation (live + mock), audit. Checkout orchestration, fee engine, and Stripe integration in one module.

## 4. Pattern drift

### P-01 `getCurrentSeason()` bypassed by re-implementations
`src/lib/storefront/season.ts:4` exports `getCurrentSeason()` (open season, fallback to latest). The same query is re-implemented inline in:
- `src/lib/ops/repeat.ts:70` (`db.season.findFirst({ where: { status: SeasonStatus.OPEN }, orderBy: { year: "desc" } })`)
- `src/lib/ops/import.ts:136` (`classifyProductRows`) and `:275` (`commitImport`)
- `src/lib/ops/prior-year-stub.ts:38`
- `src/lib/seasons/manage.ts:216` (`applyScheduledSeasonFlips` — different semantics, OK)
Helper exists; callers bypass it.

### P-02 `getCurrentSeason() → "No season" 409` boilerplate duplicated across admin routes
The exact 4-line block (`const season = await getCurrentSeason(); if (!season) { return NextResponse.json({ ok: false, error: "No season" }, { status: 409 }); }`) appears in 12 admin route handlers:
- `src/app/api/admin/routes/[id]/route.ts:23, 71`
- `src/app/api/admin/routes/route.ts:14, 35`
- `src/app/api/admin/packages/route.ts:16, 64`
- `src/app/api/admin/packages/[id]/route.ts:15, 46`
- `src/app/api/admin/packages/[id]/method/route.ts:17`
- `src/app/api/admin/pickup/route.ts:17, 51`
- `src/app/api/admin/print-batches/route.ts:31, 48`
- `src/app/api/admin/print-batches/artifacts/[artifactId]/route.ts:16`
- `src/app/api/admin/fulfillment/route.ts:10`
- `src/app/api/admin/bulk-delivery/route.ts:17`
No shared `requireCurrentSeason()` / `withSeason()` wrapper.

### P-03 `try { … } catch (error) { return apiErrorResponse(error); }` wrapper in every route
Every API route (`src/app/api/**/route.ts`) wraps its handler body in the same try/catch. ~50 routes, ~50 copies of the catch. No `withApi(handler)` higher-order wrapper.

### P-04 Two near-identical cron route handlers
- `src/app/api/cron/season-flip/route.ts`
- `src/app/api/cron/season-auto-flip/route.ts`
Both are byte-for-byte identical (same imports, same `requireCronBearer`, same `applyScheduledSeasonFlips()`, same response shape). Two endpoints, one job.

### P-05 Fulfillment-method code: multiple sources of truth
- `src/lib/checkout/delivery.ts:9` defines `FULfillment_CODES = { SHIP, PICKUP, BULK_DELIVERY, PER_PACKAGE_DELIVERY }` (no `DELIVERY`).
- `src/lib/routes/service.ts:23` and `src/lib/routes/method-switch.ts:8` define `DELIVERY_CODES = new Set(["DELIVERY","BULK_DELIVERY","PER_PACKAGE_DELIVERY"])` (no `SHIP`, no `PICKUP`).
- Bare string literals (`"SHIP"`, `"PICKUP"`, `"BULK_DELIVERY"`, `"DELIVERY"`, `"PER_PACKAGE_DELIVERY"`) scattered across `pickup/service.ts`, `pickup/bulk.ts`, `routes/service.ts`, `orders/drafts.ts`, `prior-year-stub.ts`.
Three definitions + literals; no single enum/const of all fulfillment codes.

### P-06 `staff.effectiveStaff.id` boilerplate in every admin route
Every admin route that mutates repeats `const staff = await requirePermission("admin.access"); … actorId: staff.effectiveStaff.id` (or `staffId:`). ~25 call sites pass `staff.effectiveStaff.id` as the actor. No `requireStaffActor()` that returns `{ staff, actorId }` together.

### P-07 `formatCents` / `availableUnits` re-export vs direct import inconsistency
Some callers import `formatCents` from `@/lib/storefront/catalog` (re-export), others from `@/lib/storefront/catalog-shared` (source). `availableUnits` is imported from `@/lib/inventory/reserve` (raw) or `@/lib/storefront/catalog-shared` (clamped) depending on the call site. No convention for which path is public.

### P-08 Client `fetch + json + ok check` pattern duplicated
~30 client components repeat `const res = await fetch(…); const json = await res.json(); if (!res.ok || json.ok === false) { … }`. Only `src/components/order/builder-shell.tsx:22` extracted an `api<T>(url, init)` helper. The rest inline it, with slight variations (`json.ok === false` vs `!json.ok`, error message extraction).

### P-09 `src/lib/orders/finalize.ts` — double-spaced formatting
Every blank line in `finalize.ts` is doubled (blank line between every statement, every import, every brace block). The file is ~539 lines but would be ~270 with normal spacing. Inconsistent with every other file in `src/lib/`; inflates line count and diff noise.

### P-10 `src/components/admin/order-detail.tsx` — mis-indented type declaration
`src/components/admin/order-detail.tsx:18` declares `type OrderDetail = {` indented 2 spaces inside the module body (after `type Payment = { … }` which is at column 0). Stray indentation suggests a botched merge or copy-paste; no other file in `src/components/` indents top-level types this way.

---

## Counts (final)

| Category | Count |
|---|---|
| Duplication | 11 |
| Naming | 6 |
| God files | 4 |
| Pattern drift | 10 |
| **Total findings** | **31** |

Output: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/results/reviews/P10-clean-code-arm-03.md`





