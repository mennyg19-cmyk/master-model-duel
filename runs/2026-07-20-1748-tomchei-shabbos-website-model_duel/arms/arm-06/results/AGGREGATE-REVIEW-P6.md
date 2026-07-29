# Aggregate P6 Review — arm-06 (blind)

**Phase:** P6 — Admin operations hub & POS
**Sources (specialist reviews only — no new findings):**
- `results/reviews/P6-security-arm-06.md`
- `results/reviews/P6-quality-arm-06.md`
- `results/reviews/P6-rules-arm-06.md`
- `results/reviews/P6-clean-code-arm-06.md`

**Method:** Union + dedupe by location+claim. Security blockers always survive (none present). No new findings introduced during aggregation. Each item tagged with source specialist(s): `[S]` security, `[Q]` quality, `[R]` rules, `[C]` clean-code.

## Counts summary

| Severity | Raw across specialists | After dedupe |
|---|---|---|
| Blocker | 0 | **0** |
| Major | 5 (S:4 + Q:1) | **5** |
| Minor | 25 (S:5 + Q:3 + R:6 + C:11) | **21** |
| **Total** | 30 | **26** |

Dedupe merges applied (3):
- Imports list cross-permission metadata leak — Security M4 (Major) ∪ Quality m2 (Minor) ∪ Rules m-4 (Minor) → **one Major** tagged `[S,Q,R]` (highest severity survives).
- `["-"]` sentinel in order-detail audit query — Rules m-5 ∪ Clean-code Minor-6 → **one Minor** tagged `[R,C]`.
- Redundant `|| DEFAULT_PAGE_SIZE` in `parseCustomerListParams` — Rules m-6 ∪ Clean-code Minor-4 → **one Minor** tagged `[R,C]`.

No Blockers. No Security blocker override needed.

---

## Blockers

None.

---

## Majors (5)

### M1 — Bulk order action has no season/tenant scoping  `[S]`
**Where:** `lib/orders/bulk.ts` `runBulkOrderAction` → `repeatOrder` / `discardOrder`; `app/api/admin/orders/bulk/route.ts`.
**Claim:** Bulk verbs operate on raw order ids with no season filter. The order list is scoped to the open season, but the bulk endpoint accepts any 100 ids a `payments.manage` holder supplies. State-machine guards bound damage, but a STAFF member can repeat 100 finalized orders from any past season into the current open season, or discard drafts they cannot see in the list. The bulk verb should scope the same way the list does.

### M2 — Bulk action audit does not record per-order outcomes  `[S]`
**Where:** `app/api/admin/orders/bulk/route.ts`.
**Claim:** A single `bulk_action` audit row records only `requested / succeeded / skipped` counts. The per-row report (which order was repeated vs. skipped and why) is returned to the client and discarded. For `discard` (releases stock, terminal state) and `repeat` (creates a new draft), an auditor cannot reconstruct which orders were affected from the audit log alone. A 100-row discard batch leaves one audit line with no target ids — an audit-trail gap for a destructive bulk verb.

### M3 — Refund on keyless host voids the payment without refunding the card  `[S]`
**Where:** `lib/payments/refund.ts` `refundStripePayment`.
**Claim:** When `getStripeConfig().secretKey` is null (documented dev/keyless seam), the Stripe call is skipped and the payment is `voidPaymentTx`'d locally — flipping status to VOIDED and recomputing `paymentStatus` as if the money were returned. The customer's card is still charged. The response reports `stripeCalled: false`, but the data state (VOIDED + paymentStatus recomputed) is indistinguishable from a real refund to every downstream view (order detail, dashboard KPIs, customer history). A staff member relying on the UI could believe the refund completed. The local void should not happen until the Stripe refund succeeds, or the status should be a distinct `REFUND_PENDING` rather than VOIDED.

### M4 — Imports list leaks cross-permission batch metadata  `[S,Q,R]`
**Where:** `app/(admin)/admin/imports/page.tsx` (`where: canCustomers ? {} : { kind: "PRODUCTS" }`); `app/api/admin/imports/route.ts` `GET`.
**Claim:** A STAFF member holding only `customers.manage` (no `catalog.manage`) sees all PRODUCTS import batches in the recent-batches list — filename, row counts, status, committed count, actor email. The preview route correctly gates on `IMPORT_PERMISSION[batch.kind]`, so the rows cannot be opened, but the list itself exposes products-import metadata to a role not permitted to manage products. The page comment promises permission-scoping the code doesn't deliver for the customers-only case. Correct filter: `canCustomers && canCatalog ? {} : canCustomers ? { kind: "CUSTOMERS" } : { kind: "PRODUCTS" }`. Tagged Major by Security (metadata exposure to a non-permitted role); Quality and Rules filed the same location+claim as Minor (detail gate holds, metadata-only). Highest severity survives dedupe.

