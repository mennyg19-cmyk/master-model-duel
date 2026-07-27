# P7 Clean-code review — arm-05

Reviewer: clean-code specialist (blind — no model names).
Scope: P7 deliverables only — `app/admin/packages/page.tsx`, `app/api/admin/packages/route.ts`, `app/api/admin/print/route.ts`, `lib/package-operations.ts`, `lib/print-batches.ts`, `prisma/migrations/20260727235000_p7_package_engine/migration.sql`, `prisma/schema.prisma` (P7 additions), `scripts/smoke-p7.ts`, plus P7 touch-ups in `app/admin/layout.tsx`, `app/admin/page.tsx`, `lib/checkout.ts`.
Rules: `arms/arm-05/.cursor/rules/clean-code.mdc`.
Format: severity · location · claim · evidence. Findings only — no fixes.

---

## High

### H1 — Duplicated package item-count reducer across 3 files (5 sites)
- Location: `lib/package-operations.ts:134`, `lib/package-operations.ts:188`, `lib/print-batches.ts:76`, `lib/print-batches.ts:90`, `app/admin/packages/page.tsx:115`.
- Claim: `packageRecord.lines.reduce((sum, line) => sum + line.quantity, 0)` is copy-pasted 5 times across 3 P7 files. Rule of 2 is met (5 call sites now), so it should be a single helper in `lib/packages.ts` (which already exists and only holds grouping helpers).
- Evidence: same reducer literal in `packageDashboard`, `splitPackage` guard, `printArtifactDocument` line builder, `orderPackingSlipDocument` line builder, and the board UI row.

### H2 — Duplicated "order number or draft reference" label across 3 files
- Location: `lib/print-batches.ts:76`, `lib/print-batches.ts:87`, `app/admin/packages/page.tsx:115`.
- Claim: `orderNumber ?? draftReference` is repeated as the human label for an order. With 3 call sites it meets Rule of 2 and should be a single `formatOrderLabel(order)` helper.
- Evidence: identical fallback expression in two print-document builders and the board row.

## Medium

### M1 — `printArtifactDocument` and `orderPackingSlipDocument` duplicate per-package line formatting
- Location: `lib/print-batches.ts:74-78` and `lib/print-batches.ts:88-92`.
- Claim: Both builders emit the same two-line shape per package (`recipientName · fulfillmentMethod.name`, then `itemCount item(s) · greeting`). The only divergence is whether the order line is prefixed. Extract a shared `formatPackageLines(packageRecord, { includeOrder })` helper.
- Evidence: `printArtifactDocument` calls `packageRecord.order.orderNumber ?? packageRecord.order.draftReference` then the same item-count + greeting pair; `orderPackingSlipDocument` emits only the item-count + greeting pair.

### M2 — Single-use module-level helpers in `print-batches.ts` (Rule of 2)
- Location: `lib/print-batches.ts:4` (`batchKeyFor`), `lib/print-batches.ts:8` (`packageIds`), `lib/print-batches.ts:95` (`pdfText`).
- Claim: Each helper has exactly one call site. `clean-code.mdc` Rule of 2 requires 2+ real call sites now. Either inline or keep them local to the calling function.
- Evidence: `batchKeyFor` called only at line 13; `packageIds` called only at line 67; `pdfText` called only at line 104.

### M3 — `fulfillmentName` is a single-call-site module-level helper
- Location: `lib/package-operations.ts:32-34`, called only at `lib/package-operations.ts:70-71`.
- Claim: Rule of 2 violation — one call site. Either inline into `materializeFinalizedOrder` or move to `lib/packages.ts` if it is intended as the canonical fulfillment display helper (but see M5 — it is not reused).
- Evidence: defined at module scope, used twice in the same `upsert` (create + update name) which is one logical call site.

### M4 — `packages/page.tsx` initial-mount effect duplicates `load()`
- Location: `app/admin/packages/page.tsx:25-32` (`load`) and `app/admin/packages/page.tsx:34-46` (`useEffect`).
- Claim: The mount effect re-implements the same fetch + state-set sequence as `load()`, only adding an `AbortController`. Two fetch paths for the same data in the same file. Pattern drift within one file.
- Evidence: `load()` does `fetch → json → setPackages/setChannels/setSummary`; the `useEffect` body does the same with `then` chaining and an abort signal.

