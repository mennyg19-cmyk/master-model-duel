# P6 Clean-Code Review — arm-04 (blind)

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Scope: P6 delta — admin ops hub, POS, customer directory, staged CSV import, admin chrome.
Reviewer: external clean-code specialist (blind). Findings only — no fixes. No new scope beyond P6.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 5 |
| Minor | 8 |

## Major

### M1. Closed-season repeat is reported as "that is not something this list can do"
`src/app/(admin)/admin/orders/actions.ts:198-201` (`runBulk`), `:172`

`runBulk` returns `null` for two different failures: an unknown action (`if (action !== 'REPEAT') return null`) and a closed season (`if (!season.ok) return null`). The caller maps any `null` to `backToDesk(returnTo, 'That is not something this list can do.')`. A staff member who picks "Start a repeat order" while the season is closed is told the action is invalid, when the real reason is that no season is open. The error path lies about the cause. Either surface the season message or split the null return into "unknown action" vs "season closed".

### M2. Payment-status → Badge tone pattern drifts across three screens
`src/app/(admin)/admin/orders/page.tsx:207-212` (`paymentTone`, 4 tones), `src/app/(admin)/admin/orders/[orderId]/page.tsx:69` (inline ternary, 2 tones: PAID → success, else warning), `src/app/(admin)/admin/today/order-queue.tsx:48` (inline ternary, 2 tones: PAID → success, else warning)

The list page distinguishes PAID / OVERPAID / PARTIALLY_PAID / unpaid; the detail page and the queue lump OVERPAID and PARTIALLY_PAID in with "warning". Same domain concept (payment status → tone) handled three ways with three different output sets. A shared `paymentStatusTone(status)` in `lib/orders` would let all three render the same colours for the same state.

### M3. snake_case → human label is duplicated three times with three different outputs
`src/app/(admin)/admin/orders/page.tsx:215-218` (`label`, title-cased: "Partially paid"), `src/app/(admin)/admin/today/order-queue.tsx:49` (inline `.replace(/_/g, ' ').toLowerCase()`, lowercased: "partially paid"), `src/app/(admin)/admin/orders/[orderId]/page.tsx:70` and `:161` (raw `order.paymentStatus` / `order.status` rendered verbatim: "PARTIALLY_PAID")

Three renderings of the same enum-to-string concern, producing three different strings for the same status. The detail page shows the raw database word to staff. A shared `humanizeStatus(status)` helper would unify the three.

### M4. Redirect-with-flash helper forked three ways across the P6 actions files
`src/app/(admin)/admin/orders/actions.ts:218-237` (`deskPath`, `doneAtDesk`, `backToDesk`, `done`, `back`), `src/app/(admin)/admin/pos/actions.ts:250-260` (`back`, `backToCheckout`, `backToCheckoutWith`), `src/app/(admin)/admin/imports/actions.ts:70-72` (`back`)

Each actions file builds its own `?notice=` / `?problem=` redirect URLs by hand with template strings and `encodeURIComponent`. The shapes differ (orders has a `returnTo` round-trip, pos has builder vs checkout targets, imports has a single back path) but the underlying concern — "redirect to a path carrying one of two flash keys" — is the same. `FlashMessages` (`components/ui/flash.tsx`) already reads these two keys; the write side has no shared helper. A `redirectWithFlash(path, { notice?, problem? })` would remove the three forks and the `deskPath`-style path-composition bug surface.

### M5. `pageQuery` duplicates `pageHref` minus the base path
`src/app/(admin)/admin/orders/page.tsx:201-205` (`pageQuery`), `src/lib/admin/list-query.ts:49-56` (`pageHref`)

Both build a `URLSearchParams` from a `Record<string, string>`, set `page` when `page > 1`, and call `.toString()`. `pageHref` returns `${basePath}?${encoded}` (or bare `basePath` when empty); `pageQuery` returns the bare query string for use as a hidden `returnTo` field. Same logic, two return shapes. `pageHref` could delegate to a shared `pageQueryString(query, page)` and `pageQuery` could call the same helper.

## Minor

### m1. Active-season lookup duplicated inline
`src/app/(admin)/admin/page.tsx:27`, `src/app/(admin)/admin/today/page.tsx:21`

Both pages run the identical `db.season.findFirst({ orderBy: [{ status: 'asc' }, { year: 'desc' }] })`. `lib/pos/counter.ts:36` has a third, different lookup (`openSeasonForCounter`, filters `status: 'OPEN'`). Three season-lookup patterns for "the season the admin is operating on right now." A `readActiveSeason()` helper would cover the first two; the POS variant stays separate because its semantics differ.

### m2. `phoneIfFree` returns a partial spread under a boolean-sounding name
`src/lib/imports/import-service.ts:253-260`

`phoneIfFree(tx, normalizedPhone, phone)` returns `{}` or `{ phone, normalizedPhone }`, spread into `tx.customer.update({ data: { ... } })` or `tx.customer.create({ data: { ... } })`. The name reads as "is this phone free?" (boolean) but it returns a partial of the customer write shape. Same shape as P5's `freePhone` finding (P5 m9). `claimablePhoneFields` or `phoneFieldsIfFree` would describe the return.