### M5 — Customers CSV import: in-file phone duplicates bypass the preview verdict  `[Q]`
**Where:** `lib/imports/customers.ts` (`duplicateKey` keys only on email; `markCustomerDuplicates` checks phones only against the DB, not within the batch); `lib/imports/engine.ts` `commitRows`.
**Claim:** Two rows in the same file with different emails but the same phone both pass in-file dedup (different keys) and both pass `markCustomerDuplicates` (no existing DB customer owns that phone yet). The preview reports both as `valid`. On commit, `createMany` with `skipDuplicates: true` inserts the first and silently drops the second on the `normalizedPhone` unique index (R-144). The dropped row is never re-marked `duplicate` in the payload — the committed batch reports `committedRows` less than `validRows` with no per-row explanation. Violates the phase's explicit gate: "preview every row's verdict before commit." The product import does not have this gap (its `duplicateKey` is slug, the only unique column).

---

## Minors (21)

### m1 — Impersonation stop does not re-check `staff.impersonate`  `[S]`
**Where:** `app/api/admin/impersonation/stop/route.ts`.
**Claim:** Uses `getAuthContext()` with no permission gate; only verifies the impersonator is still ACTIVE. Does not re-check that the impersonator still holds `staff.impersonate` (could have been revoked via override while impersonation was active). Returning to your own identity is low-risk, but the permission that authorized the impersonation should still hold at stop time, consistent with the start route's gate.

### m2 — POS checkout `amountCents` is client-controlled with no upper bound  `[S]`
**Where:** `app/api/admin/pos/checkout/route.ts`; `lib/payments/pos.ts`.
**Claim:** Accepts `amountCents: z.number().int().positive().optional()`; falls back to `finalized.totalCents`. A `payments.manage` holder can post an arbitrarily large cash/check/comp payment, driving the order to OVERPAID. No sanity cap or relation-to-total check to catch fat-finger or malicious input.

### m3 — Media upload does not verify product season  `[S]`
**Where:** `app/api/admin/media/route.ts`.
**Claim:** Checks the `productId` exists but not its season status. A `catalog.manage` holder can attach a photo to a product in a closed/CLOSED season. Low impact (manager-tier trust), but inconsistent with the open-season gates enforced everywhere ordering/imports touch a season.

### m4 — dev-auth route has no rate limit  `[S]`
**Where:** `app/api/dev-auth/route.ts`.
**Claim:** Hard-disabled on any Vercel deploy (`isDevAuthBypass` requires `VERCEL_ENV` to be neither production nor preview). In dev it accepts a `staffUserId` and issues a session with no rate limit and no attempt throttling, making local staff-id enumeration cheap. Local-dev hygiene only; not production-relevant.

### m5 — Audit log page renders raw metadata without redaction  `[S]`
**Where:** `app/(admin)/admin/audit/page.tsx`.
**Claim:** Renders `JSON.stringify(entry.metadata)` (truncated to `max-w-xs`). Metadata includes PII: customer emails, phone numbers, addresses, staff emails, impersonation targets. `audit.view` is MANAGER-default (trusted audience), but the page has no pagination (bounded to 200 rows) and no redaction of PII fields — a screenshot or log scrape exposes customer PII.

### m6 — Bulk discard has no transactional audit; a failed audit write leaves discards un-audited  `[Q]`
**Where:** `lib/orders/state-machine.ts` `discardOrder` (records no audit); `app/api/admin/orders/bulk/route.ts` (writes the `bulk_action` summary audit outside any transaction, after `runBulkOrderAction` returns).
**Claim:** `discardOrder` itself writes no `AuditLog` row — the only trail for a discard is the `bulk_action` summary written by the route after the per-row discards have already committed. If that audit write fails (connection drop, constraint error), the discards are durable but leave zero audit trail. The payment verbs deliberately co-locate audit + mutation in one tx (UR-011); discards do not, despite code comments citing that discipline. Distinct from M2 (per-order outcomes not recorded); this is the transactional-completeness gap on the summary write itself.

### m7 — P6 migration timestamp backdated before the already-applied P5 migration  `[Q]`
**Where:** `prisma/migrations/20260729001151_p6_admin_ops` sorts lexically before `prisma/migrations/20260729010000_p5_checkout`.
**Claim:** On a fresh database, Prisma applies P6 (refundRef + import tables) before P5 (checkout). The status doc asserts this is safe (P6 touches no P5-dependent objects) and `migration-guard` + a migrated dev DB verify it. The backdating is nonetheless fragile: the ordering misleads readers and a later P5-dependent migration could silently reorder. Correct today; flagged as fragility/deviation.

