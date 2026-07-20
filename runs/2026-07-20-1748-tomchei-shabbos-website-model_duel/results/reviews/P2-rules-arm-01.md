# Reviewer — Rules — arm-01 (Test 4, P2)

**Arm:** arm-01
**Tree / phase:** `arms/arm-01/workspace/` — Phase P2 (schema-first domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory, assembly)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Reviewer:** orchestrator (independent of contestants)
**Scope:** findings only — adherence to arm-01's selected catalog rules.

---

## ponytail

- **VIOLATION — test-only scaffolding shipped in production source (YAGNI / Rule of 2).** `src/domain/order-engine.ts:95-104` (`OrderNumberAllocator`) and `src/domain/inventory.ts:35-55` (`InventoryReservationLedger`) are in-memory allocators that duplicate the real DB-backed `finalizeOrder` and `reserveInventory`. Neither has a production call site; only `tests/domain-core.test.ts` imports them. Ponytail: "No unrequested abstractions… No boilerplate 'for later.' Deletion over addition." Test doubles belong under `tests/`, not `src/domain/`. Move them or delete them and test the real paths.
- **VIOLATION — unused exported helpers (dead code).** `src/lib/safe-result.ts` (`SafeResult`, `maskUnexpectedError`), `src/lib/money.ts` (`formatCents`), `src/lib/dates.ts` (`formatOrganizationDate`), `src/lib/season.ts` (`getSeasonYear`, `formatSeasonName`), and `src/lib/normalize.ts` (`normalizePhone`) have zero import sites across `src/`, `prisma/`, `scripts/`, and `tests/`. `safe-result.ts` was already flagged dead in P1 and persists into P2. Rule: "Deletion over addition." Wire them up or remove them.
- **MINOR — ladder tags still absent.** No `ponytail:` comment anywhere in the P2 additions. `src/domain/order-engine.ts` (Prisma serializable retry), `src/domain/inventory.ts` (raw SQL `UPDATE` for atomic reservation), `src/lib/money.ts`/`dates.ts` (`Intl` over a currency/date dep) are all deliberate stdlib/native choices the rule asks to tag.

## clean-code

- **VIOLATION — real domain behavior is untested; tests cover in-memory fakes (Anti-Hallucination).** `tests/domain-core.test.ts` exercises `OrderNumberAllocator` and `InventoryReservationLedger` (the in-memory stand-ins), not the real `finalizeOrder` Prisma transaction nor `reserveInventory`'s guarded `UPDATE`. `discardDraft` (`order-engine.ts:80`), `advancePackageStage` (`package-stage.ts:13`), and `reserveInventory` (`inventory.ts:3`) have no tests at all. The README claims "Order finalization claims per-season sequential numbers in serializable transactions and retries serialization conflicts," "the final unit cannot be claimed twice," and "Package stage changes use optimistic versions and write package-level audits" — none of that is verified by tool output. Anti-hallucination: "Do not claim 'fixed/passed/working' without tool output or running-app evidence."
- **VIOLATION — duplicated UI (copy-paste with minor variation).** `src/app/(admin)/admin/staff/staff-manager.tsx:159-177` and `178-196` are near-identical `<fieldset>` blocks for "Personal grants" and "Personal denies," differing only by which array (`grantPermissions` / `denyPermissions`) is read and updated. Clean-code: "No copy-paste patterns with minor variations — extract the pattern." Extract one `PermissionCheckboxGroup` (one call site for grants, one for denies — passes Rule of 2 once extracted).
- **VIOLATION — inconsistent error-handling pattern across admin routes (one pattern per concern).** `src/app/api/admin/staff/route.ts:9-14` centralizes `AccessDeniedError → 403` in a local `permissionError` helper, while `src/app/api/admin/impersonation/route.ts:60-64` and `103-107` and `src/app/api/admin/overview/route.ts:22-25` inline the same `instanceof AccessDeniedError` block. One project, two patterns for the same concern. Lift the conversion into `requirePermission` (return a `NextResponse`) or a shared `withStaffRoute` wrapper.
- **MINOR — duplicated impersonator expression (magic-ish ternary).** `staffSession.actor.id === staffSession.effective.id ? null : staffSession.actor.id` appears twice in `src/app/api/admin/staff/route.ts:80-83` and `92-96`, and the same shape is reconstructed in `impersonation/route.ts:33-44`. Extract `impersonatorId(session)` into `src/lib/auth.ts`.
- **MINOR — `readServerEnvironment` called for side effect, return value discarded.** `src/lib/db.ts:4` invokes `readServerEnvironment()` purely for its throw-on-missing `DATABASE_URL` side effect; the typed object it returns is never used. The name promises a read; the intent is validation. Rename to `assertServerEnvironment()` (or have `db.ts` consume the returned `DATABASE_URL`) so the call site is honest.
- **MINOR — type drift persists from P1.** `src/lib/permissions.ts:19-23` types `grantPermissions`/`denyPermissions` as `string[]` and the API route accepts `string[]` (`staff/route.ts:113-120`), while `hasPermission` compares against the narrow `Permission` union. Narrow the boundary to `Permission[]` so an invalid literal fails at the edge instead of being silently stored. (Carried from P1; still open in P2.)
- **MINOR — client `StaffUser` type re-declared by hand.** `staff-manager.tsx:8-17` re-types the staff record shape Prisma already generates. Use `Prisma.StaffUserGetPayload<{ select: ... }>` (or a shared `Pick`) so the client tracks schema changes. (Carried from P1.)

