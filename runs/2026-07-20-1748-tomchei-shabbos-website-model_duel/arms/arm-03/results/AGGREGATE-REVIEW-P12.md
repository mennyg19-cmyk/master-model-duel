# P12 Aggregate Review -- arm-03

**Phase:** P12 -- Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Tree:** `arms/arm-03/workspace/`
**Inputs:** `results/reviews/P12-{security,quality,rules,clean-code}-arm-03.md`
**Method:** Union + dedupe by location+claim. No new findings. Severity remap (per P11/P12 reference): Blocker = Quality Critical / Security High-or-Critical on trust boundary; Major = Security Medium, Quality Major, Rules High/Medium, Clean-code High/Medium; Minor = Security Low/Info, Quality Minor, Rules Low, Clean-code Low.

## Classification

- **Blocker** -- must fix before gate.
- **Major** -- fix in fix pass.
- **Minor** -- hardening / polish.

## Counts

| Blocker | Major | Minor | Total |
|---|---|---|---|
| 0 | 7 | 15 | 22 |

Quality review returned **PASS** with no findings (two non-blocking observations on S5 dress-rehearsal fidelity, recorded as notes, not findings). Security surfaced no Critical/High trust-boundary issue. Rules review explicitly retracted a prior fabricated version; only the verified findings below are carried.

## Blockers (0)

None. All four reviewers agree the P12 trust boundaries are sound: every admin route gates through `requirePermissionApi`; all six crons use `requireCronAuth` (constant-time compare, 503 when `CRON_SECRET` unset); test console fail-closes to 404 outside test mode; exports stream with audit-on-complete-and-abort and CSV formula neutralization; legacy import is dry-run-then-commit keyed by SHA-256 file hash; address-book edits verify `address.customerId === customerId` (no IDOR).

## Majors (7)

| # | Title | Location | Sources |
|---|---|---|---|
| M1 | Reconciliation manual POST has no concurrency guard while the cron path does -- `runPaymentReconciliation()` creates `PaymentReconFlag` rows one-by-one **outside any transaction**; `reference` is `@unique`. Two concurrent POSTs (double-click; `useHubAct` has no busy/disabled guard) both compute the same findings, both `create` the same reference -> P2002 mid-loop -> 500, and the `writeAudit` after the call never runs, so a failed recon run leaves a partial flag set with no audit row. Cron wraps the same call in `runCronJob` (overlap-skip); manual route has no equivalent. | `app/api/admin/reconciliation/route.ts:20-31`; `lib/payments/reconcile.ts:169-179`; `lib/cron.ts:33-59`; `components/admin/use-hub-act.ts:14-19` | sec P12-S1, rules F1 |
| M2 | Legacy commit **overwrites** the season `orderCounter` instead of taking the max. A live order created between `planLegacyImport` and the orders stage increments the counter; the import then sets `orderCounter: maxNumber`, resetting it backward, so the next live order reuses a number the import already wrote -> `orderNumber` collision. Must be `Math.max(current, maxNumber)` or an atomic conditional update. | `lib/legacy-import/commit.ts:237` | rules F2 |
| M3 | Legacy commit PUT rejects `COMPLETED` but not `COMMITTING`. Two concurrent PUTs both pass the gate, both call `commitLegacyImport`, both run the catalog stage; `LegacyImportStage` has `@@unique([runId, stage])` so the second stage-marker `create` throws P2002 -> 500. Commit button has no busy guard. | `app/api/admin/legacy-import/route.ts:79-87`; `prisma/schema.prisma` `@@unique([runId, stage])`; `lib/legacy-import/commit.ts:33` | rules F3 |
| M4 | `adminHandler` (`lib/api/admin-handler.ts`) captures permission gate -> open-season 409 -> body parse -> `ActionError` map, but only **11 of 63** admin routes use it. The other 52 hand-write `requirePermissionApi(...)` + `if ("response" in gate) return gate.response` + `safeParse(await request.json().catch(...))` + `Response.json({error},{status:400})`. Root cause: `adminHandler` hardcodes `getOpenSeason()` (409 when no season), so routes outside an open season (refunds, bulk finalize, season management, media, staff, reconciliation) can't adopt it. Make the season gate opt-in (`requireSeason?: boolean`) and the helper covers ~50 more routes. | `app/api/admin/**` (63 routes); `lib/api/admin-handler.ts` | clean-code 1 |
| M5 | `addressOf(pkg)` shape mapper (`{ line1, line2, city, state, zip }`) redefined in 4 lib modules. Rule of 2 satisfied long ago -- promote to `lib/addresses/normalize.ts` (already exists) and import. | `lib/routes/service.ts`; `lib/repeat.ts`; `lib/shipping/labels.ts`; `lib/routes/print.ts` | clean-code 2 |
| M6 | Two button patterns coexist in `components/**` (~28 files): `<Button>` (~83 uses) and raw `<button className="rounded-md border border-border ...">` (~62 uses). The exact small-secondary string `rounded-md border border-border px-2 py-0.5 text-xs hover:bg-brand-soft disabled:opacity-50` appears 6x verbatim across `package-board`, `pickup-actions`, `shipment-actions`, `route-actions`, `fulfillment-actions`. Extend `Button` with `size="sm"` + `variant="secondary"` and migrate, or document raw `<button>` as allowed for one-off sizes. | `components/**` | clean-code 3 |
| M7 | `lib/routes/service.ts` (476 lines, 21 KB) is a borderline god file mixing four concerns: route building (`buildRoute`), day-of notifications (`captureDayOfNotifications`), stop delivery (`markStopDelivered`), and method-switch + reroute (`switchPackageMethod`, `rerouteSuggestions`, `confirmReroute`). Each is a distinct lifecycle with its own callers. Splitting into `lifecycle.ts` / `method-switch.ts` / `reroute.ts` drops each below 200 lines. Not urgent, but the next feature here will push it over. | `lib/routes/service.ts` | clean-code 4 |

