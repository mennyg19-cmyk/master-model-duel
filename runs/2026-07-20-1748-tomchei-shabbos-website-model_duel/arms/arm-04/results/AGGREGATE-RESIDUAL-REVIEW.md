# Aggregate Residual Review — arm-04 (Test 5)

**Reviewer:** external residual aggregator (blind)
**Tree graded:** `arms/arm-04/workspace/` (post self-fix, full tree)
**Method:** union + dedupe by location+claim across the four specialist residual reviews. No new findings introduced. Security findings always survive.
**Sources:**
- `results/reviews/residual-security-arm-04.md`
- `results/reviews/residual-quality-arm-04.md`
- `results/reviews/residual-rules-arm-04.md`
- `results/reviews/residual-clean-code-arm-04.md`

## Totals

| Bucket | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 14 |
| Info | 3 |
| **Total (actionable)** | **17** |

Info items are noted for completeness; not required fixes.

## Per-source counts

| Source | Blocker | Major | Minor | Info |
|---|---|---|---|---|
| security | 0 | 0 | 5 | 0 |
| quality | 0 | 1 | 4 | 3 |
| rules | 0 | 0 | 3 | 0 |
| clean-code | 0 | 2 | 3 | 0 |
| **raw sum** | 0 | 3 | 15 | 3 |
| **after dedupe** | 0 | 3 | 14 | 3 |

One duplicate removed: the `result` standalone-name finding in `src/app/(storefront)/newsletter-actions.ts` appears in both rules (Rules-1) and clean-code (m-2) — merged into a single minor (MIN-09 below).

## Blockers

None.

## Majors

### MAJ-01 — POS builder can create orders against a merged-away customer, re-splitting the household
- **Source:** quality (MAJOR-1)
- **Where:**
  - `src/app/(admin)/admin/pos/[customerId]/page.tsx:59` — direct `db.customer.findUnique`, no `survivorOf`
  - `src/app/(admin)/admin/pos/[customerId]/checkout/page.tsx:47` — same
  - `src/lib/orders/assignment.ts:263` — `fromAccountHolder` reads by id, no merge check
  - `src/lib/orders/cart-service.ts`, `src/lib/pos/counter.ts` — no `mergedIntoCustomerId` guard on cart/order `customerId`
  - Reachable via `posBuilderPath(customer.id)` on directory rows (MIN-01) and the customer detail page (MIN-02)
- **Claim:** The self-fix added `survivorOf` to lookup/resolution paths but not to the admin POS builder/checkout. A merged-away customer is still a valid `Customer` row; staff clicking "Ring up" on a shell start a cart keyed to the shell id and place an order with `order.customerId = shell.id`, re-splitting the household's history. Pickup orders need no address, so the empty address book does not block the flow. Counter quick-search is safe (`lookupCustomersForCounter` filters); directory and detail-page links are not.
- **Severity rationale:** Realistic but not guaranteed; data integrity impact is serious but recoverable by another merge. Not a blocker — sign-in/checkout and counter search still resolve to the survivor.

### MAJ-02 — `isUniqueViolation` helper exists but is bypassed in 4 modules (pattern drift)
- **Source:** clean-code (M-1)
- **Where:**
  - `src/lib/core/prisma.ts:12` — defines `isUniqueViolation(error)` / `isMissingRec(error)`
  - Inline `error instanceof Prisma.PristmaClientKnownRequestError && error.code === 'P2002'` still in:
    - `src/lib/customers.ts:36-37`, `:258-259`, `:348-349`
    - `src/lib/payments/webhook-service.ts:103`
    - `src/lib/bootstrap.ts:78`
    - `src/lib/seasons/wizard.ts:118`
- **Claim:** The helper was introduced specifically to eliminate this drift (per its own comment) and is used in `catalog/admin.ts`, `notifications/outbox.ts`, `email/campaigns.ts`. The inline detector persists in 4 modules / 6 sites — the same drift the helper was created to prevent, violating the arm's "one pattern per concern" rule in the same module that documents it.

### MAJ-03 — `env-spec.ts` superRefine: 7 near-identical loopback-check blocks + 6 secret-required blocks
- **Source:** clean-code (M-2)
- **Where:** `src/lib/env-spec.ts:288-458`
  - Loopback checks at lines 305-316, 328-336, 348-356, 361-369, 395-405, 422-430, 437-448 (7 blocks, ~70 lines, all `if (env.X === 'local'/'capture' && !isLoopbackUrl(env.APP_URL)) ctx.addIssue(...)`)
  - Secret-required-when-provider checks at lines 297-303, 318-324, 338-344, 371-377, 379-389, 450-457 (6 blocks)
- **Claim:** Two helpers (`requireLoopback(...)`, `requireSecretWhen(...)`) would collapse ~130 lines of near-duplicate `addIssue` boilerplate into ~30. The file's own `checkSecretStrength` helper proves the pattern. Adding a new provider today means copy-pasting a 10-line block and editing the message — exactly the anti-pattern named in the arm's `clean-code.mdc`.

## Minors

