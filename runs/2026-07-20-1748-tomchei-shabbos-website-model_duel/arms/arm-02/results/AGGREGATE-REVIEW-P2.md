# Aggregate Review — P2 — arm-02

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Arm:** arm-02
**Phase:** P2 — Domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory schema + engine
**Tree:** `arms/arm-02/workspace/`
**Inputs:** `results/reviews/P2-security-arm-02.md`, `P2-quality-arm-02.md`, `P2-rules-arm-02.md`, `P2-clean-code-arm-02.md`
**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings.

## Severity counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 13 |
| Minor | 22 |
| **Total** | **35** |

Severity mapping (same as P1): security HIGH = blocker; security MEDIUM / quality correctness-or-integrity defect / rules VIOLATION = major; all LOW + clean-code refactor debt + informational = minor. No security HIGH findings in P2, so no blockers. Where two specialists filed the same location+claim at different severities, the higher severity survives (e.g. clean-code Finding 6 LOW + rules clean-code VIOLATION → major).

## Sources

- S = security (`P2-security-arm-02.md`), findings S1–S11
- Q = quality (`P2-quality-arm-02.md`), findings F1–F12
- R = rules (`P2-rules-arm-02.md`), per-rule items
- C = clean-code (`P2-clean-code-arm-02.md`), findings 1–6

## Dedupe map (merged findings)

- R-clean-code VIOLATION "type/schema drift — hand-retyped `StaffMember`" ≡ C-Finding 6 → **A12** (major; rules violation wins over clean-code LOW)
- R-clean-code MINOR "swallowed error in reporter" ≡ C-Finding 2 → **A32**
- R-clean-code MINOR "inconsistent button pattern" ≡ C-Finding 4 → **A33**
- R-ponytail MINOR "`groupByPackageKey` single test caller" ≡ C-Finding 1 "duplicated grouping logic in `finalize.ts`" → **A27** (same root gap: helper exists, production path inlines a duplicate; one fix — call the helper from `finalize.ts`)
- R-clean-code MINOR "defensive `?.` on layout-guaranteed value" ≡ C-Finding 3 → **A29**

All other findings carried over verbatim with no merge.

---

## Blockers (0)

None. No security HIGH findings in P2. The P1 blockers (brute-force/rate-limit, session invalidation on role change) were addressed in P2 — login now throttles (S4 notes the limiter exists, S2 flags it is bypassable) and role/override changes delete live sessions (security positives list). The remaining security gaps are MEDIUM or below.

---

## Major (13)

### A1 — Login timing side-channel enables staff email enumeration
**Severity:** major · **Source:** S1 · **Files:** `app/api/auth/login/route.ts:44-50`, `lib/auth/passwords.ts:10-16`
The unified `Invalid email or password` message does not equalize timing: on a missing user, `verifyPassword` (scrypt, deliberately slow) never runs, so the non-existent-user response is dramatically faster than the wrong-password response. An attacker enumerates valid staff emails by timing despite the unified message. Run a dummy scrypt over a fixed salt on the missing-user path before returning the unified error.

### A2 — `x-forwarded-for` trusted unconditionally; rate limits bypassable by header spoofing
**Severity:** major · **Source:** S2 · **Files:** `lib/rate-limit.ts:21-23`; used by `app/api/auth/login/route.ts:28`, `app/api/client-error/route.ts:18`
`clientIp` returns the first `x-forwarded-for` value with no trusted-proxy validation. Any client can set a fresh value per request and evade the per-IP login throttle (20/15 min) and the client-error throttle entirely. Combined with the in-memory per-process limiter (A20), brute-force protection on the password login is effectively bypassable. Tie `x-forwarded-for` trust to a configured trusted proxy / hop count, or fall back to the socket peer when no trusted proxy is configured.

