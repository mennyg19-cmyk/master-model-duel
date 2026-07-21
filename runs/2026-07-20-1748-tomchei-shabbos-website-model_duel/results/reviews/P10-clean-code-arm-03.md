# P10 Clean-code Review — arm-03

**Reviewer:** external (blind)
**Tree:** `arms/arm-03/workspace` · **Phase:** P10 (Seasons management, repeat orders, replacement mappings)
**Scope:** duplication, naming, god files, pattern drift in P10 code.

| ID | Severity | Location | Claim | Suggested fix |
|---|---|---|---|---|
| CC-01 | High | `src/app/api/cron/season-flip/route.ts` | Byte-identical duplicate of `season-auto-flip/route.ts`. Only `season-auto-flip` is wired (smoke + README); `season-flip` is dead code. | Delete `season-flip/route.ts`. |
| CC-02 | High | `package.json:29-30` | `smoke:p10` script entry listed twice verbatim. | Remove duplicate line. |
| CC-03 | High | `src/lib/ops/repeat.ts:410-440` (`repeatOrder`) | `needsReview` computed but never read; `if (input.forceAuto \|\| allMapped)` is always true because `!allMapped` returns early at 417; final `return ok({ needsReview: true })` at 440 is unreachable; `forceAuto` param doesn't force anything (a `!allMapped` source still returns needsReview regardless of forceAuto). | Drop `needsReview`, drop the `forceAuto \|\|` redundancy, delete the unreachable return, and either honor forceAuto (auto-create even when needsPick) or remove the param. |
| CC-04 | High | `src/lib/catalog/replacements.ts:150-160` (`pickPriceSmart`) | Exported helper has zero call sites — Rule-of-2 / YAGNI violation. | Delete `pickPriceSmart`. |
| CC-05 | High | `src/lib/ops/repeat.ts` (676 lines, mixed concerns) | God file: repeat preview/confirm + single repeat + bulk repeat + `bulkUpdateOrderStatus` (unrelated to repeats). Crosses the 500-line / mixed-concern threshold. | Split `bulkUpdateOrderStatus` into `lib/ops/bulk-status.ts` (or `orders/bulk.ts`). |
| CC-06 | High | `src/lib/ops/prior-year-stub.ts` vs `scripts/seed.ts:424-457` | Two parallel seeders create imported prior-year orders with different draftRefs (`IMP-2025-${ts}` vs `IMP-2025-PRIOR`) and orderNumbers (random vs 42). Duplication + drift. | Extract one `seedImportedPriorYearOrder` used by both the API route and `seed.ts`, or delete the stub (seed.ts already covers S3). |
| CC-07 | Medium | `src/components/account/repeat-review.tsx:8-45` | `Candidate`, `Line`, `Preview` types re-define subsets of `ReplacementCandidate` / `RepeatLinePreview` / `RepeatPreview` from `lib/ops/repeat.ts` + `lib/catalog/replacements.ts`. Type/schema drift. | Import shared types from the lib (export them if needed). |
| CC-08 | Medium | `src/components/admin/seasons-admin.tsx:6-14` | `Season` type hand-rolls a subset of the Prisma `Season` model. Drift risk. | Derive via `Prisma.SeasonGetPayload<…>` or import the generated type. |
| CC-09 | Medium | `src/lib/seasons/manage.ts:186-193` (`scheduleSeasonFlip`) | Ternaries `input.scheduledOpenAt === undefined ? undefined : input.scheduledOpenAt` are no-ops — equivalent to the bare value. Redundant complexity. | Replace with `scheduledOpenAt: input.scheduledOpenAt, scheduledCloseAt: input.scheduledCloseAt`. |
| CC-10 | Medium | `src/lib/ops/repeat.ts:323-325` (`confirmRepeatOrder`) | Empty `if` body with a narration comment (`// Allowed — recipient cleared on confirm.`). Dead code / anti-AI-tic. | Delete the empty `if`. |
| CC-11 | Medium | `src/lib/ops/repeat.ts:334-345` | Two adjacent `if` branches return the identical error `"Confirm each recipient (keep or clear) before continuing."` | Combine: `if (hasRecipient && (!choice \|\| choice.keepRecipient === undefined))`. |
| CC-12 | Medium | `src/lib/ops/repeat.ts:340-345` | `!choice` recipient branch defends an impossible state — every caller (customer route `min(1)` + review client, staff auto path) sends a choice for every line. Defensive code for a condition that can't happen. | Drop the `!choice` branch. |
| CC-13 | Medium | `src/lib/catalog/replacements.ts:99` | Magic number `hopCount < 8` caps the BFS chain depth. | Extract `MAX_REPLACEMENT_HOPS = 8` named constant. |
| CC-14 | Medium | `src/app/api/admin/season-gate/route.ts` + `src/app/api/admin/seasons/route.ts` (PATCH) | Season mutations split across two routes: status via `POST /api/admin/season-gate`, schedule via `PATCH /api/admin/seasons`. Two endpoints mutate the same resource — pattern drift. | Fold gate into `PATCH /api/admin/seasons/[id]` (or `/api/admin/seasons` with `seasonId` + `status`). |
| CC-15 | Medium | `src/components/admin/seasons-admin.tsx:187` | Schedule `<input onChange={…}>` fires `scheduleOpen` → `PATCH /api/admin/seasons` on every keystroke of a `datetime-local` field. | Submit on blur or add a Save button + debounce. |
| CC-16 | Medium | `src/lib/ops/repeat.ts:473` + `:84` (`bulkRepeatOrders` → `previewRepeatOrder`) | Each bulk item fetches the order twice: once in `bulkRepeatOrders` (`db.order.findUnique`), again inside `previewRepeatOrder`. | Pass the already-fetched `source` into `previewRepeatOrder` (add an overload) to halve queries. |
| CC-17 | Low | `src/lib/catalog/replacements.ts:84-95` | `if (!existing \|\| hopCount < existing.hopCount)` — BFS with a `visited` set guarantees first hit is shortest, so `existing` is always null and the `hopCount < existing.hopCount` branch is dead. | Simplify to `if (!existing) targetHits.set(...)`. |
| CC-18 | Low | `src/components/admin/seasons-admin.tsx:67` | `setStatus` error path uses bare `json.error` (can render `undefined`), while `createSeason`/`scheduleOpen` use `json.error \|\| "…failed"`. Inconsistent error fallback. | Use `json.error \|\| "Gate failed"` everywhere. |
| CC-19 | Low | `src/lib/ops/prior-year-stub.ts:108` | `orderNumber: 900000 + Math.floor(Math.random() * 9000)` — non-deterministic, collision-prone, inconsistent with `seed.ts` (fixed `42`). | Use a stable counter or upsert by `draftRef`. |
| CC-20 | Low | `src/lib/seasons/manage.ts:145-153` (`setSeasonStatus`) | Manual OPEN/CLOSED flip does not clear `scheduledOpenAt`/`scheduledCloseAt`. A manually-closed season with a past `scheduledOpenAt` will be re-opened by the next cron run — pattern drift between manual and cron paths. | Clear the opposite schedule field on manual flip (mirror `applyScheduledSeasonFlips`). |

## Counts

- Total findings: 20
- High: 6
- Medium: 10
- Low: 4