### M5 — `runPackageAction` and `runPrintAction` are near-identical POST wrappers
- Location: `app/admin/packages/page.tsx:48-60` and `app/admin/packages/page.tsx:62-72`.
- Claim: Both functions do `fetch(url, { method: POST, body: JSON.stringify(action) })`, parse JSON, set `message`, and on success refresh state. Extract one `postJson(url, action, { onSuccess })` helper.
- Evidence: same headers, same error path, same `setMessage` call; only the URL and the success side-effect differ.

### M6 — Inconsistent enum display formatting
- Location: `lib/package-operations.ts:32-34` (`fulfillmentName` title-cases: `LOCAL_DELIVERY → Local Delivery`), `lib/print-batches.ts:71` (`artifact.kind.replaceAll("_", " ")` yields `PACKING SLIP` uppercase), `app/admin/packages/page.tsx:96` (`artifact.filingGroup.replaceAll("_", " ")`).
- Claim: One pattern per concern violated — two ways to render an enum-with-underscores for UI/print. The fulfillment method is title-cased; the artifact kind and filing group are left uppercase. Pick one helper and reuse it.
- Evidence: `fulfillmentName` does `.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())`; the print/UI call sites do bare `replaceAll("_", " ")`.

### M7 — `savedPackageMoves` is a fabricated metric labeled as a real one
- Location: `lib/package-operations.ts:144-150`.
- Claim: `savedPackageMoves: Math.max(0, productionUnits - packages.length)` is presented to staff as "Package moves saved by grouping" (UI label at `packages/page.tsx:88`). It is not a measured count — it is `items − packages`, which overcounts savings whenever a recipient orders >1 of the same item (no extra "move" was ever going to happen). The phase EXPECTED asks for "production/savings summaries"; this number misrepresents the savings.
- Evidence: no grouping-without-grouping baseline is computed; the formula assumes every item would have been its own package absent grouping, which is false for multi-quantity lines.

### M8 — `packageDashboard` computes `productionUnits` twice
- Location: `lib/package-operations.ts:134` (per-channel accumulation) and `lib/package-operations.ts:144` (whole-board reduce).
- Claim: The board total is computed once inside the channel loop and again as a separate full reduce over the same packages. The total can be derived from `channels` (sum of `channel.productionUnits`).
- Evidence: line 134 accumulates `channel.productionUnits += productionUnits`; line 144 re-reduces `packages` to get the same number.

## Low

### L1 — `bulk_status` uses `versions: Record<string, number>` while `advance` uses `version: number`
- Location: `app/api/admin/packages/route.ts:9` and `app/api/admin/packages/route.ts:13`.
- Claim: Two representations of the same concept (package version) in one discriminated schema. A single shape (e.g. always `versions: Record<id, number>`) would remove the per-action divergence and simplify the bulk path's "version for every package" guard at line 42.
- Evidence: `advance` sends `{ packageId, version, status }`; `bulk_status` sends `{ packageIds[], versions: Record<id, number>, status }`.

### L2 — `reprintArtifact` vs `reprintOrderPackingSlip` not-found handling diverges
- Location: `lib/print-batches.ts:46` (`findUniqueOrThrow` → Prisma message) and `lib/print-batches.ts:54-55` (manual `findUnique` + custom `throw new Error("Order was not found.")`).
- Claim: One error-handling approach per concern violated. Two not-found patterns for the same kind of lookup in the same module.
- Evidence: `findUniqueOrThrow` lets Prisma throw `P2025`; the sibling function hand-rolls the check and message.

### L3 — `orderId!` non-null assertion
- Location: `app/api/admin/print/route.ts:20`.
- Claim: `await orderPackingSlipDocument(orderId!)` uses a `!` assertion because the guard on line 18 (`if (!artifactId && !orderId)`) does not narrow `orderId` to non-null in the else branch. Restructuring (e.g. early-return per branch) removes the assertion.
- Evidence: `const document = artifactId ? await printArtifactDocument(artifactId) : await orderPackingSlipDocument(orderId!);`

