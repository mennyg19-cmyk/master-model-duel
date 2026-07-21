# P7 Quality Review — arm-03

Scope: `arms/arm-03/workspace/` against `shared/phases/PHASE-P7-EXPECTED.md`.
Mode: findings only. Smoke (`arms/arm-03/results/PHASE-P7-SMOKE.md`) reports 16/16 PASS; this review looks past smoke at the code that makes it pass.

## Headline

Two complete, parallel package/print engines were built and both are wired into routes. The **live** engine (`src/lib/ops/*`) backs every P7 UI component and the smoke run. The **dead** engine (`src/lib/packages/*` + `src/lib/print/*`) is mounted on orphaned routes no UI calls, yet it is the one that implements the season scoping, method-terminal guards, partial-quantity split, and correct PDF page sizes that the live engine is missing. The contestant built the better implementation and then wired in the weaker one.

| Concern | Live engine (`lib/ops/*`) | Dead engine (`lib/packages/*` + `lib/print/*`) |
|---|---|---|
| Season scoping | None — list/dashboard/regroup/split operate across all seasons | Season-scoped everywhere |
| Method-terminal guard (SENT vs PICKED_UP) | Missing | Enforced in `bulk-stage` route + `fulfillment-actions.tsx` |
| Split | Whole-item only; resets split-off to `NEW` | Partial-quantity; preserves source stage |
| Regroup key-match check | None (any same-order packages) | Requires matching recipient/address/method/greeting |
| Regroup audit retention | Donor `PackageAuditLog` rows cascade-deleted | Donor rows survive (donor kept, emptied) |
| PDF page size | Letter for everything (cards + labels wrong size) | `CARD_5X7`, `LABEL_4X6`, `LETTER` |
| PDF storage | Base64 data URL in JSONB payload | Rendered on demand from structured payload |

## Findings

### F1 — Two competing engines, both mounted (clean-code: duplicated logic, inconsistent patterns, dead code)

- `src/lib/ops/packages.ts` (`listPackages`, `splitPackage`, `regroupPackages`, `bulkAdvancePackageStage`, `fulfillmentChannelDashboard`) — `Result<T>` return style, `FOR UPDATE` row locks.
- `src/lib/packages/actions.ts` + `src/lib/packages/board.ts` (`splitPackage`, `regroupPackages`, `advancePackageStage`, `listPackages`, `channelSummaries`) — `ActionError` throw style, `updateMany` optimistic concurrency.
- Same split for print: `src/lib/ops/print-batch.ts` vs `src/lib/print/batches.ts` + `src/lib/print/render.ts`.

Route wiring (verified by import grep):

- Live (`lib/ops`): `GET/POST /api/admin/packages`, `GET/POST /api/admin/packages/[id]`, `GET /api/admin/fulfillment`, `GET/POST /api/admin/print-batches`, `GET /api/admin/print-batches/artifacts/[id]`.
- Dead (`lib/packages` + `lib/print`): `POST /api/admin/packages/[id]/split`, `POST /api/admin/packages/[id]/stage`, `POST /api/admin/packages/regroup`, `POST /api/admin/packages/bulk-stage`, `GET /api/admin/print-artifacts/[id]`, `GET /api/admin/orders/[id]/packing-slip`.

