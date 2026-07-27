# P7 Quality Review — arm-05

Reviewer specialist: Quality. Scope: P7 only. Findings only — no fixes.

Plan ref: `shared/MERGED-BUILD-PLAN.md` § P7. Expected ref: `shared/phases/PHASE-P7-EXPECTED.md`.

Severity scale: critical / high / medium / low / info.

## Summary counts

- critical: 0
- high: 3
- medium: 7
- low: 4
- info: 0

## Findings

### H1 — high — Nightly print batch includes already-shipped packages

- Location: `lib/print-batches.ts:18-28`, `scripts/smoke-p7.ts:78-104`
- Claim: EXPECTED #4 / #6 require a nightly print batch for packages needing printing, and "printing never auto-advances shipped state". The batch queries every active package regardless of status, so SENT and PICKED_UP packages get fresh slips, labels, and greeting cards reissued every night.
- Evidence: `createNightlyPrintBatch` runs `transaction.package.findMany({ where: { isActive: true }, ... })` with no `status` filter. `PackageStatus` includes `NEW`, `PRINTED`, `PACKED`, `SENT`, `PICKED_UP`; all are `isActive: true`. Each new nightly batch (keyed by date) re-enrolls every active package into a new `PrintArtifact` per filing group. The smoke only seeds NEW packages and never advances one to SENT before building a batch, so the regression is unobserved.

### H2 — high — PDF content identical for slips, labels, and greeting cards

- Location: `lib/print-batches.ts:64-93`, `lib/print-batches.ts:99-127`
- Claim: EXPECTED #4 / #5 require "separate PDF per filing group (slips, labels)" and "greeting-card PDFs per filing group on card stock". All three artifact kinds render the same two-line-per-package text listing; there is no label layout, no greeting-card layout, and no packing-slip order contents.
- Evidence: `printArtifactDocument` builds `lines: packages.flatMap(...)` with `[recipientName · method, "Order ... · N item(s) · greeting"]` for every `PrintArtifactKind`. `orderPackingSlipDocument` reuses the same line shape. `createPdf` emits one Helvetica text page with up to 55 of these lines. Nothing distinguishes a PACKING_SLIP from a LABEL from a GREETING_CARD — same content, same font, same single-page layout. A shipping label needs an address block + barcode area; a greeting card needs the greeting as the primary content; a packing slip needs order line items. None of those distinctions exist.

### H3 — high — `advancePackageStatus` is not transactional with its audit

- Location: `lib/package-operations.ts:153-167`
- Claim: EXPECTED #2 requires "per-package status advance" with audit retained. The status update and the audit insert run as separate statements outside a transaction; a failure between them leaves an unaudited status change.
- Evidence: `advancePackageStatus` does `prisma.package.findUniqueOrThrow(...)`, then `prisma.package.updateMany(...)`, then `prisma.packageAudit.create(...)`. No `prisma.$transaction` wraps the three calls. If the audit insert throws (DB error, network blip), the package status is already committed with no `package.status_changed` row. The same non-atomic pattern is used by `updatePackageStatuses` (line 169-178), which `Promise.all`s multiple `advancePackageStatus` calls — each one independently non-atomic.

### M1 — medium — Package board capped at 250 rows, no pagination

- Location: `lib/package-operations.ts:121-131`, `app/admin/packages/page.tsx:34-46`
- Claim: EXPECTED #3 requires a "fulfillment channel dashboard". Plan G-024 targets 5,000+ packages at crunch. The board fetches 250 packages with `take: 250` and no `skip`, no cursor, and no pagination control in the UI.
- Evidence: `packageDashboard` calls `prisma.package.findMany({ where: { isActive: true }, ..., take: 250 })`. The packages page renders `packages.map(...)` directly. Beyond 250 active packages, the board silently drops the rest — no count, no "showing 250 of N" indicator, no next-page control. Channel summaries (`channels`, `productionUnits`, `savedPackageMoves`) are also computed from the 250-row window, so the KPIs undercount at scale.

### M2 — medium — `regroupPackages` allows merging across different recipients/methods/greetings

