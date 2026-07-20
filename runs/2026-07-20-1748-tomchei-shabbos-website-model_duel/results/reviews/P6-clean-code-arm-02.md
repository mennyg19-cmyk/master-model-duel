# Reviewer specialist — Clean-code

**Arm:** `arm-02`
**Tree / phase:** P6 — Admin operations hub & POS (`arms/arm-02/workspace/`)
**Output:** `results/reviews/P6-clean-code-arm-02.md`

Focus: duplication, naming, god files, pattern drift. Findings only, no fixes.
`clean-code` is in this arm's rules — review is in scope. Reviewer is blind to the
contestant model name.

Scope reviewed: `app/(admin)/admin/{page,layout,orders,customers,pos,import,settings}`,
`app/api/admin/{orders,customers,pos,import}`, `app/api/{draft,checkout/quote}`,
`components/admin/{pos-client,settings-hub,import-client,order-money-actions,order-bulk-actions,order-badges}`,
`lib/{orders/list,imports,csv,order-builder/draft-store,payments/post-payment}`.

Severity scale: **High** (real divergence / large duplication) · **Medium** (clear
duplication or drift) · **Low** (style / minor).

---

## High

### H1. Customer-search `where` clause duplicated with behavioral drift
`app/api/admin/customers/route.ts` (GET) and `app/(admin)/admin/customers/page.tsx`
both hand-build the same `OR: [name contains, email contains, phoneNormalized contains]`
with the same `phoneDigits.length >= 4` guard. They disagree on *when* the query is
treated as a phone number: the API only runs `normalizePhone(q)` when
`/^[\d\s\-().+]+$/` matches (`looksLikePhone`); the page calls `normalizePhone(q)`
unconditionally for every non-empty `q`. A name containing digits ("John 2nd")
hits phone matching on the directory page but not on the search API. Duplicated
query logic + inconsistent behavior between the two surfaces.

### H2. Quote `issues` flattening duplicated across POS and web quote routes
`app/api/admin/pos/quote/route.ts` and `app/api/checkout/quote/route.ts` both
construct the response `issues` array with the identical expression:

```
issues: [
  ...quote.priced.issues,
  ...quote.priced.lines.flatMap((line) => line.issues.map((issue) => `${line.productName}: ${issue}`)),
],
```

The POS route additionally maps `recipients`/`methods`/`purimDayChoices`. The
shared `buildCheckoutQuote` could return this shaped response (or a small shaper
helper could own it); instead the issue-flattening logic is copy-pasted between
the two endpoints and will drift.

### H3. Per-component inline `fetch` + error-extraction duplication
`components/admin/{pos-client,settings-hub,import-client,order-money-actions,order-bulk-actions}.tsx`
each reimplement the same pattern: `fetch(...)` → `await response.json().catch(() => null)`
→ `if (!response.ok) setError(body?.error ?? \`…(${response.status})\`)`. Only
`settings-hub.tsx` factors out a `requestJson` helper, and even that one doesn't
cover the others. Five client components, five copies of the same fetch/error
plumbing, with subtly different error fallback strings.

### H4. God file: `components/admin/pos-client.tsx` (468 lines, 3 components + type)
Holds `PosClient`, `CustomerPicker`, and `PosCheckout` plus the `PosQuote` type.
`PosCheckout` alone is ~230 lines mixing quote fetching, choice/delivery-day
state, fee rendering, and payment submission. `CustomerPicker` and `PosCheckout`
are independently mountable concerns; splitting them per file would clarify
ownership and shrink the largest file in the phase.

### H5. God file: `components/admin/settings-hub.tsx` (414 lines, 5 components + types)
Holds `SettingsHub` plus `OrdersTab`, `ShippingTab`, `EmailTab`, `DeveloperTab`
and the shared `SettingsHubData`/`ActFn`/`SaveSettingFn` types. The file mixes
season status, package types, pickup locations, follow-up, delivery ZIPs, rates,
fee rules, Purim day choices, email sender, and developer notes — every settings
concern in one file. Each tab is a clear single-concern split candidate.

---

## Medium

### M1. Money-line rendering duplicated
`<p className="flex justify-between"><span className="text-muted">…</span><span>{formatCents(…)}</span></p>`
is repeated across `app/(admin)/admin/orders/[id]/page.tsx` (items/fees/donation/total/posted/balance
≈ 6×), `components/admin/pos-client.tsx` (items/fee lines/total), and
`app/(admin)/admin/page.tsx` (dashboard cards use a different shape but same
intent). 3+ call sites — a `MoneyLine`/`MoneyRow` component is the textbook
extraction the clean-code rule set calls out.

