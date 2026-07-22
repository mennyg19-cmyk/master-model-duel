# Test 5 — Aggregate residual review (arm-03)

**Source residual reviews:** `residual-clean-code-arm-03.md`, `residual-rules-arm-03.md`
**Missing:** `residual-security-arm-03.md` and `residual-quality-arm-03.md` were **not produced** for arm-03. Security and quality residuals below are **derived** by cross-referencing the P12 phase reviews (`P12-security-arm-03.md`, `P12-quality-arm-03.md`) against the verified-fixes list in `residual-rules-arm-03.md`. Items the self-fix closed in-tree are dropped; items with no verified fix are listed as residual and marked `(derived)`.
**Tree:** `arms/arm-03/workspace` (post self-fix)
**Scope:** dedup across the two residual reviews; Blockers / Majors / Minors buckets. Process/hygiene findings kept in a separate bucket (not counted as Majors/Minors).

## Headline

All three self-found blockers are closed in the tree. Post-fix smoke is 5/5 PASS (S3 legacy import moved from FAIL → PASS). No regressions introduced by the fix pass. Residual is **0 blockers, 5 majors, 10 minors, 5 process/hygiene**. The majors are a mix of agreed debt (god files, process-local rate limits) and one customer-visible defect (mojibake on the payment path). The self-fix notes undercount and re-ID the fixes — three real fixes landed in the tree without being recorded.

## Blockers (0)

None residual. All three self-found blockers (SR-B1 refund placeholder, SR-B2 magic-link PII redaction, SR-B3 Stripe mock fail-closed) verified closed in `residual-rules-arm-03.md`.

## Majors (5, deduped)

| ID | Location | Finding | Sources |
|---|---|---|---|
| AG-M1 | `lib/routes/service.ts` | God file over the 500-line hard split + mixed concerns (route build, day-of notify, stop delivery, method-switch/reroute, PIN throttle, print PDF, nearby suggestions). Mandatory split per `clean-code.mdc` (>500 lines OR mixed concerns). **Line-count discrepancy between reviewers:** rules review reports 965 lines, clean-code review reports 510. Both agree it is over threshold; the gap should be reconciled before a split is planned. | RR-M2 + clean-code #3 |
| AG-M2 | `lib/ops/import.ts` (671), `lib/ops/repeat.ts` (665), `lib/orders/drafts.ts` (540), `lib/checkout/session.ts` (531), `lib/ops/print-batch.ts` (513) | Five additional modules over the >500-line / mixed-concerns threshold. Skipped as a set (large no-behavior refactor). | RR-M3 |
| AG-M3 | `lib/http/public-guard.ts` (and callers) | Rate limits are process-local `Map`s with a single shared `"anon"` identity. Multi-instance deploys reset counters per isolate; one noisy client exhausts the shared anon bucket. Agreed debt (shared store / edge limits needed). | RR-M1 |
| AG-M4 | `lib/api/admin-handler.ts` + ~25 admin route handlers | Partial `adminHandler` migration: only ~6 routes migrated (recon, refund, payments, void, settings, season-status). ≥25 admin handlers still hand-roll `requirePermissionApi` + `safeParse` + status mapping. The self-fix made the inconsistency **worse** — two competing patterns for the same concern now coexist. Future gate-contract changes must be applied in two places. | clean-code #1 |
| AG-M5 | `components/checkout/checkout-form.tsx`, `lib/checkout/fees.ts`, `lib/public-guard.ts`, `lib/shipping/margin.ts` | Mojibake in customer-visible UI strings: UTF-8 em dash / minus / ellipsis mis-decoded as Latin-1 (`â€"`, `âˆ'`, `â€¦`) on the payment path (fallback conflict message, day picker, "starting secure payment", rate-option labels, "ZIP outside delivery area", 429 body). Broken glyphs render to shoppers. Self-fix did not address any of SR-m1–m9. | clean-code #2 |

## Minors (10, deduped)

