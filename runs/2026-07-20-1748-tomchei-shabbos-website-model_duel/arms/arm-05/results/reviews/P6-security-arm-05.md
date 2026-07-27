# P6 Security Review — arm-05 (blind)

**Phase:** P6 — Admin operations hub & POS
**Scope:** admin/POS authz, refund paths, CSV import trust, IDOR, bulk actions
**Method:** Findings only — no fixes. P6 scope only.
**Plan ref:** `shared/MERGED-BUILD-PLAN.md` § P6 (R-049, R-050, R-052..R-054, R-059..R-064, R-092, R-094..R-096, R-105, R-106, R-143; UR-006 POS parity, UR-011 POS half, G-028)

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 4 |
| Low | 3 |
| Info | 1 |

All admin API routes use `authorize(request, <permission>)` from `lib/route-auth.ts` and mutating routes add `hasSameOrigin(request)`. Permission gates match the plan for the operations hub, POS, refunds, and imports. The findings below are about *what those gates actually protect* — not missing gates.

---

## Findings

### M1 — CSV import bypasses catalog/customer permission gating
**Severity:** Medium
**Location:** `lib/admin-operations.ts` `stageImport`/`commitImport` (lines 54–106); `app/api/admin/imports/route.ts` POST (lines 11–25)
**Claim:** The import endpoint authorizes only `imports.manage`. `commitImport` writes products (`prisma.product.create`) and customers (`prisma.customer.create`) directly. Catalog CRUD via `/api/admin/catalog` requires `settings.manage`; customer writes elsewhere require `customers.write`. A staff user granted `imports.manage` alone (a plausible per-permission grant for a bulk-import operator) can create products and customers without holding `settings.manage` or `customers.write`, defeating the catalog admin permission boundary.
**Evidence:** `app/api/admin/catalog/route.ts:25-26` gates GET on `settings.manage` and `:44-46` gate POST on `settings.manage`. `app/api/admin/imports/route.ts:12` gates both stage and commit on `imports.manage` only. `lib/admin-operations.ts:97` creates products in the latest OPEN season; `:91` creates customers. `lib/permissions.ts:1-11` lists `imports.manage`, `settings.manage`, `customers.write` as separate permissions, and STAFF role gets neither `imports.manage` nor `settings.manage` — so an override granting only `imports.manage` is a valid configuration the permission model explicitly supports.

### M2 — POS walk-in upsert renames any existing customer
**Severity:** Medium
**Location:** `lib/admin-operations.ts` `createWalkInPosOrder` (lines 155–159)
**Claim:** The walk-in POS flow upserts a customer by `emailNormalized` with `update: { firstName, lastName }`. Any staff user with `orders.write` (the standard STAFF role) can enter an existing customer's email in the POS walk-in form and overwrite that customer's first and last name. The rename is not audited as a customer write (`payment.offline_posted` is logged, but no `customer.updated` event records the rename) and is not bound to `customers.write`.
**Evidence:** `lib/admin-operations.ts:155-159`:
```155:159:lib/admin-operations.ts
  const customer = await prisma.customer.upsert({
    where: { emailNormalized: normalizeEmail(parsed.email) ?? `walkin-${randomUUID()}@local.test` },
    create: { firstName: parsed.firstName, lastName: parsed.lastName, emailNormalized: normalizeEmail(parsed.email) },
    update: { firstName: parsed.firstName, lastName: parsed.lastName },
  });
```
`prisma/schema.prisma:224-235` confirms `Customer.emailNormalized` is `@unique` and `firstName`/`lastName` are mutable fields. `lib/permissions.ts:19` shows STAFF has `orders.write` but not `customers.write`.

### M3 — Offline-payment route finalizes any DRAFT order, no POS-origin check
**Severity:** Medium
**Location:** `app/api/admin/orders/[orderId]/offline-payment/route.ts` POST (lines 12–25); `lib/checkout.ts` `createPosOrder` (lines 319–340) and `assertLiveOrder` (lines 64–103)
**Claim:** The offline-payment endpoint accepts any `orderId` from the URL and calls `createPosOrder`, which runs `startCheckout` → `saveCheckoutDetails` → `assertLiveOrder` (requires `status === "DRAFT"`) and finalizes with cash/check. There is no check that the draft was created by staff/POS or is otherwise POS-eligible. A staff user with `orders.write` can take a customer's pending web draft and force-finalize it with cash, marking the order `FINALIZED` and `paymentStatus: POSTED`. The customer's later Stripe checkout attempt will fail because the order is no longer in DRAFT. The plan separates web (Stripe-hosted) from POS (cash/check) payments; this route blurs that boundary by accepting any draft.
**Evidence:** `app/api/admin/orders/[orderId]/offline-payment/route.ts:19-21` reads `orderId` from URL params and calls `createPosOrder(orderId, parsed.data.checkout, ...)`. `lib/checkout.ts:79` requires only `order.status !== "DRAFT"` to throw; no origin/creator check. `lib/checkout.ts:295-298` sets the order to `FINALIZED` with `paymentStatus: "POSTED"`. The audit event is `payment.offline_posted` (line 314) — no audit ties the order to a POS-eligible origin.