### MIN-01 — Admin customer directory lists merged-away customers as active
- **Source:** quality (MINOR-1)
- **Where:** `src/lib/customers.ts:147` (`listCustomerDirectory`), `:132` (`customerSearchWhere`)
- **Claim:** `listCustomerDirectory` does not filter `mergedIntoCustomerId: null`, so shells appear with 0 orders / 0 addresses. `customerSearchWhere` returns them in name/email/phone search. `lookupCustomersForCounter` (line 183) correctly filters — the inconsistency is the bug. This is the entry point that makes MAJ-01 reachable.

### MIN-02 — Admin customer detail page does not redirect to the survivor
- **Source:** quality (MINOR-2)
- **Where:** `src/app/(admin)/admin/customers/[customerId]/page.tsx:30`
- **Claim:** The page loads the shell by id and renders an empty profile. The cleanup queue's "Open" link (`/admin/migration/cleanup/page.tsx:92`) points at `flag.customerId`, which after a DUPLICATE_CUSTOMER merge is the shell; staff following it land on an empty profile rather than the survivor. Should resolve through `survivorOf` and redirect.

### MIN-03 — `bulkRepeatHistoryAction` / `repeatLatestOrderForCustomer` skip shells with a confusing message
- **Source:** quality (MINOR-3)
- **Where:** `src/app/(admin)/admin/customers/actions.ts:80` → `src/lib/orders/bulk-actions.ts:160` → `src/lib/orders/repeat-order.ts:128`
- **Claim:** A shell selected from the directory (MIN-01) and submitted via "Repeat their last order" produces "Nothing to repeat: this customer has no order from an earlier season." — true for the shell, false for the household. The skip is silent about the merge; staff believe the household never ordered. Not a data bug; a confusing no-op that follows from MIN-01.

### MIN-04 — Reconciliation `MISSING_INTENT` finding still pairs `Gateway = $0.00` with `Expected = payment` for a recorded payment
- **Source:** quality (MINOR-4)
- **Where:** `src/lib/payments/reconciliation.ts:176-177`; rendered `src/app/(admin)/admin/reports/payments/page.tsx:100-101`
- **Claim:** Carried from P12 F3. Headers improved to "Gateway"/"Expected" and the note clarifies, but for `MISSING_INTENT` the row reads `Gateway $0.00 · Expected $39.00` for a payment that *is* recorded on this side. The disagreement is the missing checkout attempt, not missing money; the column pairing still reads as "the gateway charged nothing." Display-only; the note carries the truth.

### MIN-05 — CSV import stores formula-injection prefixes verbatim
- **Source:** security (SEC-01)
- **Where:** `src/lib/imports/csv.ts`; flows into admin views / CSV exports via `src/lib/reports/export-service.ts`
- **Claim:** RFC 4180 parser stores values beginning with `=`, `+`, `-`, `@` as typed. Imported customer/product fields (name, address, notes) flow into admin list views and CSV exports. An attacker who can submit a CSV import (`migration.manage`/`imports.manage` staff, or a poisoned legacy file) can plant cells Excel/Sheets interpret as formulas when an admin opens the re-exported CSV. Bounded impact (admin-only, no server execution); classic injection-of-trust vector. Not exploitable by anonymous users.

### MIN-06 — In-memory rate limiter is per-instance and not shared
- **Source:** security (SEC-02)
- **Where:** `src/lib/http/public-guards.ts` (module-scope `Map`)
- **Claim:** Under serverless / multi-instance deployments each warm instance has its own counter, so the effective limit is `limit × instanceCount`. Public endpoints (client-error reporter, Stripe webhook) tolerate more hits than configured. No data exposed; brute-force / abuse throttling is weaker than configuration implies.

### MIN-07 — `clientIpAddress` trusts `x-forwarded-for` first IP unconditionally when `TRUST_PROXY_HEADERS` is set
- **Source:** security (SEC-03)
- **Where:** `src/lib/http/request-ip.ts`, `src/lib/http/public-guards.ts`
- **Claim:** When `TRUST_PROXY_HEADERS=true`, the first entry of `x-forwarded-for` is read. On a chain where the leftmost value is client-controlled and not stripped by the edge, the first IP can be spoofed. Audit logs and rate-limit buckets would attribute actions to an attacker-chosen address. Opt-in (default `false`); deployment-footgun, not a default bug.

### MIN-08 — Local hosted-payment page is gated only by session URL, not by a server-verified ownership check on the order
- **Source:** security (SEC-04)
- **Where:** `src/app/checkout/hosted/[sessionId]/actions.ts`, `src/lib/payments/local-hosted.ts`
- **Claim:** Lookup by session id (unguessable random) references the order; confidentiality rests on session-id entropy. No secondary `customerId`/`draftOwner` match. For the local provider (loopback-only by env validation) this is acceptable, but the pattern would be unsafe if the local provider were ever exposed off-loopback. Trust-boundary note, not an exploitable path today.

