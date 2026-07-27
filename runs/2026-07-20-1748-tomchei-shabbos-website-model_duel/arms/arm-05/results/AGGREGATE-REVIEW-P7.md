# P7 Aggregate Review — arm-05 (blind)

**Phase:** P7 — Package engine live
**Inputs:** `P7-security-arm-05.md`, `P7-quality-arm-05.md`, `P7-rules-arm-05.md`, `P7-clean-code-arm-05.md`
**Method:** Union + dedupe by location+claim. Security findings always survive. No new findings.
**Severity mapping:** Critical/High-security → blocker; High/Medium → major; Low → minor; Info/Nit → nit.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 24 |
| Minor | 15 |
| Nit | 1 |
| **Total** | **40** |

Raw input totals: security 7, quality 14, rules 7, clean-code 20 = 48 findings → 40 after dedupe (8 duplicates merged across 6 clusters).

Source tags: **[S]** security, **[Q]** quality, **[R]** rules, **[C]** clean-code.

---

## Prioritized fix list (single pass)

### Major — security & authz (fix first)

1. **IDOR: print artifact retrieval is unscoped** [S] — `app/api/admin/print/route.ts:12-30`; `lib/print-batches.ts:64-79`
   - Any staff with `orders.read` can fetch any `PrintArtifact` PDF by enumerating CUIDs. No batch/filing-group/season/tenant scoping. Add scope predicate to `printArtifactDocument`.

2. **IDOR: order packing slip retrieval is unscoped** [S] — `app/api/admin/print/route.ts:12-30`; `lib/print-batches.ts:81-93`
   - Any staff with `orders.read` can generate a packing slip for any order ID (including DRAFTs). `orderPackingSlipDocument` does an unqualified `findUniqueOrThrow({ where: { id: orderId } })`. Add order-state/scope filter.

3. **IDOR: package write actions accept arbitrary package/order IDs** [S] — `app/api/admin/packages/route.ts:26-56`; `lib/package-operations.ts` `materializeFinalizedOrder`, `advancePackageStatus`, `splitPackage`, `regroupPackages`
   - Every package write is keyed by an unscoped ID. `materialize` accepts any `orderId`; `advance`/`split` accept any `packageId`; `regroup` accepts any `packageIds` (only same-order constraint enforced). Staff with `orders.write` can mutate packages on any finalized order. Add order/staff-scope predicates to each lookup.

4. **Missing optimistic-version guards and increments on `split` and `regroup`** [S][Q] — `lib/package-operations.ts:180-217` (split), `lib/package-operations.ts:219-252` (regroup)
   - Merged from security F5 + quality M5 + quality M6. `splitPackage` reads the source and mutates without a version check, and does not increment the source package's `version` after moving lines — a stale client can still `advancePackageStatus(source.id, oldVersion, ...)` post-split. `regroupPackages` does not version-check the source set and never increments the target package's `version` despite line mutations. Contrast `advancePackageStatus:159-163` which correctly uses `where: { id, version, status, isActive }` and asserts `updated.count === 1`. Add version guards on reads and `version: { increment: 1 }` on both source and target of split/regroup.

### Major — print batch correctness & layout

5. **Nightly print batch includes already-shipped packages** [Q] — `lib/print-batches.ts:18-28`; `scripts/smoke-p7.ts:78-104`
   - EXPECTED #4/#6 require a nightly batch for packages needing printing, with "printing never auto-advances shipped state". `createNightlyPrintBatch` queries `where: { isActive: true }` with no `status` filter, so SENT and PICKED_UP packages get fresh slips/labels/greeting cards reissued every night. Add a `status: { in: [NEW, PRINTED, PACKED] }` filter.

6. **PDF content identical for slips, labels, and greeting cards** [Q] — `lib/print-batches.ts:64-93`; `lib/print-batches.ts:99-127`
   - EXPECTED #4/#5 require "separate PDF per filing group (slips, labels)" and "greeting-card PDFs per filing group on card stock". All three `PrintArtifactKind` values render the same two-line-per-package text listing with the same font and single-page layout. A shipping label needs an address block + barcode area; a greeting card needs the greeting as primary content; a packing slip needs order line items. Add per-kind layouts.

