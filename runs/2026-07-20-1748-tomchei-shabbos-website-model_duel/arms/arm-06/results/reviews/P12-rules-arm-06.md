# Reviewer specialist — Rules — P12 — arm-06 (blind)

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Tree:** arms/arm-06/workspace/
**Phase:** P12 — Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness
**Plan ref:** shared/phases/PHASE-P12-EXPECTED.md, shared/MERGED-BUILD-PLAN.md § P12
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph (.cursor/rules/*.mdc)
**Reviewer:** rules specialist, blind to model name
**Scope:** adherence to this arm's selected catalog rules only. Findings only, no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 9 |
| **Total** | **11** |

Phase coverage against PHASE-P12-EXPECTED.md is complete: all five "must be true" items have code + a domain test (`scripts/test-p12-domain.mjs`, 30+ assertions) plus the smoke path. The findings below are rule-adherence defects, not missing features. No `.scratch/PHASE-P12-STATUS.md` or `PHASE-P12-SMOKE.md` exists in this workspace (see m9).

---

## Major

### M1. Resolve-review comment claims an "edit first" workflow the admin UI never exposes (anti-hallucination + UR-014 workflow gap)
`app/api/admin/customers/[customerId]/addresses/[addressId]/resolve-review/route.ts:7-8` states: "a flagged (needsReview) address is resolved by a human confirming or correcting it — the flag clears, audited. Corrections go through the normal address PATCH first, then this clears the flag." The cleanup UI does not expose that PATCH path. The customer page (`app/(admin)/admin/customers/[customerId]/page.tsx:82-99`) renders the address book as a read-only `<li>` list with a "needs review" badge; `CustomerEditor` (`customer-editor.tsx`) edits only name/phone. `BookCleanup` (`book-cleanup.tsx`) offers exactly two actions: merge duplicates, and "Confirm" (clear the flag). The staff PATCH route (`app/api/admin/customers/[customerId]/addresses/[addressId]/route.ts`) exists and is audited, but no admin component calls it — the only `EditSavedAddressDialog` lives in `components/order-builder/`, which is the storefront order builder, not the cleanup console. So a staff member facing a flagged address with a bad ZIP can either clear the flag (leaving the poisoned value) or merge it away — the "correct the value then confirm" path the comment describes is unreachable from the cleanup UI. The comment is an unverified claim about a workflow that does not exist in the surface it documents.

### M2. Method-drilldown "Shipping charged" includes VOIDED labels while the margin rollup excludes them; the comment claims they match (clean-code § consistency / anti-hallucination)
`lib/reports/seasons.ts:103-107` (`getMethodDrilldown`) groups `Shipment` by `status: { in: ["PURCHASED", "VOIDED"] }` and sums `chargedCents` across both, then exposes the total as `shippedChargedCents` on the SHIPPED row. `lib/reports/margin.ts:85-88` (`getMarginRollup`) filters `status: "PURCHASED"` only — VOIDED labels are excluded because "a void returns the margin." The `getMethodDrilldown` comment (lines 88-90) says "the shipped column books what customers were charged for labels (the margin ledger's charged side)" — i.e. it claims parity with the margin ledger. That is false: the margin ledger's charged side is PURCHASED-only, so for any season with a voided label the method drilldown's "Shipping charged" is strictly higher than the margin rollup's "Charged" for the same season. Two reports of the same concern (what customers were charged for shipping) use different status filters, and the comment asserts they agree when they do not.

---

## Minor

### m1. `getMarginRows` hard-caps at 200 rows with no pagination or truncation indicator (anti-hallucination)
`lib/reports/margin.ts:76` defaults `take` to 200; the page calls `getMarginRows({ seasonId })` with no take, so the per-package ledger table (`app/(admin)/admin/reports/page.tsx:250-293`) silently truncates at 200 shipments. There is no "showing 200 of N" indicator and no pagination control. A season with >200 shipments renders a table that looks complete but is not — the page heading "Per-package ledger" implies exhaustiveness.

### m2. `deliveries` export matches packages to recipients by `recipientName` string equality (clean-code § correctness)
`lib/exports/datasets.ts:94` does `row.order.packages.find((candidate) => candidate.recipientName === row.name)` to attach the package stage to a delivery row. Two recipients with the same name on one order both resolve to the first matching package, so the second recipient's row reports the first recipient's `package_stage`. The grouping key (P2) includes recipient name, but a name collision within one order is still possible (e.g. two "Rivky Weiss" recipients at different addresses); the export does not deduplicate by the full grouping key.

### m3. `legacy/orders.ts` re-queries the full catalog per order group instead of caching per season (ponytail § scale)
`lib/imports/legacy/orders.ts:237` runs `tx.product.findMany({ where: { seasonId: season.id } })` inside the per-order-group loop. `legacyProductsImport` (`lib/imports/legacy/products.ts:74-82`) caches the season id by year; the orders handler does not cache the catalog by season. For a 2000-row import spread across many orders, this holds the commit transaction open with N full-catalog round-trips.

### m4. `legacy/customers.ts` does two `findUnique` calls per row inside one transaction (ponytail § scale)
`lib/imports/legacy/customers.ts:110-111` runs `tx.customer.findUnique({ where: { email } })` and `tx.customer.findUnique({ where: { normalizedPhone } })` per row inside `commitLegacyCustomerRows`. For a 2000-row import that is up to 4000 round-trips holding the commit transaction open. A single `findMany({ where: { OR: [...] } })` up front with a Map would collapse the per-row queries.

### m5. `testops/actions.ts` `clear` resets `reserved` but not `onHand`, leaving stale inventory (clean-code § correctness)
`lib/testops/actions.ts:122-127` resets `inventoryItem.reserved = 0` and `season.lastOrderSeq/lastDraftSeq = 0` after truncating the transactional tables, but `inventoryItem.onHand` is left at its post-finalization value. The `clear` description (`test-ops-console.tsx:18-20`) says it "Keeps the season, catalog, customers, and settings" — inventory is part of the catalog, so it survives, but its `onHand` now reflects decrements from orders that no longer exist. A rehearsal act that finalizes 10 units then runs `clear` starts the next act with 10 units of phantom consumption. `reset` (wipe + reseed) fixes it; `clear` alone does not.

### m6. `testops/actions.ts` WIPE/CLEAR table lists are hardcoded and manually synced to `@@map` (clean-code § latent footgun)
`lib/testops/actions.ts:15-100` — `WIPE_TABLES` and `CLEAR_TABLES` are string arrays hand-maintained against `prisma/schema.prisma` `@@map` values. The comment on line 14 acknowledges the sync ("Table names = @@map values in prisma/schema.prisma") but no test or guard enforces it. A future migration adding a table would silently leave it un-wiped/un-cleared, so a `reset` would not actually restore a clean test season for that table. The migration-guard CI check does not cover this list.

### m7. `ReconciliationRun.actorId` is a dangling string with no FK relation and no reader (clean-code § dead surface)
`prisma/schema.prisma:1275` declares `actorId String?` with no `actor StaffUser? @relation(...)`. `lib/reconcile/matcher.ts:33` writes `actorId: input.ctx?.staff.id ?? null`; the page (`app/(admin)/admin/reconciliation/page.tsx:120`) reads only `run.actorEmail`. No query joins `ReconciliationRun.actorId` to `StaffUser`. The audit log (`recordAudit` with the full ctx) is the canonical actor trail, so `actorId` on the run row is an orphaned string written but never read — same class as the P11 `EmailCampaign.createdById` finding, lower stakes because `actorEmail` is the display field.

### m8. `lapsed-customers` export defines "revenue" from order totals while reports define it from POSTED payments (clean-code § consistency / vocabulary)
`lib/exports/datasets.ts:269` computes `lifetime_revenue_dollars` as `row.orders.reduce((sum, order) => sum + order.totalCents, 0)` over finalized order totals. `lib/reports/seasons.ts:4-7` defines revenue as "POSTED payments only — the payment ledger is the money truth, not order totals, so a refunded season stays honest." The `year-metrics` export (`datasets.ts:178`) follows the reports' POSTED-payments definition. So "revenue" means one thing in reports + year-metrics and a different thing in lapsed-customers. A refunded lapsed customer shows higher `lifetime_revenue_dollars` in the export than their contribution to any season's `revenue_dollars` in reports. The term is overloaded across two exports of the same domain.

### m9. No `.scratch/` phase plan, run-state, or smoke evidence; `.gitignore` does not list `.scratch/` (workflow § expectation files)
`workflow.mdc` (Expectation Files / Run checkpoint) requires a rolling `.scratch/phase-plan.md` with EXPECTED blocks before each todo and a `.scratch/run-state.md` updated on gate pass; `PHASE-P12-EXPECTED.md` names `arms/{id}/workspace/.scratch/PHASE-P12-SMOKE.md` as the smoke evidence path. None of these exist in `arms/arm-06/workspace/`, and `.gitignore` does not include `.scratch/` (so the folder is not even set up to be gitignored). The contestant relied on `scripts/test-p12-domain.mjs` for verification instead of the expectation-file discipline. The phase landed and tests pass, but the pre-committed self-review artifact trail the rule mandates is absent.

---

## Rule coverage notes (no finding)

- **codegraph.mdc**: this reviewer is a subagent without the MCP; structural lookups used Read on literal paths, not Grep-for-symbols. No codegraph violation is asserted against the arm.
- **workflow.mdc § Gate discipline**: lint/typecheck/migration-guard/test:unit/test:domain/build all reported green; the P12 domain suite (`test-p12-domain.mjs`) passes 30+ assertions covering S1–S4 domain behavior. The gate discipline gap is the missing expectation-file artifact (m9), not an unchecked checklist item.
- **workflow.mdc § Shell execution**: no inline `$` PowerShell in the new P12 files; cron routes and scripts use the `cronRoute` skeleton and `.mts` script files.
- **ponytail.mdc § ladder**: no new packages added in P12. Reconciliation, exports, reports, imports, and test-ops are all built on existing Prisma + native `fetch` + the existing `lib/csv` engine. The ladder rungs are honored.
- **ponytail.mdc § anti-slop**: comments across `lib/reconcile/matcher.ts`, `lib/exports/datasets.ts`, `lib/reports/{seasons,margin}.ts`, `lib/imports/legacy/*`, and `lib/testops/*` are non-obvious intent (one-claim law, capture-mode honesty, order-number repair rationale, terminal-state choice for refunded orders), not narration. No sycophancy or stock vocab in code comments.
- **vocabulary.mdc**: no refactor/tidy/rebuild commands in scope this phase; "add" (new reports/exports/reconciliation/import kinds/test console) followed existing patterns (`requireApiPermission`, `recordAudit`, `DomainRuleError`, `mapDomainError`, `apiFetch`, Card/Button/Badge, `cronRoute`).
- **clean-code § Dependency Discipline**: no new deps; versions already pinned from earlier phases.
- **clean-code § UI Consistency**: the new admin pages (reports, export, reconciliation, imports, test-ops, help) reuse the existing admin shell, header, sidebar, `BackLink`, Badge, and stone/brand token palette. No rogue styling.
- **R-185 cron registration**: `vercel.json` registers 8 crons (nightly-print, outbox-sweep, payment-reminders, pickup-expiry, season-flip, shipping-maintenance, email-log-purge, reconcile-stripe), all routed through `lib/cron-route.ts` → `isCronAuthorized` (constant-time bearer compare). The plan text says "all 5 Vercel crons" — the implementation exceeds that count; every cron has secret auth. Not a violation.

## Out of scope

- Live Stripe key validation — no key on this host; the matcher's fixture/capture-mode honesty is the documented class (same as P5/P8/P11).
- Performance of the scale dress rehearsal (S5) under real 5k-package load — the findings above flag transaction-span and unbounded-query patterns; a load run would surface concrete numbers.