## workflow

- **VIOLATION — "verify in the running app" not evidenced for P2 domain claims.** Workflow: "Verify in the running app — never mark done from code alone. An empty 200 is not working: seed data, exercise the real flow." The README's P2 section asserts finalization, reservation, and stage-transition behaviors, but no smoke, integration, or running-app evidence exists for them — only unit tests on in-memory fakes (see clean-code finding above). At minimum, `npm run smoke:concurrency` should exercise the real `finalizeOrder`/`reserveInventory` paths against the seeded DB.
- **MINOR — DECISION-LOG / expectation files not visible in the arm tree.** Workflow expects a rolling `.scratch/phase-plan.md` with EXPECTED blocks written before each P2 todo and walked afterward with evidence. No `.scratch/` artifact is present under `arms/arm-01/`. (`.scratch/` is gitignored, so absence is not proof of non-compliance — but no P2 expectation evidence survives anywhere, which compounds the verification gap above.)

## vocabulary

- **PASS — term accuracy.** README and code use exact P2 terms ("schema-first domain core", "package grouping", "draft reference", "order finalization", "inventory reservation", "package stage", "assembly batch"). No refactor/tidy/rebuild commands were issued this phase, so the scope table is not exercised. No findings.

## codegraph

- **PARTIAL — index present, process not verifiable.** `.codegraph/` exists in the workspace, so `codegraph init` was run. The rule's hard requirement — CodeGraph (MCP/CLI) for all structural lookups, no grep-for-symbols — governs the development process and cannot be confirmed from the build artifact alone. No findings against the artifact; flagged as non-evaluable for process adherence.

---

## Summary

| Rule | Findings | Severity |
|---|---|---|
| ponytail | 2 violations (test scaffolding in `src/domain`; unused exported helpers) + 1 minor (no ladder tags) | mixed |
| clean-code | 3 violations (real domain behavior untested / tests cover fakes; duplicated permission fieldsets; inconsistent admin error handling) + 4 minor (duplicated impersonator ternary; side-effect env call; permission type drift; hand-retyped client `StaffUser`) | mixed |
| workflow | 1 violation (no running-app evidence for P2 domain claims) + 1 minor (no `.scratch/phase-plan.md` evidence) | mixed |
| vocabulary | 0 | clean |
| codegraph | index present; process not verifiable | n/a |

Findings: **7 violations + 6 minors = 13 findings.**

Strongest: schema-first Prisma domain core with serializable finalization, atomic guarded inventory `UPDATE`, optimistic version on package stage, package-level audit rows, and exact dependency pinning. Weakest: the test suite verifies in-memory stand-ins rather than the real DB paths the README claims, test scaffolding lives in `src/domain/`, and a cluster of unused `lib/` helpers shipped ahead of any caller — all cheap to fix and they close the gap between the README's claims and what tool output actually demonstrates.
