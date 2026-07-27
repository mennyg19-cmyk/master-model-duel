# Test 5 residual review — Quality (arm-04, blind)

**Arm:** arm-04
**Tree graded:** `arms/arm-04/workspace/` (post self-fix, full tree)
**Scope:** correctness, broken flows, stubs, missing smoke, regressions vs EXPECTED.
**Method:** blind — post-fix tree only. No `SELF-REVIEW.md`, `SELF-FIX-NOTES.md`, or self-review/fix chat read.
**Findings only — no fixes proposed.**

## Severity summary

| Bucket | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 4 |
| Info | 3 |
| **Total** | **8** |

## What is solid (context, not findings)

- The self-fix customer-merge feature is wired correctly on the **resolution** side: `linkCustomerIdentity`, `findCustomer`, `getCurrentCustomer`, `findOrCreateLocalCustomer`, `findOrCreateCustomerAtCounter`, and `attachGuestCustomer` (checkout) all route through `survivorOf` (`src/lib/customers.ts:60`), so a household signing in with either login lands on the survivor's orders and address book. `lookupCustomersForCounter` (`customers.ts:183`) filters `mergedIntoCustomerId: null`, so the counter quick-search never offers a shell.
- `mergeCustomer` (`migration/address-cleanup.ts:196`) moves orders, archives duplicate address keys, releases the duplicate's login, and sets the `mergedIntoCustomerId` pointer in one transaction; the migration test (`tests/migration.test.ts:173`) proves the household lands on the survivor after merge. One-hop pointer invariant is documented and held.
- All six cron routes answer GET as well as POST behind the bearer gate (`src/app/api/cron/*/route.ts`); `vercel.json` registers all six. P12 EXPECTED S2e satisfied (smoke log confirms).
- Reconciliation `writeFindings` now `upsert`s on fingerprint (`payments/reconciliation.ts:206`) — the P12 F2 race is closed.
- Export audit row is written before the first byte leaves (`reports/export-service.ts:39`), amended on completion/cancel — P12 SEC-1 closed.
- `addressProblem` / `STATE_CODE` / `ZIP_CODE` centralized in `core/addresses.ts`; `legacy-rows.ts:172` reuses them — P12 Rules M1 closed.
- `legacy-import.ts` split into `legacy-rows.ts` + `legacy-verdicts.ts` + `legacy-commit.ts` + a thin orchestrator — P12 Rules M2 closed.
- `TabNav` extracted to `components/ui/tab-nav.tsx` — P12 clean-code M1 closed.
- `mapLegacyRow` validates candidate membership in the service (`legacy-import.ts:137`) and `lineNumber` is integer-validated (`migration/actions.ts:71`) — P12 SEC-2/SEC-3 closed.
- `wipeTransactionalData` now deletes `paymentReconciliationFlag` + `paymentReconciliationRun` (`testing/console.ts:139-140`) — P12 F7 closed.
- `finishRun` throws if the season was deleted mid-commit (`legacy-commit.ts:172`) — P12 F5 closed.
- P12 smoke evidence (`workspace/.scratch/PHASE-P12-SMOKE.md`) present and all rows PASS, including S3f (the merge) and S5a (full dress rehearsal). `.scratch/PHASE-P12-STATUS.md` present — P12 F1 closed.

## Findings

### MAJOR-1 — POS builder can create orders against a merged-away customer, re-splitting the household

**Where**
- `src/app/(admin)/admin/pos/[customerId]/page.tsx:59` — `db.customer.findUnique({ where: { id: customerId } })` (no `survivorOf`).
- `src/app/(admin)/admin/pos/[customerId]/checkout/page.tsx:47` — same direct lookup.
- `src/lib/orders/assignment.ts:263` — `fromAccountHolder` reads the customer by id and uses `customer.fullName` with no merge check.
- `src/lib/orders/cart-service.ts` and `src/lib/pos/counter.ts` — no `mergedIntoCustomerId` guard on the cart/order `customerId`.
- Entry points that target a shell id: `src/app/(admin)/admin/customers/page.tsx:108` (`posBuilderPath(customer.id)` on every directory row, shells included — see MINOR-1) and `src/app/(admin)/admin/customers/[customerId]/page.tsx:58` (`posBuilderPath(customer.id)` on the detail page, which loads the shell — see MINOR-2).

**Claim**
The self-fix added `survivorOf` to the lookup/resolution functions but not to the admin POS builder/checkout path. A merged-away customer remains a valid `Customer` row (by design — past order lines still point at its archived addresses), and the admin directory lists it (MINOR-1). Staff clicking "Ring up" on a shell start a cart keyed `posOwner(staff, shell.id)`; placing the order writes `order.customerId = shell.id`, re-splitting the household's history — the exact failure the merge exists to prevent. Pickup orders need no address, so the shell's empty address book does not block the flow. The counter quick-search is safe (`lookupCustomersForCounter` filters), but the directory "Ring up" link and the customer-detail "Ring up an order" link are not.

