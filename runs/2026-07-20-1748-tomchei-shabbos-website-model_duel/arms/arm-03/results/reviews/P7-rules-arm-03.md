# P7 Rules review — arm-03

**Phase:** P7 — Package engine live
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Scope:** P7 deliverables (package materialization, split/regroup/stage, fulfillment dashboard, nightly + reprint print batches, PDF artifacts). Findings only — no fixes applied.

## Summary

P7 functionality passes its 16/16 smoke, but the package + print layer carries two full parallel implementations of the same operations, several orphaned routes/components, and a hardcoded "stagesUnchanged" evidence flag that makes the smoke's print-safety check vacuous. The duplicated code violates `clean-code` (one pattern per concern, Rule of 2, no dead code) and `ponytail` (no boilerplate "for later", deletion over addition). `workflow` Spec/gate discipline held (smoke green, status file written), but `codegraph` was not the structural-lookup path used here — discovery was file-by-file.

## Findings

### R-1 — Two parallel implementations of split / regroup / stage-advance (clean-code: one pattern per concern; ponytail: no boilerplate)

Same operations are implemented twice with **different semantics**, and different routes wire to different copies:

| Operation | `src/lib/ops/packages.ts` | `src/lib/packages/actions.ts` |
|---|---|---|
| split | whole-row move only; `FOR UPDATE` lock; version conflict check | partial-quantity split that creates a new `OrderLine`; no row lock; `updateMany` version check |
| regroup | deletes donor packages; no season scoping; allows any non-terminal stage; no recipient/method/greeting match check | keeps donors emptied with audit; season-scoped; `NEW` only; requires matching key |
| stage advance | `bulkAdvancePackageStage` (per-item loop, own transaction each) | `advancePackageStage` (single `updateMany`, optional outer tx) |

Wiring:
- `POST /api/admin/packages` → `ops/packages` (regroup + bulk stage) — `src/app/api/admin/packages/route.ts:6`
- `POST /api/admin/packages/[id]` → `ops/packages` split + `package-stages` transition — `src/app/api/admin/packages/[id]/route.ts:6`
- `POST /api/admin/packages/[id]/split` → `packages/actions` split — `src/app/api/admin/packages/[id]/split/route.ts:6`
- `POST /api/admin/packages/[id]/stage` → `packages/actions` advance — `src/app/api/admin/packages/[id]/stage/route.ts:7`
- `POST /api/admin/packages/regroup` → `packages/actions` regroup — `src/app/api/admin/packages/regroup/route.ts:6`
- `POST /api/admin/packages/bulk-stage` → `packages/actions` advance + channel-bulk `updateMany` — `src/app/api/admin/packages/bulk-stage/route.ts:8`

The UI (`package-board.tsx`, `fulfillment-dashboard.tsx`) only calls `/api/admin/packages` and `/api/admin/packages/[id]` — i.e. only the `ops/packages` path. The `packages/actions`-backed routes are reachable only via the dead `fulfillment-actions.tsx` (see R-2) or not at all.

### R-2 — Orphaned routes and a dead component (clean-code: dead code — delete, don't comment out; ponytail: deletion over addition)

- `src/components/admin/fulfillment-actions.tsx` (154 lines) is exported but **never imported** by any page or component (only the fulfillment dashboard is mounted, at `src/app/(admin)/admin/fulfillment/page.tsx:17`).
- `src/app/api/admin/packages/[id]/split/route.ts`, `…/[id]/stage/route.ts`, `…/regroup/route.ts` are not called by any client component. Only `bulk-stage/route.ts` is referenced, and only by the dead `fulfillment-actions.tsx`.
- `src/app/api/admin/print-artifacts/[id]/route.ts` is not linked from any UI (the print-batches list links to `/api/admin/print-batches/artifacts/[id]` instead — `src/components/admin/print-batches.tsx:121`).

### R-3 — `FulfillmentActions` expects a response shape the route never returns (clean-code: anti-hallucination / consistency; workflow: verify in running app)

`fulfillment-actions.tsx` posts to `/api/admin/print-batches` and reads `body.batch.artifacts.length` and `body.replayed` (`fulfillment-actions.tsx:103,125,144`). The actual route returns `{ ok, batchId, runKey, created, artifactCount, packageCount, stagesUnchanged }` (`src/lib/ops/print-batch.ts:318`, `src/app/api/admin/print-batches/route.ts:61`). The shape it expects is the one returned by the **other** implementation (`src/lib/print/batches.ts` → `{ batch, replayed }`). If this component were ever mounted, every "Reprint" / "Run nightly batch" button would render `undefined` artifact counts. Dead code that is also wrong-shaped — would break on revival.

### R-4 — `stagesUnchanged` is hardcoded `true`, not measured (clean-code: anti-hallucination — do not claim "passed/working" without evidence)

`persistBatch` returns `stagesUnchanged: true as const` unconditionally (`src/lib/ops/print-batch.ts:228,281`); the three runners forward it verbatim (`runNightlyPrintBatch`, `reprintFilingGroup`, `reprintOrder`). The route returns it as-is. Smoke S2a asserts `json.stagesUnchanged === true` (`scripts/smoke-p7.mjs:269`) — passes trivially because the value is a constant, not a measurement. The print-never-ships guarantee is real (no `Package.stage` writes in the print path), but the boolean is not evidence of it. `packageStagesForBatch` (`src/lib/ops/print-batch.ts:462`) exists to produce that evidence and is **never called** by any route or component.

