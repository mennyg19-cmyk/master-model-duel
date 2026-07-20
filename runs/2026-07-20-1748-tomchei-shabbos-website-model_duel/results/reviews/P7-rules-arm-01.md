# Reviewer specialist — Rules

**Arm:** arm-01
**Tree / phase:** P7 — Package engine live (per `shared/phases/PHASE-P7-EXPECTED.md`)
**Arm rules list:** ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol
**Output:** `results/reviews/P7-rules-arm-01.md`

Findings only. No fixes. Blind to model name.

## Summary

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 5 |
| Low | 7 |
| **Total** | **14** |

## High

### H1 — PDF renderer silently strips non-ASCII text (data loss in printed artifact)
`src/domain/print-batches.ts` — `escapePdfText` does `value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "")` before drawing recipient name, customer, greeting, and product text into the PDF. Any non-Latin character (Hebrew recipient/greeting on a Purim site, accented Latin outside ASCII) is dropped before rendering; a fully non-Latin recipient or greeting renders as an empty string in the printed slip/label/card.
- Violates **ponytail** "Never cut: data-loss prevention" and **clean-code** anti-hallucination ("Do not claim 'fixed/passed/working' without tool output or running-app evidence" — the smoke only asserts `%PDF-1.` magic bytes, not legible text).
- The payload JSON preserves the bytes; only the user-visible PDF loses them, so the defect is invisible unless you open the PDF.

### H2 — Bulk status conflicts are silently dropped from the UI
`src/components/fulfillment-board.tsx` — `post()` reads `payload.error` only on `!response.ok`; on `response.ok` it shows the canned `success` string and `window.location.reload()`. `bulkAdvancePackageStage` returns `{ applied, conflicts }`, but per-package transition failures (e.g. a `NEW` package advanced straight to `SENT`, which `ALLOWED_PACKAGE_TRANSITIONS` rejects) come back inside an `ok` response and are never surfaced. Staff see "Selected packages advanced to SENT" even when every package conflicted.
- Violates **clean-code** error handling ("Error messages say what went wrong AND what the expected state was") and **workflow** "Verify in the running app — an empty 200 is not working."

## Medium

### M1 — Write side effect behind a GET + read-only permission
`src/app/(admin)/admin/fulfillment/page.tsx` — `FulfillmentPage` (a GET render) calls `materializeMissingFinalizedOrders(db)`, which creates `Package`/`PackageLine`/`PackageAudit` rows. The route guards with `requirePermission("admin:view")`, so a read-only viewer triggers package-materialization writes on every board load. No DECISION-LOG entry records this choice.
- Violates **workflow** "Never silently choose business logic" and least-privilege; **clean-code** "No 'just in case' code — every line must have a reason" (the page is the wrong trigger for a backfill).

### M2 — Undocumented "boxes saved by grouping" business calculation
`src/app/(admin)/admin/fulfillment/page.tsx` — `groupedSavings += Math.max(0, giftCount - 1)` is presented as "boxes saved by grouping." That formula assumes one gift per box in the un-grouped case and one box per group otherwise — a domain assumption with no DECISION-LOG entry, no constant, and no comment.
- Violates **workflow** "Never silently choose business logic (calculations, domain rules) — log in DECISION-LOG.md and flag."

### M3 — Missing phase smoke evidence artifact
`shared/phases/PHASE-P7-EXPECTED.md` says evidence lives at `arms/{id}/workspace/.scratch/PHASE-P7-SMOKE.md`. No such file exists in `arms/arm-01/workspace/.scratch/`. The `scripts/p7-smoke.ts` harness exists, but the gate evidence file does not.
- Violates **workflow** gate discipline ("An expectation checklist item is unchecked or lacks evidence") and expectation-file protocol.