### M2. Date formatting duplicated and ad-hoc
`toISOString().slice(0, 16).replace("T", " ")` (datetime) appears in
`orders/[id]/page.tsx` (placed, finalized, audit ≈ 3×) and
`order-money-actions.tsx` (receivedAt). `toISOString().slice(0, 10)` (date-only)
appears in `orders/page.tsx`, `customers/[id]/page.tsx`, and `customers/page.tsx`
(since). No shared `formatDate`/`formatDateTime` helper; the same slicing is
inlined ~6 times.

### M3. Page-clamp expression duplicated
`Math.min(MAX_PAGE, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1))`
is implemented in `lib/orders/list.ts` (`parseOrderListFilters`) and re-implemented
inline in `app/(admin)/admin/customers/page.tsx`. Same logic, two sources.

### M4. Pagination constants duplicated
`ORDERS_PAGE_SIZE = 25` (`lib/orders/list.ts`) and `PAGE_SIZE = 25`
(`customers/page.tsx`); `MAX_PAGE = 400` is declared in both `lib/orders/list.ts`
and `customers/page.tsx`. Same magic values, two independent sources — drift risk.

### M5. Pagination-link builders drift
`orders/page.tsx` `queryFor(page)` builds `URLSearchParams` by calling
`params.set(...)` per filter; `customers/page.tsx` `pageLink(target)` builds it by
spreading `{ ...(q ? {q} : {}), ...(target > 1 ? {page} : {}) }` into
`new URLSearchParams(...)`. Two pagination-link builders, two implementations,
same purpose.

### M6. Dollars-to-cents conversion duplicated
`order-money-actions.tsx` has `parseDollars` (`Math.round(Number.parseFloat(raw) * 100)`).
`settings-hub.tsx` inlines `Math.round(Number(newRate.price) * 100)` and
`Math.round(Number(event.target.value) * 100)` (twice — bulk + per-package). The
same cents conversion is reimplemented per surface instead of a shared
`dollarsToCents` helper.

### M7. `getOpenSeason` + "The store is closed" 409 boilerplate repeated
The identical 2-line season guard (`const season = await getOpenSeason(); if (!season)
return Response.json({ error: "The store is closed" }, { status: 409 });`) opens
`pos/draft`, `pos/quote`, `pos/checkout`, `checkout`, and `checkout/quote`.
`import/route.ts` does a conditional variant. A `requireOpenSeason()` helper would
remove the boilerplate and the copy of the literal `"The store is closed"` string.

### M8. Client-side type re-declarations drift from server shapes
- `PosQuote` (`pos-client.tsx`) re-declares the `fees` discriminated union from
  `buildCheckoutQuote`'s response.
- `StagedRow` is declared in both `lib/imports.ts` and
  `components/admin/import-client.tsx` (same shape, two sources).
- `Preview` (`import-client.tsx`) widens `kind` to `string` while the server's
  `StagedImport` uses `ImportKind` (`"customers" | "products"`).
- `PaymentRow` (`order-money-actions.tsx`) types `method`/`state` as `string`
  while the server sends Prisma `PaymentMethod`/`PaymentState` enums.

Each is a hand-maintained client mirror of a server shape; none are shared from a
single source, so all four can silently diverge.

### M9. POS checkout error-status and audit-atomicity drift
`app/api/admin/pos/checkout/route.ts` returns HTTP **200** with `{ ok: false,
error: finalizeError }` when finalize fails after the payment is posted — every
other admin API in this phase signals failure with a non-2xx status. The same
route also calls `postPayment(...)` and then `writeAudit(...)` as separate writes
(no `tx`), while `app/api/admin/orders/[id]/payments/route.ts` does both inside
one `db.$transaction`. Two payment-write paths, two different atomicity
contracts.

---

## Low

### L1. `pricecents` naming drift
`lib/imports.ts` `productRowSchema` uses the field name `pricecents` (all
lowercase, no separator) and `REQUIRED_HEADERS.products` lists `pricecents`. The
rest of the domain uses `priceCents` / `basePriceCents` / `amountCents`
(camelCase). The CSV header is lowercase by convention, but the schema field
itself breaks the casing convention used everywhere else.

