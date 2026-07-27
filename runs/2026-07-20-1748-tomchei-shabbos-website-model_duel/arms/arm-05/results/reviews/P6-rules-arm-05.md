# P6 Rules Review — arm-05 (blind)

Reviewer specialist: Rules. Phase: P6 — Admin operations hub & POS.
Scope: always-on rules adherence in P6 code (`lib/admin-operations.ts`, `app/api/admin/operations/route.ts`, `app/api/admin/imports/route.ts`, `app/api/admin/orders/[orderId]/route.ts`, `app/admin/operations/page.tsx`, `app/admin/pos/page.tsx`, `app/admin/layout.tsx`, `app/admin/page.tsx`, `scripts/smoke-p6.ts`, `.scratch/PHASE-P6-STATUS.md`, `.scratch/PHASE-P6-SMOKE.md`, `.scratch/phase-plan.md`).

Arm rules graded: `clean-code.mdc`, `ponytail.mdc`, `workflow.mdc`, `codegraph.mdc`, `vocabulary.mdc`.

Findings only — no fixes.

---

## Summary

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 3 |
| Low | 3 |
| Total | 8 |

---

## HIGH-1 — Anti-hallucination: S4 smoke claim overstates coverage

**Location:** `scripts/smoke-p6.ts` lines 52-64; `.scratch/PHASE-P6-SMOKE.md` line 12; `.scratch/PHASE-P6-STATUS.md` line 14.

**Claim:** "S4 passed" — 1,000-order / 5,000-package fixture proves bounded pagination and deterministic conflict reporting.

**Evidence:** `shared/phases/PHASE-P6-EXPECTED.md` S4 requires "Page 1k-order / 5k-package fixtures; **two conflicting bulk actions report skipped/conflicts deterministically**." The smoke script creates 1,000 orders and 5,000 packages, asserts `page.pageSize === 25` and the row counts, then stops. The `bulkReview` path in `app/api/admin/operations/route.ts` (POST `action: "bulk"`, lines 46-54) — the only code that produces `outcome: "conflict"` — is never invoked by the smoke script. No conflicting-version bulk action is exercised anywhere in `smoke-p6.ts`. `PHASE-P6-SMOKE.md` row S4 marks PASS without noting the missing conflict half. `clean-code.mdc` Anti-Hallucination: "Do not claim 'fixed/passed/working' without tool output or running-app evidence."

---

## HIGH-2 — Expectation files: P6 checklist never walked

**Location:** `.scratch/phase-plan.md` lines 32-39.

**Claim:** Phase P6 complete per `.scratch/PHASE-P6-STATUS.md` line 3 ("Status: complete").

**Evidence:** The P6 block in `phase-plan.md` has four expectation items, all still unchecked `[ ]`:

```
1. [ ] Permission-aware operations dashboard exposes KPIs, Today work, bounded order/customer lists, payment detail/refund API, and audit visibility.
2. [ ] Staff POS creates walk-in customer orders through the same checkout pricing, inventory, finalization, cash/check, and audit path.
3. [ ] Customer/product CSV imports stage a preview, reject invalid/duplicate data, and commit corrected data atomically with audit evidence.
4. [ ] A 1,000-order / 5,000-package fixture proves pagination stays bounded and a bulk review action reports version conflicts.
```

`workflow.mdc` Expectation Files: "After the todo: walk that checklist item by item, marking each with evidence… An item without evidence is unchecked; an unchecked item means the todo is not done." The status file declares done while the expectation checklist is untouched.

---

## MEDIUM-1 — Anti-hallucination: S1 smoke claim overstates coverage

**Location:** `scripts/smoke-p6.ts` lines 26-35; `.scratch/PHASE-P6-SMOKE.md` line 9.

**Claim:** "S1 passed" — Manager + restricted Staff traverse dashboard, Today queue, search, detail, refund, audit views.

**Evidence:** `PHASE-P6-EXPECTED.md` S1 lists six traversable surfaces. The smoke script exercises: `operationsDashboard()` (dashboard KPIs), `listOrders({ page: 1 })` (list, no query), a manager GET returning 200, and a restricted STAFF (DENY `orders.read`) GET returning 403. It does NOT call `GET /api/admin/orders/[orderId]` (detail), `POST /api/admin/orders/[orderId]` (refund), or any audit-log read. The Today queue is covered only as `dashboard.todayCount` — a count, not a queue traversal. `PHASE-P6-SMOKE.md` row S1 marks PASS without caveats. `clean-code.mdc` Anti-Hallucination: "Do not claim 'fixed/passed/working' without tool output or running-app evidence."

---

## MEDIUM-2 — Duplicated logic: `normalizeEmail` reimplemented

**Location:** `lib/admin-operations.ts` lines 23-25.

**Claim:** New helper introduced for email normalization.

**Evidence:** `lib/foundation.ts` lines 16-18 already exports `normalizeEmail(email: string)`. The P6 file redefines it locally with an `string | undefined` signature:

