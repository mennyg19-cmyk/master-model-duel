# P1 rules review — arm-04 (blind)

Scope: `arms/arm-04/workspace/` against this arm's selected catalog rules only
(ponytail, clean-code, workflow, vocabulary, codegraph). Findings only — no fixes.

## Counts

- Blocker: 0
- Major: 0
- Minor: 5
- Rules checked: 5
- Rules with findings: 2 (clean-code, codegraph)
- Rules clean: 3 (ponytail, workflow, vocabulary)

## Findings

1. minor — clean-code / Naming: `result` used as a standalone variable in
   `src/lib/staff-service.ts` (`changeStaffRole`, `setStaffStatus`),
   `src/app/(admin)/admin/staff/actions.ts` (`inviteStaffAction`), and
   `src/app/setup/actions.ts` (`createFirstManager`). Banned vague name.
2. minor — clean-code / Naming: `item` used as a callback parameter in
   `src/app/(admin)/admin/layout.tsx` (`visibleNav.filter((item) => ...)`,
   `.map((item) => ...)` x2). Banned vague name.
3. minor — clean-code + ponytail / Dead code & Rule of 2: `maskError` in
   `src/lib/core/result.ts` has zero production call sites (only tests + a
   README mention). Defined, exported, tested, but no app code calls it.
4. minor — clean-code / UI Consistency: staff detail "Back to staff" link in
   `src/app/(admin)/admin/staff/[staffUserId]/page.tsx` is hardcoded to
   `/admin/staff` with no README-defined exception for back navigation.
5. minor — codegraph: `.codegraph/` is not initialized in the workspace even
   though the `codegraph` CLI is on PATH. Rule requires `codegraph init`
   before structural lookups when the index is missing and the CLI is
   available.

## Notes

- No god files (largest is `staff-service.ts` at 136 lines).
- One pattern per concern is consistent and documented in README (Prisma, Zod,
  `Result`, integer cents, `Intl` dates, Tailwind tokens, `node:test`).
- Dependencies are pinned to exact versions; `dotenv` is used in
  `prisma.config.ts`, so not an unused-dependency finding.
- Comments are non-obvious intent/constraints only; no narration or
  change-explanation comments found.
- Error handling has no swallowed errors; the cookie parse `catch { return null }`
  and `createDatabase` "already exists" swallow are defined fallbacks with
  explanatory comments.
