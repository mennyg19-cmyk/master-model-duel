# Reviewer — Rules — arm-02 (Test 4, P2)

**Arm:** arm-02
**Tree / phase:** `arms/arm-02/workspace/` — Phase P2 (schema-first domain core: seasons, catalog, customers, orders, packages, payments, shipping, inventory, assembly)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol
**Reviewer:** orchestrator (independent of contestants)
**Scope:** findings only — adherence to arm-02's selected catalog rules.

---

## ponytail

- **PASS — ladder followed and tagged.** `lib/cn.ts:1` (hand-rolled `cn` over `clsx`/`tailwind-merge`) and `lib/auth/passwords.ts:3` (node `scrypt` over a `bcrypt` dep) both carry `ponytail:` comments naming the deliberate shortcut. `lib/rate-limit.ts` is an in-memory fixed-window limiter with an explicit "swap for a shared store before horizontal scaling" note — stdlib-first, no premature dep. No unrequested abstractions; no `lib/` helpers shipped without callers (`brand`, `audit`, `rate-limit`, `env`, `db`, `customers`, and every `lib/domain/*` module has a real call site in `app/`, `prisma/seed.ts`, `scripts/`, or `tests/`). No findings.
- **MINOR — `groupByPackageKey` has a single call site.** `lib/domain/grouping.ts:36` is exported and consumed only by `tests/grouping.test.ts`; production grouping goes through `packageGroupingKey` directly in `lib/domain/finalize.ts:64`. Rule of 2 is borderline here (one test caller). Either wire it into `finalize.ts` (replacing the local `byKey` map) or drop it — right now it reads as a helper written for the test rather than for the code.

## clean-code

- **VIOLATION — type/schema drift: hand-retyped staff shape instead of Prisma's generated types.** `components/staff-manager.tsx:11-18` declares a local `StaffMember` with string-literal unions `role: "MANAGER" | "STAFF" | "DRIVER"`, `status: "ACTIVE" | "REVOKED"`, and `effect: "GRANT" | "DENY"`, duplicating the `StaffRole`, `StaffStatus`, and `OverrideEffect` enums that `@prisma/client` already generates. `app/(admin)/admin/staff/page.tsx:18-28` then hand-maps each Prisma row into this shape. Clean-code: "Type/schema drift — centralize types, single source of truth." If an enum value is added, this component silently drifts and the API contract (`app/api/staff/[id]/route.ts:7-9`, `app/api/staff/[id]/overrides/route.ts:7-14`) keeps accepting the narrow literal set while the client accepts anything. Type the client with `Prisma.StaffUserGetPayload<{ include: { permissionOverrides: true } }>` and reuse `StaffRole`/`StaffStatus`/`OverrideEffect` at the boundary.
- **MINOR — swallowed error in the error reporter.** `app/error.tsx:23` ends the client-error `fetch` with `.catch(() => {})`. Clean-code: "No swallowed errors (empty catch blocks)." This is a fire-and-forget reporter, but a broken reporter should still be observable — at minimum `console.warn` so a regression in `/api/client-error` isn't invisible. The endpoint itself is volume-bounded and sanitized (`app/api/client-error/route.ts:11-13`); the client side should match that posture.
- **MINOR — magic values.** `app/api/client-error/route.ts:18` inlines `rateLimit("client-error:" + ip, 10, 60 * 1000)`; `app/api/audit/route.ts:11` and `app/(admin)/admin/audit/page.tsx:7` both inline `take: 100`; `lib/rate-limit.ts:15` inlines the `10_000` cleanup threshold. The login route names its knobs (`ATTEMPT_LIMIT_PER_IP` etc. in `app/api/auth/login/route.ts:13-15`) — these should follow the same pattern. Low impact, but the audit cap is a tuning knob shared by two files and worth one constant.
- **MINOR — inconsistent button pattern in the same file.** `components/session-buttons.tsx` uses the shared `Button` component for `StopImpersonationButton` but a hand-rolled `<button>` with ad-hoc classes (`text-xs text-muted hover:text-danger hover:underline`) for `LogoutButton`. Clean-code UI consistency / one pattern per concern. Either add a `link` variant to `components/ui/button.tsx` (the variant map is right there) or use the existing `secondary` variant — the two controls sit next to each other in the admin sidebar.
- **MINOR — duplicated fetch + error + navigate pattern.** The same shape — `fetch` → `response.json().catch(() => null)` → set a `errorMessage` from `body?.error` → `router.refresh()`/`router.push()` — is repeated in `app/login/page.tsx:17-36` (`submitLogin`), `components/setup-form.tsx:16-32` (`submitSetup`), and `components/staff-manager.tsx:34-48` (`callApi`). Three call sites clear the Rule of 2. Ponytail caveat: the three differ enough (different endpoints, different success navigation, `callApi` returns a boolean) that a `lib/api-request.ts` helper may not save lines once the call-site wiring is accounted for — flagged for judgment rather than as a must-fix.
- **MINOR — vague standalone name `item`.** `tests/domain-db.test.ts:111` `const item = await db.inventoryItem.create(...)`. `item` is on the clean-code banned-names list. Rename to `inventoryItem` (or `stockItem`) so the reservation assertion reads against a named thing.
- **MINOR — defensive optional chaining on a value the layout guarantees.** `app/(admin)/admin/page.tsx:17` renders `Signed in as {staff?.actingAs.name} ({staff?.actingAs.role})` with `?.`, but `app/(admin)/admin/layout.tsx:18` already `redirect("/login")` when `staff` is null. The chaining is dead defense that would render "undefined (undefined)" if ever hit. Drop the `?.` (the layout is the authority) or add a real null branch.

