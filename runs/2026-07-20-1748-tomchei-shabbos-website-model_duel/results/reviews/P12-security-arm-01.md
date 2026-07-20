# P12 Security Review — arm-01 (blind)

**Phase:** P12 (Reporting, exports, reconciliation, historical migration, scale hardening, launch readiness)
**Scope:** `arms/arm-01/workspace/` — files added/modified in P12
**Focus:** trust boundaries, auth, secrets, IDOR, injection. Findings only — no fixes.
**Reviewer blind to model identity.**

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 6 |
| Low | 5 |
| **Total** | **12** |

## HIGH

### H1 — CSRF on destructive/financial admin POST routes
**Files:** `src/app/api/admin/test-console/route.ts`, `src/app/api/admin/legacy-imports/route.ts`, `src/app/api/admin/legacy-imports/[batchId]/commit/route.ts`, `src/app/api/admin/stripe-reconciliation/route.ts`, `src/app/api/admin/help/route.ts`
P12 adds destructive endpoints (test-console `wipe`/`seed`/`reset`/`setMode`, legacy-import `stage`/`commit`) and a financial endpoint (manual Stripe reconciliation). All authenticate via `requirePermission`, which resolves the session from Clerk cookies (`getCurrentStaffUser`) with no CSRF token, no `Origin`/`Referer` validation, and no visible `SameSite=Strict` enforcement on the session cookie. A malicious third-party page can trigger cross-site POSTs that mutate or wipe production data and trigger financial reconciliation. Clerk's default `SameSite=Lax` blocks top-level form POSTs but not all CSRF vectors (e.g. `fetch` with `credentials: "include"` under same-site sibling subdomains, or any same-site XSS). The blast radius is now data-loss + financial, not just read.

## MEDIUM

### M1 — Legacy import payload is unbounded in aggregate → resource exhaustion
**File:** `src/app/api/admin/legacy-imports/route.ts` (zod schema), `src/domain/legacy-import.ts`
The zod schema permits 25,000 customers each with up to 25,000 addresses (625M address entries), 25,000 products, and 25,000 orders with up to 1,000 lines each. The whole document is parsed, `JSON.stringify`-hashed, stored as a single JSONB `payload`, and later re-processed. No explicit request body-size cap is enforced at the route. A single authorized `settings:manage` user can submit a multi-GB body that exhausts Node memory, Postgres storage, and parser time.

### M2 — `commitLegacyImport` runs the entire import in one serializable transaction
**File:** `src/domain/legacy-import.ts` (`commitLegacyImport`, isolation `Serializable`)
The full document (up to 25k orders × 1k lines plus customer/address/product upserts) is committed inside a single `$transaction` with `Serializable` isolation and no chunking. At scale this holds locks for minutes, blocking other writers (orders, payments, fulfillment) and degrading availability — a self-inflicted DoS amplified by M1.

### M3 — Customer dedup silently grafts legacy records onto live customers
**File:** `src/domain/legacy-import.ts` (`commitLegacyImport`, customer lookup)
Existing customers are matched by `legacySourceId` OR `emailNormalized` OR `phoneNormalized`. If a legacy customer's email/phone matches a live customer with a different `legacySourceId`, the import reuses that customer and attaches legacy addresses and historical finalized orders to the live account without confirmation. The dry-run inspector (`inspectLegacyDocument`) does not flag this cross-boundary merge. A sloppy or malicious import can graft historical orders and addresses onto a real customer's identity.

### M4 — CSV formula-injection guard bypassable via leading whitespace
**File:** `src/domain/launch-exports.ts` (`protectSpreadsheetCell`)
`protectSpreadsheetCell` only prefixes `'` when the cell starts with one of `= + - @ \t \r`. Spreadsheet applications trim leading whitespace before evaluating formulas, so a value like `" =2+2"` or `" \t=HYPERLINK(...)"` bypasses the guard. User-controlled fields (`recipient`, `customer`, `email`, `recipientName` snapshots) flow into exports and can carry such payloads.

### M5 — Cron Stripe reconciliation writes no audit-log entry
**File:** `src/app/api/cron/stripe-reconciliation/route.ts`
The manual admin route records `stripe_reconciliation.completed` in `AuditLog`, but the cron route does not. Automated daily reconciliation runs (financial operation) leave no auditable trail of who/when/what — only the `ReconciliationRun` row, with no actor attribution. The phase requirement that crons be authed is met, but auditability is asymmetric.

### M6 — Reconciliation only reads the first 100 Stripe PaymentIntents
**File:** `src/domain/stripe-reconciliation.ts` (`readProviderIntents`)
`stripe.paymentIntents.list({ limit: 100 })` is not paginated. `ORPHAN_PROVIDER_INTENT` detection therefore only covers the most recent 100 intents; anything older is invisible and the run can report a false-clean reconciliation. This undermines the financial-integrity guarantee the phase calls for (S2: "orphaned PaymentIntent flagged").

## LOW

### L1 — `x-cron-run-key` header is attacker-controllable and used as a DB unique key
**File:** `src/app/api/cron/stripe-reconciliation/route.ts`
The cron route accepts `x-cron-run-key` verbatim as `runKey` (no length/charset validation) and stores it. A caller who passes `CRON_SECRET` can pre-empt a future day's default runKey (`stripe-reconciliation:YYYY-MM-DD`) to pre-create a `COMPLETED` run and suppress that day's real reconciliation. Mitigated by `CRON_SECRET` gating.

### L2 — Cron reconciliation race on the default per-day runKey
**File:** `src/app/api/cron/stripe-reconciliation/route.ts`, `src/domain/stripe-reconciliation.ts`
Default `runKey` is `stripe-reconciliation:${day}`. Two concurrent invocations both pass the `existing?.status === "COMPLETED"` short-circuit, both upsert to `RUNNING`, and both execute. Findings are deduped by `identityKey`, but `matchedCount`/`findingCount` and the `RUNNING`→`COMPLETED` transition can race. No advisory lock or unique claim guard.

### L3 — Exports silently truncate at 25,000 rows
**File:** `src/domain/launch-exports.ts` (every dataset uses `take: 25_000`)
All export queries cap at 25,000 rows with no overflow flag, so a season larger than the cap produces an export that omits rows without any indication. Evidence completeness for audit/finance is silently degraded.

### L4 — Export "streaming" materializes the full CSV in memory first
**File:** `src/app/api/admin/exports/route.ts`
`getExportRows` loads all rows, `encodeCsv` builds the entire CSV string in memory, and only then is it chunked into a `ReadableStream`. The streaming is cosmetic; peak memory holds the full CSV. Not a vulnerability at 25k rows, but the streaming response misrepresents the memory profile.

### L5 — Test-console `wipe` deletes customers by order association, not by ID prefix
**File:** `src/domain/test-console.ts` (`wipeScaleFixture`)
Scale orders are identified by `draftReference startsWith "p12-scale-"`, and customers are then deleted by `id in orders.map(order => order.customerId)`. If a scale order ever references a real customer id (e.g. via a future seed change), `wipe` would delete the real customer. Gated to non-production (`assertTestConsoleEnabled`), so impact is limited, but the deletion predicate is fragile.
