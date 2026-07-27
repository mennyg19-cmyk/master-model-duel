# P7 Security Review — arm-05 (blind)

**Phase:** P7 — Package engine live
**Scope:** package board authz, print batch trust, IDOR on packages/orders, PDF generation
**Reviewer:** Security specialist
**Method:** Findings only — no fixes. P7 scope only.

## Findings

### F1 — IDOR: print artifact retrieval is unscoped
- **Severity:** Medium
- **Location:** `app/api/admin/print/route.ts` GET (lines 12–30); `lib/print-batches.ts` `printArtifactDocument` (lines 64–79)
- **Claim:** Any staff member with `orders.read` can fetch the PDF for any `PrintArtifact` by guessing/enumerating its CUID. There is no batch, filing-group, season, or tenant scoping — `printArtifactDocument(artifactId)` calls `findUniqueOrThrow({ where: { id: artifactId } })` and renders recipient names, greetings, fulfillment channels, and order numbers for whatever artifact was requested.
- **Evidence:** GET handler authorizes only `orders.read`; then `printArtifactDocument(artifactId)` performs an unqualified lookup by ID. STAFF role grants `orders.read` (`lib/permissions.ts` line 19), so any staff user can pull any artifact's PDF. The PDF body leaks `packageRecord.recipientName`, `packageRecord.greeting`, `packageRecord.order.orderNumber`, and fulfillment channel (`lib/print-batches.ts` lines 74–77).

### F2 — IDOR: order packing slip retrieval is unscoped
- **Severity:** Medium
- **Location:** `app/api/admin/print/route.ts` GET (lines 12–30); `lib/print-batches.ts` `orderPackingSlipDocument` (lines 81–93)
- **Claim:** Any staff member with `orders.read` can generate a packing slip PDF for any order ID — including DRAFT orders — by passing `orderId=`. No order-state, season, or staff-scope check is performed.
- **Evidence:** `orderPackingSlipDocument(orderId)` calls `findUniqueOrThrow({ where: { id: orderId } })` with no `status` filter. The route accepts `orderId` from the query string and routes straight to the document builder. A staff user can enumerate order CUIDs and harvest packing-slip content (recipient names, greetings, item counts) for orders they would not normally open.

### F3 — IDOR: package write actions accept arbitrary package/order IDs
- **Severity:** Medium
- **Location:** `app/api/admin/packages/route.ts` POST (lines 26–56); `lib/package-operations.ts` `materializeOrderPackages`, `advancePackageStatus`, `splitPackage`, `regroupPackages`
- **Claim:** Every package write action is keyed by an unscoped ID. `materialize` accepts any `orderId`; `advance`/`split` accept any `packageId`; `regroup` accepts any `packageIds` (only same-order constraint is enforced). A staff user with `orders.write` can mutate packages belonging to any finalized order in the system, not just orders they would normally operate on.
- **Evidence:** `materializeFinalizedOrder` checks `order.status === "FINALIZED"` but not order-scope (`lib/package-operations.ts` lines 47–51). `advancePackageStatus` does `findUniqueOrThrow({ where: { id: packageId } })` with no scoping (line 154). `splitPackage` and `regroupPackages` similarly fetch by ID only (lines 182, 221). The route's only authz gate is the global `orders.write` permission (line 27).

### F4 — IDOR: reprint audit can be forged for arbitrary artifacts/orders
- **Severity:** Low
- **Location:** `app/api/admin/print/route.ts` POST (lines 32–49); `lib/print-batches.ts` `reprintArtifact` (lines 45–51), `reprintOrderPackingSlip` (lines 53–60)
- **Claim:** The `reprint_artifact` and `reprint_order` actions write `print.artifact_reprinted` / `print.order_packing_slip_reprinted` audit events for any artifact/order ID the actor supplies. Combined with F1/F2, a staff user can both view and plant misleading reprint audit rows for artifacts/orders outside their normal scope.
- **Evidence:** `reprintArtifact(artifactId, actorId)` does `findUniqueOrThrow({ where: { id: artifactId } })` and writes an `AuditEvent` with no scope check. `reprintOrderPackingSlip` only checks the order exists (`findUnique`, not `findUniqueOrThrow`) and writes the audit row. The audit trail cannot prove the actor was entitled to reprint the subject.

### F5 — Missing optimistic-version guards on `split` and `regroup`
- **Severity:** Low
- **Location:** `lib/package-operations.ts` `splitPackage` (lines 180–217), `regroupPackages` (lines 219–252)
- **Claim:** `advancePackageStatus` correctly requires a `version` and uses a conditional `updateMany` to detect concurrent changes, but `splitPackage` and `regroupPackages` read the source package and mutate it without any version check. Two staff members acting on the same package simultaneously can produce divergent state (double-splits, regroup-into-a-package-that-was-just-split, etc.) with no conflict signal.
- **Evidence:** `splitPackage` reads `source` and creates the target without re-checking `source.version` or using a conditional update (lines 182–216). `regroupPackages` filters by `isActive: true, status: "NEW"` but does not version-gate the `package.update({ isActive: false })` call (line 242). Contrast with `advancePackageStatus` lines 159–163 which uses `where: { id, version, status, isActive: true }` and asserts `updated.count === 1`.

### F6 — PDF content-stream escaping is minimal
- **Severity:** Low
- **Location:** `lib/print-batches.ts` `pdfText` (lines 95–97) and `createPdf` (lines 99–127)
- **Claim:** `pdfText` escapes only `\\`, `(`, and `)`. Recipient names, greetings, and `draftReference` values are customer/staff-controlled free text and are written verbatim into the PDF content stream after that minimal escape. Newlines, tabs, carriage returns, or other control bytes in those fields pass through unfiltered, which can break PDF rendering or truncate the printed label/slip silently. No code execution risk (PDF text strings, not JavaScript), but integrity of the printed artifact is not guaranteed.
- **Evidence:** `pdfText` (lines 95–97) handles three characters only. The content stream assembles `(${pdfText(line)}) Tj` lines with no filtering of `\n`, `\r`, `\t`, or non-printable bytes (line 106). `document.lines` are populated from `packageRecord.recipientName`, `packageRecord.greeting`, and `packageRecord.order.draftReference` (lines 74–77, 88–91), all of which are user-supplied strings stored in the DB.

### F7 — `packageDashboard` returns unscoped global package list
- **Severity:** Informational
- **Location:** `lib/package-operations.ts` `packageDashboard` (lines 121–151)
- **Claim:** The dashboard returns the 250 most-recently-updated active packages across every customer, season, and fulfillment channel with no staff-scope filter. This is consistent with the rest of the admin app (single-tenant, all staff see all orders), but it means the P7 board does not narrow the data exposure beyond what `orders.read` already grants.
- **Evidence:** `prisma.package.findMany({ where: { isActive: true }, ..., take: 250 })` (lines 122–131) — no `actorId`, season, or staff-scope predicate. Returned to any caller with `orders.read` (route line 21).

## Summary counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 3 |
| Informational | 1 |
| **Total** | **7** |
