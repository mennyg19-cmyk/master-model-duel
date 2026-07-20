# P7 Rules review — arm-02

Reviewer: Rules specialist (blind to model name).
Scope: `arms/arm-02/workspace/` P7 changes (package engine, print batches, fulfillment dashboard).
Rules graded: ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol.
Method: findings only, no fixes. Evidence cited as `path:line`.

## Severity counts

- Critical: 0
- High: 2
- Medium: 5
- Low: 4
- Info: 1

## Findings

### H1 — Cross-season leak in fulfillment dashboard artifacts list
`app/(admin)/admin/fulfillment/page.tsx:24-31` queries `db.printArtifact.findMany` with `take: 30` and **no `seasonId` filter**, while `channelSummaries(season.id)` is season-scoped. The "Print production" table therefore shows artifacts from every season, not the open one. Clean-code (consistency: one scoping pattern per concern) + correctness. The channel rollup and the artifact list disagree on scope.

### H2 — Channel bulk move skips per-package `PackageAudit`
`app/api/admin/packages/bulk-stage/route.ts:44-61` (methodId path) issues one atomic `package.updateMany` and writes a single `AuditLog` row, but never writes `PackageAudit`. The single-package path (`advancePackageStage` in `lib/packages/actions.ts:225`) writes a `PackageAudit` per move. Same business action, two audit patterns — clean-code (inconsistent patterns) and the phase's own "audit retained" expectation (SMOKE S1) is only honored on the split/regroup/single paths, not the channel bulk path.

### M1 — Client duplicates server stage-transition logic
`components/admin/package-board.tsx:34-38` hardcodes `NEXT_STAGES` and re-derives terminal at `:143-144`, duplicating `allowedNextStages`/`terminalStageFor` in `lib/domain/package-stage.ts`. Clean-code (duplicated logic). The board is server-rendered — the allowed next stages could be computed server-side and passed in, removing the drift risk if the server table changes.

### M2 — `buildOrderPackingSlip` shows other orders' lines
`lib/print/batches.ts:144-163` loads every package in the season that has any line from the order, then renders all of each package's `items`. A grouped package can hold lines from several orders; the per-order packing slip therefore lists items belonging to other orders. Phase EXPECTED §5 says "per-order packing slip." Domain-correctness + workflow (never silently choose business logic — the cross-order visibility is an unlogged decision).

### M3 — `groupArtifacts` O(n²) spread into a Map
`lib/print/batches.ts:70-74` builds groups with `byGroup.set(group, [...(byGroup.get(group) ?? []), entry])`, reallocating per entry. At 5k+ packages (the scale the schema indexes target, G-024) this is quadratic. Ponytail (minimum code that scales) + clean-code. Use `push`.

### M4 — `packingSlipDrafts` quadratic filter
`lib/print/batches.ts:103-114` fetches orders then, per order, filters all packages with `entry.lines.some(line => line.order.id === order.id)`. O(orders × packages). At scale this is the hot path of the nightly batch. Ponytail.

### M5 — `reprintOrder` over-fetches then filters
`lib/print/batches.ts:210-233` calls `packingSlipDrafts(packages, …)` (which builds slips for every order touching those packages) and then `.filter((draft) => draft.orderId === orderId)`. Correct but wasteful — the reprint already knows the single order. Clean-code (over-verbose code).

### L1 — `renderArtifactPdf` switch has no exhaustiveness guard
`lib/print/render.ts:91-102` switches on `PrintArtifactKind` with no `default`/`never` assertion. If the enum gains a member the function silently returns `undefined` and the download route (`app/api/admin/print-artifacts/[id]/route.ts:14`) passes `undefined` to `new Uint8Array(...)`. Clean-code (anti-AI-tics: defensive gap). A `default: ((_: never) => …)(kind)` or `assertNever` would catch it at compile time.

### L2 — Raw stage string in order detail
`app/(admin)/admin/orders/[id]/page.tsx:139` renders `{line.package.stage}` as the badge label (e.g. `PICKED_UP`), while every other surface pretty-prints with `.replace("_", " ")` (board `:173`, fulfillment `:125`). UI consistency (clean-code).

### L3 — `note: (result: never) => string` type-erasure hack
`components/admin/fulfillment-actions.tsx:26-32` declares the callback param as `never` and calls `note(result.body as never)`, letting each call site supply its own body shape without any checking. Anti-AI-tics ("no redundant type assertions the compiler already guarantees" — this is the inverse, an unsafe assertion to defeat the compiler). Works; reads as a smell.

### L4 — `runNightlyBatch` returns 404 for "no work"
`lib/print/batches.ts:180` throws `ActionError("No new packages to print tonight", 404)`. 404 means "resource not found"; "nothing to do" is a 200/409-ish condition. Minor error-shape inconsistency (clean-code: one error-handling approach).

### I1 — `escapePdfText` vs `WinAnsiEncoding` mismatch
`lib/pdf.ts:26-35` keeps bytes 32–255 verbatim and the comment claims Latin-1, but the fonts declare `/WinAnsiEncoding` (`:93,:95`). Latin-1 and WinAnsi differ at a handful of code points (e.g. 0xA0, 0xAD). For US addresses and English greetings this is moot, but the comment overstates correctness. Anti-hallucination (verify-before-claim) — informational only.

## What passed cleanly

- Optimistic locking on stage advance is correct and tested (`lib/packages/actions.ts:202-231`, `tests/package-stage.test.ts`).
- Print never touches `Package` rows — `renderArtifactPdf` reads payload snapshots only; G-002 honored.
- Nightly idempotency via unique `runKey` with P2002 race handling (`lib/print/batches.ts:170-195`).
- `lib/pdf.ts` is dependency-free (ponytail ladder rung 2: stdlib only) with a correct xref table.
- Permission `fulfillment.manage` added to MANAGER + STAFF, denied to DRIVER, deny-overridable (`lib/auth/permissions.ts`).
- Nav items added consistently (`app/(admin)/admin/layout.tsx:14-15`).
- SMOKE evidence 25/25 PASS in `.scratch/PHASE-P7-SMOKE.md`; P7 EXPECTED checklist all checked in `PHASE-P7-STATUS.md`.