7. **`advancePackageStatus` is not transactional with its audit** [Q][R] — `lib/package-operations.ts:153-167`; `app/api/admin/packages/route.ts:40-47`
   - Merged from quality H3 + rules MEDIUM-4. The `package.updateMany` and `packageAudit.create` run as independent Prisma calls with no `$transaction`. If the audit insert throws, the status bump persists with no audit trail. `updatePackageStatuses` (lines 169-178) drives these via `Promise.all`, so N packages are advanced and audited concurrently with no shared transaction. Sibling helpers `splitPackage` and `regroupPackages` both wrap state+audit in `$transaction`; `createNightlyPrintBatch` does the same. Wrap `advancePackageStatus` in `prisma.$transaction`.

### Major — board UI / plan parity

8. **Package board capped at 250 rows, no pagination** [Q] — `lib/package-operations.ts:121-131`; `app/admin/packages/page.tsx:34-46`
   - EXPECTED #3 requires a "fulfillment channel dashboard". Plan G-024 targets 5,000+ packages at crunch. `packageDashboard` calls `prisma.package.findMany({ where: { isActive: true }, ..., take: 250 })` with no `skip`, cursor, or pagination control in the UI. Channel summaries (`channels`, `productionUnits`, `savedPackageMoves`) are computed from the 250-row window, so KPIs undercount at scale. Add cursor pagination and a "showing N of M" indicator.

9. **`regroupPackages` allows merging across different recipients/methods/greetings** [Q] — `lib/package-operations.ts:219-252`
   - UR-001 defines a package by a recipient/address/method/greeting grouping key. `regroupPackages` validates only `isActive`, `status: "NEW"`, and same `orderId`. It does not compare `groupingKey`, `fulfillmentMethodId`, `addressId`, `recipientName`, or `greeting` across the selected packages. A manager can merge a SHIP package with a LOCAL_DELIVERY package from the same order, producing one package whose lines were meant for two different fulfillment channels. Add a grouping-key equality check.

10. **`PICKED_UP` status not reachable from the package board UI** [Q] — `app/admin/packages/page.tsx:117-120`; `lib/package-operations.ts:10-16`
    - EXPECTED #2 requires "per-package status advance (optional stages)". `PackageStatus` includes `PICKED_UP` and `allowedTransitions` permits NEW/PRINTED/PACKED → PICKED_UP. The board exposes only Print, Pack, and Send buttons. The API accepts `PICKED_UP`, but the UI never offers it. Pickup packages cannot be marked picked-up from the board. Add a Pick-up button.

11. **Bulk status action offers only PRINTED** [Q] — `app/admin/packages/page.tsx:109`
    - EXPECTED #3 requires "bulk status actions" (plural). The board exposes a single bulk button that hardcodes `status: "PRINTED"`. The backend `updatePackageStatuses` accepts any `PackageStatus`, but the UI never sends anything but PRINTED. Add bulk Pack, bulk Send, and bulk Pick-up controls.

12. **`savedPackageMoves` is a fabricated metric labeled as a real one** [C] — `lib/package-operations.ts:144-150`; `app/admin/packages/page.tsx:88`
    - `savedPackageMoves: Math.max(0, productionUnits - packages.length)` is presented to staff as "Package moves saved by grouping". It is not a measured count — it is `items − packages`, which overcounts savings whenever a recipient orders >1 of the same item (no extra "move" was ever going to happen). The phase EXPECTED asks for "production/savings summaries"; this number misrepresents the savings. Compute a real grouping-without-grouping baseline or relabel.

### Major — smoke / anti-hallucination

13. **Smoke S3 asserts the wrong package for "printed still unshipped"** [Q][R] — `scripts/smoke-p7.ts:87-103`; `.scratch/PHASE-P7-SMOKE.md:11`
    - Merged from quality M7 + rules MEDIUM-2. `firstPackage` is the source of the split (line 71) and is never printed or advanced — it stays NEW. Only `split` (the target) is advanced PRINTED → PACKED → SENT (lines 87-91). The S3 closing assertion (line 103) checks `firstPackage.status !== "SENT"`, which is trivially true for a NEW package and does not exercise the "printing does not auto-advance shipped state" guarantee. No package is both printed AND asserted to remain unshipped through the batch run. Advance a package to PRINTED before the nightly batch and assert it stays non-SENT after the batch.

