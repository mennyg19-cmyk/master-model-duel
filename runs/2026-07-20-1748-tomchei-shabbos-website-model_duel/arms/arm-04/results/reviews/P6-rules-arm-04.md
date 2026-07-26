# P6 Rules Review — arm-04 (blind)

Reviewer: external, rules specialist. Scope: P6 delta only (admin operations hub, Today queue, order desk, order detail + refund, POS, customer directory, CSV import, admin chrome, bounded list queries / bulk actions). Graded against this arm's selected catalog rules: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`. Findings only — no fixes. No new scope beyond P6.

## Summary

The P6 delta is disciplined. The ladder is respected (hand-rolled RFC 4180 CSV reader instead of a dep, no new packages), `Result<T>` is the single error shape, comments explain intent rather than narrate, the smoke harness drives the real app over HTTP and checks the database afterwards, and the bulk-action report is per-order and deterministic by design. The findings below are narrow.

## Findings

### Major

1. **Dashboard `customers` KPI is dead code and breaks the file's own scoping promise** — `src/lib/admin/dashboard.ts:51` (`db.customer.count()`) and `:22` (`customers: number` on `DashboardKpis`)
   `readDashboard` runs `db.customer.count()` with no `where` — a global count across every season — and returns it as `kpis.customers`. No caller reads `kpis.customers`: the dashboard page (`src/app/(admin)/admin/page.tsx:53-78`) renders `kpi-orders`, `kpi-today`, `kpi-billed`, `kpi-outstanding` only; a repo-wide search for `.customers` finds only the type field and an unrelated comment. The module's header comment (`dashboard.ts:11-14`) states "Every figure here is scoped to the season being run, because a total that quietly included last Purim would be worse than no total" — the dead query violates that promise and `clean-code`'s dead-code rule ("delete, don't comment out") at the same time. Either wire it up season-scoped or drop the field and the query.

### Minor

2. **`sellAtCounter` is non-atomic and a throw from the payment step leaves no audit** — `src/lib/pos/counter.ts:85-94`
   `finalizeOrder` commits the placed order (reserving stock, assigning the order number), then `postOfflinePayment` runs as a separate call. The comment at lines 50-55 documents the deliberate "honest state" trade-off for a *returned* failure (`Result` carries the message), which satisfies `ponytail`'s "never silently choose business logic" rule. The gap is the throw path: if `postOfflinePayment` throws (DB error, connection drop), the order is placed and unpaid with no `Payment` row and no audit of the attempt, and the user sees a 500. `clean-code` error-handling ("error messages say what went wrong AND what the expected state was") has no record that the cash attempt happened.

3. **Bulk-action summary audit is recorded outside any transaction** — `src/app/(admin)/admin/orders/actions.ts:174-184`
   `runBulk` applies per-order mutations (each `transitionOrder` / `repeatOrderAtCounter` writes its own audit inside its own transaction), then `recordAudit` writes the `orders.bulk_action` summary row after the work, with no transaction wrapping the summary. Compare `commitImport` (`src/lib/imports/import-service.ts:161-170`), which records `import.committed` *inside* the commit transaction. If the summary `recordAudit` fails, the per-order audits exist but the batch summary is missing. `clean-code` "one audit pattern per project" is the issue, not correctness.

4. **`repeatOrderAtCounter` open-cart check is outside the transaction** — `src/lib/orders/repeat-order.ts:58-66` (check), `:88` (transaction start)
   The "one till, one open cart per customer" check (`db.order.findFirst`) runs before `db.$transaction`. A single staff member double-clicking "Order this again" can pass the check twice and create two carts for the same customer. The race is self-scoped (`posStaffUserId: staff.acting.id`), so it is not a cross-staff concern, but the guard's intent ("a repeat that quietly merged into a cart already on the screen would double somebody's order") can be defeated by the same person clicking fast.

5. **`writeCustomers` / `writeProducts` do per-row round trips inside the transaction** — `src/lib/imports/import-service.ts:211-248`, `270-288`
   Each row is a `findUnique` + `create`/`update` round trip inside `runInTransaction`. For a 5,000-row batch (the cap in `csv.ts:15`) this is thousands of round trips with locks held for the whole commit. Correct and matches the "atomic" requirement, but a scale concern at the documented cap; flagged because P6's own smoke (S4) and G-024 target crunch volume.

6. **`bulkChangeStatus` skip check reads stale `amountPaidCents`** — `src/lib/orders/bulk-actions.ts:65,75`
   `readOrders` fetches all selected orders once into a `Map`, then the loop checks `order.amountPaidCents > 0` to skip cancelling paid orders. A concurrent refund or payment between the read (line 65) and the per-order `transitionOrder` (line 85) makes the skip decision stale — a refunded order gets skipped, a newly-paid order gets cancelled. Bounded: `transitionOrder` has its own state-machine guards, and the report is per-order so the outcome is visible. TOCTOU only.

## Rules adherence scoreboard

| Rule | Verdict |
|---|---|
| `ponytail` (ladder, anti-bloat) | Strong. Hand-rolled CSV reader instead of a dep; no new packages; `ListSearch`/`Pagination`/`BackLink` extracted once with 3+ call sites (Rule of 2 satisfied); `pos/paths.ts` is the URL-as-state pattern, not a session. |
| `clean-code` (naming, comments, error handling, dead code) | One dead field with a comment-truth violation (finding 1); one non-atomic error outcome with no audit (finding 2); one inconsistent audit pattern (finding 3). Comments are intent-bearing throughout; no narration. |
| `workflow` (verify in running app, gates, security) | Strong. `scripts/smoke-p6.ts` drives the real app over HTTP, reads the DB afterwards, runs the unit-test file by name, and runs `npm run ci`; `imports.manage` / `orders.manage` / `orders.view` permission gates are re-checked inside each server action; `.env.example` already carries the new secrets. |
| `vocabulary` | No command words issued in this delta; n/a. |
| `codegraph` | Not evaluable from the delta alone; no grep-for-structure evidence in P6 files. |

## Counts

- blocker: 0
- major: 1
- minor: 5