### L2. `posDraftOwner` models POS as a "guest"
`lib/order-builder/draft-store.ts` `posDraftOwner(customerId)` returns
`{ kind: "guest", tokenHash: \`pos|${customerId}\` }`. A staff/POS draft is
modeled as a guest draft whose only distinguishing signal is the `pos|` prefix
in the hash. A `kind: "pos"` owner (or a dedicated column) would express intent
without the prefix trick.

### L3. Trivial one-line wrappers
`pos/draft/route.ts` `loadCustomer(id)` wraps `db.customer.findUnique` with a
null-id guard; `api/draft/route.ts` `ownerAddressBook(customerId)` wraps a
ternary. Both are one-liners behind a name; per the project's no-wrapper-for-
one-liner rule they add indirection without abstraction.

### L4. `"request"` magic sentinel in bulk report
`components/admin/order-bulk-actions.tsx` on HTTP failure pushes
`{ id: "request", reason: ... }` into the same `skipped` array that normally
holds order ids. The render path then does `labelById.get(entry.id) ?? entry.id`,
so the sentinel renders as the literal string `"request"`. A magic id mixed into
the data shape; the error path and success path speak different shapes.

### L5. Stripe refund button shown unconditionally
`components/admin/order-money-actions.tsx` renders the "Refund Stripe payment"
form whenever `can.refund`, regardless of whether the order has a refundable
Stripe payment. The API returns 404 if none. The UI offers an action the server
may always reject — UI logic doesn't reflect order state.

### L6. Void route mixes 400 and 409 for failures
`app/api/admin/orders/[id]/payments/[paymentId]/void/route.ts` maps
`stripe_not_voidable` → 400 and `already_voided` → 409. Other routes in this
phase use 409 for "state conflict" cases; the 400 here is a one-off choice.

### L7. `STALE_DRAFT_MS` and the ">1h" label drift together
`app/(admin)/admin/page.tsx` defines `STALE_DRAFT_MS = 60 * 60 * 1000` and
separately hardcodes the queue title `"Stale checkout drafts (>1h)"`. The label
is a string restatement of the constant; changing one without the other drifts.

### L8. Unnamed magic numbers
`app/api/admin/orders/[id]/payments/route.ts` `amountCents: z.number().int().min(1).max(10_000_000)`
and `app/api/admin/import/route.ts` `csv: z.string().min(1).max(2_000_000)` use
inline numeric literals (max $100k payment, 2 MB CSV) with no named constant or
comment explaining the bound.

### L9. `colSpan` hardcoded to column count
`orders/page.tsx` empty row uses `colSpan={8}`; `customers/page.tsx` uses
`colSpan={5}`. Both are tied by hand to the table's column count — adding a
column silently breaks the empty-state row.

### L10. `formatCents` lives in `lib/catalog`
`formatCents` is imported from `@/lib/catalog` across orders, payments, POS,
settings, and dashboard. A money-formatting helper used pervasively is
co-located with catalog code — a minor naming/co-location mismatch.

### L11. `import` route uses `seasonId = season?.id ?? ""`
`app/api/admin/import/route.ts` passes an empty string to
`stageImport`/`commitImport` when no season is open. Customer imports ignore
`seasonId` so `""` is harmless today, but an empty-string sentinel instead of
`null` is a smell that will bite if product-import code ever reads it.

### L12. `requirePermissionApi` gate boilerplate
Every admin API route opens with the same `const gate = await
requirePermissionApi(...); if ("response" in gate) return gate.response;`
two-liner. This is the established pattern (acceptable), but combined with M7's
season check it's ~4 lines of identical preamble per route.

---

## Counts by severity

| Severity | Count |
|---|---|
| High | 5 |
| Medium | 9 |
| Low | 12 |
| **Total** | **26** |

## Themes

- **Duplication** is the dominant issue: the customer-search `where`, the quote
  `issues` flattener, the per-component fetch plumbing, money-line rendering,
  date formatting, page-clamp math, and pagination-link building are each
  reimplemented 2–5×.
- **God files**: `pos-client.tsx` and `settings-hub.tsx` together account for
  ~880 lines of mixed-concern components.
- **Pattern drift**: client-side type mirrors diverge from server shapes
  (`PosQuote`, `StagedRow` ×2, `Preview`, `PaymentRow`); POS checkout uses a
  different error-status and audit-atomicity contract than the rest of the
  payment APIs; `looksLikePhone` is applied in one surface but not its twin.
- **Naming**: `pricecents`, `posDraftOwner` ("guest"), `formatCents` in
  `lib/catalog` are the notable mismatches.
