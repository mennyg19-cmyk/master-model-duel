# P6 Rules Review — arm-01

Reviewer: Rules specialist. Blind to model name. Scope: P6 (Admin operations hub & POS) additions in `arms/arm-01/workspace/`.
Phase spec: `shared/phases/PHASE-P6-EXPECTED.md`. Rules graded: ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol. Findings only, no fixes.

## Findings

### F1 — "Season revenue" KPI has no season filter (clean-code §Anti-Hallucination; correctness)
`src/lib/admin-operations.ts:61-64` aggregates `where: { status: "FINALIZED" }` with no `seasonId`, then renders it as "Season revenue" at `src/app/(admin)/admin/page.tsx:32`. The number is all-season revenue under a per-season label. `getCurrentSeason()` exists and is used elsewhere in P6; the dashboard ignores it. Mislabeled + wrong value.

### F2 — `audit:view` permission defined but never enforced (clean-code §Consistency, §Inconsistent patterns)
`src/lib/permissions.ts:7` declares `audit:view` (MANAGER-only via the full list, STAFF gets only `admin:view`). No call site uses it. The audit page guards on `admin:view` (`src/app/(admin)/admin/audit/page.tsx:7`), the overview API returns recent audit events on `admin:view` (`src/app/api/admin/overview/route.ts:7-13`), and the order-detail audit panel opens on `admin:view` (`src/app/(admin)/admin/orders/[orderId]/page.tsx:17`). Net effect: a restricted STAFF user reads the full staff audit trail. Either the permission is dead or every audit surface is under-gated.

### F3 — `normalizePhone` duplicated 4x with divergent return types (clean-code §Duplicated logic, §Type/schema drift)
Four private copies of the same digits→`+1…`/`+…` rule, three different empty-return contracts:
- `src/app/api/admin/customers/route.ts:14` → `null` on empty
- `src/app/api/admin/imports/route.ts:14` → `""` on empty
- `src/app/api/admin/imports/[batchId]/commit/route.ts:8` → `null` on empty
- `src/lib/csv-import.ts:11` (`normalizeImportedPhone`) → `""` on empty

`src/lib/normalize.ts` already owns `normalizeEmail`; phone belongs there. Rule of 2 is long past met, and the null/"" split is a latent bug source for the import path.