### m3. Product price round-trips through string
`src/lib/imports/row-readers.ts:120` (`pricecents: String(parsed.data.price)`), `src/lib/imports/import-service.ts:274` (`Number(row.parsed.pricecents)`)

The reader transforms the input string to a number via zod, then stringifies it into the `parsed` record; the writer parses it back to a number. The `parsed` column is `Json` so a number would survive. Storing the number directly removes the round-trip and the `String`/`Number` pair.

### m4. `input.seasonId!` non-null assertion repeated
`src/lib/imports/import-service.ts:65`, `:148`

The guard at `:50-52` proves `seasonId` is non-null for `PRODUCTS`, but the `!` is repeated at both call sites that pass it downstream. A local `const seasonId = input.seasonId` after the guard (or folding the check into the `PRODUCTS` branch) would remove the assertion.

### m5. `labelOf` and `shortId` are two label helpers for the same record shape
`src/lib/orders/bulk-actions.ts:178-186`

`labelOf(order)` produces `#000123` or the draft reference; `shortId(id)` produces `~abcd1234`. Both build the `BulkRecord.label` string. `shortId` is only used for the "no longer exists" branch where there is no order to read. Fine as is, but the two names don't signal that they answer the same question — one is "the label for this order", the other "the label when there is no order". `labelOfOrder` / `labelOfMissing` would pair them.

### m6. Admin route-path constants follow three conventions
`src/app/(admin)/admin/orders/page.tsx:24` (`const BASE_PATH = '/admin/orders'`, module-local), `src/lib/pos/paths.ts:6` (`POS_PATH` + helpers, central file), `src/app/(admin)/admin/imports/actions.ts:15` (`const IMPORTS_PATH = '/admin/imports'`, module-local)

Three conventions for "the admin route this feature lives at." POS gets a paths module because it has two composed routes (`posBuilderPath`, `posCheckoutPath`); orders and imports inline a single constant. Soft drift — not worth a paths module per feature, but worth noting that POS already established the pattern and the other two did not follow it.

### m7. `HEADERS` display map drifts from the CSV contract the reader enforces
`src/app/(admin)/admin/imports/page.tsx:18-21` (`HEADERS`), `src/lib/imports/row-readers.ts:39-43` (customer reader accepts `fullname` or `name`), `:108-113` (product reader accepts `price` or `pricecents`)

`HEADERS.CUSTOMERS = 'fullName, email, phone'` and `HEADERS.PRODUCTS = 'slug, name, priceCents, category'` are shown to the operator as the required columns. The readers accept more than that (`name` as a fallback for `fullname`, `price` as a fallback for `pricecents`). A reader who changes the accepted column set has to update `HEADERS` in a separate file or the upload hint drifts from the parser. Either derive `HEADERS` from the reader's accepted-key list or document the fallbacks in the hint.

### m8. `pos/page.tsx` open-tills narrowing is defensive code for a DB-enforced invariant
`src/app/(admin)/admin/pos/page.tsx:48-58`

The `flatMap` over `till.customer ? [...] : []` narrows out the null case, with a comment that says the `Order_pos_has_customer` CHECK constraint makes the null branch unreachable. The migration at `prisma/migrations/20260726230000_p6_ops_hub_pos_imports/migration.sql:80-81` confirms the constraint. Per the clean-code rule "no defensive code for conditions that can't happen", this is borderline — the schema relation is optional so TypeScript forces the check, and `flatMap` is the cheapest narrowing. Acceptable, but the comment is the only signal that the empty branch is dead.

## Notes (not findings)

- `lib/admin/list-query.ts` is the right home for the paging helpers and is reused by `order-desk.ts`, `customers.ts`, and the dashboard's `readPageRequest({ size: '5' })` call. Good centralization.
- `lib/orders/bulk-actions.ts` keeps the bulk report ordered by `label` so two staff running the same batch compare line-by-line; the `droppedCount` field and `summarizeBulk`'s "over the N limit" line carry the bounded-batch contract (G-024) into the redirect.
- `lib/pos/counter.ts` reuses `readCheckoutSummary`, `finalizeOrder`, and `postOfflinePayment` — the POS parity claim (UR-006) is structural, not asserted. The only POS-specific code is `posOwner` and the `expectedTotalCents` guard.
- `lib/imports/csv.ts` is a hand-written RFC 4180 reader; the comment explains why (one input shape, stdlib + native platform per the ponytail ladder). No CSV dependency added.
- `audit.ts` extends the `AuditDetails` map with `orders.bulk_action`, `order.repeated`, `import.staged`, `import.committed`, `import.discarded` — each new action is declared before it can be logged, which is the point of the map.
- `admin/orders/[orderId]/page.tsx` reuses `OFFLINE_METHOD_LABELS` from `lib/payments/offline-payments.ts` for the payment-row label, so the POS and the order desk spell "Cash" / "Check" the same way.
- `components/checkout/recipient-card.tsx` is shared between the storefront checkout and the POS checkout via injected `actions` props — the "same card on both sides" claim (UR-006) is structural.