### A3 — Impersonation audit is not atomic with the session mutation; no step-up re-auth
**Severity:** major · **Source:** S3 · **Files:** `app/api/impersonate/route.ts:27-34` (POST), `42-48` (DELETE); `lib/auth/session.ts:55-57`
POST does `await setImpersonation(...)` then a separate `await writeAudit(...)` with no surrounding transaction (unlike `staff/[id]` PATCH and overrides PUT, which wrap mutation + audit in `db.$transaction`). If the audit write fails, impersonation is active with no audit record — violating the "no audited action without its audit entry" guarantee the rest of the codebase enforces. The same gap exists in DELETE. Separately, impersonation requires only `staff.impersonate` (held by every MANAGER) with no step-up re-auth and persists for the full 12-hour session TTL — a hijacked manager session can impersonate any active staff member undetected until expiry. Wrap both operations in a transaction and consider step-up auth + a shorter impersonation TTL.

### A4 — Order-number gap on losing concurrent finalize
**Severity:** major · **Source:** Q-F1 · **File:** `lib/domain/finalize.ts:22-29`
`claimNextOrderNumber` (atomically increments `Season.orderCounter` under a row lock) runs **before** the guarded status flip `tx.order.updateMany({ where: { id, status: "DRAFT" } })`. When two requests finalize the same draft, both pass `assertTransition`, both claim a distinct number, then only one `updateMany` returns `count === 1`; the loser throws but the Season counter was already incremented, permanently wasting a number. The S4 test only asserts `fulfilled.length === 1`, not that the counter stayed gap-free. EXPECTED #10/#S4 require "concurrent finalizations → unique sequential numbers." Fix: flip status first (guarded `updateMany`, abort on `count !== 1`), then `claimNextOrderNumber` inside the same transaction.

### A5 — Package merge is not concurrency-safe
**Severity:** major · **Source:** Q-F2 · **File:** `lib/domain/finalize.ts:72-90`
`tx.package.findFirst({ where: { seasonId, groupingKey, stage: "NEW" } })` then `tx.package.create(...)` with no lock, no `upsert`, no unique constraint. Two concurrent finalizations of **different** orders sharing a grouping key can both find no NEW package and both create one — producing two NEW packages for the same `(seasonId, groupingKey)`, the exact opposite of the merge guarantee UR-001 is built on. The S2 merge test runs finalizes sequentially and never exercises this race. Fix: add a partial unique index `CREATE UNIQUE INDEX ... ON "Package"("seasonId","groupingKey") WHERE "stage" = 'NEW'` and use `upsert`/insert-on-conflict so the second finalize joins the existing NEW package.

### A6 — `finalizeOrder` never reserves inventory
**Severity:** major · **Source:** Q-F4 · **Files:** `lib/domain/finalize.ts`, `lib/domain/inventory.ts`
The reserve engine exists and is exercised standalone by S5, but `finalizeOrder` never calls `reserveInventory` for the order's products/add-ons. EXPECTED #8 states "Order state machine + finalize + discard; concurrency via row-level locking / optimistic versioning on inventory and package mutations." Inventory is untouched on the only code path that should claim stock, so a finalized order carries no reservation. Either wire `reserveInventory` into `finalizeOrder` (per line, gated on `product.trackInventory`/`addOn.trackInventory`) or document the deferral in `PHASE-P2-STATUS.md`.

### A7 — `Package.version` optimistic locking is unused (claimed vs EXPECTED #8)
**Severity:** major · **Source:** Q-F5 · **Files:** `prisma/schema.prisma` (`Package.version`, `InventoryItem.version`), `lib/domain/inventory.ts`
`Package.version` and `InventoryItem.version` exist, but no P2 code path reads `version` for optimistic concurrency on Package. There is no stage-transition function at all in P2, so the "optimistic versioning on package mutations" half of EXPECTED #8 is unimplemented, not deferred-with-stub. `InventoryItem.version` is incremented in the raw `UPDATE` but never compared. Either ship a minimal `transitionPackageStage` that uses `version`, or mark `version` as reserved-for-future in the status doc so EXPECTED #8 isn't claimed as done.

### A8 — `ShippingQuote` permits neither orderId nor packageId
**Severity:** major · **Source:** Q-F7 · **File:** `prisma/schema.prisma:407-417`
Both `orderId` and `packageId` are nullable with no CHECK. A quote attached to nothing is meaningless and will orphan on cleanup. Add a CHECK that at least one is set (`("orderId" IS NOT NULL) OR ("packageId" IS NOT NULL)`), mirroring the `InventoryItem_target_xor` pattern already in the migration.