### F4 — POS customer-create API under-gated vs the POS page (clean-code §Consistency)
`POST /api/admin/customers` requires only `admin:view` (`src/app/api/admin/customers/route.ts:21`), but the POS page that calls it via `PosCustomerCreator` requires `payments:manage` (`src/app/(admin)/admin/pos/page.tsx:15`). A STAFF user cannot open POS yet can create customers through this endpoint. The endpoint is a POS action and should match `payments:manage` (or the page should drop to `admin:view` — but it posts payments, so the endpoint is the one that's wrong).

### F5 — Inconsistent nav permission gating (clean-code §UI Consistency)
`src/app/(admin)/admin/layout.tsx:83-100` gates Catalog/Media/Settings behind `settings:manage` and Staff behind `staff:manage`, but POS (line 71), Imports (line 77), and Audit (line 80) are unconditional. STAFF sees all three links and gets a 403 on POS and Imports clicks (Audit renders because of F2). Either gate every protected destination or none; the half-gated nav is a pattern split.

### F6 — Stripe refund issued before the DB transaction (clean-code §Error Handling; ponytail §Never cut: data-loss)
`src/app/api/admin/orders/[orderId]/refunds/route.ts:41-51` calls `stripe.refunds.create` and only then opens `db.$transaction` at line 53. The idempotency key is `admin-refund:${payment.id}:${payment.refundedCents}:${amount}` keyed on the pre-refund `refundedCents` baseline. Failure mode: two actors refund the same payment concurrently with different amounts — both pass the `refundableCents` check against the stale baseline, Stripe issues both refunds (different keys), but only one `updateMany({ where: { refundedCents: <baseline> } })` succeeds; the loser returns 409 while their Stripe refund is already real and never recorded. Crash between the Stripe call and commit orphans a refund the same way. Record intent in DB first, then call Stripe, or reconcile via webhook.

### F7 — Import commit doesn't re-check duplicates and doesn't handle P2002 (clean-code §Error Handling)
`src/app/api/admin/imports/[batchId]/commit/route.ts:31-85` re-reads `batch.rows` and runs `customer.createMany` / `product.createMany` with only the staged `invalidRowCount`/`duplicateCount` as a gate. A customer created between stage and commit trips a unique constraint; the outer catch (line 87-92) only handles `AccessDeniedError`, so P2002 bubbles as an unhandled 500. Stage and commit also disagree on the current season for products (see F16).

### F8 — Dead `PATCH /payments` void handler (clean-code §Dead code; ponytail §Code rules / YAGNI)
`src/app/api/admin/orders/[orderId]/payments/route.ts:85-136` implements a void (`PATCH`) endpoint with its own audit action (`payment.offline_voided`). No UI calls it — `OrderMoneyActions` only POSTs (`src/components/admin-order-actions.tsx:57`), and a workspace-wide grep finds no other caller. Whole handler is "for later." Delete or wire it up.

### F9 — Missing `.scratch/PHASE-P6-SMOKE.md` (workflow §Expectation Files, §Gate discipline)
`PHASE-P6-EXPECTED.md` names the evidence path `arms/{id}/workspace/.scratch/PHASE-P6-SMOKE.md`. The arm has no `.scratch/` directory at all (no `run-state.md`, no `phase-plan.md`, no smoke evidence). `scripts/p6-smoke.ts` exists but there is no record it was run or that the expectation checklist was walked with evidence. Gate is unlogged.

### F10 — Audit views render raw `actorStaffId` cuids (clean-code §UI Consistency / §Naming)
`src/app/(admin)/admin/audit/page.tsx:21` and `src/app/(admin)/admin/orders/[orderId]/page.tsx:63` print `event.actorStaffId ?? "System"` — a raw cuid, not a display name. The audit log already joins `actorStaffId` to `StaffUser`; the overview and layout resolve `effective.displayName` elsewhere, so the resolver pattern exists. Audit is the one screen that most needs a human-readable actor.

### F11 — `getOrderDetail` over-fetches (ponytail §Code rules: shrink)
`src/lib/admin-operations.ts:122-123` includes `paymentIntents` and `packages`, but `src/app/(admin)/admin/orders/[orderId]/page.tsx` only consumes `customer`, `season`, `lines`, `payments`, `totalCents`, `status`, `cachedPaymentStatus`, `orderNumber`, `draftReference`. Two unused relations fetched per detail load.

### F12 — `result` standalone variable name (clean-code §Naming)
`src/app/api/admin/orders/[orderId]/payments/route.ts:96` `const result = await db.$transaction(...)`. `result` is on the banned-as-standalone list; `paymentOutcome` (or an inline return) reads as the thing it is.

### F13 — "Good evening" hardcoded regardless of time (clean-code §UI Consistency / copy)
`src/app/(admin)/admin/page.tsx:25` always greets "Good evening". Cosmetic, but it's a fact claim that's wrong most of the day and the page is server-rendered with `dynamic = "force-dynamic"`, so a time-aware greeting is cheap.

### F14 — Overview heading weight drifts from the rest of admin (clean-code §UI Consistency)
`src/app/(admin)/admin/page.tsx:24` uses `text-4xl font-bold tracking-tight`; every other P6 admin page uses `text-4xl font-black` (e.g. `today/page.tsx:14`, `orders/page.tsx:33`, `customers/page.tsx:41`). One screen looks different from the rest — exactly the "if a new screen looks different, that's a bug" rule.

### F15 — Inline magic list caps and a duplicated 2000-row limit (clean-code §Magic values)
`ADMIN_PAGE_SIZE`/`MAX_BULK_ORDERS` are named in `admin-operations.ts:5-6`, but the rest are inline: `take: 100` (`admin-operations.ts:98`), `take: 200` (`audit/page.tsx:10`), `take: 50` (`imports/page.tsx:11`), `take: 12` (`overview/route.ts:12`), `take: 6` (`admin/page.tsx:15`), `take: 8` (`admin-operations.ts:67`). The `2000`-row import cap appears in `csv-import.ts` (implicit via the route), `imports/route.ts:75`, and the UI copy at `imports/page.tsx:18` and `import-manager.tsx` — same number, four homes.

### F16 — Product duplicate detection silently no-ops without a current season (clean-code §Inconsistent patterns)
`src/app/api/admin/imports/route.ts:48-56` reads `current-season-id`; if missing, `seasonId = ""` and the `product.findMany({ where: { seasonId: "", ... } })` match set is empty, so stage reports zero duplicates. `src/app/api/admin/imports/[batchId]/commit/route.ts:50` then throws "Current season is required for product imports." Stage passes a batch that commit refuses, with no signal at preview time.

### F17 — `StagedRow.rowNumber` typed as string (clean-code §Type/schema drift)
`src/lib/csv-import.ts:4` declares `StagedRow = Record<string, string> & { rowNumber: string }` and sets `row.rowNumber = String(lineIndex + 1)` (line 62). Both routes then do `Number(row.rowNumber)` (`imports/route.ts:80`, and the type guard in `imports/page.tsx` narrows `rowNumber` to `number`). Row number is metadata, not a CSV cell — carrying it as a string forces casts at every consumer and is why the page needs a runtime type guard on a JSONB column it controls.

## Count

17 findings — Medium 9 (F1–F9), Low 8 (F10–F17).
Hot spots: permission model (F2, F4, F5), money/refund consistency (F6), import stage↔commit integrity (F7, F16), duplicated phone normalization (F3). No High; F6 is the closest to High on the money-loss axis.