### M4 — Skipped-order error reasons computed then discarded
`src/domain/package-operations.ts` — `materializeMissingFinalizedOrders` collects `skipped: { orderId, reason }[]` with real error messages, but `fulfillment/page.tsx` only renders `materialization.skipped.length` as a generic "N older finalized orders need recipient or fulfillment repair" banner. The actual reasons never reach the staff user.
- Violates **clean-code** error handling ("No swallowed errors") and **workflow** verify-in-app.

### M5 — Inconsistent HTTP status mapping (409 as catch-all)
`src/app/api/admin/print-batches/route.ts` and `src/app/api/admin/packages/actions/route.ts` — every non-`AccessDeniedError` failure returns 409, including "That filing group has no printable packages" (a 404/422), "That order has no printable packages" (404), and "Split quantity must be a positive whole number" (422). 409 Conflict is reserved for concurrent/version conflicts.
- Violates **clean-code** "One error-handling approach per project" / inconsistent patterns.

## Low

### L1 — Magic values in PDF renderer
`src/domain/print-batches.ts` — `renderArtifactPdf` embeds unexplained literals: `50 750 Td`, `0 -14 Td`, `/F1 11`, MediaBox `[0 0 612 792]`, `.slice(0, 48)` page cap, `padStart(10)`/`padStart(6)` for xref. No named constants or comments for the letter-size / line-height / 48-page cap.
- Violates **clean-code** "Magic values — named constants / enums."

### L2 — String-literal stage values instead of enum
`src/domain/print-batches.ts` — `loadPrintablePackages` uses `stage: { notIn: ["SENT", "PICKED_UP"] }` while `package-operations.ts` uses `PackageStage.SENT` / `PackageStage.PICKED_UP` for the same concept. Drift risk if the enum changes.
- Violates **clean-code** "Type/schema drift — centralize types, single source of truth."

### L3 — Redundant defensive slice
`src/domain/package-operations.ts` — `bulkAdvancePackageStage` does `requests.slice(0, 100)`; the route's zod schema already enforces `.max(100)`. Dead defensive code for a condition the schema prevents.
- Violates **clean-code** "No defensive code for conditions that can't happen."

### L4 — Inconsistent locking between split and regroup
`src/domain/package-operations.ts` — `splitPackage` opens with `SELECT ... FOR UPDATE`; `regroupPackages` does not, relying only on optimistic `version` increment. Two concurrent regroups on overlapping packages can race without a row lock. Same module, two patterns.
- Violates **clean-code** "Inconsistent patterns — pick one, apply everywhere."

### L5 — Silent cap on backfill batch
`src/domain/package-operations.ts` — `materializeMissingFinalizedOrders` uses `take: 200` with no indication to the caller that more remain. A backlog >200 silently leaves orders un-materialized across page loads.
- Violates **clean-code** magic values and **workflow** verify-in-app (silent truncation).

### L6 — Magic `orders.slice(0, 12)` in reprint UI
`src/components/fulfillment-board.tsx` — the per-order reprint list renders only the first 12 orders with no "more" affordance or count. An order past index 12 cannot be reprinted from the board.
- Violates **clean-code** magic values; minor **workflow** verify-in-app gap.

### L7 — Copy-paste naming in smoke harness
`scripts/p7-smoke.ts` — `authSecret = "p5-local-smoke-signing-key-2026"` keeps the `p5` prefix from the prior phase's smoke script. Functional, but misleading in a P7 artifact.
- Violates **vocabulary** naming and **clean-code** "No copy-paste patterns with minor variations — extract the pattern."

## Notes

- `package-stage.ts` transition table correctly keeps `SENT`/`PICKED_UP` terminal and never auto-advances on print; `print-batches.ts` never calls `advancePackageStage`. P7 invariant #6 (printing ≠ shipped) is respected in code.
- Nightly idempotency via `runKey` unique + `P2002` catch in `createNightlyPrintBatch` is sound; S3 smoke asserts replay equality.
- `splitPackage`/`regroupPackages` both write `PackageAudit` rows; S1 smoke asserts retained audits. Audit retention invariant is met.
