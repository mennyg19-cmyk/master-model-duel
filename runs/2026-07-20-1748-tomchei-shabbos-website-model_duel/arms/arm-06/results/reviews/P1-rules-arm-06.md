# P1 Rules Review — arm-06 (blind)

- Scope: `arms/arm-06/workspace/` — Test 4 / P1 (Foundation: identity, roles, permissions, staff tooling).
- Rules graded: ponytail, clean-code, workflow, vocabulary, codegraph (per `arms/arm-06/.cursor/rules/`).
- Findings only — no fixes. Severity bands: Blocker / Major / Minor.
- Method: full read of `lib/`, `app/`, `components/`, `scripts/`, `prisma/`, `middleware.ts`, `.scratch/`, README, ARM/AGENTS; grep for import/call-site evidence.

## Summary

| Band | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 3 |

## Adherence notes (what held)

- **clean-code structure / naming / comments:** Files are small, single-concern, well-named (`requirePermission`, `canTargetStaff`, `recordAudit`, `normalizeEmail`). Comments explain non-obvious intent only (e.g. "Deny override beats grant override beats role default", "Advisory lock makes the empty-database check atomic"). No narration comments, no god files (largest is `staff-editor.tsx` at 183 lines).
- **clean-code consistency (one pattern per concern):** README § Patterns table declares one choice per concern (mutations via `/api/**` + fetch, gates via `require*`, money in cents, typed settings, optimistic `version`). The shipped code follows these for everything actually used in P1.
- **clean-code dependency discipline:** Versions pinned in `package.json` (no floating ranges); no convenience packages; `clsx` + `tailwind-merge` are the minimal kit. `.env` gitignored, `.env.example` generated from a single source (`lib/env-spec.ts`).
- **workflow expectation files / gate discipline:** `.scratch/phase-plan.md` has EXPECTED items written before build; `.scratch/PHASE-P1-STATUS.md` walks each item with evidence; `.scratch/run-state.md` present and current; smoke S1–S5 ran against the live app (production build on 3106) with transcript saved. Spec-gate + grill artifacts present in `results/`.
- **workflow security basics:** No secrets in code; `AUTH_SECRET` from validated env; `.env*` in `.gitignore`; client-error endpoint bounded + redacted.
- **workflow shell discipline:** Complex PowerShell in `.scratch/*.ps1` script files, not inline `$`. `&&` avoided.
- **vocabulary:** No refactor/rebuild/aggressive-refactor commands were in scope for P1 (greenfield build), so the vocabulary triggers that mandate `codegraph_impact` first were not activated. No mis-scoped command interpretation evident.
- **ponytail chat/code anti-slop:** Code identifiers and error strings stay exact; commit-style prose in README/STATUS is direct.

## Findings

### Major 1 — Dead "for-later" helper modules (ponytail Rule of 2 + clean-code "no just-in-case code")

Four `lib/` modules ship functions with **zero call sites** in the P1 tree:

- `lib/dates.ts` — `formatDate`, `addDays` (no import anywhere)
- `lib/money.ts` — `toCents`, `formatMoney` (no import anywhere)
- `lib/ids.ts` — `generatePublicId` (no import anywhere)
- `lib/phone.ts` — `normalizePhone` (no import anywhere)

`ponytail.mdc`: "Rule of 2: needs 2+ real call sites right now. Not 'might be useful later.'" and "No boilerplate 'for later.'" `clean-code.mdc`: "No 'just in case' code — every line must have a reason" + dead-code refactor category.

The README § Patterns table documents these as the chosen patterns for later phases (orders, packages, phone capture). Establishing the *pattern choice* in P1 is defensible under clean-code "pick patterns in the first session and document in README," but shipping the implementations with no callers is not — the pattern choice could be a README line + an empty `lib/money.ts` re-exported later. As-is, four modules of dead code were added in the foundation phase.

Cited rule: `ponytail.mdc` (Rule of 2, "no boilerplate for later"), `clean-code.mdc` (Abstraction Discipline / Anti-AI-Tics / dead code).

