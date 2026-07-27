# P6 Aggregate Review — arm-05 (blind)

**Phase:** P6 — Admin operations hub & POS
**Inputs:** `P6-security-arm-05.md`, `P6-quality-arm-05.md`, `P6-rules-arm-05.md`, `P6-clean-code-arm-05.md`
**Method:** Union + dedupe by location+claim. Security findings always survive. No new findings.
**Severity mapping:** Critical/High-security → blocker; High/Medium → major; Low → minor; Info/Nit → nit.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 16 |
| Minor | 31 |
| Nit | 2 |
| **Total** | **49** |

Raw input totals: security 8, quality 24, rules 8, clean-code 21 = 61 findings → 49 after dedupe (12 duplicates merged).

Source tags: **[S]** security, **[Q]** quality, **[R]** rules, **[C]** clean-code.

---

## Prioritized fix list (single pass)

### Major — security & authz (fix first)

1. **CSV import bypasses catalog/customer permission gating** [S] — `lib/admin-operations.ts:54-106`; `app/api/admin/imports/route.ts:11-25`
   - `commitImport` writes products/customers under only `imports.manage`; defeats `settings.manage` / `customers.write` boundary. Add per-write permission checks or split stage/commit permissions.

2. **POS walk-in upsert renames any existing customer** [S] — `lib/admin-operations.ts:155-159`
   - Staff with `orders.write` can overwrite an existing customer's first/last name via walk-in form; rename is not audited as a customer write and is not bound to `customers.write`. Gate rename behind `customers.write` or skip update when the email already exists.

3. **Offline-payment route finalizes any DRAFT order, no POS-origin check** [S] — `app/api/admin/orders/[orderId]/offline-payment/route.ts:12-25`; `lib/checkout.ts:64-103, 319-340`
   - Any staff with `orders.write` can force-finalize a customer's web draft with cash, breaking the customer's later Stripe checkout. Add a POS-origin/creator check before finalizing.

4. **Refund sets order `paymentStatus: REFUNDED` ignoring other posted payments** [S] — `lib/checkout.ts:353-372`
   - Unconditional `REFUNDED` even when other posted payments remain. Mirror `voidOfflinePayment` (count active payments before deciding order status).

### Major — missing UI / plan parity

5. **Order detail UI missing** [Q] — `app/admin/orders/` (no file); `app/admin/operations/page.tsx:89-93`
   - EXPECTED #2 requires full order detail with money actions + Stripe refund path. Only API exists.

6. **Customer detail + order history UI missing** [Q] — `app/admin/customers/` (no file); `app/admin/operations/page.tsx:94-97`
   - EXPECTED #4 requires customer directory + detail + order history. Only directory list exists.

7. **POS does not reuse cart-first builder** [Q] — `app/admin/pos/page.tsx:19-40`; `lib/admin-operations.ts:145-171`
   - EXPECTED #3 / R-059 require POS to reuse storefront cart-first builder. POS is a flat one-product form bypassing `lib/order-builder.ts`.

8. **Bulk "review" action is a no-op, misnamed** [Q][C] — `app/api/admin/operations/route.ts:46-54`; `app/admin/operations/page.tsx:65-74`
   - Only increments `version`; no review field touched. Either implement a real review step or rename action/audit/UI to `bulk_version_probe`.

9. **Smoke S4 incomplete vs EXPECTED** [Q][R] — `scripts/smoke-p6.ts:52-64`; `.scratch/PHASE-P6-SMOKE.md:12`
   - S4 requires two conflicting bulk actions reporting skipped/conflicts deterministically. Smoke never calls the bulk endpoint. Anti-hallucination violation: marked PASS without evidence.

10. **P6 expectation checklist never walked** [R] — `.scratch/phase-plan.md:32-39`; `.scratch/PHASE-P6-STATUS.md:3`
    - All four P6 expectation items still unchecked `[ ]` while status file declares "complete". Walk the checklist item-by-item with evidence.

### Major — correctness / data integrity

11. **`todayCount` field name is the opposite of what it counts** [Q][C] — `lib/admin-operations.ts:138,142`; `app/admin/operations/page.tsx:83`
    - Counts drafts *older* than 24h (stale), not today's. Rename to `staleDraftCount` / `overdueDraftCount`.

12. **`recentOrders` fetched but never rendered** [Q][C] — `lib/admin-operations.ts:135-143`; `app/admin/operations/page.tsx:20-28`
    - Dead fetch shipped to client on every dashboard call. Either render or delete.

13. **Walk-in POS creates a new Customer per order without email; no find-or-create parity** [Q][C] — `lib/admin-operations.ts:155-159`
    - `walkin-${randomUUID()}@local.test` fallback regenerates per call, so `upsert` always creates. Add phone/name lookup or an anonymous-walk-in singleton.

