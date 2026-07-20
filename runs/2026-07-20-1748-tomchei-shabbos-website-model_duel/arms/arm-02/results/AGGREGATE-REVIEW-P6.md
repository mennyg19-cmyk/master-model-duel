# P6 Aggregate Review — arm-02

**Phase:** P6 — Admin operations hub & POS
**Tree:** `arms/arm-02/workspace/`
**Inputs:** `P6-security-arm-02.md`, `P6-quality-arm-02.md`, `P6-rules-arm-02.md`, `P6-clean-code-arm-02.md`
**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings.

## Classification

- **Blocker** = High severity (money-loss / large divergence / god-file). Must fix before gate.
- **Major** = Medium severity (correctness gap, audit-integrity, duplication with drift). Fix in fix pass.
- **Minor** = Low / Informational (style, hardening, magic values).

## Blockers (6)

| # | Title | Location | Sources |
|---|---|---|---|
| B1 | Stripe refund issued before DB row, no idempotency key — concurrent retries double-refund (money-loss) | `app/api/admin/orders/[id]/refund/route.ts:44-52`; `lib/payments/stripe.ts:69-75` | rules F1, quality Q3 |
| B2 | Customer-search `where` clause duplicated with behavioral drift (page normalizes phone unconditionally; API guards with `looksLikePhone`) | `app/(admin)/admin/customers/page.tsx:21` vs `app/api/admin/customers/route.ts:19-20` | clean-code H1, rules F9, quality Q4 |
| B3 | Quote `issues` flattening duplicated across POS and web quote routes | `app/api/admin/pos/quote/route.ts`, `app/api/checkout/quote/route.ts` | clean-code H2 |
| B4 | God file `components/admin/pos-client.tsx` (468 lines, 3 components + type) | `components/admin/pos-client.tsx` | clean-code H4 |
| B5 | God file `components/admin/settings-hub.tsx` (414 lines, 5 components + types) | `components/admin/settings-hub.tsx` | clean-code H5 |
| B6 | Per-component inline `fetch` + error-extraction duplication (5 client components) | `components/admin/{pos-client,settings-hub,import-client,order-money-actions,order-bulk-actions}.tsx` | clean-code H3 |

## Majors (16)

| # | Title | Location | Sources |
|---|---|---|---|
| M1 | Refund `alreadyRefunded` not scoped to chosen payment intent; only latest Stripe payment refundable | `app/api/admin/orders/[id]/refund/route.ts:23-35` | rules F2, quality Q2 |
| M2 | POS checkout posts payment outside audit transaction; finalize after money committed; finalize failure leaves DRAFT with POSTED payment + duplicate-checkout; returns 200 on failure (audit-atomicity + error-status drift) | `app/api/admin/pos/checkout/route.ts:73-101` | rules F3, quality Q1, clean-code M9 |
| M3 | Bulk action audit row carries no `targetId` / no per-id detail — per-order auditability lost for money-adjacent transitions | `app/api/admin/orders/bulk/route.ts:33-49` | security SEC-01, quality Q8 |
| M4 | `discard`/`finalize` audit written outside state-change transaction; `void`/`post` inside — two audit patterns in one phase | `app/api/admin/orders/[id]/{discard,finalize}/route.ts`; `lib/payments/post-payment.ts:73-94` | rules F4 |
| M5 | Import commit doesn't catch Prisma `P2002` from `createMany` — bubbles as unhandled 500 with no `error` body | `lib/imports.ts:132-169`, `app/api/admin/import/route.ts` | rules F5 |
| M6 | Missing `.scratch/PHASE-P6-SMOKE.md` and `.scratch/phase-plan.md` — phase gate unlogged | `arms/arm-02/workspace/.scratch/` | rules F6 |
| M7 | Dashboard "Audit entries" KPI shown without `audit.view` — STAFF sees count but is denied the audit page | `app/(admin)/admin/page.tsx:20-24,191-193` | rules F7 |
| M8 | Refund form renders on DISCARDED orders and orders with no Stripe payment; API returns 404/409 | `components/admin/order-money-actions.tsx:202` | rules F8, clean-code L5 |
| M9 | Money-line rendering duplicated (3+ call sites) | `orders/[id]/page.tsx`, `pos-client.tsx`, `admin/page.tsx` | clean-code M1 |
| M10 | Date formatting duplicated and ad-hoc (~6 inline slices) | `orders/[id]/page.tsx`, `order-money-actions.tsx`, `orders/page.tsx`, `customers/[id]/page.tsx`, `customers/page.tsx` | clean-code M2 |
| M11 | Page-clamp expression duplicated | `lib/orders/list.ts`, `customers/page.tsx` | clean-code M3 |
| M12 | Pagination constants duplicated (`ORDERS_PAGE_SIZE`/`PAGE_SIZE=25`, `MAX_PAGE=400` in two homes) | `lib/orders/list.ts`, `customers/page.tsx` | clean-code M4 |
| M13 | Pagination-link builders drift (two implementations) | `orders/page.tsx`, `customers/page.tsx` | clean-code M5 |
| M14 | Dollars-to-cents conversion duplicated per surface | `order-money-actions.tsx`, `settings-hub.tsx` | clean-code M6 |
| M15 | `getOpenSeason` + "The store is closed" 409 boilerplate repeated across 5 routes | `pos/draft`, `pos/quote`, `pos/checkout`, `checkout`, `checkout/quote` | clean-code M7 |
| M16 | Client-side type re-declarations drift from server shapes (`PosQuote`, `StagedRow` ×2, `Preview`, `PaymentRow`) | `pos-client.tsx`, `lib/imports.ts`, `import-client.tsx`, `order-money-actions.tsx` | clean-code M8 |