### Major 2 — Codegraph index never initialized (workflow + codegraph)

No `.codegraph/` directory exists anywhere under `arms/arm-06/workspace/` (verified). No `codegraph init` / `codegraph status` evidence in `.scratch/`.

`workflow.mdc` Session Start: "If `.codegraph/` is missing and `codegraph` CLI is on PATH, run **`codegraph init`** before structural exploration." `codegraph.mdc` Hard rule: "Every session, before structural work: 1. Run `codegraph status` … 3. If `.codegraph/` missing and `codegraph` on PATH → `codegraph init` once, then use graph." With no index, all structural lookups would have fallen back to Read/grep — which `codegraph.mdc` forbids when an index *should* exist.

Caveat: 4 of 6 arms in this run lack a `.codegraph/` index (only arm-01 and arm-02 have one), so CLI availability on this host is not fully confirmed from the tree alone. The rule still requires an *attempt* and a note if both MCP and CLI are unavailable; neither an index nor a "CLI unavailable" note exists. Downgraded from Blocker to Major on that uncertainty.

Cited rule: `workflow.mdc` (Session Start), `codegraph.mdc` (Hard rule, "Not initialized").

### Minor 1 — `lib/result.ts` unused; README/code error-pattern drift (clean-code consistency + dead code)

`lib/result.ts` exports `Result`, `ok`, `err`, `maskError` — **none imported anywhere** (only the README § Patterns line references `Result + maskError`). Actual error handling across all API routes is inline `NextResponse.json({ error: "…" }, { status: … })` (see `app/api/admin/staff/route.ts`, `app/api/admin/staff/[id]/route.ts`, `app/api/setup/route.ts`, etc.). The declared "one error-handling approach" (`Result` + `maskError`) and the implemented approach (inline `NextResponse`) disagree — a clean-code consistency finding on top of the dead code.

Cited rule: `clean-code.mdc` (Consistency — one error-handling approach per project; dead code).

### Minor 2 — `assertDevAuthEnabled` single call site + throw/catch for control flow (clean-code Rule of 2, error handling, anti-AI-tics)

`lib/auth.ts:76` defines `assertDevAuthEnabled(): void` that throws when `DEV_AUTH_BYPASS` is off. It has exactly **one call site** (`app/api/dev-auth/route.ts:14`), wrapped in `try { assertDevAuthEnabled() } catch { return 404 }`. Rule of 2 says a helper needs 2+ real call sites now; this could be an inline `if (!isDevAuthBypass) return NextResponse.json(...)`.

The catch also discards the thrown message ("Dev auth is disabled. Set `DEV_AUTH_BYPASS=true` for local testing only.") and returns a vaguer "Dev auth is disabled" — `clean-code.mdc` Error Handling: "Error messages say what went wrong AND what the expected state was."

Cited rule: `clean-code.mdc` (Rule of 2 via ponytail, Error Handling, Anti-AI-Tics — unnecessary throw/catch for control flow).

### Minor 3 — Hardcoded "Back to home" links (clean-code UI consistency)

`app/not-found.tsx:9` and `app/forbidden.tsx:12` render `<Link href="/">Back to home</Link>`. `clean-code.mdc` UI Consistency: "Back buttons go to where the user came from, not a hardcoded route. Define explicit exceptions (e.g., Settings always returns to Settings root) in the project README." No exception is declared in the README for these pages. (Arguably these are "go home" rather than "go back" affordances, but the rule covers back navigation generally and no exception is recorded.)

Cited rule: `clean-code.mdc` (UI Consistency — back navigation).

## Out of scope / not graded

- Live Clerk integration (documented dev-auth bypass is an allowed P1 deviation per the spawn prompt and README § Auth).
- Sidebar mobile menu, client-error rate limiting — already listed as known limitations in `.scratch/PHASE-P1-STATUS.md`; not rule violations.
- Phase 2+ features (orders, packages, delivery routes) — not in P1 scope; their absence is correct.