- Location: `lib/package-operations.ts:219-252`
- Claim: UR-001 defines a package by a recipient/address/method/greeting grouping key. EXPECTED #2 says "regroup". Regrouping two packages with different methods/addresses/greetings produces a target package whose `groupingKey`, `fulfillmentMethodId`, `addressId`, `recipientName`, and `greeting` no longer describe its lines.
- Evidence: `regroupPackages` validates only `isActive`, `status: "NEW"`, and `new Set(packages.map(p => p.orderId)).size === 1`. It does not compare `groupingKey`, `fulfillmentMethodId`, `addressId`, `recipientName`, or `greeting` across the selected packages. The target keeps its own fields; source lines are moved in regardless. A manager can merge a SHIP package with a LOCAL_DELIVERY package from the same order, producing one package whose lines were meant for two different fulfillment channels.

### M3 — medium — `PICKED_UP` status not reachable from the package board UI

- Location: `app/admin/packages/page.tsx:117-120`, `lib/package-operations.ts:10-16`
- Claim: EXPECTED #2 requires "per-package status advance (optional stages)". `PackageStatus` includes `PICKED_UP` (the pickup fulfillment terminal state), and `allowedTransitions` permits NEW/PRINTED/PACKED → PICKED_UP. The board exposes only Print, Pack, and Send buttons.
- Evidence: The page renders three per-row buttons: `Print` (→PRINTED, line 118), `Pack` (→PACKED, line 119), `Send` (→SENT, line 120). No button posts `status: "PICKED_UP"`. The `statusSchema` in `app/api/admin/packages/route.ts:6` accepts `PICKED_UP`, so the API supports it, but the UI never offers it. Pickup packages cannot be marked picked-up from the board.

### M4 — medium — Bulk status action offers only PRINTED

- Location: `app/admin/packages/page.tsx:109`
- Claim: EXPECTED #3 requires "bulk status actions" (plural). The board exposes a single bulk button that hardcodes `status: "PRINTED"`.
- Evidence: The "Mark selected printed" button posts `{ action: "bulk_status", packageIds: selected, versions: bulkVersions, status: "PRINTED" }`. No bulk Pack, bulk Send, or bulk Pick-up control. The backend `updatePackageStatuses` accepts any `PackageStatus`, but the UI never sends anything but PRINTED.

### M5 — medium — `splitPackage` does not increment the source package version

- Location: `lib/package-operations.ts:180-217`
- Claim: EXPECTED #2 requires per-package status advance with optimistic versioning. Splitting moves/decrements the source's lines but leaves `version` unchanged, so a stale client holding the pre-split version can still advance the source's status as if nothing changed.
- Evidence: The transaction creates `target`, updates `sourceLine` (decrement or reparent), and writes two `packageAudit` rows. No `transaction.package.update({ where: { id: source.id }, data: { version: { increment: 1 } } })`. The source's `updatedAt` changes via `@updatedAt`, but the integer `version` used by `advancePackageStatus`'s `where: { id, version, status, isActive }` does not. A concurrent `advancePackageStatus(source.id, oldVersion, "PRINTED", ...)` succeeds post-split because the version guard still matches.

### M6 — medium — `regroupPackages` does not increment the target package version

- Location: `lib/package-operations.ts:229-251`
- Claim: Same optimistic-versioning concern as M5, on the regroup target. The target's lines change (quantities incremented, new lines reparented in) but its `version` stays the same.
- Evidence: The loop updates source packages with `isActive: false, version: { increment: 1 }` (line 242) and writes audits. The target (`packages[0]`) is never `update`d — its `version` is not incremented despite line mutations. A stale client holding the target's pre-regroup version can still `advancePackageStatus` successfully.

### M7 — medium — Smoke S3 asserts the wrong package for "printed still unshipped"

