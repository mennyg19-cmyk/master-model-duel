# P7 Aggregate Review — arm-03

**Phase:** P7 — Package engine live (grouping UI, statuses, print batches, cards)
**Tree:** `arms/arm-03/workspace/`
**Inputs:** `results/reviews/P7-{security,quality,rules,clean-code}-arm-03.md`
**Method:** Union + dedupe by location+claim. Security highs become blockers. No new findings.

## Classification

- **Blocker** = High severity (cross-season IDOR / cross-season data leak / audit-integrity break / parallel-domain duplication with drift). Must fix before gate.
- **Major** = Medium severity (missing scoping, dead code, non-atomicity, god files, type drift). Fix in fix pass.
- **Minor** = Low / Informational (hardening, magic values, comment drift, error-shape nits, missing smoke coverage).

## Counts

| Blocker | Major | Minor | Total |
|---|---|---|---|
| 19 | 21 | 11 | 51 |

## Blockers (19)

| # | Title | Location | Sources |
|---|---|---|---|
| B1 | Dev auth trusts an unsigned `x-dev-user-id` header / `dev_user_id` cookie — any client can become any user (manager/staff/driver/customer); `AUTH_MODE=dev` set in reviewed `.env`; full auth + authorization bypass if mode reaches a reachable deployment | `src/lib/auth.ts:36-54`; `src/middleware.ts:67-78`; `src/app/api/dev/session/route.ts:10-19` | sec S-01 |
| B2 | `GET /api/admin/packages` lists packages with no season filter — any admin (incl. `STAFF`) can enumerate packages across all seasons incl. archived, exposing recipient PII | `src/app/api/admin/packages/route.ts:12-33`; `src/lib/ops/packages.ts:56-100` | sec S-02 |
| B3 | `POST /api/admin/packages` `action=stage` advances package stages with no season scoping — any admin can move packages from any (incl. archived) season to `PRINTED`/`PACKED`/`SENT`/`PICKED_UP` | `src/app/api/admin/packages/route.ts:55-83`; `src/lib/ops/packages.ts:419-496` | sec S-03 |
| B4 | `POST /api/admin/packages` `action=regroup` merges packages with no season scoping — any admin can regroup packages across seasons | `src/app/api/admin/packages/route.ts:49-53,60-69`; `src/lib/ops/packages.ts:320-417` | sec S-04 |
| B5 | `GET /api/admin/packages/[id]` fetches a package by ID with no season check — IDOR within admin role across seasons; any admin can read recipient name/address/greeting/items by enumerating IDs | `src/app/api/admin/packages/[id]/route.ts:11-23`; `src/lib/ops/packages.ts:102-107` | sec S-05 |
| B6 | `POST /api/admin/packages/[id]` `action=split` splits a package with no season scoping — any admin can split any package in any season | `src/app/api/admin/packages/[id]/route.ts:44-55`; `src/lib/ops/packages.ts:196-317` | sec S-06 |
| B7 | `POST /api/admin/print-batches` `nightly`/`reprint-group` accept a client-supplied `seasonId` that overrides current season — any admin can regenerate PII-laden PDFs for archived seasons | `src/app/api/admin/print-batches/route.ts:13-28,52-74` | sec S-07 |
| B8 | `POST /api/admin/print-batches` `reprint-order` accepts any `orderId` with no season membership check — any admin can reprint artifacts (slips/labels/cards) for any order in any season | `src/app/api/admin/print-batches/route.ts:25-28,76-83`; `src/lib/ops/print-batch.ts:387-431` | sec S-08 |
| B9 | `bulk-stage` `methodId` path writes phantom audit rows — `packageAuditLog.createMany` writes for every package captured by the preceding `findMany`, not just those actually `updateMany`-updated; concurrent tx leaves audit rows claiming transitions that never happened; `findMany` also does not acquire `FOR UPDATE` locks | `src/app/api/admin/packages/bulk-stage/route.ts:59-86` | sec S-09 |
| B10 | PICKUP/SHIP terminal-stage invariant not bound to fulfillment method on live paths — a PICKUP package can be advanced to `SENT` and a SHIP package to `PICKED_UP` via live per-package and bulk paths; only dead `bulk-stage` route guards this | `src/lib/orders/package-stages.ts:12-18`; live callers `src/lib/ops/packages.ts:439,447` and `src/app/api/admin/packages/[id]/route.ts:57` | quality P7-Q-01 |
| B11 | Greeting-card and label PDFs produced at LETTER size (612×792), not card stock (CARD_5X7 360×504) or 4×6 label (288×432) — violates EXPECTED item 5 | `src/lib/print/pdf.ts:5-47` (`buildSimplePdf`); used by `src/lib/ops/print-batch.ts:242,252` | quality P7-Q-02 |
| B12 | Live PDF generator emits raw UTF-8 bytes inside `(...)` text strings with only `\`/`(`/`)` escaping and no `/Encoding` entry — non-ASCII recipient names/greetings/products produce invalid PDFs | `src/lib/print/pdf.ts:5-47` (`buildSimplePdf`) | quality P7-Q-03 |
| B13 | Two parallel implementations of `splitPackage`/`regroupPackages`/package-stage advance — `lib/ops/packages.ts` (Result<T>) vs `lib/packages/actions.ts` (throws ActionError); wired into different routes; same domain, two sources of truth | `src/lib/ops/packages.ts` vs `src/lib/packages/actions.ts` | rules R01, clean-code CC-03-01, quality P7-Q-04 |
| B14 | Two parallel print-batch implementations — `ops/print-batch.ts` (stores `pdfDataUrl` eager) vs `print/batches.ts` (structured payload, renders on demand); two `packageInclude` shapes, two `PackageRow` types, two `filingGroup` derivations | `src/lib/ops/print-batch.ts` vs `src/lib/print/batches.ts` | rules R02, clean-code CC-03-02, quality P7-Q-06 |
| B15 | Two dependency-free PDF generators in the same repo — `buildSimplePdf` (single-page text-only) vs `renderPdf` (multi-page with sizes/fonts/pagination); both used by P7 code paths | `src/lib/print/pdf.ts` vs `src/lib/pdf.ts` | rules R03 |
| B16 | Divergent business rules for the same operation — `ops` regroup allows any non-terminal stage and skips grouping-key match; `actions` regroup requires NEW + matching recipient/address/method/greeting; `ops` split moves whole items only; `actions` split supports partial-quantity splits creating new OrderLine rows | `src/lib/ops/packages.ts` `regroupPackages`/`splitPackage` vs `src/lib/packages/actions.ts` `regroupPackages`/`splitPackage` | rules R04 |
| B17 | Three implementations of the package stage transition (lock → `assertPackageTransition` → version-guarded update → `packageAuditLog` + `auditLog`) — `transitionPackage`, `advancePackageStage`, `bulkAdvancePackageStage` each re-do the same skeleton; audit-log meta shape also differs | `src/lib/orders/package-stages.ts`, `src/lib/packages/actions.ts`, `src/lib/ops/packages.ts` | clean-code CC-03-03 |
| B18 | Four near-identical row-lock helpers — `lockOrderForUpdate`, `lockPackageForUpdate`, `lockPackage`, `lockPaymentForUpdate`; each is `SELECT id FROM "<Table>" WHERE id = $1 FOR UPDATE` then `findUniqueOrThrow`; same pattern, four copies | `src/lib/orders/lock.ts`, `src/lib/orders/package-stages.ts:42`, `src/lib/ops/packages.ts:196`, `src/lib/ops/refunds.ts:17` | clean-code CC-03-04 |
| B19 | `zip_blocked` conflict envelope constructed three times verbatim — trivially extractable to a `zipBlockedConflict(error)` helper | `src/lib/checkout/session.ts:348-358, 423-441, 535-547` | clean-code CC-03-05 |

## Majors (21)

| # | Title | Location | Sources |
|---|---|---|---|
| M1 | `FulfillmentActions` component is never rendered anywhere and its `print`/`order` modes would crash at runtime — expects `{ batch: { artifacts: [...] }, replayed }` shape but live route returns `{ ok, batchId, runKey, created, artifactCount, packageCount, stagesUnchanged }` | `src/components/admin/fulfillment-actions.tsx` (whole file) | quality P7-Q-05, rules R08 |
| M2 | Print-batches UI reads `json.packageStages` which the API never returns — `stillUnshipped` indicator is vacuously true forever; misleading UI claim | `src/components/admin/print-batches.tsx:51-54` vs `src/lib/ops/print-batch.ts:318-325` | quality P7-Q-07 |
| M3 | Channel bulk-stage path (the only place the method/stage guard lives) writes `packageAuditLog` rows but skips the global `AuditLog` entry every other stage-change path creates; also uses `updateMany` with `version: { increment: 1 }` but no version precondition (no optimistic concurrency check) | `src/app/api/admin/packages/bulk-stage/route.ts:59-85` (methodId branch) | quality P7-Q-08 |
| M4 | `reprintFilingGroup` has no stage filter — reprints slips/labels/cards for packages already in `SENT`/`PICKED_UP`, producing stale paperwork for shipped packages; inconsistent with nightly and EXPECTED item 4 | `src/lib/ops/print-batch.ts:331-385` | quality P7-Q-09 |
| M5 | `fulfillmentChannelDashboard` groups ALL packages across ALL seasons with no `seasonId` filter — cross-season aggregation; parallel `lib/packages/board.ts` `channelSummaries(seasonId)` takes seasonId; silently chooses cross-season | `src/app/api/admin/fulfillment/route.ts`; `src/lib/ops/packages.ts:110-194` | rules R05, sec S-12 |
| M6 | Dead branch in `fulfillmentChannelDashboard` — `if (!channel)` creates a channel on the fly but `channels` is pre-populated with every `FulfillmentMethod` and `rows` only contain FKs that exist in `methods`, so the branch can never fire | `src/lib/ops/packages.ts:148-166` | rules R06 |
| M7 | Dead module `lib/packages/board.ts` — `channelSummaries`, `parsePackageListFilters`, `listPackages`, `ChannelSummary`, `PACKAGES_PAGE_SIZE` have no callers; `/api/admin/packages` and `/api/admin/fulfillment` both import from `lib/ops/packages` instead | `src/lib/packages/board.ts` (whole file) | rules R07 |
| M8 | `void itemGroups;` — fetches `packageItem.groupBy` from the DB then explicitly discards the result; wasted query plus "just in case" code | `src/lib/packages/board.ts:117` | rules R09 |
| M9 | Three `PackageInclude` shapes for the same aggregate — `lib/ops/packages.ts`, `lib/packages/board.ts`, `lib/print/batches.ts` all select different slices of the same `Package`; no shared type | `src/lib/ops/packages.ts:30-54`, `src/lib/packages/board.ts:50-67`, `src/lib/print/batches.ts:8-30` | rules R10, clean-code CC-03-16 |
| M10 | STATUS claims "Split audit notes use ASCII `->`" but the parallel `packages/actions.ts` split path still writes Unicode `→`; claim presented as global constraint but only one of two implementations follows it | `arms/arm-03/results/PHASE-P7-STATUS.md:19` vs `src/lib/packages/actions.ts:183` | rules R11, quality P7-Q-10 |
| M11 | `finalize.ts` formatting drift — every code line is followed by a blank line, doubling the file to 539 lines for ~200 LOC; `prettier`/`eslint` would reformat on save; this file escaped that | `src/lib/orders/finalize.ts` (whole file) | clean-code CC-03-06 |
| M12 | Pagination constants and `clampPageSize` duplicated across four files — `orders.ts` uses `DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE`; `packages.ts` uses `DEFAULT_PAGE`/`MAX_PAGE`; `customers.ts` inlines `DEFAULT_PAGE = 50; MAX_PAGE = 100` with no helper; `audit.ts` uses `DEFAULT_AUDIT_LIMIT`/`MAX_AUDIT_LIMIT` with inline clamp | `src/lib/ops/orders.ts:8-23`, `src/lib/ops/packages.ts:13-28`, `src/lib/ops/customers.ts:10-11`, `src/lib/audit.ts:25-26` | clean-code CC-03-07 |
| M13 | `formatCents` exists and is used by storefront + builder + checkout, but admin components re-implement money formatting inline as `$${(cents / 100).toFixed(2)}` (5 files, 6 sites); `admin/page.tsx` even defines a local `money()` helper instead of importing | `src/lib/storefront/catalog-shared.ts:32` vs `src/app/(admin)/admin/page.tsx:7-10`, `src/components/admin/catalog-admin.tsx:245`, `src/components/admin/order-detail.tsx:122,133,134`, `src/components/admin/orders-list.tsx:193`, `src/components/admin/addon-admin.tsx:134` | clean-code CC-03-08 |
| M14 | Centralized `writeAudit` helper is used by ~15 call sites, but ~12 other sites call `tx.auditLog.create` / `db.auditLog.create` directly across 12 files; the helper exists, half the codebase ignores it | `src/lib/audit.ts:6` vs ~12 files using `db.auditLog.create` directly | clean-code CC-03-09 |
| M15 | Customer OR-search predicate (displayName / email / phone / emailNorm / phoneNorm) is built twice in the same file — `listCustomers` and `searchCustomersForPos` duplicate the OR clause | `src/lib/ops/customers.ts:13-55` vs `:270-290` | clean-code CC-03-10 |
| M16 | "Edit saved address" form and "new recipient" form share 5+ identical `<Input>` fields bound to the same `form` state — two ~30-line JSX blocks differ only by `data-testid` prefixes and the autocomplete widget; extractable to a single `<AddressFields>` component | `src/components/order/assign-dialog.tsx:252-298` vs `302-369` | clean-code CC-03-11 |
| M17 | `lib/orders/drafts.ts` god file (540 lines) — mixes draft creation, line add/update/remove, three-way assignment, guest-token lifecycle, and cancellation; splits naturally: `drafts/create.ts`, `drafts/lines.ts`, `drafts/assign.ts`, `drafts/guest.ts` | `src/lib/orders/drafts.ts` (540 lines) | clean-code CC-03-12 |
| M18 | `lib/checkout/session.ts` god file (512 lines) — mixes order loading, fee-line mapping, validation-line mapping, price refresh, summary build, prepare flow, hosted-checkout flow | `src/lib/checkout/session.ts` (512 lines) | clean-code CC-03-13 |
| M19 | Coarse permission model — every P7 package/print route gates only on `admin.access`, which `STAFF` receives by default; no `packages.write`, `print.run`, or `print.reprint` permission; any staff user can run nightly print batches, reprint any order, advance stages, split/regroup packages; plan calls for per-person permission toggles (UR-012) | `src/lib/permissions.ts:3-19`; all P7 routes | sec S-15 |
| M20 | `reprint-group` and `reprint-order` batches are not idempotent (`idempotent: false`, `runKey` includes `Date.now()`) and the endpoint has no rate limit — an admin (or script with stolen admin creds) can spam reprints, creating unbounded `PrintBatch`/`PrintArtifact` rows (storage exhaustion / DoS) | `src/lib/ops/print-batch.ts:24-30,331-431`; `src/app/api/admin/print-batches/route.ts` | sec S-16 |
| M21 | Two different bulk patterns in the same domain — `ops` `bulkAdvancePackageStage` loops N sequential `$transaction`s; the `bulk-stage` route's `methodId` branch does one `updateMany`; inconsistent bulk semantics | `src/lib/ops/packages.ts` `bulkAdvancePackageStage` vs `src/app/api/admin/packages/bulk-stage/route.ts` | rules R13 |

## Minors (11)

| # | Title | Location | Sources |
|---|---|---|---|
| m1 | `GET /api/admin/print-artifacts/[id]` fetches any print artifact by ID with no season check and serves a PDF containing recipient PII — IDOR within admin role across seasons | `src/app/api/admin/print-artifacts/[id]/route.ts:10-32` | sec S-10 |
| m2 | `GET /api/admin/print-batches/artifacts/[artifactId]` fetches any print artifact by ID with no season check and serves a PDF with PII — IDOR within admin role | `src/app/api/admin/print-batches/artifacts/[artifactId]/route.ts:8-46` | sec S-11 |
| m3 | Header injection in `Content-Disposition` — `filename="${artifact.kind}-${artifact.filingGroup}.pdf"` interpolates `filingGroup` (derived from fulfillment method `code`) without sanitization; sibling `/api/admin/print-artifacts/[id]` route sanitizes — inconsistent | `src/app/api/admin/print-batches/artifacts/[artifactId]/route.ts:28` | sec S-13 |
| m4 | `print-artifacts/[id]` sets `Cache-Control: private, max-age=60` on a PII-laden PDF — browser caches recipient names/addresses for 60 seconds; on a shared device, a subsequent user could retrieve the cached PDF via back/forward navigation | `src/app/api/admin/print-artifacts/[id]/route.ts:26` | sec S-14 |
| m5 | Contradictory fallback in `reprintFilingGroup` — `fulfillmentMethodId: method?.id` AND `fulfillmentMethod: { code: group }` when `method` is null; `fulfillmentMethodId: null` AND a code match cannot both hold; dead branch | `src/lib/ops/print-batch.ts:347-359` | rules R12 |
| m6 | Two PDF-download routes orphaned — no UI links to them; `packing-slip` route is the only live caller of `print/render.ts` `renderArtifactPdf` and `print/batches.ts` `buildOrderPackingSlip`; the rich renderer is unreachable from any UI flow | `src/app/api/admin/orders/[id]/packing-slip/route.ts`; `src/app/api/admin/print-artifacts/[id]/route.ts` | quality P7-Q-11 |
| m7 | Greeting-card artifacts always created for every filing group, even when no package has a greeting — `cardLines` falls back to `"Season's greetings"` when `pkg.greeting` is empty; wastes rows and produces cards for greetingless packages | `src/lib/ops/print-batch.ts:176-188` (`buildGroupArtifacts` greeting-card branch) | quality P7-Q-12 |
| m8 | `packageStagesForBatch` is never called; `stagesSnapshot` and `packageIds` are written into every artifact payload but never read by any live route (download route only reads `pdfDataUrl`, falling back to `title`/`lines`); dead storage on every `PrintArtifact.payload` | `src/lib/ops/print-batch.ts:461-477`; payload writes at `:250-251` | quality P7-Q-13 |
| m9 | Smoke does not cover several EXPECTED items: regroup flow (S1 only splits), fulfillment-dashboard bulk status actions (S3d only checks summaries return), "separate PDF per filing group" (S3a only checks idempotency + counts), card-stock / 4×6 label sizing (S2b only checks content-type), method/stage terminal invariant (S2c-e only marks one SHIP package) | `scripts/smoke-p7.mjs` (whole file) vs `shared/phases/PHASE-P7-EXPECTED.md` | quality P7-Q-14 |
| m10 | `lib/ops/packages.ts` at 458 lines bundles list query + dashboard + split + regroup + bulk stage — under the 500-line threshold but same concern cluster as the parallel-implementation blocker; resolving the duplication also resolves this | `src/lib/ops/packages.ts:458` (file length) | clean-code CC-03-14 |
| m11 | `Object.assign(new Error(...), { code: "..." })` pattern in `refunds.ts` used to thread error codes out of the transaction then re-checked in the catch; the codebase already has a `Result<T, E>` type with `err(code, message)` — refunds should return `Result` from inside the transaction rather than throwing decorated errors; two error-signaling patterns in one file | `src/lib/ops/refunds.ts:157-170, 173-177` | clean-code CC-03-15 |

## Dedupe map (collapsed duplicates)

- B13 ← rules R01 + clean-code CC-03-01 + quality P7-Q-04 (parallel `packages` implementations: `lib/ops/packages.ts` vs `lib/packages/actions.ts`)
- B14 ← rules R02 + clean-code CC-03-02 + quality P7-Q-06 (parallel print-batch implementations: `lib/ops/print-batch.ts` vs `lib/print/batches.ts`)
- M1 ← quality P7-Q-05 + rules R08 (dead `FulfillmentActions` component)
- M5 ← rules R05 + sec S-12 (fulfillment dashboard cross-season aggregation)
- M9 ← rules R10 + clean-code CC-03-16 (three `PackageInclude` shapes)
- M10 ← rules R11 + quality P7-Q-10 (STATUS ASCII-`->` claim vs Unicode-`→` code)

## Notes (carried, not findings)

- Auth gates present on every P7 route (`requirePermission("admin.access")`); the gate is correct mechanically but too coarse (see M19).
- No findings against the `print ≠ shipped` invariant (UR-001, G-001..G-004): `runNightlyPrintBatch`, `reprintFilingGroup`, `reprintOrder`, and `renderArtifactPdf` never mutate `Package.stage`; audit meta records `stagesMutated: false`. This is the strongest part of P7.
- No secrets, credentials, or tokens observed in the reviewed source. `.env` contains only dev placeholders and dev-mode flags; `.gitignore` covers `.env*`.
- All DB access via Prisma parameterised queries — no SQL-injection surface.
- Smoke 16/16 PASS but does not exercise cross-season scoping, channel-bulk audit, terminal-stage invariant, card-stock/label sizing, or per-group separation — the gaps above are outside smoke coverage.
- The `lib/ops/` vs `lib/<domain>/` split is itself a pattern-drift signal: the codebase has not decided whether ops lives under `ops/` or under the domain folder. Resolving B13/B14 collapses the duplication.
- `tsconfig.tsbuildinfo` (1.1 MB) is committed — build artifact that should be in `.gitignore`; hygiene finding, not a clean-code finding.

Output path: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-03/results/AGGREGATE-REVIEW-P7.md`