### A9 — No uniqueness on per-line option/add-on snapshots
**Severity:** major · **Source:** Q-F8 · **File:** `prisma/schema.prisma` (`OrderLineOption`, `OrderLineAddOn`)
`OrderLineOption(orderLineId, productOptionId)` and `OrderLineAddOn(orderLineId, addOnId)` have no `@@unique`. Duplicate rows on the same line are not prevented at the DB level; price-snapshot aggregation could double-count an add-on or option. Add `@@unique([orderLineId, productOptionId])` and `@@unique([orderLineId, addOnId])`.

### A10 — `OrderLine.packageId` is `ON DELETE SET NULL`, breaking the finalize invariant
**Severity:** major · **Source:** Q-F12 · **Files:** `prisma/schema.prisma:299`, migration line 456
`ON DELETE SET NULL` for `OrderLine.packageId` silently orphans a package's lines from any grouping on delete. Once an order is finalized, its lines must belong to exactly one package (UR-001 keystone invariant); SET NULL can break that invariant without an audit trail. Consider `ON DELETE RESTRICT` (force explicit re-group) or a re-group-on-delete path.

### A11 — Missing `.env.example` despite being referenced
**Severity:** major · **Source:** R-workflow VIOLATION · **Files:** `lib/env.ts:25`, `.gitignore:34,45`, `README.md`
Workflow Security Basics: "`.env.example` with placeholders for every secret." `lib/env.ts:25` tells the user "Fix these variables (see .env.example)" and `.gitignore` ignores `.env*`, but no `.env.example` exists anywhere under `arms/arm-02/workspace/` (confirmed by glob). A new developer hitting the env-validation throw is pointed at a file that isn't there. Add `.env.example` with `DATABASE_URL=`, `AUTH_MODE=dev`, `SESSION_SECRET=`, and the two Clerk keys commented out.

### A12 — Type/schema drift: hand-mapped client `StaffMember` shape
**Severity:** major · **Source:** R-clean-code VIOLATION ≡ C-Finding 6 · **Files:** `components/staff-manager.tsx:11-18`, `app/(admin)/admin/staff/page.tsx:18-28`, `app/api/staff/route.ts`
`staff-manager.tsx` declares its own `StaffMember` type with string-literal unions `role: "MANAGER" | "STAFF" | "DRIVER"`, `status: "ACTIVE" | "REVOKED"`, `effect: "GRANT" | "DENY"`, duplicating the `StaffRole`, `StaffStatus`, and `OverrideEffect` enums `@prisma/client` already generates. The staff page hand-maps each Prisma row into this shape, and the API route returns Prisma objects directly with no shared DTO — three places own a piece of the "staff over the wire" shape and can drift silently. Clean-code: "Centralize types, single source of truth." Centralize a `StaffView` type in `lib/` derived from the Prisma payload and project into it from both the API route and the page.

### A13 — No `.codegraph/` index in the workspace (process gap, evidence-backed)
**Severity:** major · **Source:** R-codegraph VIOLATION · **Tree:** `arms/arm-02/workspace/`
arm-01's workspace has a `.codegraph/`; arm-02's does not (confirmed by glob). Codegraph rule: "If `.codegraph/` is missing and `codegraph` CLI is on PATH, run `codegraph init` before structural exploration." We cannot confirm the CLI was on PATH for arm-02, so this is flagged as a process gap with evidence (missing index) rather than a proven artifact violation. If the CLI was unavailable, the rule permits a Read/grep fallback "for this run only" — but the absence of the index is the observable signal.

---

## Minor (22)

### A14 — In-memory rate limiter is per-process only
**Source:** S4 · **File:** `lib/rate-limit.ts:1-19`
The fixed-window limiter lives in a process-local `Map`. Under any multi-instance deploy, per-IP and per-account limits reset per node, so an attacker distributing requests across N nodes gets N× the configured limit. The plan defers a shared store, but flag now so production does not ship with the in-memory limiter as the only brute-force control (compounds with A2).