14. **Settings hub: Email and Developer tabs are dead stubs** [Q] — `app/admin/settings/page.tsx:36-44`
    - EXPECTED #5 requires tabs wired to live config. Both render static text only.

15. **Settings hub: package types, pickup locations, follow-up not wired** [Q] — `app/admin/settings/page.tsx:38`
    - Orders tab only wires `storeStatus`. R-094..R-096 deliverables missing.

16. **Imports: products commit hardcodes `kind: "PACKAGE"` and skips duplicate SKU detection** [Q] — `lib/admin-operations.ts:54-65, 93-101`
    - Stage-time duplicate detection only runs for customers; product commit ignores any kind field and has no SKU check before `product.create`.

### Minor

17. **Imports: no preview UI for errors** [Q] — `app/admin/operations/page.tsx:50-56, 98-102`
    - Only counts invalid rows; `errors[i]` strings never rendered. EXPECTED S3 requires preview errors.

18. **Imports: staged batches not listable or recoverable** [Q] — `app/api/admin/imports/route.ts` (POST only); `app/admin/operations/page.tsx:17,55`
    - No GET endpoint; `batchId` held in React state. Navigating away orphans the staged batch.

19. **Smoke S3 does not test products import path** [Q] — `scripts/smoke-p6.ts:42-50`
    - Only customers branch exercised. Products branch never touched by smoke.

20. **Bulk API does not require a version per orderId; missing entries silently bypass conflict detection** [Q][S] — `app/api/admin/operations/route.ts:7-10, 46-53`
    - `versions[orderId] === undefined` → Prisma treats `version: undefined` as "no filter" → always "processed". Add schema check that every `orderIds[i]` has a matching key.

21. **Smoke S1 claim overstates coverage** [R] — `scripts/smoke-p6.ts:26-35`; `.scratch/PHASE-P6-SMOKE.md:9`
    - S1 lists six traversable surfaces; smoke exercises dashboard KPIs + list + 403 only. No detail/refund/audit reads. Anti-hallucination violation.

22. **`normalizeEmail` duplicated between `lib/admin-operations.ts` and `lib/foundation.ts`** [R][C] — `lib/admin-operations.ts:23-25` vs `lib/foundation.ts:16-18`
    - Foundation version imported by 3 other call sites. Extend foundation helper to accept `string | undefined` and delete the fork.

23. **Refund endpoint uses ad-hoc validation vs zod** [R] — `app/api/admin/orders/[orderId]/route.ts:23-24`
    - Sibling P6 routes use zod schemas. Use a `z.object({ paymentId: z.string() })` schema at the boundary.

24. **`lib/admin-operations.ts` is a god file mixing six P6 concerns** [C] — `lib/admin-operations.ts:1-172`
    - Imports, lists, dashboard, POS orchestration in one module. Split into `lib/admin/{imports,lists,dashboard,pos}.ts`.

25. **`createWalkInPosOrder` reuses the Stripe checkout flow then rewrites payment to offline with no comment** [C] — `lib/admin-operations.ts:163-170` → `lib/checkout.ts:319-340`
    - Three-step dance (fabricate Stripe session → finalize → rewrite to CASH/CHECK) is non-obvious. Add a comment explaining the borrowed-validation intent.

26. **`OperationsPage` has two duplicated fetch-all-three paths (`load` and `useEffect`)** [C] — `app/admin/operations/page.tsx:19-29, 31-48`
    - Extract a single `loadAll(signal?)` helper.

27. **Bulk POST has no transaction boundary** [R][C] — `app/api/admin/operations/route.ts:46-54`
    - `Promise.all(updateMany)` + separate `auditEvent.create`. Wrap in `prisma.$transaction(async (tx) => …)` for atomicity + audit durability.

28. **POS POST does not validate `input` at the boundary** [C] — `app/api/admin/operations/route.ts:7-10, 43-44`
    - `input: z.unknown()` forwards to lib which re-parses. Embed `createWalkInPosOrder`'s schema in `postSchema`.

29. **GET `view=products` is permission-scope drift** [R][C] — `app/api/admin/operations/route.ts:12-13, 26-32`
    - `orders.read` gates the full product catalog read. Use a catalog permission and move the query into `lib/admin-operations.ts`.

30. **`listOrders` and `listCustomers` have inconsistent signatures** [C] — `lib/admin-operations.ts:108, 121`
    - One takes options object, the other positional args. Align on one options-object shape.

31. **`importRowSchema` is one shared schema for customer and product rows (type drift)** [C] — `lib/admin-operations.ts:6-14`
    - Single schema with all 7 fields optional. Use a discriminated union on `kind`.