```23:25:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/admin-operations.ts
function normalizeEmail(email: string | undefined) {
  return email?.trim().toLowerCase();
}
```

Three other call sites (`lib/newsletter.ts`, `lib/order-builder.ts`, `app/api/staff/route.ts`) import the foundation version. `clean-code.mdc` Refactor categories: "Duplicated logic — pull into `lib/` helpers"; "On every edit: scan for existing solutions… If yes → use it. If close-but-not-quite → extend it, don't fork it." The foundation helper should have been extended (or wrapped) rather than forked.

---

## MEDIUM-3 — Inconsistent patterns: ad-hoc validation vs zod

**Location:** `app/api/admin/orders/[orderId]/route.ts` lines 23-24.

**Claim:** Refund endpoint validates input manually.

**Evidence:** The sibling P6 routes use zod schemas: `app/api/admin/imports/route.ts` lines 6-9 (`importSchema`), `app/api/admin/operations/route.ts` lines 7-10 (`postSchema`). The order-detail refund route does not:

```23:24:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/api/admin/orders/[orderId]/route.ts
  const { paymentId } = await request.json().catch(() => ({}));
  if (typeof paymentId !== "string") return NextResponse.json({ error: "Provide a payment to refund." }, { status: 400 });
```

`clean-code.mdc` Consistency: "One error-handling approach per project"; Refactor categories: "Inconsistent patterns — pick one, apply everywhere." The same phase introduced two validation styles.

---

## LOW-1 — Magic values: page size and time window unnamed

**Location:** `lib/admin-operations.ts` lines 109, 122, 138.

**Claim:** List bounds and "Today" window are inline literals.

**Evidence:** `const take = 25` is duplicated in `listOrders` (line 109) and `listCustomers` (line 122). The Today-queue cutoff uses an unannotated milliseconds literal:

```138:138:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/lib/admin-operations.ts
    prisma.order.count({ where: { status: "DRAFT", updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
```

CSV/quantity caps `500_000` and `100_000` appear as zod literals (`app/api/admin/imports/route.ts` line 7; `lib/admin-operations.ts` line 13, 151). `clean-code.mdc` Refactor categories: "Magic values — named constants / enums." A shared `PAGE_SIZE = 25` and `TWENTY_FOUR_HOURS_MS` would remove the duplication and the unexplained arithmetic.

---

## LOW-2 — Permission granularity: customers view gated by `orders.read`

**Location:** `app/api/admin/operations/route.ts` lines 12-25.

**Claim:** GET endpoint authorizes all views under a single permission.

**Evidence:** The GET handler calls `authorize(request, "orders.read")` once, then branches on `view`: `orders`, `customers`, `products`, or `dashboard`. The `customers` view returns customer directory data without checking `customers.read`, even though `customers.read` exists as a distinct permission in `lib/permissions.ts` line 8. A role granted `orders.read` but denied `customers.read` (via override) would still list customers. `workflow.mdc` Security Basics: "Least privilege by default."

---

## LOW-3 — Audit durability: bulk action not transactional with its audit

**Location:** `app/api/admin/operations/route.ts` lines 47-54.

**Claim:** Bulk review writes per-order updates and an audit event as separate steps.

**Evidence:

```47:54:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/api/admin/operations/route.ts
    const outcomes = await Promise.all(bulk.orderIds.map(async (orderId) => {
      const updated = await prisma.order.updateMany({
        where: { id: orderId, status: "FINALIZED", version: bulk.versions[orderId] },
        data: { version: { increment: 1 } },
      });
      return { orderId, outcome: updated.count === 1 ? "processed" : "conflict" };
    }));
    await prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, action: "orders.bulk_reviewed", details: { outcomes } } });
```

The `updateMany` calls run concurrently outside any transaction; the `auditEvent.create` runs afterward as an independent write. If the audit insert throws, the order version bumps persist with no audit trail. The phase plan calls bulk actions "auditable" (`.scratch/phase-plan.md` line 34). `workflow.mdc` Security Basics expects auditability; `clean-code.mdc` Error Handling: "Error messages say what went wrong AND what the expected state was" — here a partial-failure state is silently committed.

---

## Notes (not findings)

- `lib/admin-operations.ts` is 172 lines — under the 500-line god-file threshold.
- `lib/checkout.ts` is 382 lines, mixed (POS, hosted checkout, refunds, voids, webhook signature). Approaching the god-file threshold but predates P6; not a P6-introduced finding.
- `prisma.$transaction([…])` array form vs `prisma.$transaction(async (tx) => …)` interactive form coexist. This is the documented Prisma pattern (interactive when later ops depend on earlier results); not an inconsistency.
- Hand-rolled CSV parser in `parseCsv` (lines 27-52) does not handle quoted commas, but adding a CSV dependency would violate the ponytail ladder for this scope; not a finding.
- `codegraph.mdc` could not be applied — no `.codegraph/` index in the arm workspace. Structural lookups used Read/Grep per the "Not initialized" fallback.
