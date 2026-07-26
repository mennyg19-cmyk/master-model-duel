# P4 Aggregate Review — arm-04 (blind)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Phase:** P4 — cart-first builder, address book, customer account, staff customer directory.
**Method:** Union of four specialist reviews (security, quality, rules, clean-code), deduped by location+claim. No new findings introduced. Security findings keep their severity on merge.
**Source reviews:** `arms/arm-04/results/reviews/P4-{security,quality,rules,clean-code}-arm-04.md`.

## Counts after dedupe

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 17 |

## Prioritized fix list (builder-readable)

### Majors (fix before P5)

1. **Guest "self" assignment target is broken.** `AssignmentPanel` renders no `recipientName` field, but `fromAccountHolder` for a guest requires one and rejects with "Tell us your name…". The "self" radio is `defaultChecked`, so a guest's first assign attempt fails pointing at a field the form does not show; recovery requires switching to "Add a new recipient". Smoke S1e only exercises "self" with a signed-in customer; S2b builds a guest cart but never assigns it. *(quality M1)*
   - `src/components/builder/assignment-panel.tsx:51-135`
   - `src/lib/orders/assignment.ts:253-265`

2. **`text()` FormData helper duplicated across three action modules.** Three byte-identical copies of `function text(formData, field) { return String(formData.get(field) ?? '').trim(); }` with ~9 total call sites. Rule of 2 met; belongs in a shared `lib/forms` helper. The duplicated vague name (see minor m1) is harder to fix while the helper is forked. *(clean-code M1 ≡ rules m3; severity promoted to major on merge)*
   - `src/app/(storefront)/order/actions.ts:154`
   - `src/app/(storefront)/account/actions.ts:93`
   - `src/app/(admin)/admin/customers/actions.ts:62`

3. **Address-field extraction from FormData duplicated four times.** Each posts the same eight fields (`recipientName, label, line1, line2, city, state, postalCode, phone`) by hand. A new address column means four edits, three of them easy to miss. Extract `addressFieldsFromForm(formData)`. *(clean-code M2)*
   - `src/app/(storefront)/order/actions.ts:77` (`assignLineAction`)
   - `src/app/(storefront)/order/actions.ts:120` (`saveBuilderAddressAction`)
   - `src/app/(storefront)/account/actions.ts:37` (`saveAddressAction`)
   - `src/app/(admin)/admin/customers/actions.ts:24` (`saveCustomerAddressAction`)

### Minors (priority order — security first, then correctness/UX, then consistency)

**Security hardening (defense-in-depth; not exploitable in P4 callers):**

4. **`claimGuestDraft` TOCTOU can leave a customer with two DRAFTs.** No lock between `findOwnedDraft` (returns null) and `db.order.update` (re-parents the guest draft). A concurrent `addToCartAction` from the now-signed-in browser creates a second draft. Schema has no unique index on `(customerId, seasonId, status='DRAFT')`. Same root cause as the next item. *(security 1 ≡ quality m2)*
   - `src/lib/orders/cart-service.ts:172-203`
   - `src/lib/orders/cart-service.ts:43-50` (missing unique constraint)
   - `src/app/(storefront)/account/orders/[orderId]/page.tsx:133` (Continue link always goes to oldest draft)

5. **`safeDestination` whitelist bypassed by path traversal.** `candidate = '/account/../admin'` satisfies `startsWith('/account/')` and is returned unchanged; the browser normalizes to `/admin`. Admin routes still gate via `requirePermission`, so no privilege escalation — but the whitelist's intent is bypassed. Canonicalize the path before the prefix test. *(security 2)*
   - `src/app/(storefront)/account/sign-in/actions.ts:65-72`

6. **`saveBuilderAddressAction` skips `requireOpenStore`.** Every other action in `(storefront)/order/actions.ts` gates on `requireOwner()` → `requireOpenStore()`. This one only resolves `getCurrentCustomer()`, so a signed-in customer can mutate their address book while the store is closed. Not an ordering mutation, but the inconsistency is a trap for a P5 author. Gate it for parity or move it to `account/actions.ts`. *(security 3)*
   - `src/app/(storefront)/order/actions.ts:108-135`

7. **`discardDraft`/`transitionOrder` accept a bare `orderId` with no owner filter.** Service layer is IDOR-by-design; only the P4 caller's pre-check (`findOwnedOrder`) keeps it safe. Defense-in-depth: take a `DraftOwner` argument and fold `ownerFilter` into the `where`, matching `cart-service` and `assignment`. *(security 4)*
   - `src/lib/orders/order-service.ts:114-158`

8. **`claimGuestDraft` audit logged as `system`, not the customer.** Matches the audit module's convention (customer/cron actions are `system`), so not a bug. Flag for P5/P12 review when audit retention is finalized — the `order.draft_claimed` event has no attributable actor. *(security 5)*
   - `src/lib/orders/cart-service.ts:195-200`

**Correctness / UX:**

9. **`FulfillmentFields` pickup-location select always rendered when any pickup location exists, regardless of selected method.** Defaults to "Not picking up"; server ignores it unless `method.requiresPickupLocation`. No bad data written, but the UI implies pickup is choosable for delivery methods. *(quality m3)*
   - `src/components/builder/assignment-panel.tsx:249-261`

10. **Address autocomplete is browser autofill + a `<datalist>` of saved recipients only.** EXPECTED item 2 reads "address autocomplete + server validation". Server validation works; the autocomplete side is a defensible "no paid lookup service" reading of R-025 but does not include street-level suggestion lookup. Status file flags it as deliberate. Noting as interpretation gap, not defect. *(quality m1)*
    - `src/components/addresses/address-fields.tsx:35-56`