### M4 — Refund sets order `paymentStatus: REFUNDED` ignoring other posted payments
**Severity:** Medium
**Location:** `lib/checkout.ts` `refundStripePayment` (lines 353–372)
**Claim:** After a successful Stripe refund, the order's `paymentStatus` is set to `REFUNDED` unconditionally. If the order has multiple posted payments (e.g., a partial Stripe charge plus a posted cash payment, or two Stripe payments), refunding one flips the whole order to `REFUNDED` even while other posted payments remain. `voidOfflinePayment` (lines 342–351) correctly counts active payments before setting the order status; the refund path does not. Financial integrity drift: reports and customer-facing status will show "refunded" while money is still posted.
**Evidence:** `lib/checkout.ts:367-371`:
```367:371:lib/checkout.ts
  await prisma.$transaction([
    prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } }),
    prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: "REFUNDED" } }),
    prisma.auditEvent.create({ data: { actorId, action: "payment.stripe_refunded", subjectId: payment.id, details: { orderId: payment.orderId, refundId: body.id } } }),
  ]);
```
Contrast with `lib/checkout.ts:347-348` which counts active payments before deciding the order's payment status on void.

### L1 — Bulk action version check can be silently skipped
**Severity:** Low
**Location:** `app/api/admin/operations/route.ts` POST bulk branch (lines 46–54); `postSchema` (line 9)
**Claim:** The bulk action schema accepts `orderIds: z.array(z.string().cuid())` and `versions: z.record(z.string(), z.number().int().positive())` as independent fields. The handler reads `bulk.versions[orderId]` per order. If a caller includes an `orderId` in `orderIds` but omits its entry in `versions`, `bulk.versions[orderId]` is `undefined`, and Prisma treats `where: { version: undefined }` as "no filter" — the optimistic-concurrency guard is skipped. The update then always succeeds and reports `outcome: "processed"` instead of `"conflict"`, defeating the deterministic conflict reporting required by G-024 and the S4 smoke check.
**Evidence:** `app/api/admin/operations/route.ts:9` defines `versions` as a free-form record (not keyed to `orderIds`). `:48-50`:
```48:52:app/api/admin/operations/route.ts
      const updated = await prisma.order.updateMany({
        where: { id: orderId, status: "FINALIZED", version: bulk.versions[orderId] },
        data: { version: { increment: 1 } },
      });
      return { orderId, outcome: updated.count === 1 ? "processed" : "conflict" };
```
No validation that every `orderId` has a corresponding `versions` entry.

### L2 — CSV parser does not handle quoting or escaping
**Severity:** Low
**Location:** `lib/admin-operations.ts` `parseCsv` (lines 27–52)
**Claim:** The parser splits each line on `,` with no quote handling, no escape handling, and no length cap per field beyond Zod's per-field max. A field containing a comma (e.g., a last name `Smith, Jr.`) is silently split into two columns, shifting every subsequent column and producing mis-parsed rows that may pass validation with wrong values rather than being rejected. Trust boundary: CSV is untrusted external input from staff, but the parser does not enforce a well-formed shape before validation.
**Evidence:** `lib/admin-operations.ts:35`:
```35:36:lib/admin-operations.ts
    const values = line.split(",").map((value) => value.trim());
    const candidate = Object.fromEntries(headers.map((header, column) => [header, values[column] || undefined]));
```
No `"` handling, no RFC 4180 conformance. Malformed rows are not detected as malformed — they are validated against the shifted columns.

### L3 — Staged import batch has no ownership tracking
**Severity:** Low
**Location:** `lib/admin-operations.ts` `stageImport`/`commitImport` (lines 54–106)
**Claim:** A staged batch is stored in `AppSetting` under `import.batch:${batchId}` with `batchId = randomUUID()`. The `import.staged` audit event records the staging actor, but `commitImport` does not verify the committing actor is the stager (or a manager) before committing. Any user with `imports.manage` can commit any batch, including one staged by another user. Combined with M1, a user granted only `imports.manage` could commit product/customer writes staged by someone else. The `batchId` is unguessable (UUIDv4), so this is not a remote exploit, but it weakens the audit trail's claim of who authorized the commit.
**Evidence:** `lib/admin-operations.ts:75-80` reads the batch by `batchId` only — no `actorId` comparison. `:103` writes a fresh `import.committed` audit with the *committer's* `actorId`, not the original stager's.

### I1 — No server-side middleware gates `/admin/*` pages
**Severity:** Info (P1 scope, surfaced during P6)
**Location:** repo root — no `middleware.ts` exists; `app/admin/layout.tsx` (lines 1–24) renders unconditionally
**Claim:** P6 added `/admin/operations` and `/admin/pos` as client-component pages. The admin layout is a server component with no auth check, and there is no `middleware.ts` at the workspace root to redirect unauthenticated users away from `/admin/*`. The API routes return 401/403, so no data leaks, but the admin shell, navigation labels, and page chrome render to anyone who hits `/admin/operations`. This is a P1 concern (auth middleware) called out here because P6 expanded the admin surface.
**Evidence:** `Glob middleware.*` returned 0 files. `app/admin/layout.tsx:1-24` has no `auth()`/`authenticate()` call. All authz lives in API route handlers via `authorize()`.