### m8 — Hand-rolled `<input>`/`<select>` on admin list pages while sibling components use the kit  `[R]`
**Where:** `app/(admin)/admin/orders/page.tsx:95–155` (1 `<input>` + 3 `<select>`, inline classes, no focus ring) and `app/(admin)/admin/customers/page.tsx:57–63` (1 `<input>`, same inline classes). Compare `OrderListTable` and other P6 client components which use `<Input>`/`<Select>` from `components/ui/`.
**Claim:** `clean-code.mdc` "UI Consistency — one styling approach per project." The kit `Select`/`Input` apply `focus:border-brand-600 focus:ring-1 focus:ring-brand-600`; the hand-rolled versions omit the focus ring, so the filter controls visibly differ from every other input on the admin surface. The kit components are `forwardRef` with no `useState`/`useEffect`, so they render fine from server components — no technical reason to hand-roll. Either adopt the kit on the two filter forms or record a README § Rule Preferences entry narrowing the kit to client components with a reason.

### m9 — README not updated for P6  `[R]`
**Where:** `workspace/README.md:1` (title still "… (arm-06, phase P5)"); `:45` (sections stop at "What P5 ships"); `:77–92` (Patterns table lists no P6 pattern).
**Claim:** `workflow.mdc` "Keep README current" and `clean-code.mdc` "Consistency — one pattern per concern … document in README." P6 introduced four new pattern choices — staged-atomic import engine, bounded bulk runner with deterministic per-row report, dashboard query module, shared list-controls helpers — none registered in the Patterns table. A future session touching imports/bulk/dashboard has no README entry naming the chosen pattern. Add a "What P6 ships" section and four rows to the Patterns table.

### m10 — Dead `GET` handler on `/api/admin/imports`  `[R]`
**Where:** `app/api/admin/imports/route.ts:22–44` (`GET`).
**Claim:** The imports page queries `prisma.importBatch.findMany` directly in the server component; `ImportUpload` only POSTs to the same route. No client or test calls `GET /api/admin/imports`. `clean-code.mdc` "Dead code — delete, don't comment out." The `GET` export duplicates the page's own query and has zero callers. Either delete the `GET` export or wire the page to it (and drop the page's direct Prisma call) so the list query has one home.

### m11 — Defensive `["-"]` fallback in order-detail audit query  `[R,C]`
**Where:** `app/(admin)/admin/orders/[orderId]/page.tsx:43` — `{ targetType: "Payment", targetId: { in: paymentIds.length > 0 ? paymentIds : ["-"] } }`.
**Claim:** `clean-code.mdc` "No 'just in case' code — every line must have a reason." In Prisma, `in: []` already matches no rows, which is the intent when there are no payments. The `["-"]` fallback is a guard for a condition the ORM already handles. Drop the ternary and pass `paymentIds` directly (or build the `OR` array conditionally, omitting the `Payment` branch entirely when `paymentIds` is empty).

### m12 — Redundant `|| DEFAULT_PAGE_SIZE` in `parseCustomerListParams`  `[R,C]`
**Where:** `lib/customers/directory.ts:22` — `pageSize: parsePageSize(searchParams.size) || DEFAULT_PAGE_SIZE`.
**Claim:** `clean-code.mdc` Anti-AI-Tics / dead branch. `parsePageSize` (`lib/admin/order-list.ts:33–36`) already returns `DEFAULT_PAGE_SIZE` as its fallback for any unrecognized value, and never returns `0` or `NaN`. The `|| DEFAULT_PAGE_SIZE` can never fire. Drop the `|| DEFAULT_PAGE_SIZE` — `parsePageSize(searchParams.size)` alone is correct.

### m13 — Duplicated `first()` array-picker (Rule of 2 met)  `[C]`
**Where:** `lib/admin/order-list.ts:19–23` (`first(raw)`); `lib/customers/directory.ts:17–18` (reimplements the same logic inline for `q` and `page`).
**Claim:** `clean-code.mdc` Consistency / duplicated logic. `directory.ts` already imports from `order-list.ts` (`DEFAULT_PAGE_SIZE`, `parsePageSize`) — it should call `first()` rather than fork the pattern.

### m14 — Duplicated pagination nav + `pageHref` builder  `[C]`
**Where:** `app/(admin)/admin/orders/page.tsx:75–84` + `170–186`; `app/(admin)/admin/customers/page.tsx:40–46` + `111–127`.
**Claim:** The Prev/Next `<nav>` block and the `pageHref(target)` URL builder are near-verbatim across the two list pages. `clean-code.mdc` duplicated UI / duplicated logic. A `<PaginationNav page pages href={pageHref} />` component plus a `buildListHref(base, params)` helper would dedupe the markup and the URLSearchParams loop.

