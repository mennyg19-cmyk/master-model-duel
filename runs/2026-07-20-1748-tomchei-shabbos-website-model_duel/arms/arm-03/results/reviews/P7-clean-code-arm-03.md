# P7 Clean-code review — arm-03

**Phase:** P7 — Package engine live
**Scope:** P7 deliverables only (package materialization, split/regroup/stage, fulfillment dashboard, nightly + reprint print batches, PDF artifacts). Findings only — no fixes applied.

## Summary

The P7 surface is functional (smoke 16/16) but carries heavy duplication: two implementations of split/regroup/stage-advance, two PDF generators, two `PrintArtifact.payload` schemas, several orphaned routes, and one dead client component that is also shape-mismatched to its route. Naming and error-handling drift inside the live path are moderate. The biggest clean-code risk is latent: the `print-artifacts/[id]` download route would render broken PDFs for any artifact written by the nightly/reprint path, because the two writers use incompatible payload shapes in the same JSON column.

## Findings

### C-1 — Duplicated logic: split / regroup / stage-advance exist twice

`src/lib/ops/packages.ts` and `src/lib/packages/actions.ts` both implement `splitPackage`, `regroupPackages`, and a stage-advance function with **different semantics** (lock strategy, partial vs. whole-item split, donor deletion vs. retention, season scoping, key-match enforcement). See the rules review (R-1) for the full wiring table. Clean-code category: **duplicated logic** + **inconsistent patterns**. Net effect: the live UI uses `ops/packages`; the `packages/actions`-backed routes are reachable only via dead UI (C-3).

### C-2 — Duplicated logic: two PDF generators

`src/lib/pdf.ts` (`renderPdf`, `paginate`, `PdfLine`, `LETTER`/`LABEL_4X6`/`CARD_5X7`) and `src/lib/print/pdf.ts` (`buildSimplePdf`, `pdfToDataUrl`) both write PDFs from scratch with no shared code. `ops/print-batch.ts` uses the second; `print/render.ts` uses the first. Clean-code category: **duplicated logic** + **inconsistent patterns** (one concern, two strategies).

### C-3 — Dead code: orphaned routes + dead component

- `src/components/admin/fulfillment-actions.tsx` — exported, never imported (only `FulfillmentDashboardClient` is mounted on the fulfillment page).
- `src/app/api/admin/packages/[id]/split/route.ts`, `…/[id]/stage/route.ts`, `…/regroup/route.ts` — no client component calls them.
- `src/app/api/admin/print-artifacts/[id]/route.ts` — no UI links to it (the print-batches list links to `/api/admin/print-batches/artifacts/[id]`).

Clean-code category: **dead code** — delete, don't leave commented or unwired.

### C-4 — Dead component is also shape-mismatched to its route