**Severity rationale:** Realistic path, not guaranteed — staff must find the shell in the directory and choose it. Data integrity impact (re-split) is serious but recoverable by another merge. Not a blocker: the counter search and all sign-in/checkout flows still resolve to the survivor.

### MINOR-1 — Admin customer directory lists merged-away customers as active

**Where:** `src/lib/customers.ts:147` (`listCustomerDirectory`) and `:132` (`customerSearchWhere`).

**Claim**
`listCustomerDirectory` does not filter `mergedIntoCustomerId: null`, so shells appear with 0 orders and 0 active addresses. `customerSearchWhere` returns them in name/email/phone search. This is the entry point that makes MAJOR-1 reachable. `lookupCustomersForCounter` (line 183) correctly filters, so the counter quick-search is fine — the inconsistency is the bug.

### MINOR-2 — Admin customer detail page does not redirect to the survivor

**Where:** `src/app/(admin)/admin/customers/[customerId]/page.tsx:30`.

**Claim**
The page loads the shell by id and renders an empty profile (0 orders, 0 addresses). The cleanup queue's "Open" link (`/admin/migration/cleanup/page.tsx:92`) points at `flag.customerId`, which after a DUPLICATE_CUSTOMER merge is the shell. Staff following it from a decided flag land on an empty profile rather than the survivor. The page should resolve through `survivorOf` and redirect.

### MINOR-3 — `bulkRepeatHistoryAction` / `repeatLatestOrderForCustomer` skip shells with a confusing message

**Where:** `src/app/(admin)/admin/customers/actions.ts:80` → `src/lib/orders/bulk-actions.ts:160` → `src/lib/orders/repeat-order.ts:128`.

**Claim**
A shell selected from the directory (MINOR-1) and submitted via "Repeat their last order" produces "Nothing to repeat: this customer has no order from an earlier season." — true for the shell, false for the household. The skip is silent about the merge; staff believe the household never ordered. Not a data bug; a confusing no-op that follows from MINOR-1.

### MINOR-4 — Reconciliation `MISSING_INTENT` finding still pairs `Gateway = $0.00` with `Expected = payment` for a recorded payment

**Where:** `src/lib/payments/reconciliation.ts:176-177`, rendered at `src/app/(admin)/admin/reports/payments/page.tsx:100-101`.

**Claim**
Carried from P12 F3. Column headers were improved to "Gateway"/"Expected" and the note clarifies, but for `MISSING_INTENT` the row reads `Gateway $0.00 · Expected $39.00` for a payment that *is* recorded on this side. The disagreement is the missing checkout attempt, not missing money; the column pairing still reads as "the gateway charged nothing." Display-only; the note carries the truth.

## Info (noted, no fix required)

- **INFO-1 — `itemSales` export `count` loads all groups into memory.** `src/lib/reports/datasets.ts:208-214`. Carried from P12 F6 (Low). `count` runs a full `groupBy` to return `.length`; `page` runs it again. Small by construction (one row per product snapshot), so not a scale problem — only a shape inconsistency with the paging interface.
- **INFO-2 — `readMarginReport(seasonId, 0)` non-obvious `limit=0` contract.** `src/lib/reports/datasets.ts:180` / `margin-report.ts:113`. Carried from P12 F4 (Low). `limit=0` slices the returned `rows` to empty but leaves `summary` computed from the full unsliced set — the year-metrics export depends on this. Works correctly; the contract is implicit.
- **INFO-3 — `claimPhone` writes the normalized form into the display `phone` column.** `src/lib/imports/prior-year-orders.ts:294`. The parameter is named `normalizedPhone` and the legacy path pre-normalizes via `legacy-rows.ts:115`, so the display column receives the E.164 form rather than the donor's original formatting. Minor display issue on the customer record for imported prior-year donors; not a correctness bug.

## Smoke vs EXPECTED

P12 EXPECTED S1–S5 all satisfied per `workspace/.scratch/PHASE-P12-SMOKE.md` (run 2026-07-27T09:07:54Z, all rows PASS). The merge path (S3f) is covered. The residual findings above are paths the smoke does not exercise: the smoke builds its rehearsal order from the storefront and the counter quick-search, never from the directory "Ring up" link on a merged-away customer, so MAJOR-1 / MINOR-1 / MINOR-2 / MINOR-3 were not caught.