## Minors (15)

| # | Title | Location | Sources |
|---|---|---|---|
| m1 | Mock-gateway checkout trigger has no auth and no customer-session check. Anyone who knows a `stripeSessionId` can POST `checkout.session.completed` for any session, with an arbitrary `amountCents` override (the "test hook" from the comment). Test-mode only (refused when a live Stripe key is set), so impact is bounded to mock money -- but lets an unauthenticated caller complete any checkout for any amount, bypassing the test customer's own session. | `app/api/dev/stripe-checkout/route.ts:22-61` | sec P12-S2 |
| m2 | First-manager bootstrap has no rate limit. The transaction guards the race (only one manager created, then 423), but on a fresh deploy an attacker can spam POST `/api/setup` with a known email/password trying to win the race before the operator does. No lockout, no IP throttle. | `app/api/setup/route.ts:19-62` | sec P12-S3 |
| m3 | Synthetic emails for nameless/phoneless rows use `legacy+${slugify(name \|\| phone \|\| String(line))}@imported.invalid`. When `name` is empty and `phone` is null, the fallback is `String(line)` (unique per line), but when `name` is the literal fallback `"Imported customer"` for two distinct people with no usable identity, both collapse onto the same `name:imported customer` key and the same synthetic email, merging two unrelated people into one Customer row. Data-integrity issue, not a privilege boundary. | `lib/legacy-import/plan.ts:185-197` | sec P12-S4 |
| m4 | Resolving a `PaymentReconFlag` (marking a money discrepancy closed) gates on `reports.view` -- the same permission that views reports. A staff member who can read the recon list can also silently resolve (hide) a genuine orphaned-payment flag. No separate "resolve" permission exists. Consider gating PATCH on `payments.refund` or a new `reconciliation.resolve` permission. | `app/api/admin/reconciliation/route.ts:35-56` (PATCH) | sec P12-S5 |
| m5 | `wipeOpenSeason` is a hard delete of every transactional row for the open season (orders, packages, shipments, payments, intents, recon flags). No soft-delete, no snapshot. Documented test-only and the route 404s in live mode -- but a misconfigured staging deploy (`NODE_ENV!=production`, no `STRIPE_SECRET_KEY` -> `isTestMode()` true) that's publicly reachable exposes a one-click season wipe to anyone with `settings.manage`. | `lib/test-console.ts:16-66` | sec P12-S6 |
| m6 | Two money formatters produce different strings for the same cents value. Reports page local `money()` -> `$1,234.56` (locale commas); shared `formatCents()` -> `$1234.56` (no commas). Two homes, two outputs across the same app. | `app/(admin)/admin/reports/page.tsx:9-11`; `lib/catalog.ts:52-54` | rules F4 |
| m7 | Same reconciliation operation leaves an audit trail in two different surfaces depending on the trigger. Manual POST writes an `AuditLog` row; the cron writes only a `CronRunLog` (no `AuditLog`). A staff member reviewing the audit log cannot see that recon ran nightly. | `app/api/admin/reconciliation/route.ts:24-29`; `app/api/cron/stripe-reconciliation/route.ts:10` | rules F5 |
| m8 | Export audit `rows` count is off-by-one: `rowCount` increments for every yielded CSV line **including the header**, so the audit `detail.rows` (and the export-history table) overstates data rows by 1 for every dataset. | `app/api/admin/exports/[dataset]/route.ts:55`; `lib/exports.ts` | rules F6 |
| m9 | `marginReport` per-label rows are not season-scoped and cap at 200 with no pagination, while the reports page already has a season picker for the drill-down. At the 5k-package baseline the "Per label" table is a 200-row cross-season window with no way to scope or page it; season totals and per-label rows answer different questions on the same card. | `lib/reports.ts:154-169`; `app/(admin)/admin/reports/page.tsx:160` | rules F7 |
| m10 | `lapsed-customers` export uses a correlated per-customer subquery (`SELECT se.name ... LIMIT 1`) plus `NOT EXISTS` per customer. Every other dataset is set-based; this one fires N correlated subqueries at multi-season scale (thousands of customers). | `lib/exports.ts:108-124` | rules F8 |
| m11 | Mojibake in `lib/shipping/margin.ts` comments: `chargeCents a~' buy.amountCents` and `quote a" the comparison set` -- UTF-8 bytes (`-`, `--`) decoded as Latin-1, so the file was saved/read with the wrong encoding. | `lib/shipping/margin.ts:13,15` | rules F9 |
| m12 | `scripts/smoke-p12.ts` (751 lines) is a single `main()` walking S1-S5 plus wipe/reseed. It's a smoke script, so the bar is lower, but the file is now the longest in the repo and the only one over 500 lines. Splitting per-scenario (`smoke-p12-reports.ts`, `...-recon.ts`, `...-legacy.ts`) with a shared `loadDotEnv` + evidence helper would make failures easier to localize. | `scripts/smoke-p12.ts` | clean-code 5 |
| m13 | Magic values: `REROUTE_RADIUS_MILES = 0.5` is named (good), but `BULK_LIMIT = 200` (`orders/bulk/route.ts`), `SHIPPO_TIMEOUT_MS`, and a few rate-limit windows are local literals with no central home. Most are colocated with their use, which is fine -- flagging only because the routing and shipping modules each keep their own timeout constants. | `lib/routes/service.ts:15`; `app/api/admin/orders/bulk/route.ts`; shipping modules | clean-code 6 |
| m14 | `AdminHandlerContext<P, B>` -- `B` / `P` single-letter generics read less clearly than `Params` / `Body` would. Cosmetic. | `lib/api/admin-handler.ts:13` | clean-code 7 |
| m15 | `message.includes("No Order found")` string-matches Prisma's `findUniqueOrThrow` error text to reword it. Fragile -- a Prisma version bump or a non-English locale could change the message. Prefer catching the known Prisma code (`P2025`) via `Prisma.PrismaClientKnownRequestError` and emitting the plain "Order not found" string. | `app/api/admin/orders/bulk/route.ts:57` | clean-code 8 |