`fulfillment-actions.tsx` reads `body.batch.artifacts.length` and `body.replayed` from `POST /api/admin/print-batches` (`fulfillment-actions.tsx:103,125,144`). The route returns `{ ok, batchId, runKey, created, artifactCount, packageCount, stagesUnchanged }` — no `batch`, no `replayed`. The shape it expects belongs to the other implementation (`print/batches.ts`). Reviving this component would surface `undefined` counts on every button. Clean-code category: **inconsistent patterns** + **anti-AI-tics** (code that looks right but isn't verified against the live contract).

### C-5 — Type/schema drift: two `PrintArtifact.payload` shapes in one JSON column

`ops/print-batch.ts` persists `{ title, lines, packageIds, stagesSnapshot, pdfDataUrl, stock }` (`src/lib/ops/print-batch.ts:247`). `print/batches.ts` persists `GroupArtifactPayload | PackingSlipPayload` (`src/lib/print/payload.ts`, `src/lib/print/batches.ts:191`). Same column, incompatible schemas. The two download routes each assume one schema:
- `/api/admin/print-batches/artifacts/[id]` reads `payload.pdfDataUrl` / `payload.lines` — works only for `ops/print-batch` payloads.
- `/api/admin/print-artifacts/[id]` calls `renderArtifactPdf(kind, payload)` which casts `payload as GroupArtifactPayload` and reads `payload.filingGroup` / `payload.packages` — would render an empty/broken PDF for any `ops/print-batch` payload (which has no `packages` field).

Today the writers don't collide (packing-slip route renders on-the-fly; nightly/reprint persist via `ops/print-batch`), but the drift is latent and the orphaned `print-artifacts/[id]` route would break on any persisted artifact from the live path. Clean-code category: **type/schema drift**.

### C-6 — Magic / hardcoded evidence: `stagesUnchanged: true as const`

`persistBatch` returns `stagesUnchanged: true as const` unconditionally (`src/lib/ops/print-batch.ts:228,281`); all three runners forward it. The smoke's print-safety assertion (`scripts/smoke-p7.mjs:269`) checks `json.stagesUnchanged === true` — trivially green because the value is a constant, not a measurement. `packageStagesForBatch` (`src/lib/ops/print-batch.ts:462`) exists to produce real evidence and is never called. Clean-code category: **magic values** + **anti-AI-tics** ("just in case" evidence).

### C-7 — `print-batches.tsx` reads a field the route never returns

`src/components/admin/print-batches.tsx:51` reads `(json.packageStages ?? [])`. The route response has no `packageStages` field, so `stages` is always `[]` and the `stillUnshipped` portion of the status message is always `true` regardless of reality. Clean-code category: **inconsistent patterns** (client/route contract drift).

### C-8 — Over-verbose query in `reprintFilingGroup`

`src/lib/ops/print-batch.ts:346` does a two-step method lookup then builds the `where` with `fulfillmentMethodId: method?.id` plus a conditional spread `...(method ? {} : { fulfillmentMethod: { code: group } })`. Collapses to one clause: `fulfillmentMethod: { code: { equals: group, mode: "insensitive" } } }`. The current form has a dead branch (`fulfillmentMethodId: undefined` is a no-op) and reads harder than the single-clause form. Clean-code category: **anti-AI-tics** (over-verbose code).

### C-9 — Naming: banned standalone names in live path

The arm's `clean-code` rule bans `data`, `result`, `info`, `temp`, `val`, `item`, `thing` as standalone names. Violations in P7 files:
- `result` — `src/lib/ops/packages.ts:312,413,492`; `src/lib/ops/print-batch.ts:309,366,412`; `src/lib/orders/package-stages.ts:63,101`.
- `item` — `src/lib/ops/packages.ts:433` (`for (const item of input.items)`); `src/lib/packages/actions.ts:96,105,134`; `src/lib/print/batches.ts:55`; `src/lib/print/render.ts:30,48`; `src/components/admin/package-board.tsx:199`.

Clean-code category: **naming conventions**. Pervasive but low-severity; flagging the pattern, not each site.

### C-10 — Error-handling drift inside one file

In `src/lib/ops/packages.ts`, `splitPackage`'s catch includes the underlying detail (`Could not split package: ${detail}`), but `regroupPackages` and `bulkAdvancePackageStage` return generic strings (`"Could not regroup packages."`, `"Could not bulk-update package stages."`). The rule requires error messages to say what went wrong **and** the expected state. The sibling file `packages/actions.ts` uses specific `ActionError` messages throughout — so the two implementations diverge on error specificity as well as semantics. Clean-code category: **error handling** + **inconsistent patterns**.

### C-11 — `finalize.ts` is double-spaced

`src/lib/orders/finalize.ts` has a blank line after nearly every code line (539 physical lines for ~270 logical lines), inconsistent with every other file in the arm. No other P7 file is formatted this way. Bloats the file and makes diffs noisier. Clean-code category: **inconsistent patterns** (one formatting pattern per project).

### C-12 — `regroupPackages` (ops) nesting

`src/lib/ops/packages.ts:345` — `for (const donor of donors) { for (const item of donor.items) { if (existing) {…} else {…} } }` with awaits at each leaf. Function → try → for → for → if/else is 4–5 levels; the rule calls for refactor past 3. The inner per-item upsert could be a helper. Clean-code category: **anti-AI-tics** (nesting > 3).

### C-13 — `reserveOrderInventory` nesting + repeated shape

`src/lib/orders/finalize.ts:240` — outer `for (const line of lines)` with an `if (tracksInventory)` block that does findUnique + null-throw + `addNeed`, then a nested `for (const lineAddOn of line.addOns)` with the same findUnique + null-throw + `addNeed` shape duplicated for add-ons. The two lookup-or-throw blocks are a copy-paste pair with minor variation; the rule says extract the pattern. Clean-code category: **duplicated logic** + **nesting > 3**.

### C-14 — `splitPackage` (ops) bakes a timestamp into the greeting portion of the grouping key

`src/lib/ops/print-batch.ts` is not the only oddity — in `src/lib/ops/packages.ts:243`, `splitPackage` builds the new package's `groupingKey` via `buildGroupingKey({ …, greeting: \`${source.greeting}#split-${Date.now().toString(36)}\` })`. `buildGroupingKey` lowercases and joins, so the `#split-…` tag becomes part of the normalized greeting field — the field that semantically identifies greeting equality for regroup. The sibling implementation (`packages/actions.ts:27`) uses `suffixedKey` which splits on `#` and keeps the base key clean. Clean-code category: **inconsistent patterns** + semantic misuse of a field.

### C-15 — PDFs generated inside an open DB transaction

`persistBatch` (`src/lib/ops/print-batch.ts:233`) calls `buildSimplePdf(spec.lines)` and `pdfToDataUrl(pdf)` for every artifact **inside** the `db.$transaction(async (tx) => { … })` callback. For the nightly batch (smoke shows 1038 artifacts / 5037 packages), this holds a transaction open while generating and base64-encoding ~1000 PDFs. The alternative implementation (`print/batches.ts`) stores only the payload and renders on read — no transaction-held PDF work. Clean-code category: **anti-AI-tics** (every line must have a reason) + performance smell; not strictly a clean-code rule but worth flagging.

## Category tally

| Category | Findings |
|---|---|
| Duplicated logic | C-1, C-2, C-13 |
| Dead code | C-3 |
| Inconsistent patterns | C-1, C-2, C-4, C-7, C-10, C-11, C-14 |
| Type/schema drift | C-5 |
| Magic values | C-6 |
| Naming conventions | C-9 |
| Error handling | C-10 |
| Anti-AI-tics (over-verbose / nesting / just-in-case) | C-4, C-6, C-8, C-12, C-13, C-15 |

## Net

The highest-impact items are structural: C-1 (two split/regroup/stage implementations), C-5 (two payload schemas in one JSON column), and C-3/C-4 (dead + shape-mismatched UI). The rest are naming, error-specificity, and formatting drift. None of these block the P7 smoke, but C-5 and C-4 are correctness landmines if the dead routes/component are ever revived, and C-6 undermines the phase's headline "print never ships" evidence.
