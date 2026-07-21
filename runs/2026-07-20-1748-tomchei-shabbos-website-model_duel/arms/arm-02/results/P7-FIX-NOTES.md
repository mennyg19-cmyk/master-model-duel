# P7 Fix Pass — arm-02

**Input:** `results/AGGREGATE-REVIEW-P7.md` · **Single pass** · Date: 2026-07-21

## Blockers — all fixed

| # | Fix | Where |
|---|---|---|
| B1 | `regroupPackages` now takes `seasonId` and filters `where: { id: { in: ids }, seasonId }` — a package id from another season is not returned and the length check rejects with 409. Route resolves the open season first. | `lib/packages/actions.ts`, `app/api/admin/packages/regroup/route.ts` |
| B2 | `toPrintPackage(entry, forOrderId?)` narrows a package's line list to one order. `buildOrderPackingSlip` and every `PACKING_SLIP` draft (`packingSlipDraft`, nightly, reprint) pass the order id, so a slip for order X never lists items order Y paid for — even in a finalize-merged box. Labels/slips/cards still show the full box. No render change needed once the payload is scoped. | `lib/print/batches.ts` |
| B3 | Fulfillment "Print production" list now filters `printArtifact.findMany({ where: { printBatch: { seasonId: season.id } } })`. Backed by new `PrintBatch.seasonId` column (see M2). | `app/(admin)/admin/fulfillment/page.tsx` |
| B4 | Channel bulk move resolves target ids inside the transaction, then `updateMany` + `packageAudit.createMany` (action `stage_advanced`, detail `via: "channel_bulk"`) — same audit invariant as single advance / split / regroup. | `app/api/admin/packages/bulk-stage/route.ts` |

## Majors fixed

- **M1** `splitPackage` / `advancePackageStage` / `regroupPackages` all take `seasonId` and look up with `findFirst({ id, seasonId })`; split/stage/regroup/bulk-stage routes resolve `getOpenSeason()` (409 when none). Cross-season CUIDs 404.
- **M2** `PrintBatch.seasonId` (FK to Season, `@@index([seasonId, createdAt])`) — migration `20260721100000_p7_fix_print_batch_season` backfills existing rows to the open season. Artifact download route scoped: `findFirst({ id, printBatch: { seasonId: openSeason.id } })`.
- **M3 (+m5)** Reprint runKeys are minute-stable (`reprint-order-{id}-{yyyymmddhhmm}`) and `createOrReplayBatch` recovers from P2002 by replaying the winner — double-click/same-minute reprints return the existing batch instead of growing PrintBatch unboundedly or throwing.
- **M4** `ids` bulk-stage branch runs in one `db.$transaction`: logical skips (stale version, wrong stage, missing) still reported per-id, but any unexpected failure rolls back the whole batch including the AuditLog row.
- **M5 (+M10)** `package-board.tsx` deletes its local `NEXT_STAGES` + terminal re-derivation and calls domain `allowedNextStages`; `BoardPackage.stage`/`methodKind` now typed `PackageStage`/`FulfillmentKind` (SENT/PICKED_UP rows now render their [] state correctly from the domain).
- **M6** `groupArtifacts` pushes into the Map bucket instead of re-spreading per entry (O(n)).
- **M7** `packingSlipDrafts` builds an orderId→packages Map in one pass (was O(orders × packages)).
- **M8** `reprintOrder` builds its own packing slip via `packingSlipDraft(order, packages)` — no more building slips for every order then filtering.
- **M9 (+m19)** `fulfillment-actions.tsx` `post<T>` is generic; all `never` casts gone. `StageCounts` = `Record<PackageStage, number>`; `methodKind: FulfillmentKind` (`ChannelSummary.kind` typed in `lib/packages/board.ts`).
- **M11** Greeting-card draft construction deduped into `greetingCardDraft()` used by both `groupArtifacts` and `reprintOrder`.

## Not addressed (minors, out of single-pass budget)

m1–m4, m6–m18 from the aggregate (defence-in-depth FINALIZED check, filename sanitization nit, PDF Latin-1 fidelity, nightly UTC-day window, split-panel client guard, render exhaustiveness guard, misc dedupe/comment nits). m5 (reprint P2002) landed with M3.

## Verification

- `npm run ci` — lint, typecheck, migration guard (`No difference detected`), 51/51 unit tests PASS.
- Re-smoke S1–S3: `npx tsx .scratch/p7-smoke.ts` → **25/25 ALL PASS** (`.scratch/PHASE-P7-SMOKE.md`). Smoke fixture recipients now run-stamped so re-runs don't finalize-merge into prior runs' NEW packages.
- Targeted blocker proof: `.scratch/p7-fix-verify.ts` → **8/8 ALL PASS** — cross-order merged box slip excludes the other order (B2), cross-season regroup 409 (B1), foreign-season stage 404 (M1), foreign artifact download 404 + dashboard exclusion (B3/M2), channel bulk writes PackageAudit (B4), same-minute reprint replays one batch (M3).