## Dedupe map (collapsed duplicates)

- M1 <- sec P12-S1 + rules F1 (manual reconciliation POST has no concurrency guard; per-finding `create` outside any transaction; P2002 -> 500; `writeAudit` never runs; cron path wraps in `runCronJob`, manual path does not). Same location, same claim -- merged. Severity: rules High + security Medium both map to Major under the P12 convention.

No other overlaps. Quality review contributed no findings. Security S2-S6, rules F2-F9, and clean-code 1-8 are all distinct locations/claims.

## Notes (carried, not findings)

- **Quality PASS** -- all 5 EXPECTED items shipped, smoke 5/5, CI green (lint + typecheck + migration:guard + 78 tests), evidence files present and internally consistent. Two non-blocking S5 dress-rehearsal fidelity observations (order created via service calls not the public `/api/checkout` HTTP flow; reroute performed on a second fresh shipping package because the SENT original can't switch) -- both documented in-code, neither undermines reconciliation or state-machine coverage.
- **Cron auth sound** -- all 6 cron routes use `requireCronAuth` (bearer, `timingSafeEqual` with length pre-check, 503 when `CRON_SECRET` unset); `runCronJob` reaps stale running claims >10min and serializes overlaps via oldest-claim-wins. `vercel.json` registers all 6 schedules.
- **Test console fail-closed** -- `isTestMode()` checked before the permission gate so the route 404s (not 401) outside test mode; `settings.manage` required; wipe is one transaction (120s timeout); smoke S5 confirms 5003 packages wiped in 2.5s.
- **Legacy import trust boundary** -- `imports.legacy` gate; PUT requires the exact bytes hash-match a prior dry-run; plan re-derived from posted bytes so a body swap can't sneak past; `parseCsv` enforces `MAX_IMPORT_ROWS=5000`; `bodySchema` caps csv at 5MB; review queue resolves by `itemId` with `status: "open"` guard.
- **IDOR** -- address-book PATCH verifies `address.customerId !== customerId` -> 404; reports drilldown validates `seasonId` against the performance list before calling `seasonDrilldown`. Single-tenant, so cross-org IDOR is moot, but within-tenant checks are present.
- **CSV formula injection** -- `lib/csv.ts:csvField` tab-prefixes any field starting with `=+\-@` on export; customer-controlled greeting/name/address can't execute when staff open the export in Excel.
- **Rules review retraction** -- the rules reviewer explicitly retracted a prior fabricated version of `P12-rules-arm-03.md` (9 findings, 3H/4M/2L) that cited non-existent paths (`src/lib/ops/reconcile.ts`, `src/lib/ops/import.ts` 702 lines, `src/lib/reports/margin.ts`, `src/lib/exports/center.ts`, `src/app/api/admin/address-cleanup/`, `src/lib/ops/test-ops.ts`, missing `.scratch/phase-plan.md`). None of those paths exist in `arms/arm-03/workspace`. Only the verified findings (F1-F9 above) are carried. The prior `AGGREGATE-REVIEW-P12.md` was based on that fabricated input and is superseded by this file.
- **Codegraph** -- `.codegraph/` present; no codegraph-rule violation observed.
- **Dependency discipline** -- no new convenience deps in P12; CSV parsing reuses the existing `lib/csv.ts` (`parseCsv`/`csvLine`).

## Verdict

P12 ships the EXPECTED surfaces with sound trust boundaries and a clean 5/5 smoke. No blockers. Seven majors cluster on three themes: reconciliation money-surface concurrency (M1, with audit-surface drift m7), legacy-import counter/concurrency (M2, M3), and shared-handler adoption + duplicated mapper + UI button drift (M4, M5, M6, M7). Recommend: treat P12 as **PASS with findings** -- gate after M1, M2, M3 are addressed (money-path + data-integrity); M4-M7 are fix-pass work.

---

Output path: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-03/results/AGGREGATE-REVIEW-P12.md`
