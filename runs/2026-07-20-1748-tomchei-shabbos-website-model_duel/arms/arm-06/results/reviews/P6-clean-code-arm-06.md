# Reviewer specialist — Clean-code

**Arm:** `arm-06` (blind — no model names)
**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Tree / phase:** P6 — Admin operations hub & POS
**Rule source:** `arms/arm-06/.cursor/rules/clean-code.mdc` (active)
**Reviewer scope:** Findings only, no fixes. Severity: Blocker / Major / Minor.

## Scope reviewed

P6 surface: `app/(admin)/admin/{layout,page}.tsx`, `app/(admin)/admin/orders/{page,order-list-table}.tsx`, `app/(admin)/admin/orders/[orderId]/{page,order-actions}.tsx`, `app/(admin)/admin/customers/page.tsx`, `app/(admin)/admin/customers/[customerId]/{page,customer-editor}.tsx`, `app/(admin)/admin/pos/{page,pos-shell}.tsx`, `app/(admin)/admin/pos/checkout/page.tsx`, `app/(admin)/admin/imports/{page,import-upload}.tsx`, `app/(admin)/admin/imports/[batchId]/{page,import-preview}.tsx`, `app/api/admin/orders/bulk/route.ts`, `app/api/admin/orders/[orderId]/payments/route.ts`, `app/api/admin/payments/[paymentId]/{void,refund}/route.ts`, `app/api/admin/imports/route.ts`, `app/api/admin/imports/[batchId]/{commit,discard}/route.ts`, `app/api/admin/pos/{draft,checkout}/route.ts`, `lib/admin/{dashboard,order-list}.ts`, `lib/orders/{bulk,repeat}.ts`, `lib/payments/{pos,refund}.ts`, `lib/imports/{engine,customers,products,kinds}.ts`, `lib/customers/directory.ts`, `components/admin/{back-link,order-badges,sidebar}.tsx`.

---

## Findings

### Minor-1 — Duplicated `first()` array-picker (Rule of 2 met)

`lib/admin/order-list.ts:19-23` defines `first(raw)` for `string | string[] | undefined` search-params. `lib/customers/directory.ts:17-18` reimplements the same logic inline for `q` and `page`. Two real call sites, identical intent. `directory.ts` already imports from `order-list.ts` (`DEFAULT_PAGE_SIZE`, `parsePageSize`) — it should call `first()` rather than fork the pattern. `clean-code.mdc` Consistency / duplicated logic.

**Severity: Minor.**

---

### Minor-2 — Duplicated pagination nav + `pageHref` builder

The Prev/Next `<nav>` block and the `pageHref(target)` URL builder are near-verbatim across the two list pages (`app/(admin)/admin/orders/page.tsx:75-84` + `170-186`, `app/(admin)/admin/customers/page.tsx:40-46` + `111-127`). Two call sites now; a third list page would tip it further. A `<PaginationNav page pages href={pageHref} />` component plus a `buildListHref(base, params)` helper would dedupe the markup and the URLSearchParams loop. `clean-code.mdc` duplicated UI / duplicated logic.

**Severity: Minor.**

---

### Minor-3 — Magic `25` in orders list page

`app/(admin)/admin/orders/page.tsx:80` hardcodes the default page size:

```80:80:app/(admin)/admin/orders/page.tsx
    if (params.pageSize !== 25) query.set("size", String(params.pageSize));
```

`DEFAULT_PAGE_SIZE` is exported from the same module the file imports (`lib/admin/order-list.ts:7`). The literal `25` is a magic value that must mirror `DEFAULT_PAGE_SIZE` by hand — drift here silently breaks the "clean URL when default" contract. `clean-code.mdc` Abstraction Discipline: magic values.

**Severity: Minor.**

---

### Minor-4 — Redundant `|| DEFAULT_PAGE_SIZE` in directory.ts

`lib/customers/directory.ts:22`:

```22:22:lib/customers/directory.ts
    pageSize: parsePageSize(searchParams.size) || DEFAULT_PAGE_SIZE,
```

`parsePageSize` (`lib/admin/order-list.ts:33-36`) already returns `DEFAULT_PAGE_SIZE` when the input is not in `LIST_PAGE_SIZES`. The `|| DEFAULT_PAGE_SIZE` is dead code — `parsePageSize` never returns a falsy value. `clean-code.mdc` Anti-AI-Tics: "No 'just in case' code — every line must have a reason."

**Severity: Minor.**

---

### Minor-5 — Duplicate `next/navigation` import statement

`app/(admin)/admin/imports/[batchId]/page.tsx:3,5`:

```3:5:app/(admin)/admin/imports/[batchId]/page.tsx
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/permissions";
import { forbidden } from "next/navigation";
```

Two import statements from the same module. Every other P6 file combines them (e.g. `orders/[orderId]/page.tsx:3`). Pattern drift; merge into one line.

**Severity: Minor.**

---

### Minor-6 — `["-"]` sentinel hack in order-detail audit query

`app/(admin)/admin/orders/[orderId]/page.tsx:38-48` builds the audit `OR` with a sentinel to dodge an empty `in:`:

