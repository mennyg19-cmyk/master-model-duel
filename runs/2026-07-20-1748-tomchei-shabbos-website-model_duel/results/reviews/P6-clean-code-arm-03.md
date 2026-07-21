# Reviewer specialist — Clean-code

**Arm:** `arm-03`
**Tree / phase:** P6 — Admin operations hub & POS (`arms/arm-03/workspace/`)
**Output:** `results/reviews/P6-clean-code-arm-03.md`

Focus: duplication, naming, god files, pattern drift, magic values, type/schema drift. Findings only, no fixes.
`clean-code` is in this arm's rules — review is in scope. Reviewer is blind to the contestant model name.

Scope reviewed: `app/(admin)/admin/{page,layout,today,orders,orders/[id],customers,customers/[id],pos,imports,audit}`,
`app/api/admin/{dashboard,orders,orders/[id]/refund,orders/[id]/repeat,orders/bulk,customers,customers/[id],pos/attach-customer,imports,banner}`,
`lib/ops/{orders,customers,refunds,import,repeat,settings-keys}`, `lib/{audit,result,phone}`,
`components/admin/{shell,orders-list,order-detail,customers-list,customer-detail,imports-client,pos-customer-panel,pos-page-client,settings-hub}`.

Severity scale: **High** (real divergence / large duplication) · **Medium** (clear duplication or drift) · **Low** (style / minor).

---

## High

### H1. Money formatting duplicated inline despite an existing `formatCents` helper
`lib/storefront/catalog.ts:11` re-exports `formatCents` (from `catalog-shared.ts`), available across the codebase. The P6 admin surface ignores it and inlines the same conversion:
- `app/(admin)/admin/page.tsx:7-10` defines a local `money()` → `cents == null ? "—" : \`$${(cents / 100).toFixed(2)}\``.
- `components/admin/orders-list.tsx:193` — `$${(o.expectedTotalCents / 100).toFixed(2)}`.
- `components/admin/order-detail.tsx:122, 133, 134, 150` — four more inline copies.

6+ call sites, helper exists, not reused. The local `money()` and `formatCents` also disagree on the null case, which is exactly the drift the shared helper exists to prevent.

### H2. List-page boilerplate duplicated between orders and customers
`components/admin/orders-list.tsx` and `components/admin/customers-list.tsx` both implement the same skeleton:
- `useCallback(load, [page, q])` building `URLSearchParams({ page, pageSize: "50" })` + optional `q`.
- `useEffect(() => void load(), [load])`.
- `setRows` / `setTotalPages` from `json`.
- Prev/Next button pair with `disabled={page <= 1}` / `disabled={page >= totalPages}`.

Two copies of the same list-page pattern, diverging only in the resource name and the filter set. The next admin list page (e.g. audit, staff) will pick one arbitrarily. A shared `useAdminList` hook (or a `<AdminListPanel>` component) covers both.

---

## Medium

### M1. Page-gate try/catch wrapper duplicated across 8 admin pages
The block
```
try { await requireAdminPage(...); ... } catch (error) {
  if (error instanceof AuthError && error.status === 403) return <Forbidden message={error.message} />;
  throw error;
}
```
is copy-pasted in `admin/page.tsx`, `today/page.tsx`, `orders/page.tsx`, `orders/[id]/page.tsx`, `customers/page.tsx`, `customers/[id]/page.tsx`, `imports/page.tsx`, `audit/page.tsx`. The POS page (`pos/page.tsx`) uses a *different* gate (see rules F9), so the phase has two gate patterns. A `withAdminPage(permission, render)` wrapper, or a shared `<AdminPage permission>` boundary component, removes the boilerplate and makes the one-off POS deviation impossible.

### M2. Audit query shape duplicated with two different limits
- `app/api/admin/orders/[id]/route.ts:29-34` — `db.auditLog.findMany({ where: { action: { in: ... } }, orderBy, take: 250, include: { actor } })` then JS-filter by `meta.orderId`.
- `app/(admin)/admin/audit/page.tsx:9-16` — `db.auditLog.findMany({ orderBy, take: 50, include: { actor, target } })`.

Same audit surface, two query shapes, two `take` literals (250 vs 50), two `include` sets. The order-detail path also does a JS-side filter the audit page doesn't. One `listAudit({ orderId?, limit })` helper in `lib/audit.ts` (which currently only owns `writeAudit`) covers both.

### M3. Settings JSONB type-narrowing duplicated in `settings-hub.tsx`
`components/admin/settings-hub.tsx:32-41` hand-narrows `emailFrom` / `emailReplyTo` for both object (`{ address }`) and string shapes — a 10-line `typeof`/`in` block, repeated for two keys. The settings JSONB is untyped end-to-end: `getSetting` returns `unknown`, each consumer re-derives the shape, and `load()` has to defend against both shapes because no schema owns the value. A typed `emailAddressSetting` parser (or a typed `getSetting<T>`) removes the block.