### L4 — Magic value `take: 250` in `packageDashboard`
- Location: `lib/package-operations.ts:130`.
- Claim: Unnamed cap on packages loaded for the board. At the 5k-package crunch scale (G-024) this is a hidden pagination ceiling with no constant or comment explaining why 250.
- Evidence: `orderBy: { updatedAt: "desc" }, take: 250` with no named constant.

### L5 — Magic value `slice(0, 55)` in `createPdf`
- Location: `lib/print-batches.ts:106`.
- Claim: Max lines per PDF page is an unnamed literal. A `MAX_LINES_PER_PAGE` constant would convey intent.
- Evidence: `...document.lines.slice(0, 55).flatMap(...)`.

### L6 — `target="_blank"` PDF links without `rel="noopener noreferrer"`
- Location: `app/admin/packages/page.tsx:98` and `app/admin/packages/page.tsx:116`.
- Claim: New-tab links to PDF endpoints omit the reverse-tabnabbing guard. Minor but consistent with the project's security-basics stance in `workflow.mdc`.
- Evidence: `<a className="button secondary" href={`/api/admin/print?artifactId=${artifact.id}`} target="_blank">` and the packing-slip anchor.

### L7 — Audit granularity drift between batch creation and reprint
- Location: `lib/print-batches.ts:38-40` (one `auditEvent` for the whole nightly batch) vs `lib/print-batches.ts:47-49` and `lib/print-batches.ts:56-58` (one `auditEvent` per reprint).
- Claim: Batch creation records one summary audit row; reprints record per-target rows. The same print concern is audited at two different granularities. Not necessarily wrong, but the divergence is unexplained.
- Evidence: `createNightlyPrintBatch` creates a single `print.batch_created` event with `artifactCount`; `reprintArtifact` and `reprintOrderPackingSlip` each create one event per action.

### L8 — Two audit tables for related package/print operations
- Location: `lib/package-operations.ts:105-112` (`PackageAudit`) and `lib/print-batches.ts:38` (`AuditEvent`).
- Claim: Package materialization and status changes write `PackageAudit`; print batch creation and reprints write `AuditEvent`. The split may be intentional (package-scoped vs staff-action-scoped) but is not documented, so future contributors will guess which table a new print/package action should target.
- Evidence: `materializeFinalizedOrder` → `packageAudit.create`; `advancePackageStatus` → `packageAudit.create`; `createNightlyPrintBatch` → `auditEvent.create`.

### L9 — `assert.equal(x >= 4, true)` instead of `assert.ok(x >= 4)`
- Location: `scripts/smoke-p7.ts:75`.
- Claim: Awkward assertion idiom — comparing a boolean to `true` instead of using `assert.ok`. Minor readability nit in the smoke test.
- Evidence: `assert.equal(await prisma.packageAudit.count(...) >= 4, true);`

### L10 — `readCheckout` is a single-call-site module-level helper
- Location: `lib/package-operations.ts:18-30`, called only at `lib/package-operations.ts:52`.
- Claim: Rule of 2 borderline — one call site. The extraction improves readability of `materializeFinalizedOrder`, but strictly it should be local to that function or moved to a shared wire-format module if other phases need it.
- Evidence: defined at module scope, used once.

---

## Counts

- High: 2
- Medium: 8
- Low: 10
- Total: 20

## Theme

Duplication is the dominant issue: the package item-count reducer (5 sites) and the order-label fallback (3 sites) are the clearest Rule-of-2 extractions. The two print-document builders share a per-package line shape that should be one helper. Beyond duplication, the `savedPackageMoves` metric (M7) is the most consequential finding because it presents a fabricated number to staff as a real savings count. Naming is clean (no banned standalone names in P7 code). No god files — `package-operations.ts` (253 lines) and `print-batches.ts` (128 lines) are well under the 500-line split threshold. Comment quality is good — no narration or change-explanation comments in P7 additions.
