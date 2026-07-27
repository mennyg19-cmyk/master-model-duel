# Test 5 — Residual rules review (arm-05, post-fix)

**Tree:** `arms/arm-05/workspace` (post self-fix)
**Mode:** single (residual reviewer — tree only, did not see self-review chat)
**Rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Fix notes:** `arms/arm-05/results/SELF-FIX-NOTES.md` (claims 8 fixed, 0 skipped)
**Scope:** Findings only — no fixes applied.

## Counts

| Severity | Residual |
|---|---:|
| blocker | 0 |
| major | 0 |
| minor | 7 |
| **Total** | **7** |

All 8 self-fix claims verified present in the tree (SR-001 multi-page PDF + 56-line test, SR-002 Mapbox-required production geocoding with fixture re-geocode, SR-003 100-record pagination, SR-004 finalized-only item-sales CSV, SR-005 voided-label exclusion, SR-006 legacy import PackageLine, SR-007 anonymous POS distinct customers, SR-008 abortable effect chains). No regressions observed. Residuals below are carry-over / adjacent debt in code touched by the fix pass.

## Residual findings (post-fix tree)

| ID | Severity | Location | Claim | Evidence |
|---|---|---|---|---|
| RR-1 | minor | `lib/package-operations.ts:120-145` (`packageDashboard`, SR-003) | Inconsistent `where` reuse — a `where` const is declared on line 121 and used by `count` (123) and the totals `findMany` (142), but the paginated `findMany` re-inlines `where: { isActive: true }` on line 125. One pattern per concern (clean-code § Consistency). | `const where = { isActive: true };` then `prisma.package.findMany({ where: { isActive: true }, ... })` three lines apart. |
| RR-2 | minor | `lib/package-operations.ts:124-140` (`packageDashboard`, SR-003) | Indentation drift inside the paginated `findMany` — `where`/`include`/`orderBy` sit at 4 spaces while `skip`/`take` and the sibling `findMany` body use 6. Mixed formatting in a single object literal. | Lines 125-137 at 4-space indent; lines 138-139 at 6-space; compare the consistently indented totals `findMany` at 141-144. |
| RR-3 | minor | `lib/package-operations.ts:141-144` (`packageDashboard`, SR-003) | Channel/production totals load every active package with its lines into Node memory and reduce in JS. At the smoke-p12 scale (5k packages) this is a full table load where a `groupBy`/`_sum` aggregate would do it server-side. Ponytail `shrink:` candidate. | `prisma.package.findMany({ where, select: { fulfillmentMethod:..., lines:... } })` with no `take`; smoke p12 asserts `packageDashboard(51).total >= 5000`. |
| RR-4 | minor | `app/admin/reports/page.tsx:22-53` (SR-008) | Duplicated fetch logic — `load()` (22-31) and the `useEffect` (33-53) both GET `/api/admin/reports` and set the same five state vars. The effect re-implements the fetch with an AbortController instead of calling `load(signal)`. Clean-code § duplicated logic. | `load()` body and the `.then(({response, body}) => {...})` block are line-for-line the same five `set*` calls. |
| RR-5 | minor | `app/admin/seasons/page.tsx:18-45` (SR-008) | Same duplication — `load()` (18-25) and `useEffect` (27-45) re-issue the same fetch and the same `setState` + `setTargetSeasonId` chain. | `load()` and the effect's `.then` block both call `setState(body)` + `setTargetSeasonId(current || body.seasons.find(...)?.id || "")`. |
| RR-6 | minor | `app/admin/packages/page.tsx:44-83` (SR-003) | Same duplication, and the most avoidable: `load(page, signal?)` already accepts an optional `AbortSignal` (line 44), yet the `useEffect` (68-83) re-implements the fetch+abort instead of calling `void load(1, controller.signal).catch(...)`. | `load` signature has `signal?: AbortSignal`; the effect ignores it and inlines `fetch(..., { signal: controller.signal })`. |
| RR-7 | minor | `app/admin/packages/page.tsx:54-66` (`postJson`, SR-003) | Inconsistent error-message fallback — `postJson` does `setMessage(body.error)` (62) with no `??` fallback, while the sibling `load` (48) uses `body.error ?? "Packages could not be loaded."`. A server error with no body renders the literal string `"undefined"` to the user. Clean-code § Error Handling + Consistency. | Line 62: `setMessage(body.error);` vs line 48: `setMessage(body.error ?? "Packages could not be loaded.");`. |

## Rule-by-rule residual adherence

| Rule | Adherence | Notes |
|---|---|---|
| ponytail | **Pass (with caveat)** | Ladder held — no new deps in the fix pass (Mapbox via `fetch`, PDF via Buffer, scrypt/timingSafeEqual via `node:crypto`). Caveat: RR-3 full-table load for totals is a `shrink:` candidate. |
| clean-code | **Partial** | RR-1/RR-2 inconsistent patterns + formatting in `packageDashboard`; RR-4/RR-5/RR-6 duplicated fetch logic across three admin pages; RR-7 inconsistent error fallback. No swallowed errors, no vague names, no narration comments in touched files. |
| workflow | **Pass** | Gate discipline held — SELF-FIX-NOTES records verification (typecheck, lint, test, smoke:p9, smoke:p12). Spec gate N/A (fix pass, not new feature). |
| vocabulary | **N/A** | No refactor/tidy/rebuild commands in the fix pass. |
| codegraph | **N/A for product** | No `.codegraph/` index in `arm-05/workspace`; this review used Read + Grep over the post-fix tree (literal/string lookups for `where`, `catch`, `setMessage`, etc.). |

## Net

All 8 self-fix claims landed in the tree and smoke is green per the fix notes. No blockers or majors residual. The 7 minors cluster into two themes: (a) `packageDashboard` consistency (RR-1/RR-2/RR-3) and (b) duplicated admin-page fetch logic (RR-4/RR-5/RR-6) plus one missing error fallback (RR-7). None are regressions — all are carry-over debt in code the fix pass touched but did not consolidate.
