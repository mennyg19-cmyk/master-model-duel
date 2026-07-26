# P4 Rules Review — arm-04 (blind)

Reviewer: external, rules specialist. Scope: P4 delta only (`shared/MERGED-BUILD-PLAN.md` § P4 — cart-first builder, address book, customer account). Findings only — no fixes. No new scope beyond P4. Arm rules graded: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph` (from `arms/arm-04/ARM.md` and `arms/arm-04/.cursor/rules/`).

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 5 |

P4 delivers all 8 EXPECTED items. The delta is well-factored and security-conscious: guest tokens are SHA-256 hashed and cookie-cleared only on a successful claim (`draft-access.ts`); every draft query goes through a `DraftOwner` filter so order ids from URLs cannot walk to other customers' carts (R-121); `safeDestination` in `sign-in/actions.ts` blocks open-redirect via `//host` and exact-matches `/`; two hand-written CHECK constraints (`Order_has_owner`, `OrderLine_assignment_complete`) are asserted by `migration-guard.ts` so a schema drift cannot silently drop them; `address-book.ts` dedupes on a normalized key and rewrites draft lines (not placed snapshots) on edit. No new dependencies. No god files in production code. Comments explain WHY (snapshot vs live, draft ownership, audit attribution), not WHAT. The five findings are all minor consistency/naming items.

## Findings

### Minor

**m1 — Banned standalone name `item`.** `src/components/builder/product-panel.tsx:37,40,49,58`. `clean-code.mdc` § Naming Conventions: "No vague names: `data`, `result`, `info`, `temp`, `val`, `item`, `thing` are banned as standalone names." `BuilderProductPanel` maps `items.map((item) => ...)` and `BuilderProductCard` takes `{ item: BuilderProduct }`. `items` (plural collection) is fine; the singular `item` is on the banned list. Rename to `builderProduct` / `entry` (or destructure at the map boundary).

**m2 — Inconsistent notice/problem rendering across pages.** `src/app/(storefront)/account/orders/page.tsx:35-52` vs `src/app/(storefront)/account/addresses/page.tsx:41-58` and `src/app/(storefront)/order/page.tsx:121-138`. `clean-code.mdc` § Consistency: "One error-handling approach per project." The orders page routes `?notice=`/`?problem=` through a `MESSAGES` allowlist and renders only known strings. The addresses page and the builder page render the raw query-string value directly into the notice/problem banner. React escapes the output, so this is not an XSS vector, but a crafted URL (`/order?notice=anything`) can surface arbitrary text as a system notice on those two pages. One pattern for query-string notices should apply everywhere.

**m3 — `text()` helper duplicated in three server-action modules.** `src/app/(storefront)/account/actions.ts:93-95`, `src/app/(admin)/admin/customers/actions.ts:62-64`, `src/app/(storefront)/order/actions.ts:154-156`. `clean-code.mdc` § Abstraction Discipline (Rule of 2) and § Anti-AI-Tics ("No copy-paste patterns with minor variations — extract the pattern"). The identical one-liner `function text(formData, field) { return String(formData.get(field) ?? '').trim(); }` is defined three times with ~9 total call sites. A shared `lib/forms.ts` (or extending an existing form helper) would dedupe. Borderline — the helper is trivial and stable, so leaving it is also defensible under "if removing duplication adds more lines than it saves and the code is stable, leave it duplicated"; the call-site count tips it past the Rule of 2 bar.

**m4 — `scripts/smoke-p4.ts` exceeds the 500-line god-file threshold with mixed concerns.** `scripts/smoke-p4.ts` (549 lines). `clean-code.mdc` / `ponytail.mdc`: "split when >500 lines, mixed concerns, or a refactor command." The file mixes the S1–S3 test flow with ~10 helpers: HTML parsers (`builderCards`, `cartLines`, `sidebar`, `countOf`, `referenceOf`, `centsOf`), form/redirect helpers (`formWith`, `redirectOf`, `noticeOf`), and sign-in helpers (`signInCustomer`, `signInStaff`, `addToCart`, `assign`). The parsers in particular are reusable and would read more clearly in `scripts/smoke-p4-helpers.ts`. Test code, not production, so impact is low.

**m5 — Magic value `'US'` default country.** `src/lib/orders/assignment.ts:104`. `clean-code.mdc` § Refactor categories: "Magic values — named constants / enums." `addressCountry: address ? (address.country ?? 'US') : null` hardcodes `'US'` inline. A `DEFAULT_COUNTRY = 'US'` constant (colocated with the address module) would name the intent and make a future country change a single edit. The same default is not repeated elsewhere in the P4 delta, so this is a single-site magic value — borderline, but the rule calls for naming even single-site domain constants.

## Out of scope

Payment capture, Stripe hosted checkout, fulfillment commitment, POS cash/check posting, order lifecycle transitions past DRAFT (P5); package board, printing, shipping labels, routes/drivers (P7–P9); repeat orders, replacement-mapping admin, season wizard (P10) — all untouched per EXPECTED, confirmed by diff. The `order-service.ts` changes only relax `Order.customerId`/`OrderLine.recipientName`/`fulfillmentMethodId` to nullable and add the unassigned-line gate at finalize; no P5 behavior was added.

## Reproduce

```bash
npm install
npm run db:start          # separate terminal
npm run db:deploy && npm run seed
npm run ci                # lint, typecheck, migration guard, full test suite
npm run dev               # separate terminal
npm run smoke:p4          # S1–S3 + unit-test citations
```