### A15 — `SESSION_SECRET` policy is weak and a real dev secret ships in the archive tree
**Source:** S5 · **Files:** `lib/env.ts:7-9`, `arms/arm-02/workspace/.env:3`, `.gitignore:33-45`
`env.ts` enforces only `min(16)` characters for the secret that HMAC-signs every session token. Sixteen characters is well below modern guidance and there is no entropy or rotation requirement. Separately, the workspace `.env` contains a real value (`SESSION_SECRET=dev-only-secret-not-for-production-1748`). `.gitignore` excludes `.env*`, so it will not be committed, but the file is present in the run archive tree; if the archive is shared/zipped outside git the secret leaks and every HMAC-signed session token can be forged offline. Raise the minimum length / require high entropy and ensure the dev secret is treated as disposable on any sharing.

### A16 — Staff page loads `passwordHash` into server memory unnecessarily
**Source:** S6 · **File:** `app/(admin)/admin/staff/page.tsx:7-10`
The server component runs `db.staffUser.findMany({ include: { permissionOverrides: true } })` without `omit: { passwordHash: true }`, unlike `GET /api/staff` which omits the hash. The hash is not sent to the client (only `id/name/email/role/status/overrides` are mapped into props), but it is loaded into server memory on every page render. Match the API route's hygiene and omit the hash at the query layer.

### A17 — No DB-level CHECK constraints on monetary / quantity / counter columns
**Source:** S7 · **File:** `prisma/migrations/20260720180500_p2_domain_core/migration.sql` (table definitions; only CHECK is `InventoryItem_target_xor` line 511)
The migration creates all P2 tables but adds no `>= 0` / `> 0` CHECK constraints on: `Order.totalCents`, `OrderLine.quantity`, `OrderLine.unitPriceCents`, `OrderLineOption.priceAdjustmentCents`, `OrderLineAddOn.quantity`, `OrderLineAddOn.unitPriceCents`, `Payment.amountCents`, `StripePaymentIntent.amountCents`, `ShippingQuoteOption.amountCents`, `Season.orderCounter`, `InventoryItem.quantityOnHand`, `InventoryItem.reserved`. Negative amounts are persistable at the DB layer; a negative `Payment.amountCents` is a fraud surface (a posted "payment" that reduces a balance), and a negative `Order.totalCents` breaks downstream money math. Defense-in-depth — enforce non-negativity at the DB layer, not only in application code that may not yet exist.

### A18 — `Payment` has no optimistic versioning or state-transition guard
**Source:** S8 · **Files:** `prisma/schema.prisma:382-392`, migration lines 212-223
`Payment` carries a `PaymentState` enum (POSTED/VOIDED) but no `version` column and no DB-level guard against double-void or re-post. Concurrent staff actions (post + void, or two voids) can both succeed, with the second overwriting `voidedAt` and producing duplicate audit rows. The plan defers payment lifecycle logic to a later phase, but the schema landed in P2 without a `version` column; adding one now would let that phase enforce single-winner transitions the same way `Package` and `InventoryItem` do.

### A19 — Public endpoints disclose auth state
**Source:** S9 · **Files:** `app/api/setup/route.ts:13-16`, `app/api/health/route.ts:4-18`
`GET /api/setup` returns `{ locked: staffCount > 0 }` and `GET /api/health` returns `authMode` (dev/clerk). Both are unauthenticated. An attacker learns whether first-run bootstrap is still open (targeting the setup endpoint) and which auth backend the deployment uses (targeting surface). Low impact, but consider hiding `authMode` behind an authenticated route or dropping it from the public health payload.

### A20 — Dev middleware gate is cookie-presence only and excludes `/api/*`
**Source:** S10 · **File:** `middleware.ts:6-22`
In dev mode the edge gate only checks that the `tomchei_session` cookie exists (any value, no DB validation), and the matcher covers only `/admin/:path*` and `/driver/:path*` — not `/api/*`. This is acceptable because every mutating API route calls `requirePermissionApi` (DB-backed) and admin pages re-validate via `requirePermissionPage`. But the edge gate provides no real protection on its own; a future API route that forgets the gate is unprotected at the edge. Defense-in-depth: consider validating the session at the edge or extending the matcher to `/api/*`.