## workflow

- **VIOLATION — `.env.example` missing despite being referenced.** Workflow Security Basics: "`.env.example` with placeholders for every secret." `lib/env.ts:25` tells the user "Fix these variables (see .env.example)", and `.gitignore:34,45` ignores `.env*` — but no `.env.example` exists anywhere under `arms/arm-02/workspace/` (confirmed by glob). A new developer hitting the env-validation throw is pointed at a file that isn't there. Add `.env.example` with `DATABASE_URL=`, `AUTH_MODE=dev`, `SESSION_SECRET=`, and the two Clerk keys commented out.
- **PASS — running-app verification is evidenced for P2.** Unlike arm-01, arm-02's P2 claims are backed by real DB paths: `tests/domain-db.test.ts` exercises `finalizeOrder`, `discardOrder`, `reserveInventory`, and the grouping/merge flow against the live Postgres on 4102, and `scripts/concurrency-smoke.ts` plus `npm run smoke:concurrency` (wired in `package.json:16`) exercise the versioned-update path. Workflow: "Verify in the running app — never mark done from code alone." The seed (`prisma/seed.ts:137`) finalizes a real order end to end. No findings on verification posture.
- **MINOR — `.scratch/phase-plan.md` / EXPECTED blocks not visible.** Workflow expects a rolling `.scratch/phase-plan.md` with EXPECTED blocks written before each P2 todo and walked afterward with evidence. No `.scratch/` artifact survives under `arms/arm-02/`. `.scratch/` is gitignored, so absence is not proof of non-compliance — but no P2 expectation evidence survives anywhere. Flagged as non-evaluable, not as a violation.

## vocabulary

- **PASS — term accuracy.** README and code use exact P2 terms ("schema-first domain core", "package grouping", "draft reference", "order finalization", "inventory reservation", "package stage", "assembly batch"). No refactor/tidy/rebuild commands were issued this phase, so the scope table is not exercised. No findings.

## codegraph

- **VIOLATION (process, evidence-backed) — no `.codegraph/` index in the workspace.** arm-01's workspace has a `.codegraph/`; arm-02's does not (confirmed by glob). Codegraph: "If `.codegraph/` is missing and `codegraph` CLI is on PATH, run `codegraph init` before structural exploration." The rule's hard requirement — CodeGraph (MCP/CLI) for all structural lookups, no grep-for-symbols — governs the development process. We cannot confirm the CLI was on PATH for arm-02, so this is flagged as a process gap with evidence (missing index) rather than a proven artifact violation. If the CLI was unavailable, the rule permits a Read/grep fallback "for this run only" — but the absence of the index is the observable signal.

## grill-protocol

- **NON-EVALUABLE — process rule.** Grill-protocol fires on "grill me", Spec-gate failure, redesign Phase 0, rebuild opt-in, and autonomous pre-leave. No transcript of the P2 build session is in the arm tree, so we cannot confirm whether a Spec gate / mini-grill ran before the P2 build. The P2 work is schema-first and well-scoped (the README and `prisma/schema.prisma` line comments cite R-044..R-163 throughout), which is consistent with a settled spec, but that is circumstantial. No findings against the artifact.

---

## Summary

| Rule | Findings | Severity |
|---|---|---|
| ponytail | 1 minor (`groupByPackageKey` single test caller) | low |
| clean-code | 1 violation (type/schema drift — hand-retyped staff shape) + 6 minors (swallowed error in reporter; magic values; inconsistent button pattern; duplicated fetch+error pattern; vague `item` name; defensive `?.` on layout-guaranteed value) | mixed |
| workflow | 1 violation (missing `.env.example` despite being referenced) + 1 minor (no `.scratch/phase-plan.md` evidence) | mixed |
| vocabulary | 0 | clean |
| codegraph | 1 violation (no `.codegraph/` index; process gap with evidence) | process |
| grill-protocol | non-evaluable (no build transcript in tree) | n/a |

Findings: **3 violations + 8 minors = 11 findings.**

Strongest: real DB-backed verification of the P2 domain core (`tests/domain-db.test.ts` exercises `finalizeOrder`/`reserveInventory`/grouping against live Postgres; `scripts/concurrency-smoke.ts` wired into `npm run smoke:concurrency`), `ponytail:` ladder tags on the stdlib-first choices (`cn`, `scrypt`), exact dependency pinning, and a schema that cites R-IDs in line comments. Weakest: the client re-types the Prisma enum shape by hand (`staff-manager.tsx:11-18`), `.env.example` is referenced but missing, and the `.codegraph/` index arm-01 carries is absent here — the first two are cheap fixes, the third is a process signal.