- Location: `scripts/smoke-p7.ts:103-104`, `.scratch/PHASE-P7-SMOKE.md:11`
- Claim: EXPECTED S3 requires "printed package still shows unshipped" after the nightly batch. The smoke asserts `firstPackage.status !== "SENT"`, but `firstPackage` was never printed or advanced — it stayed NEW. The check passes trivially and does not exercise the claim.
- Evidence: `firstPackage` is the source of the split (line 71). After split, `firstPackage` remains NEW; only `split` (the target) is advanced through PRINTED → PACKED → SENT (lines 87-91). The S3 assertion `(await prisma.package.findUniqueOrThrow({ where: { id: firstPackage.id } })).then(p => p.status !== "SENT")` checks a package that was never touched. The "printed still unshipped" claim is not actually tested — no package is both printed AND asserted to remain unshipped through the batch run.

### L1 — low — No nightly cron endpoint wires `createNightlyPrintBatch`

- Location: `app/api/cron/` (no directory), `lib/print-batches.ts:12`
- Claim: Plan P7 deliverable says "Nightly print batch (UR-005)". The batch is only reachable via a manual POST to `/api/admin/print` from the admin UI; there is no cron route and no `vercel.json` cron registration.
- Evidence: `Glob app/api/cron/**` returns 0 files. `Glob vercel.json` returns 0 files. The only caller of `createNightlyPrintBatch` is `app/api/admin/print/route.ts:40` (manual) and `scripts/smoke-p7.ts:79` (test). Plan P11 owns "all 5 Vercel crons registered", so this may be deferred — but the P7 deliverable's "nightly" wording implies an automated trigger that does not exist yet.

### L2 — low — `splitPackage` only allows status NEW

- Location: `lib/package-operations.ts:186`
- Claim: EXPECTED #2 says "split a package" with no status constraint. The code rejects any package not in NEW status, so a manager cannot split a PRINTED or PACKED package (e.g., to pull one damaged item out).
- Evidence: `if (!source || !source.isActive || source.status !== "NEW") throw new Error("Only new active packages can be split.")`. The plan and EXPECTED do not restrict splitting to NEW packages. The UI additionally only shows the Split button when `status === "NEW"` (page.tsx line 117).

### L3 — low — `createPdf` truncates at 55 lines per page with no pagination

- Location: `lib/print-batches.ts:106`
- Claim: Plan G-024 targets 5,000+ packages. A nightly batch PDF for a filing group with more than ~27 packages (2 lines each) silently drops the rest.
- Evidence: `...document.lines.slice(0, 55).flatMap(...)` caps the content stream at 55 lines on a single page. No multi-page `Pages` tree growth, no `Break` operator, no chunking by filing group size. A 5,000-package filing group produces a 55-line PDF that omits ~4,973 packages.

### L4 — low — `fulfillmentMethod.upsert` called once per wire line in materialize

- Location: `lib/package-operations.ts:68-72`
- Claim: Performance — materializing a 100-line order upserts the same fulfillment method up to 100 times.
- Evidence: The loop over `checkout.lines` calls `transaction.fulfillmentMethod.upsert({ where: { code: recipient.method }, ... })` for every wire line. Methods repeat across lines; the upsert is idempotent but redundant. A `Map<string, FulfillmentMethod>` cache inside the transaction would avoid the round-trips.

## Notes

- `.scratch/PHASE-P7-STATUS.md` declares P7 "complete" and `npm run smoke:p7` passing S1–S3. The smoke file confirms S1 and S2 genuinely; S3's "printed still unshipped" assertion is mis-targeted (M7).
- Print-vs-status separation (EXPECTED #6) is correctly enforced: `createNightlyPrintBatch`, `printArtifactDocument`, `orderPackingSlipDocument`, `reprintArtifact`, and `reprintOrderPackingSlip` never mutate `Package.status`. The gap is content and scope (H1, H2, L3), not status side effects.
- Materialization on checkout finalization is wired correctly: `lib/checkout.ts:302` calls `materializeFinalizedOrder(transaction, session.orderId)` inside the checkout transaction. Grouping key uses recipient/address/method/greeting per UR-001 (`lib/packages.ts:8-15`).
- Regrouped source packages are marked `isActive: false` with version increment and audit (line 242-245), so their audit trail is retained as the status note claims. The target side of regroup is the open gap (M6).