### A21 — `findOrLinkCustomer` links by email/phone without verifying identity ownership
**Source:** S11 · **File:** `lib/customers.ts:16-59`
In dev mode (no `authUserId`), `findOrLinkCustomer` matches an existing customer by email, then by normalized phone, and links the new identity into the existing record. This is the intended dedupe for staff-created phone orders, but there is no verification step. When customer auth lands in a later phase, a user who controls an email or phone that was previously used by staff for a phone-order customer would inherit that customer's order history. Flag for the customer-auth phase to require email/phone verification before linking, and to refuse silent linking when the incoming identity is a self-signup vs. a staff-created record.

### A22 — `findFirst` is non-deterministic when duplicate NEW packages exist
**Source:** Q-F3 · **File:** `lib/domain/finalize.ts:72`
`findFirst` with no `orderBy`. If A5 ever produces multiple NEW packages for one key, the line batch attaches to an arbitrary one. Even without A5, determinism matters for replay/audit. Add `orderBy: { createdAt: "asc" }` so the oldest NEW package wins, and resolve A5 so the case can't arise.

### A23 — `recalcPaymentStatus` is dead code
**Source:** Q-F6 · **File:** `lib/domain/payment-status.ts`
Recomputes `Order.paymentStatus` but is called from nowhere in P2. The cached `paymentStatus` column therefore never changes from its `UNPAID` default. Acceptable as a placeholder, but it is currently unreachable; flag for the payments phase so it isn't forgotten.

### A24 — Missing FK indexes
**Source:** Q-F9 · **File:** `prisma/schema.prisma` / migration
Prisma does not auto-create indexes on scalar FK columns. The migration adds explicit indexes only for `PackageAudit` and `CronRunLog`. `Payment.orderId`, `OrderLine.orderId`, `OrderLineOption.orderLineId`, `OrderLineAddOn.orderLineId`, `StripePaymentIntent.orderId`, `ShippingQuoteOption.quoteId`, `OrderLine.packageId`, `PackageAudit.packageId` (composite, ok), and `OrderLine.fulfillmentMethodId` are all unindexed. Will degrade list/lookup queries at scale. Add `@@index` for the hot FKs.

### A25 — Seed idempotency gap for `AddOnRestriction`
**Source:** Q-F10 · **File:** `prisma/seed.ts:90-100`
Upserts the add-on with a nested `restrictions: { create: { productId } }`. Nested `create` only runs on the upsert's **create** branch. On a re-seed where the AddOn already exists but its restriction row was deleted, the restriction is never recreated. The later `if (existingOrder) return` only short-circuits when an order already exists, so a partially-seeded DB (product+addOn present, order deleted) silently loses the restricted-add-on fixture that S1 relies on. Either move the restriction into its own upsert keyed on `(addOnId, productId)`, or guard it explicitly.

### A26 — `recalcPaymentStatus` COMPED edge on zero-total orders
**Source:** Q-F11 · **File:** `lib/domain/payment-status.ts:20`
Short-circuits `postedTotal <= 0 → UNPAID` before comparing to `totalCents`. A free order (`totalCents === 0`) with no payments is therefore marked `UNPAID` forever instead of `PAID`/`COMPED`. Minor edge; may not occur in practice, but the branch order is wrong — compare against `totalCents` first.

### A27 — `groupByPackageKey` has a single test caller; production inlines a duplicate
**Source:** R-ponytail MINOR ≡ C-Finding 1 · **Files:** `lib/domain/grouping.ts:36-47`, `lib/domain/finalize.ts:62-68`
`groupByPackageKey` is exported and consumed only by `tests/grouping.test.ts`; production grouping goes through `packageGroupingKey` directly and then re-implements the group-by-key loop inline in `finalize.ts:62-68` (a verbatim Map-based reimplementation of the helper, which `finalize.ts` already imports from on line 5). Rule of 2 is satisfied (helper + inline copy) and the fix is one line: `const byKey = groupByPackageKey(lines);`. Either wire the helper into `finalize.ts` (replacing the local `byKey` map) or drop the helper.

