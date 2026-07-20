# P7 Clean-code review — arm-02

Reviewer specialist, blind to model name. Scope: P7 package-engine surface in `arms/arm-02/workspace/` — `lib/packages/*`, `lib/print/*`, `lib/pdf.ts`, `lib/domain/package-stage.ts`, `components/admin/{package-board,fulfillment-actions}.tsx`, `app/(admin)/admin/{packages,fulfillment}/page.tsx`, `app/api/admin/packages/**`, `app/api/admin/print-{batches,artifacts}/**`, `app/api/admin/orders/[id]/packing-slip/route.ts`, plus schema/permissions/layout deltas. Findings only, no fixes.

## MEDIUM

### M1. `fulfillment-actions.tsx` — `post` is `never`-typed instead of generic
`post(body, url, note: (result: never) => string)` casts `result.body as never` at every call site (lines 26, 32, 58, 81, 101, 120). This is a non-generic function shoehorned into three body shapes via `as never`. Violates anti-AI-tics ("no redundant type assertions the compiler already guarantees") and discards the type safety the call-site callbacks then re-assert (`(body: { moved: number }) => ...`). A `post<T>(body, url, note: (body: T) => string)` would remove every cast.

### M2. `package-board.tsx` — board re-implements `allowedNextStages` from the domain
`NEXT_STAGES` (lines 34–38) plus the inline terminal re-derivation `entry.methodKind === "PICKUP" ? "PICKED_UP" : "SENT"` (line 143) duplicates `lib/domain/package-stage.ts` `allowedNextStages(current, kind)` and `terminalStageFor(kind)`. The board's table omits `SENT`/`PICKED_UP` rows and re-derives terminal locally, so the forward-stage rules now live in two places. Drift risk: if stage ordering changes in the domain, the board silently disagrees.

### M3. `package-board.tsx` — `stage`/`methodKind` loosened to `string`
`BoardPackage.stage: string` and `methodKind: string` (lines 25, 30) drop the `PackageStage` / `FulfillmentKind` enums that own these values. The rest of the P7 surface (`board.ts`, `actions.ts`, `package-stage.ts`, the route zod schemas) keeps the enums. Type/schema drift — the component compares against string literals (`"NEW"`, `"SENT"`, `"PICKED_UP"`, `"PICKUP"`) the compiler can't check against the enum.

### M4. `lib/print/batches.ts` — greeting-card draft logic duplicated
The `withGreeting = packages.filter(e => e.greeting.trim() !== "")` filter + `GREETING_CARDS` draft construction appears in both `groupArtifacts` (lines 84–92) and `reprintOrder` (lines 220–230). Same payload shape, same filter, two copies. Rule of 2 is met; a `greetingCardDraft(packages, group, generatedAt, orderId)` helper would collapse them.

## MINOR

### m1. `orderRef` helper duplicated across layers
`orderRef(order)` is defined in `lib/print/batches.ts` (line 27) and re-inlined as `line.order.orderNumber ? \`#${line.order.orderNumber}\` : line.order.draftReference` in `app/(admin)/admin/packages/page.tsx` (line 125). Two call sites, two copies — should be one shared helper.

### m2. `ORDER-${orderRef(order)}` filing-group key duplicated
Constructed in `packingSlipDrafts` (line 113) and again in `reprintOrder` (line 218). Same string template, two sites.

### m3. `lib/print/batches.ts` — artifact summary `include` repeated 3×
`include: { artifacts: { select: { id: true, filingGroup: true, kind: true, orderId: true } } }` appears at lines 137, 174, and 189. A named `artifactSummarySelect` constant would dedupe.

### m4. `NOT_DONE` duplicates the non-terminal concept
`lib/print/batches.ts` line 141 `NOT_DONE: PackageStage[] = ["NEW", "PRINTED", "PACKED"]` re-encodes the "not terminal" idea that `lib/domain/package-stage.ts` already owns via `STAGE_ORDER` / `terminalStageFor`. A helper there would centralize it.

### m5. `lib/packages/board.ts` — `STAGES` array + `stageCounts` literal duplicated
`STAGES` (line 10) lists the five stages; `stageCounts: { NEW: 0, PRINTED: 0, PACKED: 0, SENT: 0, PICKED_UP: 0 }` (line 111) re-lists them as an object literal. The literal should be derived from `STAGES` (or `Object.fromEntries`) so a stage add/edit touches one place.

### m6. `lib/packages/board.ts` — comment/code mismatch in `channelSummaries` filter
Line 131 comment: "Only channels with actual packages (or active methods) are worth a row." Line 132 filter is `summary.packages > 0 || summary.gifts > 0` — `isActive` on the method is never consulted, so the "active methods" half of the comment is untrue.

### m7. `lib/packages/actions.ts` — magic `#` separator
`baseKey` (line 23) splits `groupingKey` on `"#"` and `suffixedKey` (line 27) rejoins with `#tag-…`. The `#` delimiter is an implicit contract between these two functions and the grouping engine; a named constant would make the coupling visible.

### m8. `fulfillment-actions.tsx` — `StageCounts` re-declares stage keys
`StageCounts` (line 10) hardcodes the five stage keys as a local type, while `ChannelSummary.stageCounts` is `Record<PackageStage, number>`. The local copy can drift if the enum changes.

### m9. `bulk-stage` route — `ids` branch audit surface differs from `orders/bulk`
The `ids` branch (lines 64–83) writes only a single summary `AuditLog` (per-package audit is the `PackageAudit` row written inside `advancePackageStage`). `app/api/admin/orders/bulk/route.ts` writes a per-order `AuditLog` inside each per-id transaction plus a summary. Different audit surfaces for parallel "bulk action" endpoints — a pattern inconsistency worth a deliberate decision.

### m10. `lib/print/batches.ts` — `reprintOrder` redundantly filters `packingSlipDrafts`
Line 231 `(await packingSlipDrafts(packages, generatedAt)).filter((draft) => draft.orderId === orderId)`. `packages` is already scoped to the one order (line 212), so `packingSlipDrafts` can only return that order's draft; the filter is dead defense.

## Notes (not findings)

- `lib/pdf.ts` is clean: stdlib-only (ponytail ladder), single source for page sizes, documented xref/stream layout.
- `lib/domain/package-stage.ts` is tight: one `STAGE_ORDER`, exhaustive forward/terminal rules, covered by `tests/package-stage.test.ts`.
- `lib/packages/actions.ts` transactions each write `PackageAudit` inside the same tx — correct audit coupling.
- Print path is read-only w.r.t. `Package` (G-002) — `batches.ts` only creates `PrintArtifact` rows; `render.ts` reads snapshots; `print-artifacts/[id]` and `packing-slip` routes are GET-only. No stage advance from print.

## Counts

| Severity | Count |
|---|---|
| Medium | 4 |
| Minor | 10 |
| **Total** | **14** |