| ID | Location | Finding | Sources |
|---|---|---|---|
| AG-m1 | `.env.example` | Ships concrete dev secrets (`NEWSLETTER_HMAC_SECRET=tomchei-arm03-…`, `CRON_SECRET=tomchei-arm03-…`, `whsec_mock_dev_only`, mock Stripe key). Easy to copy verbatim into a real deploy. Should be `<set-me>` placeholders. | RR-m1 |
| AG-m2 | `lib/ops/settings-keys.ts`; `lib/ops/test-ops.ts` | `TestModeSetting` type defined in both files. Drift risk. | RR-m2 |
| AG-m3 | `app/api/client-error/route.ts` | Public POST logs client errors with no rate-limit / origin guard — log spam vector. | RR-m3 |
| AG-m4 | `components/admin/imports-client.tsx` | `MESSY_ORDERS` fixture CSV + "Bad Row" seed text embedded in the shipped admin client bundle. | RR-m4 + clean-code context |
| AG-m5 | `lib/ops/prior-year-stub.ts`; ORDERS path in `lib/ops/import.ts` | `seedImportedPriorYearOrder` stub still creates a prior-year paid order directly; real `ImportKind.ORDERS` stage+commit not exercised end-to-end by smoke. | RR-m5 |
| AG-m6 | `lib/reports.ts:183-213` | Duplicated SQL in `marginReport` totals branch — `seasonId` and non-`seasonId` queries differ by one `WHERE` predicate. Hoist shared SQL or branch on the fragment. | clean-code #4 |
| AG-m7 | `app/api/admin/reconciliation/route.ts:33`; `app/api/admin/test-console/route.ts:35` | Redundant type assertions / escape-hatch casts (`as unknown as Record<string, number>`, `as never`) to dodge `InputJsonValue`. Anti-AI-tic. | clean-code #5 |
| AG-m8 | `lib/legacy-import/commit.ts:151-188` | Count divergence in addresses stage — inner counters only count addresses with matching `customerId`, but `completed.push` reports `plan.addresses.length` and a separately recomputed `flagged` over ALL planned addresses. Two sources of truth; reported counts can exceed committed rows. | clean-code #6 |
| AG-m9 | `app/api/cron/{stripe-reconciliation,email-log-purge,notification-sweeper,payment-reminders,pickup-expiry,season-flip}/route.ts` | Cron route boilerplate duplicated across 6 routes (deny → `runCronJob` → `Response.json` → `export { POST as GET }`). A `cronHandler(jobName, fn)` helper would collapse it. Borderline under "leave stable duplication" but at 6 call sites and growing. | clean-code #7 |
| AG-m10 | `scripts/smoke-p12.ts` | 809-line god file, single `main()` walking S1–S5 + wipe/reseed. Largest file in the repo. Lower priority (test/smoke, not shipped) but over threshold. | clean-code #8 |

## Process / hygiene (5, separate bucket)

| ID | Finding | Source |
|---|---|---|
| AG-P1 | `SELF-FIX-NOTES.md` undercounts fixes — lists 7, tree shows 10 (B3 Stripe-mock fail-closed, M4 guest-cookie `secure`, M9 PIN scrypt KDF also fixed but omitted). Auditability of the self-loop reduced. | RR-P1 |
| AG-P2 | Self-fix note IDs drift from self-review IDs (notes renumber findings; no mapping back to review IDs without re-reading both). | RR-P2 |
| AG-P3 | `verifyPinHash` legacy SHA-256 fallback (`lib/routes/service.ts:55`) keeps weak unsalted `pin:${pin}` hashes valid until each route is re-saved. No re-hash-on-unlock path — weak hashes persist indefinitely. | RR-P3 |
| AG-P4 | Driver GET loads full stop rows from DB before PIN-unlock redaction. PII not leaked to client but materialized in memory on every unauthenticated GET. Low impact; future short-circuit. | RR-P4 |
| AG-P5 | Middleware `isDevAuthBypass()` evaluated twice per request (inside `clerkHandler` and in the `middleware` wrapper). Cheap but redundant. | RR-P5 |

## Security residuals (derived — no dedicated residual review)