**Clean-code consistency:**

11. **`FormState` shape forked between account and admin.** Same `{ error, notice }` shape, three definitions. Account shares via `form-state.ts`; admin restates the type and `EMPTY` constant inline. *(clean-code m2)*
    - `src/app/(storefront)/account/form-state.ts:10`
    - `src/app/(admin)/admin/customers/actions.ts:8` (`CustomerFormState`)
    - `src/app/(admin)/admin/customers/[customerId]/address-book-editor.tsx:16` (`EMPTY`)

12. **Address summary formatting drifts between `addressSummary` and an inline formatter.** Staff editor inlines `[line1, line2, \`${city}, ${state} ${postalCode}\`].filter(Boolean).join(' · ')` instead of calling `addressSummary`. Same data, two formatters, two separators (comma vs middot). Storefront account page already calls `addressSummary`. *(clean-code m3)*
    - `src/lib/addresses/address-book.ts:191`
    - `src/app/(admin)/admin/customers/[customerId]/address-book-editor.tsx:64`

13. **`destinationOf` reimplements `addressSummary` inline.** Rebuilds the same line1/line2/city/state/zip string by hand, then adds a pickup branch. The address half could call `addressSummary` and the pickup branch could wrap it. *(clean-code m4)*
    - `src/lib/orders/customer-orders.ts:191`

14. **`BuilderSearchParams` duplicates `BuilderParams`.** Same eight query-string fields, two type definitions. The page-local type drops `| null` (Next.js searchParams never yield null) but is otherwise a copy. *(clean-code m5)*
    - `src/app/(storefront)/order/page.tsx:36`
    - `src/lib/orders/builder-href.ts:12`

15. **URL-notice rendering pattern drifts.** Orders page maps short codes to messages via `MESSAGES` allowlist; addresses and order pages render the raw `params.notice`/`params.problem` string directly. React escapes output (not XSS), but a crafted URL (`/order?notice=anything`) can surface arbitrary text as a system notice on those two pages. One pattern should apply everywhere; the orders-page approach is safer. *(rules m2 ≡ clean-code m6)*
    - `src/app/(storefront)/account/orders/page.tsx:9,35-52`
    - `src/app/(storefront)/account/addresses/page.tsx:41-58`
    - `src/app/(storefront)/order/page.tsx:121-138`

16. **Vague name `text`.** Reads as the noun, not what the helper does. `formField` or `trimmedField` would describe intent. Banned-names list in the arm's own `vocabulary.mdc` calls out standalone vague names; this one survives because it reads as a domain word. Fix together with major #2. *(clean-code m1)*
    - `src/app/(storefront)/order/actions.ts:154`
    - `src/app/(storefront)/account/actions.ts:93`
    - `src/app/(admin)/admin/customers/actions.ts:62`

17. **Banned standalone name `item`.** `BuilderProductPanel` maps `items.map((item) => …)` and `BuilderProductCard` takes `{ item: BuilderProduct }`. `items` (plural) is fine; the singular `item` is on the banned list. Rename to `builderProduct` / `entry` or destructure at the map boundary. *(rules m1)*
    - `src/components/builder/product-panel.tsx:37,40,49,58`

18. **Magic value `'US'` default country.** `addressCountry: address ? (address.country ?? 'US') : null` hardcodes `'US'` inline. A `DEFAULT_COUNTRY = 'US'` constant colocated with the address module would name intent and make a future country change a single edit. Single-site, but the rule calls for naming even single-site domain constants. *(rules m5)*
    - `src/lib/orders/assignment.ts:104`

19. **`findCustomerDraft` exported, never called.** Account dashboard uses `listCustomerOrders` + `.find` instead. Dead export. *(clean-code m7)*
    - `src/lib/orders/customer-orders.ts:76`

20. **`scripts/smoke-p4.ts` exceeds the 500-line god-file threshold with mixed concerns.** 549 lines mixing the S1–S3 test flow with ~10 helpers (HTML parsers, form/redirect helpers, sign-in helpers). Test code, not production, so low impact; the parsers in particular would read more clearly in `scripts/smoke-p4-helpers.ts`. *(rules m4)*
    - `scripts/smoke-p4.ts`

## Dedupe notes

- **Major #2** merges `rules m3` and `clean-code M1` (same `text()` duplication, same locations). Severity promoted to major on merge — clean-code rated major, rules rated minor; max severity wins for non-security findings.
- **Minor #4** merges `security 1` (TOCTOU framing) and `quality m2` (missing unique index framing) — same root cause, same `cart-service.ts` locations.
- **Minor #15** merges `rules m2` and `clean-code m6` (URL-notice rendering drift, same locations).
- **Minor #16** (vague name `text`) is kept separate from **Major #2** (duplication) — same locations, different claim.
- All five security findings survive as minors (no blockers); none were downgraded on merge.
- No new findings introduced during aggregation.

## Out of scope (carried from specialist reviews)

Payment capture, Stripe hosted checkout, fulfillment commitment (P5); POS cash/check posting (P5/P6); repeat orders and replacement-mapping admin (P10); package board, printing, shipping labels, routes/drivers (P7–P9); middleware/edge auth (P1); rate limiting on public endpoints (R-122 — P5 per plan); IP logging (no P4 caller passes `ipAddress`).