32. **`commitImport` product path uses `!` non-null assertions** [C] — `lib/admin-operations.ts:98`
    - Three `!` on one line compensate for the loose schema. Tightening per #31 removes them.

33. **Admin back link is hardcoded** [Q][C] — `app/admin/layout.tsx:19`
    - Always navigates to `/admin` regardless of referrer. Use `router.back()` with fallback or document the exception.

34. **Order list: no pagination controls in UI** [Q] — `app/admin/operations/page.tsx:89-93`; `lib/admin-operations.ts:108-119`
    - Server paginates (`take: 25`) but UI ignores `total`/`page`/`pageSize`. Add next/prev + indicator.

35. **Order list: no status filter control in UI** [Q] — `app/admin/operations/page.tsx:87-88`; `app/api/admin/operations/route.ts:17-21`
    - API accepts `status`; UI has no status filter control. Status filtering unreachable from UI.

36. **Customer list: no pagination controls in UI** [Q] — `app/admin/operations/page.tsx:94-97`; `lib/admin-operations.ts:121-133`
    - Same as #34 for customers.

37. **Operations search has no Enter-key submit** [Q] — `app/admin/operations/page.tsx:87-88`
    - Input is a standalone `<label><input>` with no `<form>`. Wrap in a form or add `onKeyDown`.

38. **`bulkReview` silently truncates to 100 finalized orders** [Q] — `app/admin/operations/page.tsx:65-74`
    - `.slice(0, 100)` with no notice. Surface the cap to the user.

39. **Audit page renders nested details as `[object Object]`** [Q] — `app/admin/audit/page.tsx:22`
    - `String(value)` on arrays/objects. Use `JSON.stringify` for non-primitives.

40. **`parseCsv` is naive (no quoting/escaping)** [S][Q] — `lib/admin-operations.ts:27-52`
    - `line.split(",")` breaks on quoted commas. Add RFC 4180 handling or a CSV dependency.

41. **Staged import batch has no ownership tracking** [S] — `lib/admin-operations.ts:54-106`
    - Any `imports.manage` user can commit any batch. Verify committer is the stager (or a manager).

42. **`createWalkInPosOrder` does not check `product.isActive` before order creation** [Q] — `lib/admin-operations.ts:154-170`
    - Inactive check happens late inside `assertLiveOrder` after side effects. Check `isActive` up front.

43. **No server-side middleware gates `/admin/*` pages** [S] — repo root (no `middleware.ts`); `app/admin/layout.tsx:1-24`
    - Admin shell/nav renders to anyone hitting `/admin/*`. Add `middleware.ts` redirect for unauthenticated users. (P1 concern surfaced via P6 expansion.)

44. **Magic values: page size and time window unnamed** [R][C] — `lib/admin-operations.ts:109, 122, 138`
    - `take = 25` duplicated; `24 * 60 * 60 * 1000` unannotated. Extract `ADMIN_LIST_PAGE_SIZE` and `TWENTY_FOUR_HOURS_MS`.

45. **`.admin-alert` and `.notice` CSS classes are near-identical** [C] — `app/styles.css:27,31`
    - Two classes for the same callout pattern. Consolidate into one `.callout` class.

46. **POS page uses a different data-fetching pattern from the operations page** [C] — `app/admin/pos/page.tsx:13-17` vs `app/admin/operations/page.tsx:20-24`
    - One shared `fetchJson` helper (or SWR-style hook) for admin pages.

47. **Admin alert banner is a static string, not manager-configurable** [C] — `app/admin/layout.tsx:18`
    - R-106 calls for a configurable alert. Hardcoded string with no `AppSetting` read or settings UI.

### Nit

48. **`OperationsPage` `Order` and `Customer` types defined inline, not shared with the API** [C] — `app/admin/operations/page.tsx:7-8`
    - Hand-maintained parallel types. Export `OrderListItem`/`CustomerListItem` from `lib/admin-operations.ts`.

49. **`smoke-p6.ts` asserts `>= 2` for `payment.offline_posted` audit events** [C] — `scripts/smoke-p6.ts:39`
    - Couples smoke to exact POS payment count. Use per-step `>= 1` assertions.

---

## Notes

- No blockers: security reviewer rated all P6 security findings Medium or below; promoted to major per the mapping rule. All four security majors survive dedupe and should be addressed before any phase gate.
- 12 duplicates merged across the four specialist files; the largest overlap clusters were the bulk-action no-op (Q-H4 + C-4), the smoke S4 claim (Q-H5 + R-H1), and the `normalizeEmail` duplication (R-M2 + C-2).
- No new findings introduced during aggregation.