UI consumers (verified): `package-board.tsx`, `fulfillment-dashboard.tsx`, `print-batches.tsx` call **only** the live `lib/ops` endpoints. `FulfillmentActions` (`fulfillment-actions.tsx`, the one component that uses the dead engine's `bulk-stage` route) is rendered nowhere. `channelSummaries` is imported by no route. The dead engine is fully orphaned at the UI layer.

Net: ~700 lines of dead or competing code; two error styles; two concurrency strategies; two PDF renderers. Pick one engine, delete the other.

### F2 — Live engine is not season-scoped (correctness / authorization)

`lib/ops/packages.ts`:
- `listPackages` (`packages.ts:56`) has no `seasonId` filter — the package board shows packages from every season mixed together.
- `fulfillmentChannelDashboard` (`packages.ts:110`) groups across all seasons — the "Open packages / Shipped / Printed awaiting ship" summaries are global, not current-season.
- `splitPackage` (`packages.ts:211`) and `regroupPackages` (`packages.ts:320`) take a package id and operate with no season check.

The dead `lib/packages/*` versions all take `seasonId` and scope `where: { order: { seasonId } }`. The UI calls the unscoped ones. An admin on the package board sees and mutates cross-season data with no season authorization boundary.

### F3 — Regroup has no grouping-key match check (data integrity)

`lib/ops/packages.ts:320` `regroupPackages` only verifies `p.orderId !== orderId` (same order) and that no package is `SENT`/`PICKED_UP`. It does **not** check that the packages share recipient/address/method/greeting. An admin can regroup a SHIP-to-NY package with a SHIP-to-CA package on the same order; the donor items move into the target package and now ship to the target's address — wrong destination, silently. The dead `lib/packages/actions.ts:240` checks `packageMatchKey` equality and rejects mismatched regroups. The UI (`package-board.tsx:110` `regroup()`) calls the unchecked live version.

### F4 — Regroup loses donor audit trail (audit)

`lib/ops/packages.ts:371` creates a `PackageAuditLog` row on each donor ("Regrouped into …"), then `package.delete` at line 380 deletes the donor package. `PackageAuditLog.package` is `onDelete: Cascade` (`schema.prisma:617`), so the just-written donor audit rows are cascade-deleted with the donor. The target's audit row and the global `AuditLog` (`PACKAGE_REGROUPED`) survive, but the per-package history on the donor is lost. EXPECTED S1 spirit ("audit retained") is only partially met; smoke does not cover regroup audit retention (only S1f covers split).

### F5 — Split resets split-off package to NEW (correctness)

`lib/ops/packages.ts:260` hardcodes `stage: PackageStage.NEW` on the new package, ignoring `source.stage`. Splitting a `PRINTED` or `PACKED` package silently demotes the split-off half back to `NEW` — it must be re-printed and re-packed. The dead `lib/packages/actions.ts:129` copies `stage: source.stage`. Smoke S1c/S1e passes because the test splits a `NEW` package, so the regression is unobserved.

Also: `splitPackage` (`packages.ts:243`) injects `${source.greeting}#split-<ts>` into the `groupingKey` but stores `greeting: source.greeting` (line 259) — the key and the stored greeting disagree. The dead engine's `suffixedKey(groupingKey, "split")` keeps the greeting intact and suffixes only the key.

### F6 — No method-terminal guard on live stage transitions (domain rule)

`lib/orders/package-stages.ts:12` `ALLOWED` permits both `PACKED → SENT` and `PACKED → PICKED_UP` regardless of fulfillment method. The live UI (`package-board.tsx:156` and `fulfillment-dashboard.tsx:106`) exposes "Mark SENT" and "Mark PICKED_UP" for every package. An admin can mark a `PICKUP` package `SENT` or a `SHIP` package `PICKED_UP` via the package board or fulfillment dashboard. The dead `bulk-stage/route.ts:46-57` enforces `PICKED_UP` only for `PICKUP` and `SENT` only for non-`PICKUP` — but that route is only called by the unused `FulfillmentActions` component. EXPECTED #6 ("print ≠ shipped") is preserved, but the method-specific terminal rule is not.

### F7 — Nightly batch targets all unshipped packages, not tonight's new (semantics)

`lib/ops/print-batch.ts:300` loads `stage: { notIn: ["SENT", "PICKED_UP"] }` — i.e. `NEW` + `PRINTED` + `PACKED`. The nightly batch therefore regenerates slips/labels/cards for every package that has ever been printed but not shipped, every night. Smoke S3a shows 5035 packages / 1037 artifacts in one nightly run — that is the entire unshipped backlog, not tonight's new work. The dead `lib/print/batches.ts:245` correctly loads only `stage: "NEW"`. The idempotency key (`nightly:<seasonId>:<day>`) prevents duplicate batches on the same day, but day 2's batch reprints day 1's already-printed packages. Wasteful and confusing for staff.

### F8 — Greeting cards and labels render at letter size (vs. EXPECTED #5)

`lib/ops/print-batch.ts` builds all artifacts via `buildSimplePdf(spec.lines)` (`pdf.ts:5`), which always emits a single letter-size page (`MediaBox [0 0 612 792]`). The `payload.stock = "card"` field for `GREETING_CARDS` is a label only — the actual PDF is letter-size, not card stock. Labels are likewise letter-size, not 4×6. The dead `lib/print/render.ts:94` renders cards at `CARD_5X7` and labels at `LABEL_4X6`. EXPECTED #5 ("Greeting-card PDFs per filing group on card stock") is nominally met (a `stock` field) but not actually delivered in the PDF bytes. Smoke S2b only checks "download as PDF", not page dimensions.

### F9 — PDFs stored as base64 data URLs in JSONB (storage)

`lib/ops/print-batch.ts:252` stores `pdfToDataUrl(pdf)` (base64 of the full PDF) inside the `PrintArtifact.payload` JSONB column. For the smoke run that is 1037 artifacts, each carrying a full PDF as base64 (~33% overhead over raw bytes). The dead engine stores a structured payload and renders on demand. The live choice bloats the DB and couples the artifact to a specific render. A `Cache-Control` header is absent on the live artifact route (`print-batches/artifacts/[id]/route.ts`) — the dead route sets `private, max-age=60`.

### F10 — `print-batches.tsx` `stillUnshipped` indicator is always true (UI bug)

`print-batches.tsx:51` reads `json.packageStages`, but the live `runNightlyPrintBatch`/`reprintFilingGroup`/`reprintOrder` responses (`lib/ops/print-batch.ts`) return no `packageStages` field. `stages` is therefore always `[]`, so `unshipped = stages.every(...)` is always `true`. The "stillUnshipped=true" in the UI message is meaningless. `packageStagesForBatch` (`print-batch.ts:462`) exists in the live engine but is called by nothing — dead code that was meant to feed this indicator.

### F11 — `print-batches.tsx` `created` always true for reprints (UI bug)

`print-batches.tsx:54` prints `created=${json.created ?? true}`. The live `reprintFilingGroup`/`reprintOrder` always return `created: true` (`persistBatch` with `idempotent: false`), so reprints always report `created=true`. Only the nightly path can return `created=false` (idempotent replay). The UI label is misleading for reprints.

### F12 — `reprint-order` UI allows empty orderId (UX)

`print-batches.tsx:81-93` binds `orderId` to a free-text input defaulting to `""`. The route schema (`print-batches/route.ts:26`) requires `orderId: z.string().min(1)`, so an empty submit 400s. No client-side guard, no dropdown of valid order ids.

### F13 — `bulk-stage` methodId branch skips global AuditLog (inconsistent audit)

`bulk-stage/route.ts:73-86` (the dead engine's methodId bulk path) writes `PackageAuditLog` via `createMany` but never writes a global `AuditLog` row with `AuditAction.PACKAGE_STAGE_CHANGED`, unlike `advancePackageStage` (`lib/packages/actions.ts:330`) which writes both. Channel-bulk moves would be missing from the global audit trail. (Moot while the route is unreachable from UI, but becomes a bug the moment `FulfillmentActions` is wired in.)

### F14 — `reprintFilingGroup` where-clause is convoluted (readability)

`lib/ops/print-batch.ts:349-359` builds:

```
fulfillmentMethodId: method?.id,
...(method ? {} : { fulfillmentMethod: { code: group } }),
```

When `method` is found, `fulfillmentMethodId` is set and the spread is `{}`. When not found, `fulfillmentMethodId` is `undefined` (Prisma ignores it) and the code filter applies. Correct, but the `undefined`-as-ignore + conditional spread is hard to read. A plain `where: method ? { fulfillmentMethodId: method.id } : { fulfillmentMethod: { code: group } }` would be clearer.

### F15 — `buildSimplePdf` non-ASCII handling (edge case)

`lib/print/pdf.ts:5` uses Helvetica (Type1, WinAnsiEncoding) and escapes only `\`, `(`, `)`. Recipient names or greetings with characters outside WinAnsi (e.g. `é`, `ñ`, curly quotes) will not render correctly. The dead engine's `renderPdf` has the same font limitation but at least wraps text. Low severity for the current seed data, but a latent rendering bug for international names.

## What works

- Print never mutates `Package.stage` — confirmed in `lib/ops/print-batch.ts:273` (`stagesMutated: false`) and the artifact route is read-only. EXPECTED #6 / UR-001 / G-001–G-004 hold.
- Nightly idempotency via unique `runKey` works (smoke S3a, second run `created: false`).
- `splitPackage` retains source audit and writes `PACKAGE_SPLIT` global audit (smoke S1f).
- Per-package optimistic version checks are present on both engines.
- Stage transition graph (`package-stages.ts`) correctly forbids backwards moves and makes `SENT`/`PICKED_UP` terminal.

## Suggested fix order (if acted on)

1. Delete the dead engine (`lib/packages/*`, `lib/print/*`, the six orphaned routes, `fulfillment-actions.tsx`) — or conversely switch the UI onto the dead engine and delete `lib/ops/*`. Do not keep both.
2. Add season scoping to whichever engine survives (F2).
3. Add grouping-key match check to regroup (F3) and stop cascade-deleting donor audit (F4).
4. Preserve source stage on split (F5).
5. Add method-terminal guard to stage transitions (F6).
6. Scope nightly batch to `NEW` only (F7).
7. Render cards at `CARD_5X7` and labels at `LABEL_4X6` (F8), and store structured payloads + render on demand (F9).
8. Wire `packageStagesForBatch` into the print-batches route response or drop the `stillUnshipped` indicator (F10).