### M4. Inline magic list limits with no named constants
- `app/(admin)/admin/audit/page.tsx:11` — `take: 50`.
- `app/api/admin/orders/[id]/route.ts:32` — `take: 250`.
- `lib/ops/orders.ts:137` — `take: 8` (dashboard recent).
- `lib/ops/orders.ts:166` — `Math.min(100, Math.max(1, limit))` (today queue cap).
- `lib/ops/customers.ts:133` — `Math.min(25, limit)` (POS search).
- `lib/ops/orders.ts:8-9` — `DEFAULT_PAGE_SIZE = 50`, `MAX_PAGE_SIZE = 100` (named here, but re-inlined as `"50"` in `orders-list.tsx:34`, `customers-list.tsx:22`, `orders/route.ts:25`, `customers/route.ts:23`).

The list-page sizes are named in one file and literal everywhere else. One `lib/ops/limits.ts` (or extending `orders.ts` constants) covers the phase.

### M5. Client fetch → json → setError pattern duplicated across 7 components
`orders-list.tsx`, `customers-list.tsx`, `order-detail.tsx`, `customer-detail.tsx`, `imports-client.tsx`, `pos-customer-panel.tsx`, `settings-hub.tsx` each reimplement: `fetch(...)` → `await res.json()` → `if (!res.ok) setMessage(json.error || "… failed")`. Subtly different fallback strings ("Bulk failed", "Stage failed", "Commit failed", "Save failed", "Attach failed", "Find/create failed"). A shared `requestJson` helper (arm-02 put one in `settings-hub.tsx` but it didn't cover the others) removes the drift.

---

## Low

### L1. `imports-client.tsx` ships test CSV as the production textarea default
`components/admin/imports-client.tsx:22-24` seeds the textarea with `"displayName,email,phone\nValid Import,...\nDup Import,customer@tomchei.local,5559990000\nBad Row,,not-a-phone\n"`. A dev fixture baked into the production UI default; a real staff member opens the import page and sees seeded test rows referencing `customer@tomchei.local`. Default to empty (or a header-only line).

### L2. Import preview hides raw row cells
`components/admin/imports-client.tsx:97-101` renders `#{r.rowNumber} {r.status} — {r.errors.join("; ")}`. The staged `raw` cells (displayName/email/phone/sku) are fetched but not shown. The spec calls out "preview errors"; the user can see a row is INVALID but not what was in it, so they can't fix the source CSV without re-opening it.

### L3. `load` not in `useCallback` / effect deps incomplete
- `components/admin/order-detail.tsx:38-52` — `load` is a plain function, `useEffect(() => { void load(); }, [orderId])` omits `load` from deps.
- `components/admin/settings-hub.tsx:25-61` — same shape, `useEffect(() => { void load(); }, [])`.

Both are recreated each render; the effect only re-runs because of `[orderId]` / `[]`. Lint would flag the missing dep; a `useCallback` (or inlining) is the fix.

### L4. `orders-list.tsx` hardcodes the only bulk-status target
`components/admin/orders-list.tsx:77` sends `toStatus: "FULFILLING"` for the "Bulk → Fulfilling" button. `lib/ops/repeat.ts:227-231` allows `CANCELLED`, `FULFILLING`, `COMPLETED`. The UI exposes only one of three supported targets; the button label and the action are welded together. A target picker (or three buttons) would reflect the API.

### L5. `pos-customer-panel.tsx` debounce fetch has no `.catch` on `res.json()`
`components/admin/pos-customer-panel.tsx:33-37` — `const res = await fetch(...); const json = await res.json(); if (res.ok) setHits(json.customers);`. A non-JSON response (5xx HTML, gateway error) throws inside the timeout callback with no handler. Same shape in `orders-list.tsx:38-44`, `customers-list.tsx:24-29`, `order-detail.tsx:39-51`, `customer-detail.tsx:34-37`.

### L6. `checkout/offline/route.ts` redundant `if/else` in catch
`app/api/checkout/offline/route.ts:132-135` — `catch (error) { if (error instanceof AuthError) return apiErrorResponse(error); return apiErrorResponse(error); }`. Both branches return the same value; the `instanceof AuthError` test is dead. Collapse to one `return apiErrorResponse(error)`.

---

## Counts by severity

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 5 |
| Low | 6 |
| **Total** | **13** |

## Themes

- **Duplication** is the dominant issue: money formatting (H1), list-page boilerplate (H2), page-gate wrapper (M1), audit query (M2), settings JSONB narrowing (M3), client fetch plumbing (M5). Each is reimplemented 2–8×.
- **Pattern drift**: two page-gate patterns (M1 + rules F9); two audit query shapes (M2); two timestamp formats (rules F11); settings JSONB typed differently per consumer (M3).
- **Magic values**: list limits named in one file and literal in six others (M4); bulk caps duplicated route↔lib (rules F10).
- **No god files**: the largest P6 file (`settings-hub.tsx`, 329 lines) sits under the 500-line threshold and splits tabs by concern; `ops/import.ts` (359 lines) is the next largest and is single-concern. This is materially better than arm-02's `pos-client.tsx` (468) / `settings-hub.tsx` (414) god files.
- **Naming**: no banned standalone names (`data`, `result`, `item`) in P6 code; `phoneNorm` / `emailNorm` are consistent. The one naming smell — `stripeChargeId` holding either a `pi_` intent or a `ch_` charge (see `lib/ops/refunds.ts:56-64`) — is a schema-naming drift, flagged in rules F1's scope.