```41:44:app/(admin)/admin/orders/[orderId]/page.tsx
      OR: [
        { targetType: "Order", targetId: order.id },
        { targetType: "Payment", targetId: { in: paymentIds.length > 0 ? paymentIds : ["-"] } },
      ],
```

The `["-"]` is a "just in case" workaround for an empty payment list. The cleaner shape is to build the `OR` array conditionally (omit the `Payment` branch entirely when `paymentIds` is empty) — no sentinel, no scan over a key that can never match. `clean-code.mdc` Error Handling / Anti-AI-Tics: no defensive code for conditions that can be expressed directly.

**Severity: Minor.**

---

### Minor-7 — Silent `?? "CASH"` default in POS checkout

`lib/payments/pos.ts:40`:

```40:40:lib/payments/pos.ts
  const method = OFFLINE_METHODS[input.checkout.method as keyof typeof OFFLINE_METHODS] ?? "CASH";
```

The route (`app/api/admin/pos/checkout/route.ts:27-32`) rejects `"card"` but the cast `as keyof typeof OFFLINE_METHODS` asserts the remaining value is one of `cash | check | comp`. If `checkoutSubmitSchema` ever admits a new method that reaches here, the cast hides it and the `?? "CASH"` silently coerces it to cash — a posted payment with the wrong method on the audit trail. An unknown method should be a 422, not a silent default. `clean-code.mdc` Anti-AI-Tics: no silent "just in case" defaults; Error Handling: error messages should name the unexpected state.

**Severity: Minor.**

---

### Minor-8 — Swallowed address-fetch error in POS shell

`app/(admin)/admin/pos/pos-shell.tsx:57-62`:

```57:62:app/(admin)/admin/pos/pos-shell.tsx
  async function pickCustomer(hit: CustomerHit) {
    setError(null);
    const addresses = await apiFetch<{ addresses?: BookAddress[] }>(`/api/admin/customers/${hit.id}/addresses`);
    setBookAddresses(addresses.ok ? (addresses.body.addresses ?? []) : []);
    setCustomer(hit);
  }
```

On a failed address fetch the error is dropped (`addresses.ok ? ... : []`) and the customer is selected anyway, with no signal that the address book failed to load. The user proceeds against an empty book and only discovers the problem at checkout. `clean-code.mdc` Error Handling: "No swallowed errors." Either surface the failure via `setError` or retry; silently substituting `[]` is the empty-catch anti-pattern in conditional form.

**Severity: Minor.**

---

### Minor-9 — Duplicated bulk-action busy/error pattern in OrderActions

`app/(admin)/admin/orders/[orderId]/order-actions.tsx` has `run(label, fn)` for post/void/refund/discard, but `repeatOrder` (lines 91-107) reimplements the same busy/error/refresh dance because it needs to extract `draftRef` from the report. The `run` helper could accept an optional `onOk(body)` hook, collapsing `repeatOrder` back onto the shared path. Two call sites for the bespoke version; the rest already share `run`. `clean-code.mdc` duplicated logic with minor variations.

**Severity: Minor.**

---

### Minor-10 — `countByVerdict` recomputed redundantly in import engine

`lib/imports/engine.ts` calls `countByVerdict(rows)` twice in `stageImport` (lines 116 and 125 — once in `importBatch.create` data, once in the audit `metadata`) and twice in `commitImport` (lines 158 and 167) on the same `payload.rows`. Each call re-filters the full row list three times. Compute once into a `const counts = countByVerdict(rows)` and reuse. Minor cost, but it's the "same value computed repeatedly" smell the rule flags under Anti-AI-Tics.

**Severity: Minor.**

---

### Minor-11 — Duplicated `—` missing-value sentinel (one side dead)

`app/(admin)/admin/imports/[batchId]/page.tsx:57-59` maps `null` → `"—"` when flattening `row.data` to strings for the preview component:

```57:59:app/(admin)/admin/imports/[batchId]/page.tsx
          Object.fromEntries(
            Object.entries(row.data).map(([key, value]) => [key, value === null ? "—" : String(value)]),
          ),
```

Then `app/(admin)/admin/imports/[batchId]/import-preview.tsx:99` renders `{row.data[column] ?? "—"}`. Since the page already converted nulls to `"—"`, the preview's `?? "—"` is dead (the value is never null/undefined). Two sentinels for the same concept, one of which can't fire. Pick one owner of the `—`-for-missing convention (the preview component) and pass the raw typed data through, or drop the `?? "—"` in the preview. `clean-code.mdc` Consistency / dead code.

**Severity: Minor.**

---

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 11 |
| **Total** | **11** |

No Blockers or Majors. The P6 surface is cohesive: bounded queries, one audit pattern, one badge/toning mapping, one import-handler registry, shared list-controls state via `lib/admin/order-list.ts`. The 11 Minors cluster around two themes — Rule-of-2 duplications across the two list pages (Minors 1, 2, 9) and small "just in case" defaults/sentinels that the rule explicitly discourages (Minors 4, 6, 7, 8, 11). None block the phase gate.