14. **Smoke S3 overclaims "reprints wrote scoped audits"** [R] — `scripts/smoke-p7.ts:98-102`; `.scratch/PHASE-P7-SMOKE.md:11`
    - The smoke calls `reprintArtifact(artifact.id, staff.id)` and `reprintOrderPackingSlip(order.id, staff.id)` but never asserts any `auditEvent` count. The only post-reprint assertion is `prisma.printArtifact.count(...)` which checks that no NEW artifacts were created — it says nothing about audit events. `reprintArtifact`/`reprintOrderPackingSlip` write `auditEvent` rows (`lib/print-batches.ts:47-49, 56-58`), but the smoke never reads `auditEvent.count` to confirm. Anti-hallucination: claims must match tool output. Add an `auditEvent.count` assertion.

15. **P7 expectation checklist never walked** [R] — `.scratch/phase-plan.md:1-9`; `.scratch/PHASE-P7-STATUS.md:3`
    - The P7 block in `phase-plan.md` has five expectation items, all still unchecked `[ ]`, while `PHASE-P7-STATUS.md` line 3 declares "Status: complete". `workflow.mdc` Expectation Files: "An item without evidence is unchecked; an unchecked item means the todo is not done." Same pattern flagged in P6 HIGH-2. Walk the checklist item-by-item with evidence.

### Major — duplication / clean-code

16. **Duplicated package item-count reducer across 3 files (5 sites)** [C] — `lib/package-operations.ts:134,188`; `lib/print-batches.ts:76,90`; `app/admin/packages/page.tsx:115`
    - `packageRecord.lines.reduce((sum, line) => sum + line.quantity, 0)` is copy-pasted 5 times across 3 P7 files. Rule of 2 is met (5 call sites). Extract a single helper in `lib/packages.ts` (which already exists and only holds grouping helpers).

17. **Duplicated "order number or draft reference" label across 3 files** [C] — `lib/print-batches.ts:76,87`; `app/admin/packages/page.tsx:115`
    - `orderNumber ?? draftReference` is repeated as the human label for an order. With 3 call sites it meets Rule of 2. Extract a single `formatOrderLabel(order)` helper.

18. **`printArtifactDocument` and `orderPackingSlipDocument` duplicate per-package line formatting** [C] — `lib/print-batches.ts:74-78` and `lib/print-batches.ts:88-92`
    - Both builders emit the same two-line shape per package (`recipientName · fulfillmentMethod.name`, then `itemCount item(s) · greeting`). The only divergence is whether the order line is prefixed. Extract a shared `formatPackageLines(packageRecord, { includeOrder })` helper.

19. **Single-use module-level helpers in `print-batches.ts` (Rule of 2)** [C] — `lib/print-batches.ts:4` (`batchKeyFor`), `lib/print-batches.ts:8` (`packageIds`), `lib/print-batches.ts:95` (`pdfText`)
    - Each helper has exactly one call site. `clean-code.mdc` Rule of 2 requires 2+ real call sites now. Either inline or keep them local to the calling function.

20. **`fulfillmentName` is a single-call-site module-level helper** [C] — `lib/package-operations.ts:32-34`, called only at `lib/package-operations.ts:70-71`
    - Rule of 2 violation — one call site. Either inline into `materializeFinalizedOrder` or move to `lib/packages.ts` if intended as the canonical fulfillment display helper.

21. **`packages/page.tsx` initial-mount effect duplicates `load()`** [R][C] — `app/admin/packages/page.tsx:25-32` (`load`) and `app/admin/packages/page.tsx:34-46` (`useEffect`)
    - Merged from rules MEDIUM-3 + clean-code M4. The mount effect re-implements the same fetch + `setPackages`/`setChannels`/`setSummary` sequence as `load()`, only adding an `AbortController`. Two fetch paths for the same data in the same file. The effect should reuse `load()` with an abort wrapper.

22. **`runPackageAction` and `runPrintAction` are near-identical POST wrappers** [C] — `app/admin/packages/page.tsx:48-60` and `app/admin/packages/page.tsx:62-72`
    - Both functions do `fetch(url, { method: POST, body: JSON.stringify(action) })`, parse JSON, set `message`, and on success refresh state. Same headers, same error path, same `setMessage` call; only the URL and the success side-effect differ. Extract one `postJson(url, action, { onSuccess })` helper.