### m15 — Magic `25` in orders list page  `[C]`
**Where:** `app/(admin)/admin/orders/page.tsx:80` — `if (params.pageSize !== 25) query.set("size", String(params.pageSize));`.
**Claim:** `DEFAULT_PAGE_SIZE` is exported from the same module the file imports (`lib/admin/order-list.ts:7`). The literal `25` is a magic value that must mirror `DEFAULT_PAGE_SIZE` by hand — drift here silently breaks the "clean URL when default" contract. `clean-code.mdc` Abstraction Discipline: magic values.

### m16 — Duplicate `next/navigation` import statement  `[C]`
**Where:** `app/(admin)/admin/imports/[batchId]/page.tsx:3,5` — two import statements from `next/navigation` (`notFound` and `forbidden`).
**Claim:** Every other P6 file combines them (e.g. `orders/[orderId]/page.tsx:3`). Pattern drift; merge into one line.

### m17 — Silent `?? "CASH"` default in POS checkout  `[C]`
**Where:** `lib/payments/pos.ts:40` — `const method = OFFLINE_METHODS[input.checkout.method as keyof typeof OFFLINE_METHODS] ?? "CASH";`.
**Claim:** The route rejects `"card"` but the cast `as keyof typeof OFFLINE_METHODS` asserts the remaining value is one of `cash | check | comp`. If `checkoutSubmitSchema` ever admits a new method that reaches here, the cast hides it and the `?? "CASH"` silently coerces it to cash — a posted payment with the wrong method on the audit trail. An unknown method should be a 422, not a silent default. `clean-code.mdc` Anti-AI-Tics: no silent "just in case" defaults.

### m18 — Swallowed address-fetch error in POS shell  `[C]`
**Where:** `app/(admin)/admin/pos/pos-shell.tsx:57–62` — `pickCustomer` drops the error on a failed address fetch (`addresses.ok ? ... : []`) and selects the customer anyway.
**Claim:** The user proceeds against an empty book and only discovers the problem at checkout. `clean-code.mdc` Error Handling: "No swallowed errors." Either surface the failure via `setError` or retry; silently substituting `[]` is the empty-catch anti-pattern in conditional form.

### m19 — Duplicated bulk-action busy/error pattern in OrderActions  `[C]`
**Where:** `app/(admin)/admin/orders/[orderId]/order-actions.tsx` — `run(label, fn)` for post/void/refund/discard, but `repeatOrder` (lines 91–107) reimplements the same busy/error/refresh dance to extract `draftRef` from the report.
**Claim:** `clean-code.mdc` duplicated logic with minor variations. The `run` helper could accept an optional `onOk(body)` hook, collapsing `repeatOrder` back onto the shared path.

### m20 — `countByVerdict` recomputed redundantly in import engine  `[C]`
**Where:** `lib/imports/engine.ts` — `countByVerdict(rows)` called twice in `stageImport` (lines 116 and 125 — once in `importBatch.create` data, once in the audit `metadata`) and twice in `commitImport` (lines 158 and 167) on the same `payload.rows`.
**Claim:** Each call re-filters the full row list three times. Compute once into a `const counts = countByVerdict(rows)` and reuse. `clean-code.mdc` Anti-AI-Tics: same value computed repeatedly.

### m21 — Duplicated `—` missing-value sentinel (one side dead)  `[C]`
**Where:** `app/(admin)/admin/imports/[batchId]/page.tsx:57–59` (maps `null` → `"—"` when flattening `row.data` to strings for the preview component); `app/(admin)/admin/imports/[batchId]/import-preview.tsx:99` (renders `{row.data[column] ?? "—"}`).
**Claim:** Since the page already converted nulls to `"—"`, the preview's `?? "—"` is dead (the value is never null/undefined). Two sentinels for the same concept, one of which can't fire. Pick one owner of the `—`-for-missing convention (the preview component) and pass the raw typed data through, or drop the `?? "—"` in the preview. `clean-code.mdc` Consistency / dead code.

---

## Source specialist tallies (raw, pre-dedupe)

| Specialist | Blocker | Major | Minor | Total |
|---|---|---|---|---|
| Security | 0 | 4 | 5 | 9 |
| Quality | 0 | 1 | 3 | 4 |
| Rules | 0 | 0 | 6 | 6 |
| Clean-code | 0 | 0 | 11 | 11 |
| **Raw total** | **0** | **5** | **25** | **30** |

After dedupe: **0 Blockers, 5 Majors, 21 Minors (26 total)** — 3 cross-specialist duplicates merged (1 Major promoted from Minor-severity dupes; 2 Minors merged across Rules + Clean-code).
