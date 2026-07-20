# P7 Quality review — arm-02

Reviewer: Quality specialist (blind to model name).
Scope: `arms/arm-02/workspace/` P7 (package engine live) per `shared/phases/PHASE-P7-EXPECTED.md`.
Method: read-only findings, no fixes. Evidence = source paths + line refs.

## Severity counts

- **High:** 1
- **Medium:** 3
- **Low:** 6
- **Total:** 10

Smoke (`PHASE-P7-SMOKE.md`) is 25/25 PASS, but it does not exercise cross-order merged packages, channel-bulk audit, or season-scoping — gaps below.

## High

### H1 — Per-order packing slip leaks other orders' items in merged packages
`buildOrderPackingSlip` and `reprintOrder` load packages via `lines: { some: { orderId } }`, then `toPrintPackage` maps **every** line in those packages — including lines from other orders grouped into the same box. The rendered slip (`packingSlipPages`) lists the full package contents, so a packing slip for order X shows items order Y paid for whenever finalize merged them into one package. This mislabels fulfillment and leaks cross-order item data, and contradicts R-056's "what is in this order's shipment" framing.
- `lib/print/batches.ts:144-163` (`buildOrderPackingSlip`), `lib/print/batches.ts:210-234` (`reprintOrder`), `lib/print/render.ts:77-89`.

## Medium

### M1 — Channel bulk stage move skips per-package audit
The `bulk-stage` channel branch runs a raw `updateMany` and writes only one `AuditLog` via `writeAudit`; it never writes `PackageAudit` rows for the moved packages. The ids branch calls `advancePackageStage` (which writes `PackageAudit`), and split/regroup/single-stage all write `PackageAudit`. EXPECTED #2 and S1 emphasize "audit retained"; channel bulk moves break that invariant — the per-package history a reviewer reconstructs from `PackageAudit` is missing for these transitions.
- `app/api/admin/packages/bulk-stage/route.ts:44-61` vs `lib/packages/actions.ts:225-227`.

### M2 — Split / regroup / stage APIs are not scoped by open season
`splitPackage`, `regroupPackages`, and `advancePackageStage` look packages up by id with no `seasonId` / open-season check. A staff member holding `fulfillment.manage` can split, regroup, or advance a package belonging to a closed or past season by id. The board UI only lists the open season, but the APIs accept any id — defense-in-depth missing.
- `lib/packages/actions.ts:45-49`, `lib/packages/actions.ts:146-151`, `lib/packages/actions.ts:210-214`.

### M3 — Bulk ids stage advance is non-atomic
The ids branch loops calling `advancePackageStage` per id, each in its own transaction; a mid-loop failure leaves some packages advanced and others skipped (the response reports `done`/`skipped`, but the bulk action is not all-or-nothing). The channel branch is atomic (single `updateMany` in one transaction). The two "bulk" shapes give inconsistent atomicity guarantees.
- `app/api/admin/packages/bulk-stage/route.ts:64-83`.

## Low

### L1 — Reprint runKeys can collide unhandled
`reprintFilingGroup` / `reprintOrder` build `runKey` from `Date.now()`; a same-millisecond double click hits the unique `PrintBatch.runKey` constraint and throws `P2002` uncaught — the nightly path recovers from `P2002`, the reprint paths do not.
- `lib/print/batches.ts:206`, `lib/print/batches.ts:233`.

### L2 — Fulfillment dashboard recent-artifacts list crosses seasons
`db.printArtifact.findMany` in the fulfillment page has no season filter (and `PrintArtifact` carries no `seasonId`), so the "Print production" recent list shows artifacts from every season, not just the open one.
- `app/(admin)/admin/fulfillment/page.tsx:26-30`.

### L3 — `PrintBatch.createdByStaffId` has no FK relation
The schema declares `createdByStaffId String?` with no `@relation` to `StaffUser`, so orphaned staff references are not enforced at the DB layer — inconsistent with other actor columns elsewhere in the schema.
- `prisma/schema.prisma:464`.

### L4 — Nightly runKey is UTC-day, not local-day
`runKey = nightly-${new Date().toISOString().slice(0,10)}` uses the UTC calendar day. In a non-UTC timezone a late-evening "tonight's batch" run can produce next-day (or wrong-day) keys, shifting the idempotency window off the org's working day.
- `lib/print/batches.ts:171`.

### L5 — Split panel allows partial add-on quantities then fails at the API
The split UI renders the numeric input for add-on lines (showing "(has add-ons — moves whole)") but still accepts partial values; the 400 from `splitPackage` ("Items with add-ons move whole") only arrives on submit. No client-side guard.
- `components/admin/package-board.tsx:205-225`; `lib/packages/actions.ts:91-94`.

### L6 — PDF writer silently replaces non-Latin-1 with "?"
`escapePdfText` maps any codepoint outside 32–255 to "?". Documented as safe for English/US-address data, but greetings or recipient names with accents or Hebrew (plausible for this org) render as question marks with no warning or audit.
- `lib/pdf.ts:26-35`.