### A28 — Magic values inlined at call sites
**Source:** R-clean-code MINOR · **Files:** `app/api/client-error/route.ts:18`, `app/api/audit/route.ts:11`, `app/(admin)/admin/audit/page.tsx:7`, `lib/rate-limit.ts:15`
`client-error` inlines `rateLimit("client-error:" + ip, 10, 60 * 1000)`; both audit routes inline `take: 100`; `rate-limit.ts` inlines the `10_000` cleanup threshold. The login route names its knobs (`ATTEMPT_LIMIT_PER_IP` etc. in `app/api/auth/login/route.ts:13-15`) — these should follow the same pattern. Low impact, but the audit cap is a tuning knob shared by two files and worth one constant.

### A29 — Defensive optional chaining on a layout-guaranteed value
**Source:** R-clean-code MINOR ≡ C-Finding 3 · **File:** `app/(admin)/admin/page.tsx:17-18`
Renders `Signed in as {staff?.actingAs.name} ({staff?.actingAs.role})` with `?.`, but `app/(admin)/admin/layout.tsx:18` already `redirect("/login")` when `staff` is null. The chaining is dead defense that would render "undefined (undefined)" if ever hit. Drop the `?.` (the layout is the authority) or add a real null branch.

### A30 — Duplicated fetch + error + navigate pattern (3 call sites)
**Source:** R-clean-code MINOR · **Files:** `app/login/page.tsx:17-36` (`submitLogin`), `components/setup-form.tsx:16-32` (`submitSetup`), `components/staff-manager.tsx:34-48` (`callApi`)
The same shape — `fetch` → `response.json().catch(() => null)` → set `errorMessage` from `body?.error` → `router.refresh()`/`router.push()` — is repeated in three places. Three call sites clear the Rule of 2. Ponytail caveat: the three differ enough (different endpoints, different success navigation, `callApi` returns a boolean) that a `lib/api-request.ts` helper may not save lines once the call-site wiring is accounted for — flagged for judgment rather than as a must-fix.

### A31 — Vague standalone name `item`
**Source:** R-clean-code MINOR · **File:** `tests/domain-db.test.ts:111`
`const item = await db.inventoryItem.create(...)`. `item` is on the clean-code banned-names list. Rename to `inventoryItem` (or `stockItem`) so the reservation assertion reads against a named thing.

### A32 — Swallowed error in the error reporter
**Source:** R-clean-code MINOR ≡ C-Finding 2 · **File:** `app/error.tsx:23`
The client-error `fetch` ends with `.catch(() => {})` — an empty arrow handler that swallows every failure of the report POST. The preceding comment states intent (redacted telemetry) but the catch gives no signal when the report endpoint is down. Clean-code: "No swallowed errors (empty catch blocks)." At minimum the handler should be a named no-op with a comment, or log at debug / `console.warn` so a regression in `/api/client-error` isn't invisible.

### A33 — Inconsistent button pattern within one file
**Source:** R-clean-code MINOR ≡ C-Finding 4 · **File:** `components/session-buttons.tsx:21-34`
`LogoutButton` renders as a raw `<button>` with ad-hoc classes (`text-xs text-muted hover:text-danger hover:underline`) while `StopImpersonationButton` in the same file uses the shared `Button` component. Every other clickable surface routes styling through `components/ui/button.tsx`. A "link-styled logout" is a real variant; encode it as a `Button` variant (the variant map is right there) or use the existing `secondary` variant — the two controls sit next to each other in the admin sidebar.

### A34 — Inline styles in `global-error.tsx`
**Source:** C-Finding 5 · **File:** `app/global-error.tsx:6,9`
Uses `style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center" }}` and a second inline style on the button. Every other surface uses Tailwind utility classes and the shared `Card`/`Button` components. Nuance: `global-error.tsx` replaces the root layout so it cannot rely on the app shell — but Tailwind utilities are still available at this level, so the inline styles are avoidable. Replace with utility classes to keep one styling approach.

### A35 — No `.scratch/phase-plan.md` / EXPECTED-block evidence survives
**Source:** R-workflow MINOR (non-evaluable) · **Tree:** `arms/arm-02/`
Workflow expects a rolling `.scratch/phase-plan.md` with EXPECTED blocks written before each P2 todo and walked afterward with evidence. No `.scratch/` artifact survives under `arms/arm-02/`. `.scratch/` is gitignored, so absence is not proof of non-compliance — but no P2 expectation evidence survives anywhere. Flagged as non-evaluable, not as a violation; recorded for the trail.