23. **Inconsistent enum display formatting** [C] — `lib/package-operations.ts:32-34` (`fulfillmentName` title-cases: `LOCAL_DELIVERY → Local Delivery`), `lib/print-batches.ts:71` (`artifact.kind.replaceAll("_", " ")` yields `PACKING SLIP` uppercase), `app/admin/packages/page.tsx:96` (`artifact.filingGroup.replaceAll("_", " ")`)
    - One pattern per concern violated — two ways to render an enum-with-underscores for UI/print. The fulfillment method is title-cased; the artifact kind and filing group are left uppercase. Pick one helper and reuse it.

24. **`packageDashboard` computes `productionUnits` twice** [C][R] — `lib/package-operations.ts:134` (per-channel accumulation) and `lib/package-operations.ts:144` (whole-board reduce)
    - Merged from clean-code M8 + rules LOW-2. The board total is computed once inside the channel loop and again as a separate full reduce over the same packages. The total can be derived as `sum of channel.productionUnits`. Remove the trailing `packages.reduce(...)`.

### Minor

25. **Reprint audit can be forged for arbitrary artifacts/orders** [S] — `app/api/admin/print/route.ts:32-49`; `lib/print-batches.ts:45-51, 53-60`
    - `reprint_artifact` and `reprint_order` actions write `print.artifact_reprinted` / `print.order_packing_slip_reprinted` audit events for any artifact/order ID the actor supplies, with no scope check. Combined with #1/#2, a staff user can both view and plant misleading reprint audit rows for artifacts/orders outside their normal scope. The audit trail cannot prove the actor was entitled to reprint the subject.

26. **PDF content-stream escaping is minimal** [S] — `lib/print-batches.ts:95-97` (`pdfText`) and `lib/print-batches.ts:99-127` (`createPdf`)
    - `pdfText` escapes only `\\`, `(`, and `)`. Recipient names, greetings, and `draftReference` values are customer/staff-controlled free text written verbatim into the PDF content stream after that minimal escape. Newlines, tabs, carriage returns, or other control bytes pass through unfiltered, which can break PDF rendering or truncate the printed label/slip silently. No code execution risk (PDF text strings, not JavaScript), but integrity of the printed artifact is not guaranteed. Filter `\n`, `\r`, `\t`, and non-printable bytes.

27. **No nightly cron endpoint wires `createNightlyPrintBatch`** [Q] — `app/api/cron/` (no directory); `lib/print-batches.ts:12`
    - Plan P7 deliverable says "Nightly print batch (UR-005)". The batch is only reachable via a manual POST to `/api/admin/print` from the admin UI; there is no cron route and no `vercel.json` cron registration. Plan P11 owns "all 5 Vercel crons registered", so this may be deferred — but the P7 deliverable's "nightly" wording implies an automated trigger that does not exist yet.

28. **`splitPackage` only allows status NEW** [Q] — `lib/package-operations.ts:186`
    - EXPECTED #2 says "split a package" with no status constraint. The code rejects any package not in NEW status, so a manager cannot split a PRINTED or PACKED package (e.g., to pull one damaged item out). The UI additionally only shows the Split button when `status === "NEW"`. Loosen the constraint or document it.

29. **`createPdf` truncates at 55 lines per page with no pagination** [Q] — `lib/print-batches.ts:106`
    - Plan G-024 targets 5,000+ packages. A nightly batch PDF for a filing group with more than ~27 packages (2 lines each) silently drops the rest. No multi-page `Pages` tree growth, no `Break` operator, no chunking by filing group size. A 5,000-package filing group produces a 55-line PDF that omits ~4,973 packages. Add multi-page support.

30. **`fulfillmentMethod.upsert` called once per wire line in materialize** [Q] — `lib/package-operations.ts:68-72`
    - Performance — materializing a 100-line order upserts the same fulfillment method up to 100 times. Methods repeat across lines; the upsert is idempotent but redundant. A `Map<string, FulfillmentMethod>` cache inside the transaction would avoid the round-trips.

31. **Magic values: dashboard cap, bulk caps, and PDF line cap unnamed** [R][C] — `lib/package-operations.ts:130`; `app/api/admin/packages/route.ts:12,17`; `lib/print-batches.ts:106`
    - Merged from rules LOW-1 + clean-code L4 + clean-code L5. `250` (dashboard package cap), `100`/`25` (bulk/regroup caps), and `55` (PDF lines per page) appear once each with no named constant. Extract `PACKAGE_DASHBOARD_LIMIT`, `BULK_STATUS_MAX`, `REGROUP_MAX`, and `PDF_LINES_PER_PAGE`.