### MIN-09 — Banned standalone name `result` in `newsletter-actions.ts`
- **Source:** rules (Rules-1) + clean-code (m-2) — merged; same location+claim
- **Where:** `src/app/(storefront)/newsletter-actions.ts:22, :45, :59`
- **Claim:** `const result = await subscribe(...) / updatePreferencesByToken(...) / unsubscribeByToken(...)`. `result` is on the arm's `clean-code.mdc` banned list. Sibling action files use semantic names (`posted`, `voided`, `refunded`, `moved`, `bought`). Rename to `subscription` / `preferenceSave` / `unsub`.

### MIN-10 — Banned standalone name `data` as Prisma `data:` argument
- **Source:** rules (Rules-2)
- **Where:** `src/lib/catalog/admin.ts:95, :212`; `src/lib/imports/import-service.ts:342`
- **Claim:** `const data = { ...fields, priceCents: price }` passed as Prisma's `data:` argument. Idiomatic for Prisma, but the rule bans `data` as a standalone name. Rename to `productData` / `rowData` to satisfy the rule literally.

### MIN-11 — Banned standalone name `item` in a non-loop binding
- **Source:** rules (Rules-3)
- **Where:** `src/lib/testing/console.ts:56`
- **Claim:** `const item = SEED_ITEMS[index % SEED_ITEMS.length]`. `item` is on the banned list. Rename to `seedItem` / `chosenSeed`. (Loop-iteration `for (const item of items)` in `bin-packing.ts:75` is the standard idiom and not flagged.)

### MIN-12 — Duplicated phone-field schema in `customers.ts`
- **Source:** clean-code (m-1)
- **Where:** `src/lib/customers.ts:199-209` (`counterCustomerSchema.phone`), `:302-311` (`profileSchema.phone`)
- **Claim:** Same `phone` Zod field defined verbatim at two sites (`z.string().trim().transform(...).refine(...)` with the same 10-digit US message). A single `const phoneField = ...` constant in this module would deduplicate ~10 lines at 2 sites. The `fullName` field is likewise repeated across `localSignInSchema`, `counterCustomerSchema`, and `profileSchema` with only the min-length message differing.

### MIN-13 — `proxy.ts` middleware is a coarse auth check, relies on cookie name not validity
- **Source:** security (SEC-05)
- **Where:** `src/proxy.ts`
- **Claim:** Any request with `SESSION_COOKIE` present is let through without signature verification; tampered/junk cookies reach the route handler, where `requirePermission` does the real check. No bypass (the real gate is server-side), but every cookie-shaped value skips the redirect. Defense-in-depth gap, not a vulnerability.

### MIN-14 — Per-screen `done`/`back` + `X_FILTERS` redirect scaffolding duplicated across admin actions
- **Source:** clean-code (m-3)
- **Where:** `src/app/(admin)/admin/orders/actions.ts:214-249`, `src/app/(admin)/admin/fulfillment/actions.ts:274-311`
- **Claim:** Each defines its own `X_FILTERS` const, `xFilters(returnTo)` parser, and `doneAtX`/`backToX` wrappers around `redirectWithFlash`. Shapes identical; only path and filter names differ. A `keepFiltersFrom(returnTo, names)` + `flashBack(basePath, filters, message)` pair would cover both. At the Rule-of-2 threshold — borderline; flagged minor because the duplication is stable and extracting saves only a few lines (discipline rules say leave alone). Worth revisiting if a third admin screen grows the same shape.

## Info (noted, no fix required)

### INFO-01 — `itemSales` export `count` loads all groups into memory
- **Source:** quality (INFO-1)
- **Where:** `src/lib/reports/datasets.ts:208-214`
- **Claim:** `count` runs a full `groupBy` to return `.length`; `page` runs it again. Small by construction (one row per product snapshot); shape inconsistency with the paging interface, not a scale problem.

### INFO-02 — `readMarginReport(seasonId, 0)` non-obvious `limit=0` contract
- **Source:** quality (INFO-2)
- **Where:** `src/lib/reports/datasets.ts:180`, `src/lib/reports/margin-report.ts:113`
- **Claim:** `limit=0` slices returned `rows` to empty but leaves `summary` computed from the full unsliced set — the year-metrics export depends on this. Works correctly; the contract is implicit.

### INFO-03 — `claimPhone` writes the normalized form into the display `phone` column
- **Source:** quality (INFO-3)
- **Where:** `src/lib/imports/prior-year-orders.ts:294`
- **Claim:** Parameter named `normalizedPhone`; legacy path pre-normalizes via `legacy-rows.ts:115`, so the display column receives the E.164 form rather than the donor's original formatting. Minor display issue on imported prior-year donors; not a correctness bug.

## Dedupe notes

- **MIN-09** merges two source findings (rules Rules-1 and clean-code m-2) — both flag `const result = ...` at `src/app/(storefront)/newsletter-actions.ts:22,45,59`. Same location, same claim → single minor.
- No other cross-source duplicates found. Security findings are disjoint from quality/rules/clean-code locations. Quality MAJOR-1 / MIN-01 / MIN-02 / MIN-03 form a related chain (merged-customer shell reachability) but are distinct locations with distinct claims — kept separate.
- No new findings introduced during aggregation.