---

## Top 5 for builder fix pass

Ordered by severity × breadth × cheapness of fix:

1. **A4 — Order-number gap on losing concurrent finalize** (major). Flip status first (guarded `updateMany`, abort on `count !== 1`), then `claimNextOrderNumber` inside the same transaction so the loser aborts before touching the Season counter. Pair with the S4 smoke assertion that the counter stays gap-free.
2. **A5 — Package merge is not concurrency-safe** (major). Add a partial unique index `WHERE "stage" = 'NEW'` on `("seasonId","groupingKey")` and switch to `upsert`/insert-on-conflict so the second finalize joins the existing NEW package. Pair with A22 (`findFirst` `orderBy: createdAt asc`).
3. **A6 — `finalizeOrder` never reserves inventory** (major). Wire `reserveInventory` into `finalizeOrder` per line (gated on `trackInventory`), or explicitly document the deferral in `PHASE-P2-STATUS.md` so EXPECTED #8 stops being claimed as done. Pair with A7 (Package.version unused) — both are EXPECTED #8 claims.
4. **A3 — Impersonation audit not atomic + no step-up re-auth** (major). Wrap POST and DELETE in `db.$transaction` (mirror `staff/[id]` PATCH) so impersonation can never be active without its audit row; consider step-up re-auth + a shorter impersonation TTL.
5. **A2 — `x-forwarded-for` trusted unconditionally** (major). Tie header trust to a configured trusted proxy / hop count or fall back to the socket peer; this is the cheapest fix that makes the A14/A20 rate-limiter controls actually enforce. Pair with A1 (login timing) — both touch `app/api/auth/login/route.ts`.

---

## Notes (not counted as findings)

- No IDOR observed in P2: every per-id staff mutation still gates on `staff.manage` and blocks self-target mutations; customer/order resources now exist but every order/customer route is staff-gated with no public object-level surface yet.
- No injection observed: all DB access is via Prisma parameterized queries or tagged-template raw SQL (`reserveInventory`, `releaseReservation`, `claimNextOrderNumber`) — `${quantity}` / `${inventoryItemId}` / `${seasonId}` are parameterized, no string interpolation.
- P1 blockers resolved in P2: login now throttles (A14/A20 note the limiter exists, A2 flags it is bypassable), and role/override/permission changes delete the target's live sessions (security positives list). No P1 blocker regressed.
- `vocabulary` rule: 0 findings (terms accurate — "schema-first domain core", "package grouping", "draft reference", "order finalization", "inventory reservation", "package stage", "assembly batch" all used correctly; no refactor/tidy/rebuild commands issued this phase so the scope table is not exercised).
- `grill-protocol` rule: non-evaluable — no build transcript in the arm tree, so we cannot confirm whether a Spec gate / mini-grill ran before the P2 build. The P2 work is schema-first and well-scoped (README and `prisma/schema.prisma` line comments cite R-044..R-163 throughout), consistent with a settled spec, but that is circumstantial.
- Security positives (no action): HMAC-signed session tokens (leaked `Session` table alone cannot forge lookups; rotating `SESSION_SECRET` revokes all sessions); `httpOnly` + `sameSite:lax` + `secure`-in-production cookies; scrypt with random 16-byte salt and `timingSafeEqual`; conditional `updateMany` concurrency guards on `finalizeOrder`/`discardOrder`; `claimNextOrderNumber` row-locked atomic `UPDATE ... RETURNING`; audit-in-transaction for setup/staff POST/staff PATCH/overrides PUT; role/override changes delete live sessions; self-edit guards; `client-error` strips CR/LF and is volume-bounded; `health` keeps raw Prisma detail server-side; login `?next=` constrained to same-site relative paths; `Order.draftReference` is 8 random bytes over a 32-char unambiguous alphabet (~64 bits, not enumerable).
- Cosmetic notes from specialists (not findings): `recalcPaymentStatus` is a placeholder for the payments phase (A23); `InventoryItem.version` is incremented but never compared (same root as A7); concurrency smoke proves single-shot conflict reporting but not a retry loop; the `.scratch/` absence (A35) is gitignored and therefore non-evaluable.


