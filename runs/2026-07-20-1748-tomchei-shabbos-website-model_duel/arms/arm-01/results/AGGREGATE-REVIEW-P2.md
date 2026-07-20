# Aggregate Review — P2 — arm-01

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-01`
**Phase:** P2 — Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine
**Output:** `arms/arm-01/results/AGGREGATE-REVIEW-P2.md`

**Inputs aggregated:**
- `results/reviews/P2-security-arm-01.md` (8 findings: 0 CRIT, 0 HIGH, 1 MED, 4 LOW, 3 INFO)
- `results/reviews/P2-quality-arm-01.md` (8 findings: F1–F8)
- `results/reviews/P2-rules-arm-01.md` (13 findings: 7 VIOLATION + 6 MINOR)
- `results/reviews/P2-clean-code-arm-01.md` (15 findings: F1–F15)

**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings introduced during aggregation. Aggregator spawn exhausted twice (`resource_exhausted`); orchestrator wrote this file from frozen specialist inputs per `DEVIATIONS.md`.

Severity mapping: CRIT/HIGH security + quality Critical = **blocker**; security MED + quality Major/Moderate + rules VIOLATION + clean-code Medium-High/Medium = **major**; security LOW + quality Minor + rules MINOR + clean-code Low/Low-Medium = **minor**; Informational = **minor (info)**.

---

## Counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 11 |
| Minor | 19 |
| **Total** | **30** |

---

## Blockers (0)

None. P2 is schema + engine only; no CRIT/HIGH security findings.

---

## Majors (11)

### A1 — Unit tests exercise in-memory stubs, not production DB engines (false confidence)
**Sources:** Q F1, Q F2, RULES ponytail VIOLATION, RULES clean-code VIOLATION, CC F2
**Locations:** `tests/domain-core.test.ts:75,85`; `src/domain/order-engine.ts:95-104` (`OrderNumberAllocator`); `src/domain/inventory.ts:35-55` (`InventoryReservationLedger`)
**Claim:** S4/S5 concurrency unit tests call `OrderNumberAllocator` and `InventoryReservationLedger` — in-memory promise-queue fakes with no production call sites. Real invariants (`claimOrderNumber` Serializable transaction; `reserveInventory` guarded UPDATE) are only hit in `.scratch/p2-smoke.ts`, not unit tests. Tests would pass if DB logic were broken. Move stubs to `tests/` or rewrite tests against `finalizeOrder`/`reserveInventory` with a test DB.

### A2 — No DB-level CHECK constraints on monetary totals
**Sources:** SEC S1, Q F8 (partial)
**Locations:** `prisma/migrations/20260720210000_p2_domain_core/migration.sql`; `Order.subtotalCents`/`totalCents`, `Payment.amountCents`, `StripePaymentIntent.amountCents`, `ShippingQuote.amountCents`
**Claim:** Negative or zero monetary amounts can be persisted at the DB layer — fraud/integrity surface for payments schema. Add `>= 0` (or `> 0` where appropriate) CHECK constraints.

### A3 — `discardDraft`, `advancePackageStage`, and `reserveInventory` untested
**Sources:** Q F3, RULES clean-code VIOLATION, RULES workflow VIOLATION
**Locations:** `src/domain/order-engine.ts:80` (`discardDraft`); `src/domain/package-stage.ts:13` (`advancePackageStage`); `src/domain/inventory.ts:3` (`reserveInventory`)
**Claim:** P2 contract requires order/package state machines and optimistic versioning, but only DRAFT→FINALIZED transition is unit-tested. Package stage transitions, discard, and production reservation path have no unit/integration coverage. Regressions on version guards would not be caught.

### A4 — No unique constraint on `Package(orderId, groupingKey)`
**Sources:** Q F5
**Locations:** `prisma/schema.prisma:390` (`@@index([orderId, groupingKey])` non-unique)
**Claim:** Grouping engine assumes one package per `(order, groupingKey)` but schema allows duplicates if engine is bypassed. Add `@@unique([orderId, groupingKey])`.

### A5 — Schema/migration drift on `CustomerAccount.clerkUserId`
**Sources:** Q F6
**Locations:** `prisma/schema.prisma:88` (`String?`); `prisma/migrations/20260720172337_init/migration.sql:29` (`NOT NULL`)
**Claim:** Client types permit `null` while DB rejects it; `db:guard` does not catch drift. Align schema and migration (or add guard check).

### A6 — Dead exported helpers in `lib/` (Rule of 2)
**Sources:** RULES ponytail VIOLATION, CC F1
**Locations:** `src/lib/safe-result.ts`, `src/lib/dates.ts`, `src/lib/money.ts`, `src/lib/season.ts`, `src/lib/normalize.ts` (`normalizePhone`)
**Claim:** Zero call sites across `src/`, `tests/`, `scripts/`, `prisma/`. Delete or wire up before shipping.

### A7 — Inconsistent `AccessDeniedError → 403` handling across admin routes
**Sources:** RULES clean-code VIOLATION, CC F5
**Locations:** `src/app/api/admin/staff/route.ts:9-14` (local `permissionError`); inlined in `impersonation/route.ts:59-64,102-107`, `overview/route.ts:21-26`
**Claim:** Same concern handled two ways. Lift shared helper into `src/lib/auth.ts`.

### A8 — Duplicated grants/denies permission fieldsets in staff-manager
**Sources:** RULES clean-code VIOLATION, CC F7
**Locations:** `src/app/(admin)/admin/staff/staff-manager.tsx:159-196`
**Claim:** Near-identical `<fieldset>` blocks — extract shared `PermissionChecklist` component.

### A9 — P2 domain claims lack running-app / real-DB test evidence in CI
**Sources:** RULES workflow VIOLATION
**Locations:** `tests/domain-core.test.ts`; `package.json` (`npm run ci`); README P2 section
**Claim:** README asserts serializable finalization, reservation, and stage transitions, but CI runs stub unit tests only. Wire real-path smoke (`p2-smoke.ts` / concurrency script) into CI or integration tests.

### A10 — `global-error.tsx` hardcodes design tokens as hex
**Sources:** CC F9
**Locations:** `src/app/global-error.tsx` vs `src/app/globals.css` CSS variables
**Claim:** Duplicate color sources will drift. Import stylesheet and use `var(--*)`; reuse `Button`.

### A11 — Permission arrays typed `string[]` instead of `Permission[]`
**Sources:** RULES clean-code MINOR (elevated: boundary validation), CC F14
**Locations:** `src/lib/permissions.ts:19-23`; `src/app/api/admin/staff/route.ts:113-120`
**Claim:** Invalid permission strings stored silently. Validate and narrow at DB read / API boundary.

---

## Minors (19)

### m1 — `Payment` lacks optimistic versioning (SEC S2)
**Locations:** `prisma/schema.prisma:419-434` — defer to P5 or add `version` now.

### m2 — Predictable sequential `draftReference` (SEC S3)
**Locations:** `src/domain/order-engine.ts:15-21` — P5 should add opaque guest token (R-121).

### m3 — Untyped JSONB holds PII snapshots/settings (SEC S4)
**Locations:** `Package.addressSnapshot`, `PickupLocation.address`, `AppSetting.value`, audit metadata.

### m4 — `PackageAudit` write path untested (Q F4)

### m5 — `Product.replacementProductId` no self-cycle guard (Q F7)

### m6 — BOM quantity tables lack positivity CHECKs (Q F8)

### m7 — Duplicated state-machine pattern (CC F3) — extract `defineStateMachine` if time.

### m8 — Duplicated promise-queue in stub classes (CC F4) — collapses when A1 fixed.

### m9 — Duplicated `impersonatorId` ternary (CC F6)

### m10 — `StopImpersonationButton` inlines `<button>` instead of `Button` (CC F8)

### m11 — Inconsistent date formatting / unused `formatOrganizationDate` (CC F10)

### m12 — Mixed enum vs string-literal for `StaffRole`/`StaffStatus` (CC F11)

### m13 — Magic numbers for TTL/truncation limits (CC F12)

### m14 — String-sentinel `BOOTSTRAP_LOCKED` error (CC F13)

### m15 — `readServerEnvironment()` side-effect-only call in `db.ts` (CC F15, RULES MINOR)

### m16 — No ponytail ladder tags on P2 additions (RULES ponytail MINOR)

### m17 — No `.scratch/phase-plan.md` evidence (RULES workflow MINOR)

### m18 — `SEED_DEMO_STAFF` hardcoded manager (SEC S5 INFO)

### m19 — Local `.env` credential in workspace tree (SEC S7 INFO; P1 carry-forward)

---

## Dedupe map (selected merges)

- Q F1 ≡ Q F2 ≡ CC F2 ≡ RULES ponytail/clean-code "tests cover fakes" → **A1**
- SEC S1 ≡ Q F8 (partial monetary CHECK theme) → **A2**
- Q F3 ≡ RULES clean-code "real domain untested" → **A3** (subset of A1 scope but distinct untested functions)
- CC F5 ≡ RULES clean-code error-handling → **A7**
- CC F7 ≡ RULES clean-code fieldsets → **A8**
- CC F1 ≡ RULES ponytail dead helpers → **A6**

---

## Fix-pass priority (orchestrator hint)

1. **A1 + A3 + A9** — rewrite tests to hit production DB paths; ensure CI runs them
2. **A4 + A5 + A2** — schema/migration integrity fixes
3. **A6** — delete dead `lib/` exports
4. **A7, A8, A10, A11** — quick pattern/consistency wins if time in single pass
