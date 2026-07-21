# P7 Rules Review — arm-03 (blind)

Reviewer: external (rules specialist)
Run: 2026-07-20-1748-tomchei-shabbos-website-model_duel
Phase: P7 — Package engine live
Rules graded: ponytail, clean-code, workflow, vocabulary, codegraph
Scope: `arms/arm-03/workspace/src` for P7 surface (packages, print-batches, fulfillment)
Method: static review of source + cross-check against smoke evidence in `arms/arm-03/results/PHASE-P7-SMOKE.md`
No fixes applied. Findings only.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 4 |
| Medium | 6 |
| Low | 3 |
| **Total** | **13** |

Smoke: 16/16 PASS. Behavior is correct on the tested paths. The findings are about rule adherence, not correctness — the untested parallel API surface carries the bulk of the debt.

## Findings

| ID | Severity | Location | Claim | Rule violated |
|---|---|---|---|---|
| R01 | High | `src/lib/ops/packages.ts` vs `src/lib/packages/actions.ts` | Two parallel implementations of `splitPackage`, `regroupPackages`, and stage advance for the same Package domain. `ops/packages.ts` returns `Result<T>`; `packages/actions.ts` throws `ActionError`. Both are wired into different routes. | clean-code: "One error-handling approach per project", "Duplicated logic", "Inconsistent patterns"; ponytail: Rule of 2 |
| R02 | High | `src/lib/ops/print-batch.ts` vs `src/lib/print/batches.ts` | Two parallel print-batch implementations. `ops/print-batch.ts` stores `pdfDataUrl` (eager) with `{title, lines, packageIds, stagesSnapshot}` payload; `print/batches.ts` stores structured `GroupArtifactPayload`/`PackingSlipPayload` and renders on demand. | clean-code: "One pattern per concern", "Duplicated logic", "Type/schema drift"; ponytail: Rule of 2 |
| R03 | High | `src/lib/print/pdf.ts` (`buildSimplePdf`) vs `src/lib/pdf.ts` (`renderPdf`) | Two dependency-free PDF generators in the same repo. `buildSimplePdf` is single-page text-only; `renderPdf` is multi-page with sizes/fonts/pagination. Both used by P7 code paths. | clean-code: "One pattern per concern — never two that do the same thing" |
| R04 | High | `src/lib/ops/packages.ts` `regroupPackages`/`splitPackage` vs `src/lib/packages/actions.ts` `regroupPackages`/`splitPackage` | Divergent business rules for the same operation. `ops` regroup allows any non-terminal stage and skips grouping-key match; `actions` regroup requires NEW + matching recipient/address/method/greeting. `ops` split moves whole items only; `actions` split supports partial-quantity splits that create new OrderLine rows. | workflow: "Never silently choose business logic"; clean-code: "Inconsistent patterns" |
| R05 | Medium | `src/lib/ops/packages.ts` `fulfillmentChannelDashboard` (lines 110-194) | Dashboard groups ALL packages across ALL seasons — no `seasonId` filter. The parallel `lib/packages/board.ts` `channelSummaries(seasonId)` takes seasonId. The `/api/admin/fulfillment` route calls the season-less version, silently choosing cross-season aggregation. | workflow: "Never silently choose business logic" |
| R06 | Medium | `src/lib/ops/packages.ts` `fulfillmentChannelDashboard` (lines 148-166) | Dead branch: `if (!channel)` creates a channel on the fly. `channels` is pre-populated with every `FulfillmentMethod` (lines 130-144) and `rows` only contain FKs that exist in `methods`, so the branch can never fire. | clean-code: "No defensive code for conditions that can't happen"; "Dead code" |
| R07 | Medium | `src/lib/packages/board.ts` (whole file) | Dead module. `channelSummaries`, `parsePackageListFilters`, `listPackages`, `ChannelSummary`, `PACKAGES_PAGE_SIZE` have no callers — `/api/admin/packages` and `/api/admin/fulfillment` both import from `lib/ops/packages` instead. | clean-code: "Dead code — delete, don't comment out" |
| R08 | Medium | `src/components/admin/fulfillment-actions.tsx` | `FulfillmentActions` exported, no importers. The fulfillment page uses `FulfillmentDashboardClient` instead. | clean-code: "Dead code" |
| R09 | Medium | `src/lib/packages/board.ts` line 117 (`void itemGroups;`) | Fetches `packageItem.groupBy` from the DB then explicitly discards the result. Wasted query plus "just in case" code. (Moot as dead code, but the pattern matters if revived.) | clean-code: anti-AI-tics "No 'just in case' code — every line must have a reason" |
| R10 | Medium | Three `PackageInclude` shapes for the same aggregate | `lib/ops/packages.ts` `packageInclude` (lines 30-54), `lib/packages/board.ts` listPackages include (lines 50-67), `lib/print/batches.ts` `packageInclude` (lines 8-30) all select different slices of the same `Package`. No shared type. | clean-code: "Type/schema drift — centralize types, single source of truth" |
| R11 | Medium | `arms/arm-03/results/PHASE-P7-STATUS.md` line 19 vs `src/lib/packages/actions.ts` line 183 | STATUS claims "Split audit notes use ASCII `->` (WIN1252 Postgres client encoding rejects Unicode arrows)". The smoke-tested split path (`lib/ops/packages.ts` line 293) does use ASCII `->`, but the parallel split path (`lib/packages/actions.ts` line 183) writes `split → ${target.id}` with a Unicode arrow. The claim is presented as a global constraint but only one of two wired implementations follows it. | clean-code: "Do not claim 'fixed/passed/working' without tool output or running-app evidence" (anti-hallucination) |
| R12 | Low | `src/lib/ops/print-batch.ts` `reprintFilingGroup` (lines 347-359) | Contradictory fallback: `fulfillmentMethodId: method?.id` AND `fulfillmentMethod: { code: group }` when `method` is null. `fulfillmentMethodId: null` AND a code match cannot both hold. Dead branch. | clean-code: anti-AI-tics "No 'just in case' code" |
| R13 | Low | `src/lib/ops/packages.ts` `bulkAdvancePackageStage` vs `/api/admin/packages/bulk-stage` route | Two different bulk patterns in the same domain. `ops` `bulkAdvancePackageStage` loops N sequential `$transaction`s; the `bulk-stage` route's `methodId` branch does one `updateMany`. Inconsistent bulk semantics. | clean-code: "Inconsistent patterns" |

## Notes

- The smoke test (`scripts/smoke-p7.mjs`) only exercises the `lib/ops/packages.ts` + `lib/orders/package-stages.ts` + `lib/ops/print-batch.ts` paths. The parallel surface in `lib/packages/actions.ts`, `lib/print/batches.ts`, `lib/print/render.ts`, and the `/api/admin/packages/[id]/split|stage|regroup|bulk-stage` + `/api/admin/print-artifacts/[id]` + `/api/admin/orders/[id]/packing-slip` routes is wired but untested. Findings R01-R04 would be caught by routing all callers through one implementation.
- No codegraph finding raised: `.codegraph/` exists and the arm used it (`.scratch/cg-explore-admin.txt`, `cg-files.json`). Rule adherence for codegraph is OK.
- No ponytail-ladder finding raised: no new third-party deps added for P7 (PDFs are hand-rolled, no `pdfkit`/`puppeteer`). That is the correct ladder rung.