Cross-reference of `P12-security-arm-03.md` against the verified-fixes list in `residual-rules-arm-03.md`. The self-fix closed the S3 smoke blocker (P12-Sec F11) and the test-ops env guard gap was *partially* addressed (SR-M3 added `allowsDestructiveTestConsole()` = explicit `TEST_MODE`/`IS_TEST_ENV` and non-production — see `SELF-FIX-NOTES.md` SR-M3). The remaining P12-security findings have no verified fix in the residual-rules verified-fixes table:

| P12-Sec ID | Status | Notes |
|---|---|---|
| F1 test-ops env guard | **Partially closed** | SR-M3 added `allowsDestructiveTestConsole()` gating the destructive console. Residual question: whether `wipe`/`reseed`/`dressRehearsal` route actions are also gated, or only the console UI. Derived — not independently verified. |
| F2 duplicate reconcile cron routes | Residual | No fix recorded. `stripe-reconcile` still not registered in `vercel.json`; two reconcile codepaths. |
| F3 legacy import PAID order with no Payment row | Residual | Related to AG-m5; no Payment row added on commit. |
| F4 import GET exposes staged PII to `admin.access` | Residual | No fix recorded. |
| F5 margin financials privilege inconsistency (reports vs exports) | Residual | No fix recorded. |
| F6 `runDressRehearsal` orders not wipeable; untested | Residual | No fix recorded. |
| F7 two `setTestMode` implementations | Residual | No fix recorded. |
| F8 `CRON_SECRET` not in validated env schema | Residual | No fix recorded. |
| F9 duplicate address-cleanup routes | Residual | No fix recorded. |
| F10 `REROUTE_CONFIRMED` audit without reroute | Residual | No fix recorded. |
| F11 S3 smoke FAIL (dry-run classifies valid as duplicate) | **Closed** | Post-fix smoke 5/5 PASS; S3 green per `residual-rules`. |

## Quality residuals (derived — no dedicated residual review)

Cross-reference of `P12-quality-arm-03.md` against the verified-fixes list:

| P12-Q ID | Status | Notes |
|---|---|---|
| B1 S3 dry-run 0 valid rows | **Closed** | Same root as P12-Sec F11; S3 now PASS. |
| B2 two parallel Stripe reconcile implementations | Residual | No fix recorded. |
| H1 wipe fingerprint filter matches only one reconcile scheme | Residual | No fix recorded. |
| H2 `lib/reports/` dead code | **Not residual — phantom** | `residual-clean-code` method note: the cited `lib/reports/`, `lib/exports/`, `lib/ops/test-ops-keys.ts` paths do not exist in this tree. P12-quality H2 was filed against non-existent paths. |
| H3 two address-cleanup endpoints | Residual | Same as P12-Sec F9. |
| M1 two cron routes for payment reconcile | Residual | Same as P12-Sec F2. |
| M2 reports API redundant envelope | Residual | No fix recorded. |
| M3 `performanceReport` excludes DISCARDED inconsistently | Residual | No fix recorded. |
| M4 `reseedTestSeason` is a count, not a reseed | Residual | No fix recorded. |
| L1 `commitImport` re-fetches customer after commit | Residual | No fix recorded. |
| L2 `imports-client` default CSV is customers, not orders | Residual | Related to AG-m4. |

## Net

0 blockers, 5 majors (god files ×6 modules, process-local rate limits, half-done adminHandler migration, customer-visible mojibake), 10 minors, 5 process/hygiene slips. The fix pass closed all three blockers and the S3 smoke blocker without introducing regressions, but left the SR-m1–m9 minors untouched and introduced a new pattern-inconsistency major (adminHandler half-migration). The most actionable single item is AG-M5 (mojibake) because it is customer-visible on the payment path. The largest debt cluster is AG-M1/AG-M2 (six god files over 500 lines). The clearest process gap is AG-P1/AG-P2 (self-fix notes undercount and re-ID the fixes).

**Caveat:** security and quality residual buckets are derived from P12 phase reviews, not from dedicated residual reviews. A dedicated `residual-security-arm-03.md` and `residual-quality-arm-03.md` should be produced to confirm.
