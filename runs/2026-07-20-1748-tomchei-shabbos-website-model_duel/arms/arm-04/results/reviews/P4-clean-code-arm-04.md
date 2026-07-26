# P4 Clean-Code Review — arm-04 (blind)

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`
Scope: P4 delta — cart-first builder, address book, customer account, staff customer directory.
Reviewer: external clean-code specialist (blind). Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 7 |

## Major

### M1. `text()` FormData helper duplicated across three action modules
`src/app/(storefront)/order/actions.ts:154`, `src/app/(storefront)/account/actions.ts:93`, `src/app/(admin)/admin/customers/actions.ts:62`

Three byte-identical copies of `function text(formData, field) { return String(formData.get(field) ?? '').trim(); }`. Rule of 2 is met with three real call sites today; this is a stable one-liner that belongs in a shared `lib/forms` helper. The duplication also makes the vague name (see m1) harder to fix once.

### M2. Address-field extraction from FormData duplicated four times
`src/app/(storefront)/order/actions.ts:77` (in `assignLineAction`), `src/app/(storefront)/order/actions.ts:120` (in `saveBuilderAddressAction`), `src/app/(storefront)/account/actions.ts:37` (in `saveAddressAction`), `src/app/(admin)/admin/customers/actions.ts:24` (in `saveCustomerAddressAction`)

Each posts the same eight fields (`recipientName, label, line1, line2, city, state, postalCode, phone`) by hand. Four copies of the same field list with no shared `addressFieldsFromForm(formData)` helper. A new address column today means four edits, and three of them are easy to miss.

## Minor

### m1. Vague name: `text`
`src/app/(storefront)/order/actions.ts:154`, `src/app/(storefront)/account/actions.ts:93`, `src/app/(admin)/admin/customers/actions.ts:62`

`text` reads as the noun, not what the helper does. `formField` or `trimmedField` would describe intent. Banned-names list in the arm's own `vocabulary.mdc` calls out standalone vague names; this one survives because it reads as a domain word.

### m2. `FormState` shape forked between account and admin
`src/app/(storefront)/account/form-state.ts:10` vs `src/app/(admin)/admin/customers/actions.ts:8` (`CustomerFormState`) and `src/app/(admin)/admin/customers/[customerId]/address-book-editor.tsx:16` (`EMPTY`)

Same `{ error, notice }` shape, three definitions. The account side shares via `form-state.ts`; the admin side restates the type and the empty constant inline. Identical use with `useActionState` in both places.

### m3. Address summary formatting drifts between `addressSummary` and an inline formatter
`src/lib/addresses/address-book.ts:191` (`addressSummary`) vs `src/app/(admin)/admin/customers/[customerId]/address-book-editor.tsx:64`

The staff editor inlines `[line1, line2, \`${city}, ${state} ${postalCode}\`].filter(Boolean).join(' · ')` instead of calling `addressSummary`. Same data, two formatters, two separators (comma vs middot). The storefront account page (`account/addresses/page.tsx:82`) already calls `addressSummary`, so the pattern exists.

### m4. `destinationOf` reimplements `addressSummary` inline
`src/lib/orders/customer-orders.ts:191`

Rebuilds the same line1/line2/city/state/zip string by hand, then adds a pickup branch. The address half could call `addressSummary` and the pickup branch could wrap it; today it forks the formatting.

### m5. `BuilderSearchParams` duplicates `BuilderParams`
`src/app/(storefront)/order/page.tsx:36` vs `src/lib/orders/builder-href.ts:12`

Same eight query-string fields, two type definitions. The page-local type drops `| null` (Next.js searchParams never yield null) but is otherwise a copy. The page could derive from `BuilderParams` or the two could share one canonical type.

### m6. URL-notice rendering pattern drifts
`src/app/(storefront)/account/orders/page.tsx:9` (`MESSAGES` code→text map) vs `src/app/(storefront)/account/addresses/page.tsx:41` and `src/app/(storefront)/order/page.tsx:121` (raw `params.notice` string rendered)

The orders page maps short codes to messages; the addresses and order pages render the URL string directly. Two patterns for the same concern (URL-driven notice/problem). The orders-page approach is safer (no arbitrary text in the URL) but is only used once.

### m7. `findCustomerDraft` exported, never called
`src/lib/orders/customer-orders.ts:76`

Exported `findCustomerDraft(customerId)` has no call site in the workspace. The account dashboard (`account/page.tsx:20`) uses `listCustomerOrders` + `.find` instead. Dead export.

## Notes (not findings)

- `order/page.tsx` is 293 lines with mixed data-loading, ZIP-checker widget, layout, and module-level helpers (`cartActions`, `linksFor`). Under the 500-line god-file threshold and the concerns are page-local, so not flagged — but worth watching as P6 adds POS parity to the same shell.
- `readOrderDetail` (`customer-orders.ts:97`) runs two queries (ownership check, then a re-fetch with includes) where one `findFirst` with includes would do. Not a clean-code category failure; noted as a quality follow-up, not counted above.
- The two reporting patterns (URL-redirect for the builder's many forms vs `useActionState` for single-form pages) is documented in `form-state.ts` and `order/actions.ts` and is a deliberate split, not drift.