### R-5 — `print-batches.tsx` reads `json.packageStages`, which the route never returns (clean-code: consistency)

`src/components/admin/print-batches.tsx:51` reads `(json.packageStages ?? [])`. The `/api/admin/print-batches` POST response has no `packageStages` field, so `stages` is always `[]` and `unshipped` is always `true`. The "stillUnshipped" segment of the status message is vacuous. Same root cause as R-4: `packageStagesForBatch` is unwired.

### R-6 — Two PDF generators coexist (clean-code: one pattern per concern; ponytail: ladder — pick one)

- `src/lib/pdf.ts` — `renderPdf` / `paginate` / `PdfLine` / page sizes (used by `print/render.ts`).
- `src/lib/print/pdf.ts` — `buildSimplePdf` / `pdfToDataUrl` (used by `ops/print-batch.ts`).

Both are stdlib, both write PDFs, neither shares code with the other. `ops/print-batch.ts` stores a base64 `pdfDataUrl` in the DB at write time; `print/render.ts` renders from payload at read time. Two strategies for the same concern in the same phase.

### R-7 — Two `PrintArtifact.payload` schemas in one JSON column (clean-code: type/schema drift)

`ops/print-batch.ts` writes `{ title, lines, packageIds, stagesSnapshot, pdfDataUrl, stock }` (`src/lib/ops/print-batch.ts:247`). `print/batches.ts` writes `GroupArtifactPayload | PackingSlipPayload` (`src/lib/print/payload.ts`, `src/lib/print/batches.ts:191`). Same column, incompatible shapes. The download route `/api/admin/print-batches/artifacts/[id]` reads `payload.pdfDataUrl` / `payload.lines` and only works for the first shape; `/api/admin/print-artifacts/[id]` calls `renderArtifactPdf(kind, payload)` which expects the second shape and would render an empty/broken PDF for any artifact written by `ops/print-batch.ts`. Today the writers don't collide (the packing-slip route renders on-the-fly without persisting; nightly/reprint persist via `ops/print-batch`), but the schema drift is latent.

### R-8 — `reprintFilingGroup` query is convoluted (clean-code: anti-AI-tics — no over-verbose code)

`src/lib/ops/print-batch.ts:346` does a two-step lookup: `findFirst` the method by code (case-insensitive), then `findMany` packages with `fulfillmentMethodId: method?.id` plus a conditional spread `...(method ? {} : { fulfillmentMethod: { code: group } })`. The whole lookup collapses to one clause: `fulfillmentMethod: { code: { equals: group, mode: "insensitive" } } }`. The `method?.id` + ternary-spread form is harder to read than the single-clause form and adds a dead branch (when `method` is null, `fulfillmentMethodId: undefined` is already a no-op filter).

### R-9 — Inconsistent error message specificity across one file (clean-code: error handling — say what went wrong AND expected state; one pattern per concern)

In `src/lib/ops/packages.ts`:
- `splitPackage` catch: `Could not split package: ${detail}` — includes the underlying message.
- `regroupPackages` catch: `"Could not regroup packages."` — generic, no detail.
- `bulkAdvancePackageStage` catch: `"Could not bulk-update package stages."` — generic.

`packages/actions.ts` uses `ActionError` with specific messages ("Only packages still at New can be regrouped", "A selected item no longer belongs to this package", etc.). The two implementations diverge on error specificity as well as semantics.

### R-10 — `codegraph` not used for structural lookup during P7 (codegraph rule)

The codebase has `.codegraph/` indexed (present under `workspace/`). The codegraph rule requires CodeGraph (MCP or CLI) for all structural questions when the index is healthy, and forbids Grep/Read-tree for symbol discovery. This review was done with Read + Grep over the package/print tree. Not a defect in the contestant's product code, but a process deviation for this review pass — noted for the record.

## Rule-by-rule score

| Rule | Adherence | Notes |
|---|---|---|
| ponytail | **Partial** | Ladder respected (no new deps, stdlib PDFs). Violated by duplicated implementations (R-1), dead code (R-2, R-3), two PDF libs (R-6). |
| clean-code | **Partial** | R-1 (one pattern per concern), R-2 (dead code), R-4/R-5 (anti-hallucination), R-7 (schema drift), R-8 (over-verbose), R-9 (error handling). Naming: `result` / `item` used as standalone names in `ops/packages.ts`, `package-stages.ts`, `print/batches.ts`, `print/render.ts`, `package-board.tsx` — banned by the rule. |
| workflow | **Pass (with caveat)** | Spec/gate discipline held: P7 status file written, smoke 16/16, ASCII-arrow workaround for WIN1252 documented in `PHASE-P7-STATUS.md`. Caveat: the smoke's print-safety assertion is vacuous (R-4). |
| vocabulary | **N/A** | No refactor/tidy/rebuild commands issued in P7 build. |
| codegraph | **N/A for product** | Index exists; not used in this review pass (R-10). |

## Net

P7 ships working smoke-grade behavior, but the package + print subsystem is built twice over with divergent semantics, and the "print never ships" guarantee — the phase's headline invariant — is asserted via a hardcoded boolean rather than measured. Consolidating to one split/regroup/stage path, deleting the orphaned routes + `fulfillment-actions.tsx`, picking one PDF strategy, and wiring `packageStagesForBatch` into the route response would remove the bulk of the findings.
