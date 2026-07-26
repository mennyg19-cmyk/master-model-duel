# P2 rules review — arm-04 (blind)

Scope: `arms/arm-04/workspace/` P2 delta (schema + engine) against this arm's
selected catalog rules only (ponytail, clean-code, workflow, vocabulary,
codegraph). Findings only — no fixes. No new scope beyond P2.

## Counts

- Blocker: 0
- Major: 0
- Minor: 4
- Rules checked: 5
- Rules with findings: 3 (clean-code, ponytail, codegraph)
- Rules clean: 2 (workflow, vocabulary)

## Findings

1. minor — clean-code / Naming: `item` used as a standalone local in
   `src/lib/inventory/reserve.ts:62,67` (`availableUnits`). Banned vague name;
   rename to `inventory` or `row`.
2. minor — clean-code / Naming: `result` used as a parameter name in
   `src/lib/geocode-cache.ts:35` (`writeGeocodeCache(result: GeocodeResult, …)`)
   and referenced on lines 38–49. Banned vague name; the type already says
   `GeocodeResult`, so `geocode` or `lookup` reads better.
3. minor — clean-code + ponytail / Rule of 2: `destinationOf` in
   `src/lib/orders/grouping.ts:80` has one call site (line 73, inside
   `groupLinesIntoPackages`) and no external importer despite being exported.
   It is a trivial field-copy helper; inline it or drop the export until a
   second caller exists.
4. minor — codegraph: `.codegraph/` is still not initialized in the workspace
   even though `codegraph` CLI v1.0.1 is on PATH. The arm rule requires
   `codegraph init` before structural lookups when the index is missing and the
   CLI is available. Repeat from P1.

## Notes

- No god files: largest P2 file is `order-service.ts` at 322 lines; the schema
  split by concern (`prisma/schema/*.prisma`) keeps every file under 200 lines.
- One pattern per concern is consistent and documented in README: Prisma, Zod,
  `Result`, integer cents, `Intl` dates, `node:test`, optimistic `version`.
- Comments are non-obvious intent/constraints only (e.g. the Crockford base32
  rationale in `draft-reference.ts`, the transaction-abort explanation in
  `order-service.ts`); no narration or change-explanation comments.
- Error handling: no swallowed errors; `customers.ts` rethrows after the
  duplicate-key recovery, `seasons.ts` marks the cron run FAILED and rethrows.
- Trust-boundary / data-loss: inventory reserve uses parameterized
  `Prisma.sql` (no string interpolation into SQL); finalize is one transaction
  that claims the draft, reserves stock, takes the number and builds packages,
  so a failure rolls all of it back.
- No new dependencies added in P2; existing deps stay pinned.
- P1 minor #3 (`maskError` dead code) was resolved — `core/result.ts` no longer
  exports it. P1 minor #5 (codegraph) persists and is re-flagged above.