32. **`bulk_status` uses `versions: Record<string, number>` while `advance` uses `version: number`** [C] — `app/api/admin/packages/route.ts:9` and `app/api/admin/packages/route.ts:13`
    - Two representations of the same concept (package version) in one discriminated schema. A single shape (e.g. always `versions: Record<id, number>`) would remove the per-action divergence and simplify the bulk path's "version for every package" guard at line 42.

33. **`reprintArtifact` vs `reprintOrderPackingSlip` not-found handling diverges** [C] — `lib/print-batches.ts:46` (`findUniqueOrThrow` → Prisma message) and `lib/print-batches.ts:54-55` (manual `findUnique` + custom `throw new Error("Order was not found.")`)
    - One error-handling approach per concern violated. Two not-found patterns for the same kind of lookup in the same module. Pick one.

34. **`orderId!` non-null assertion** [C] — `app/api/admin/print/route.ts:20`
    - `await orderPackingSlipDocument(orderId!)` uses a `!` assertion because the guard on line 18 (`if (!artifactId && !orderId)`) does not narrow `orderId` to non-null in the else branch. Restructuring (e.g. early-return per branch) removes the assertion.

35. **`target="_blank"` PDF links without `rel="noopener noreferrer"`** [C] — `app/admin/packages/page.tsx:98` and `app/admin/packages/page.tsx:116`
    - New-tab links to PDF endpoints omit the reverse-tabnabbing guard. Minor but consistent with the project's security-basics stance in `workflow.mdc`. Add `rel="noopener noreferrer"`.

36. **Audit granularity drift between batch creation and reprint** [C] — `lib/print-batches.ts:38-40` (one `auditEvent` for the whole nightly batch) vs `lib/print-batches.ts:47-49, 56-58` (one `auditEvent` per reprint)
    - Batch creation records one summary audit row; reprints record per-target rows. The same print concern is audited at two different granularities. Not necessarily wrong, but the divergence is unexplained. Document the choice.

37. **Two audit tables for related package/print operations** [C] — `lib/package-operations.ts:105-112` (`PackageAudit`) and `lib/print-batches.ts:38` (`AuditEvent`)
    - Package materialization and status changes write `PackageAudit`; print batch creation and reprints write `AuditEvent`. The split may be intentional (package-scoped vs staff-action-scoped) but is not documented, so future contributors will guess which table a new print/package action should target. Document the boundary.

38. **`assert.equal(x >= 4, true)` instead of `assert.ok(x >= 4)`** [C] — `scripts/smoke-p7.ts:75`
    - Awkward assertion idiom — comparing a boolean to `true` instead of using `assert.ok`. Minor readability nit in the smoke test.

39. **`readCheckout` is a single-call-site module-level helper** [C] — `lib/package-operations.ts:18-30`, called only at `lib/package-operations.ts:52`
    - Rule of 2 borderline — one call site. The extraction improves readability of `materializeFinalizedOrder`, but strictly it should be local to that function or moved to a shared wire-format module if other phases need it.

### Nit

40. **`packageDashboard` returns unscoped global package list** [S] — `lib/package-operations.ts:121-151`
    - The dashboard returns the 250 most-recently-updated active packages across every customer, season, and fulfillment channel with no staff-scope filter. This is consistent with the rest of the admin app (single-tenant, all staff see all orders), so the P7 board does not narrow data exposure beyond what `orders.read` already grants. Informational only — no action required unless multi-tenant scoping is introduced.

---

## Notes

- No blockers: security reviewer rated all P7 security findings Medium or below; promoted to major per the mapping rule. The three IDOR majors (#1, #2, #3) survive dedupe and should be addressed before any phase gate.
- 8 duplicates merged across 6 clusters: (a) version guards/increments on split & regroup — security F5 + quality M5 + quality M6; (b) `advancePackageStatus` non-transactional — quality H3 + rules MEDIUM-4; (c) smoke S3 wrong-package assertion — quality M7 + rules MEDIUM-2; (d) `load()` duplicated in `useEffect` — rules MEDIUM-3 + clean-code M4; (e) `productionUnits` computed twice — clean-code M8 + rules LOW-2; (f) magic values — rules LOW-1 + clean-code L4 + clean-code L5.
- No new findings introduced during aggregation.