## Minors (24)

| # | Title | Location | Sources |
|---|---|---|---|
| m1 | Edge middleware is cookie-presence-only; matcher excludes `/api/admin/*` | `middleware.ts:6-22` | security SEC-02 |
| m2 | `requirePermissionApi` discloses exact missing permission name | `lib/auth/current-user.ts:66-73` | security SEC-03 |
| m3 | Mock webhook secret is a public repo constant; mock-mode webhook forgeable | `lib/env.ts:5`, `lib/payments/webhook-verify.ts`, `app/api/webhooks/stripe/route.ts:44-48` | security SEC-04 |
| m4 | `/api/dev/stripe-checkout` lets any caller mock-pay any session | `app/api/dev/stripe-checkout/route.ts:22-33` | security SEC-05 |
| m5 | POS checkout `amountCents` has no upper bound (inconsistent with sibling route cap) | `app/api/admin/pos/checkout/route.ts:22-26,73` | security SEC-06, quality Q7 |
| m6 | `season-status` PATCH does not audit auto-closed seasons | `app/api/admin/season-status/route.ts:24-37` | security SEC-07 |
| m7 | Media serve route unauthenticated, missing `X-Content-Type-Options: nosniff` | `app/media/[id]/route.ts:14-19` | security SEC-08 |
| m8 | Audit page hard-capped at latest 100 entries — no pagination, no filter; `take: 100` inline magic | `app/(admin)/admin/audit/page.tsx:7` | quality Q5, rules F14 |
| m9 | CSV parser silently drops a legitimate single-empty-field row | `lib/csv.ts:21` | quality Q6 |
| m10 | `result` standalone variable name | `app/api/admin/pos/checkout/route.ts:51` | rules F10 |
| m11 | Defensive `staff?.` after a guaranteed redirect | `app/(admin)/admin/page.tsx:16-17` | rules F11 |
| m12 | `packagesByStage` label only replaces the first underscore (`OUT_FOR_DELIVERY` → `out_for delivery`) | `app/(admin)/admin/page.tsx:102` | rules F12 |
| m13 | Bulk failure report leaks synthetic `id: "request"` sentinel into UI | `components/admin/order-bulk-actions.tsx:74` | rules F13, clean-code L4 |
| m14 | POS page requires `orders.manage` but customer-create endpoint requires `customers.manage` — walk-in create 403s silently | `app/(admin)/admin/pos/page.tsx:8`, `app/api/admin/customers/route.ts:48` | rules F15 |
| m15 | `pricecents` naming drift (lowercase, no separator) | `lib/imports.ts` | clean-code L1 |
| m16 | `posDraftOwner` models POS as a "guest" via `pos|` prefix trick | `lib/order-builder/draft-store.ts` | clean-code L2 |
| m17 | Trivial one-line wrappers (`loadCustomer`, `ownerAddressBook`) | `pos/draft/route.ts`, `api/draft/route.ts` | clean-code L3 |
| m18 | Void route mixes 400 and 409 for failure cases | `app/api/admin/orders/[id]/payments/[paymentId]/void/route.ts` | clean-code L6 |
| m19 | `STALE_DRAFT_MS` and ">1h" label drift together | `app/(admin)/admin/page.tsx` | clean-code L7 |
| m20 | Unnamed magic numbers (`max(10_000_000)` payment, `max(2_000_000)` CSV) | `payments/route.ts`, `import/route.ts` | clean-code L8 |
| m21 | `colSpan` hardcoded to column count (8 / 5) | `orders/page.tsx`, `customers/page.tsx` | clean-code L9 |
| m22 | `formatCents` lives in `lib/catalog` (co-location mismatch) | `lib/catalog` | clean-code L10 |
| m23 | `import` route uses `seasonId = season?.id ?? ""` (empty-string sentinel) | `app/api/admin/import/route.ts` | clean-code L11 |
| m24 | `requirePermissionApi` gate boilerplate repeated per admin route | `app/api/admin/**` | clean-code L12 |

## Informational (2)

| # | Title | Location | Sources |
|---|---|---|---|
| i1 | `staff.impersonate` has no protection against targeting a same/higher-privilege user (by-design) | `app/api/impersonate/route.ts:22-27` | security SEC-09 |
| i2 | Admin API mutation routes have no rate limiting | `app/api/admin/**` | security SEC-10 |

## Dedupe map (collapsed duplicates)

- B1 ← rules F1 + quality Q3 (refund race / idempotency)
- B2 ← clean-code H1 + rules F9 + quality Q4 (customer phone-search drift)
- M1 ← rules F2 + quality Q2 (refund scoping)
- M2 ← rules F3 + quality Q1 + clean-code M9 (POS checkout atomicity)
- M3 ← security SEC-01 + quality Q8 (bulk audit row)
- M8 ← rules F8 + clean-code L5 (refund form visibility)
- m5 ← security SEC-06 + quality Q7 (POS amountCents unbounded)
- m8 ← quality Q5 + rules F14 (audit take:100)
- m13 ← rules F13 + clean-code L4 (bulk "request" sentinel)

## Counts

- **Blockers:** 6
- **Majors:** 16
- **Minors:** 24 (+ 2 informational)
- **Total:** 46
