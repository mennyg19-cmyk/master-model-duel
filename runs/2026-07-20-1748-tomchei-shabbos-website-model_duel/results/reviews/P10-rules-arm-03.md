# P10 Rules Review — arm-03

**Reviewer:** external (blind)
**Arm:** arm-03
**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Ruleset:** ponytail, clean-code, workflow, vocabulary, codegraph
**Scope:** P10 diff vs P9 gate (commit `a0cd2d9`) + new untracked P10 files.

Method: `git diff a0cd2d9 -- arms/arm-03/workspace` for modified files; full read of new P10 files; cross-checked against arm rules in `arms/arm-03/.cursor/rules/*.mdc`. Findings only.

## Findings

| ID | Severity | Location | Claim | Rule |
|---|---|---|---|---|
| R1 | High | `package.json` (scripts block) | `smoke:p10` key is declared twice on adjacent lines (byte-identical). Duplicate JSON keys are undefined-behavior for parsers and is a copy-paste leftover. | clean-code (copy-paste / dead code), ponytail (deletion over addition) |
| R2 | High | `src/app/api/cron/season-auto-flip/route.ts` and `src/app/api/cron/season-flip/route.ts` | Two cron routes are byte-identical (same imports, same `requireCronBearer`, same `applyScheduledSeasonFlips` call, same response). README only documents `season-auto-flip`; `season-flip` is a redundant second endpoint. | clean-code (Rule of 2 / duplicated logic), ponytail (YAGNI, deletion) |
| R3 | Medium | `src/lib/ops/repeat.ts` `repeatOrder` (lines ~410-440) | `const needsReview = …` is computed and never read. The final `return ok({ needsReview: true, preview })` is unreachable: `!allMapped` returns early, otherwise `input.forceAuto || allMapped` is always true and returns the auto branch. Dead variable + dead return. | clean-code (dead code, anti-AI-tics "just in case"), ponytail (delete dead code) |
| R4 | Medium | `src/lib/ops/repeat.ts` | File is 676 lines (was 606 pre-P10) and mixes five concerns: preview, confirm, single repeat, bulk repeat, bulk status update. P10 extended a >500-line mixed-concern file without splitting. | clean-code (split when >500 lines or mixed concerns), ponytail (god files) |
| R5 | Medium | `src/lib/ops/prior-year-stub.ts` + `src/app/api/admin/imports/prior-year-stub/route.ts` | Module comment claims "P12 migration hook stub … so P10 S3 can exercise repeat", but `scripts/smoke-p10.mjs` S3 exercises repeat via the seed.ts-created `IMP-2025-PRIOR` order, not via this stub. Stub + route are unused by the P10 smoke; the claim is not backed by evidence. | ponytail (YAGNI / need-to-exist), clean-code anti-hallucination (claim vs. evidence) |
| R6 | Low | `src/app/(storefront)/account/orders/[id]/repeat/page.tsx` | Page returns bare `<RepeatReviewClient orderId={id} />` with no `<main>` wrapper, no header, no back navigation. Sibling order detail page uses `<main className="mx-auto max-w-2xl …">` plus a back `<Link href="/account">`. New screen diverges from storefront pattern. | clean-code (UI consistency, back navigation), vocabulary ("add" → follow existing patterns) |
| R7 | Low | `src/components/admin/seasons-admin.tsx` `scheduleOpen` | PATCH fires on every `onChange` of `datetime-local`. `new Date(localValue).toISOString()` throws `RangeError` on a partially-typed or cleared value (e.g. `new Date("")` → Invalid Date), unhandled in the handler. Over-eager network calls + unguarded throw. | clean-code (every line has a reason / no swallowed-but-unhandled errors), ponytail (no "just in case" code) |
| R8 | Low | `src/components/admin/seasons-admin.tsx` `setStatus` | Error branch uses `json.error` with no fallback string, while `createSeason` and `scheduleOpen` use `json.error || "…"`. Inconsistent error-message pattern within the same component. | clean-code (one pattern per concern / consistency) |
| R9 | Low | `src/lib/ops/repeat.ts` `confirmRepeatOrder` (lines ~323-325) | `if (choice.action === "map" && choice.keepRecipient === false) { // Allowed — recipient cleared on confirm. }` is an empty body with only a narration comment. No-op branch. | clean-code (dead code, narration comments), ponytail (delete) |
| R10 | Low | `src/lib/ops/repeat.ts` `confirmRepeatOrder` (lines ~329-345) | Two separate `if` branches (`hasRecipient && choice && choice.keepRecipient === undefined` and `hasRecipient && !choice`) return the identical error string. Mergeable into one condition. | ponytail (shrink), clean-code (copy-paste with minor variation) |
| R11 | Low | `src/lib/ops/repeat.ts` `repeatOrder` | History/change-explanation comments: "Staff UI historically one-clicked; keep auto when all lines map cleanly OR forceAuto." and "When forceAuto (bulk / API convenience) or all mapped — create draft with keep recipients." narrate what the next block does. | clean-code (no change-explanation/narration comments) |
| R12 | Low | `src/components/admin/seasons-admin.tsx` | Season list maps with `(s) => …` and uses `s.id`/`s.slug`/`s.status`. Single-letter `s` is not a universal domain abbreviation. | clean-code (naming — no vague standalone names) |
| R13 | Low | `src/app/(storefront)/account/orders/[id]/page.tsx` | New "Repeat this order" link is a raw `<Link>` with inline `bg-[var(--color-leaf)] …` classes, while the P10 repeat-review screen uses the shared `<Button>` component. Inconsistent button styling for a sibling flow. | clean-code (UI consistency / one styling approach) |

## Summary

- Total findings: 13 (High 2, Medium 3, Low 8).
- Strongest: duplicate `smoke:p10` script key (R1) and byte-identical cron routes (R2) — both clear copy-paste/YAGNI violations with one-line fixes.
- Structural: `repeat.ts` god-file (R4) and dead `needsReview`/unreachable return (R3) are the clean-code core misses.
- Scope note: `season-gate` refactor (delegating to `setSeasonStatus`) and `catalog/route.ts` (dropping `isActive` filter) are clean improvements; no findings there.
