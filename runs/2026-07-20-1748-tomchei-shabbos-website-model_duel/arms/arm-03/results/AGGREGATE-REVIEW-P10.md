# P10 Aggregate Review — arm-03

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Tree:** `arms/arm-03/workspace/`
**Inputs:** `results/reviews/P10-{security,quality,rules,clean-code}-arm-03.md`
**Method:** Union + dedupe by location+claim. Security Critical/High and trust-boundary/IDOR/money-integrity majors become Blockers; otherwise keep as Major. No new findings.

## Classification

- **Blocker** = Critical severity, or trust-boundary/IDOR/money-integrity majors. Must fix before gate.
- **Major** = Medium severity (missing scoping, side effects, dead code, non-atomicity, type drift, pattern drift, missing UI, god file, duplicated logic, audit integrity, correctness). Fix in fix pass.
- **Minor** = Low / Informational (hardening, magic values, dead branches, naming, UX gaps, DoS-surface).

## Counts

| Blocker | Major | Minor | Total |
|---|---|---|---|
| 0 | 15 | 17 | 32 |

Smoke: 3/3 PASS (`arms/arm-03/results/PHASE-P10-SMOKE.md`). All four EXPECTED items are implemented and exercised. No Critical/High security findings; no trust-boundary/IDOR/money-integrity majors → no Blockers. The staff single-order repeat flow (Q H1) is a broken-flow Major, not a Blocker: it fails open (no draft created, no review surfaced) rather than crossing a trust boundary.

## Majors (15)

| # | Title | Location | Sources |
|---|---|---|---|
| M1 | Duplicated cron route — `app/api/cron/season-flip/route.ts` and `season-auto-flip/route.ts` are byte-identical (same `requireCronBearer` + `applyScheduledSeasonFlips` POST); only `season-auto-flip` is referenced (smoke-p10.mjs); no `vercel.json` wires either. A deployed, bearer-gated, state-mutating duplicate with zero callers | `src/app/api/cron/season-flip/route.ts`; `src/app/api/cron/season-auto-flip/route.ts` | cc H1, rules H1, sec I1 |
| M2 | `forceAuto` is a dead parameter + `repeatOrder` has dead `needsReview` variable, unreachable final return, and a redundant `input.forceAuto || allMapped` condition — `allMapped` is guaranteed true after the `if (!allMapped) return` guard, so `forceAuto` never changes which branch runs; the trailing `return ok({ needsReview: true, preview })` at line 440 is unreachable. Dead control-flow cluster in the core repeat path | `src/lib/ops/repeat.ts:392-444` | cc H3+M4+M5+M6, rules H3+M1+M2+M3 |
| M3 | Staff single-order repeat swallows `needsReview` — `order-detail.tsx:repeat()` POSTs with no body (defaults `mode:"auto"`, `forceAuto:true`); when any line needs a pick, `repeatOrder` returns `{ needsReview: true, preview }`, but the client renders `res.ok ? "Repeated → draft ${json.draftRef}"` → "Repeated → draft undefined" and never routes to a review page. No staff repeat-review page exists; the admin route's `mode:"preview"`/`mode:"confirm"` are unused. EXPECTED UR-007/G-011/G-012 (confirm replacements AND recipients) bypassed on the staff single-order path | `src/components/admin/order-detail.tsx:101-106`; `src/app/api/admin/orders/[id]/repeat/route.ts:62-67` | quality H1 |
| M4 | No `vercel.json` cron registration — `applyScheduledSeasonFlips` only runs when the cron endpoint is manually invoked; UR-008 "scheduled auto-flip at configured time" never fires in production. Smoke S2 passes only because it calls the cron endpoint directly (`cronStatus:200`) | `src/app/api/cron/season-auto-flip/route.ts`; workspace root (no `vercel.json`) | quality M1, sec L2 |
| M5 | `scheduleSeasonFlip` accepts past `scheduledOpenAt`/`scheduledCloseAt` — schema validates only ISO datetime, not future; a past schedule immediately applies on the next cron tick and is audited as `kind:"season_auto_flip"` (`actorId:null`) rather than a manual `season_gate` (`actorId:staffId`), blurring deliberate vs scheduled transitions. `settings.write`-gated; audit-integrity | `src/lib/seasons/manage.ts:176-210`; `src/app/api/admin/seasons/route.ts:48-52` | quality M2, sec M2 |
| M6 | Bulk repeat bypasses per-line replacement/recipient confirmation — `bulkRepeatOrders` auto-accepts `defaultProductId` + `keepRecipient:true` for every line and creates a draft per order with no human confirmation; EXPECTED UR-007/G-011/G-012 require confirming replacements AND recipients. Staff-initiated (`admin.access`); integrity/process gap | `src/lib/ops/repeat.ts:494-517` | quality M3, sec M1 |
| M7 | `createDraftFromChoices` zeroes option adjustments — repeated lines are written with `unitPriceCents: product.basePriceCents` and `optionAdjustCents: 0` even when a `productOptionId` is carried over; the source option adjustment is dropped and the target option's `priceAdjustmentCents` is never applied. Draft undercharges for any option with a positive adjustment. Smoke S3 never checks line price | `src/lib/ops/repeat.ts:245-265` | quality M4 |
| M8 | `resolveTargetSeason` silently targets a CLOSED season when none is OPEN — fallback is `findFirstOrThrow({ orderBy:{year:"desc"} })` with no status filter; a CLOSED season becomes the repeat target with no signal to caller or user. The customer review page shows `targetSeasonName` but not status, so a user can confirm a repeat into a non-orderable season | `src/lib/ops/repeat.ts:66-76` | cc M12, quality M5 |
| M9 | `previewRepeatOrder` is a ~90-line god function mixing source fetch+validate, target resolution, per-line chain resolution+blocker accumulation, recipient-summary shaping, and payload assembly. 3+ concerns in one body | `src/lib/ops/repeat.ts:79-168` | cc M7 |
| M10 | `createDraftFromChoices` is a ~100-line function with two passes over `previewLines` (validate kept, then create) and 3+ nesting levels; the validation pass and creation pass should be named helpers | `src/lib/ops/repeat.ts:170-269` | cc M8 |
| M11 | `resolveReplacementChain` is a ~115-line god function mixing same-season fast path, BFS loop with per-hop `findMany`, SKU-fallback strategy, candidate sort, and return shaping. The SKU fallback is a distinct strategy inlined into the walker | `src/lib/catalog/replacements.ts:32-148` | cc M9 |
| M12 | Inconsistent transaction/audit pattern — `scheduleSeasonFlip` does `db.season.update` + `writeAudit` without a transaction, while siblings `setSeasonStatus` and `createSeason` both wrap state change + audit in `db.$transaction`. Two patterns for the same concern in one file | `src/lib/seasons/manage.ts:176` | cc M10, rules M4 |
| M13 | Two error-return strategies in the repeat module — `previewRepeatOrder`/`confirmRepeatOrder`/`repeatOrder`/`bulkRepeatOrders` return `Result` and wrap throws in `err(maskError(error),"…")`; `resolveReplacementChain` throws `findUniqueOrThrow` directly with no `Result`. Two contracts in one call chain | `src/lib/catalog/replacements.ts`; `src/lib/ops/repeat.ts` | cc M11 |
| M14 | Inconsistent bulk-cap pattern — `bulkUpdateOrderStatus` uses inline `if (input.items.length > 100)` while `bulkRepeatOrders` names `MAX_BULK_REPEAT = 25` and returns a typed `bound` error. Two patterns for the same concern in the same module | `src/lib/ops/repeat.ts:598` vs `:446` | cc M14, rules M6 |
| M15 | Customer-initiated repeat drafts are not attributable to the acting customer — `confirmRepeatOrder` writes `ORDER_REPEATED` with `actorId: input.actorStaffId ?? null`; on the customer path `actorCustomerId` is passed in but only stored in `meta.mode="customer_confirm"`, never in the audit `actorId` column. A customer-driven repeat is not attributable in the actor column | `src/lib/ops/repeat.ts:363-378` | sec M3+I2 |

## Minors (17)

| # | Title | Location | Sources |
|---|---|---|---|
| m1 | `pickPriceSmart` is a dead exported function — zero call sites; price-smart selection is inlined in `resolveReplacementChain` (`candidates[0]?.productId`). Rule-of-2 fail | `src/lib/catalog/replacements.ts:150` | cc H2, rules H2 |
| m2 | Dead branch in `confirmRepeatOrder` — `if (choice.action==="map" && choice.keepRecipient===false) { /* comment */ }` body is a comment only | `src/lib/ops/repeat.ts:323-325` | cc M13 |
| m3 | Magic literal `8` for chain hop cap — unnamed; `MAX_BULK_REPEAT` shows the arm names caps elsewhere | `src/lib/catalog/replacements.ts:99` | cc M15, rules M5 |
| m4 | `void AuthError;` dead import-suppression — `AuthError` imported, never used, `void` statement only suppresses the unused-import warning | `src/app/(storefront)/account/orders/[id]/page.tsx:3,32` | cc L16, rules L1 |
| m5 | Redundant `"" as string` cast — the literal is already a string | `src/components/admin/catalog-admin.tsx:33` | cc L17, rules L2 |
| m6 | Missing error fallback in `setStatus` — `setMessage(res.ok ? ... : json.error)` renders `undefined` (empty `<p>`) when no `error` field; siblings use `json.error || "fallback"` | `src/components/admin/seasons-admin.tsx:67` | cc L18, rules L3 |
| m7 | Redundant `||` in confirm line pick — `picks[line.sourceLineId] || line.defaultProductId || null`; `picks` is pre-seeded from `defaultProductId`, so the two sides are the same value | `src/components/account/repeat-review.tsx:93` | cc L19, rules L4 |
| m8 | `replacementToProductIds` is a comma-separated string parsed client-side — the API expects an array; the editor is a free-text comma field with no validation, no candidate picker, no id-format check. Pattern drift from the rest of the admin | `src/components/admin/catalog-admin.tsx:83-86` | cc L20 |
| m9 | `scheduleOpen` fires on `onChange` with no submit/debounce — PATCHes the server on every datetime-local change; the wizard form above uses a submit button. Two interaction patterns in one card | `src/components/admin/seasons-admin.tsx:187` | cc L21 |
| m10 | Bulk repeat button has no confirmation dialog — a misclick creates up to 25 drafts unconditionally | `src/components/admin/orders-list.tsx:138-140` | quality L1 |
| m11 | Customer repeat preview is N+1 per line, serial — `previewRepeatOrder` awaits `resolveReplacementChain` per line in a `for…of`; each chain does up to 8 hops, each a `findMany` with `include`. DoS-surface on a GET reachable by any signed-in customer | `src/lib/ops/repeat.ts:106-136`; `src/lib/catalog/replacements.ts:70-103` | quality L2, sec L4 |
| m12 | `repeat-review.tsx` iterates `preview.lines` twice (replacements card, then recipients card) rebuilding per-line state | `src/components/account/repeat-review.tsx:138-221` | quality L3 |
| m13 | Vague bulk-result message + vague `result` name — `orders-list.tsx` uses `(json.created?.length ?? json.updated?.length) ?? 0`; `bulkUpdateOrderStatus` uses standalone `result` for the tx outcome. Both on the banned-vague-names list | `src/components/admin/orders-list.tsx:85-87`; `src/lib/ops/repeat.ts:608` | quality L4, rules M8 |
| m14 | `seasons-admin.tsx` schedule has no per-row "saved" state — global `setMessage("Schedule saved")` is not tied to a row; the datetime-local input stays populated after save | `src/components/admin/seasons-admin.tsx:71-84` | quality L5 |
| m15 | No rate limiting on customer repeat endpoints — signed-in customer can spam POST (unbounded drafts via `randomBytes`) and spam GET (N chain-walk previews). No per-customer draft cap | `src/app/api/account/orders/[id]/repeat/route.ts` | sec L1 |
| m16 | Staff override allows mapping to any active product in the target season — `confirmRepeatOrder` falls back to `findFirst({ id, seasonId, isActive })` when `toProductId` is not a candidate; broader than "pick a replacement." `admin.access`-gated, documented intent | `src/lib/ops/repeat.ts:306-321` | sec L3 |
| m17 | Vague name `data` in catalog POST — the product payload built for the Prisma write; `data` is on the banned standalone-names list | `src/app/api/admin/catalog/route.ts:68` | rules M7 |

## Notes

- No Blockers: P10 introduces no Critical security findings and no trust-boundary/IDOR/money-integrity majors. The closest candidate (M7, option-adjustment zeroing) is a money-adjacent correctness gap but it undercharges a draft line, not a finalized/paid order, and totals recompute downstream — Major, not Blocker.
- The staff single-order repeat flow (M3) is the highest-priority Major: it is a broken user-facing flow that fails open with a misleading success message. The server supports the review modes; the UI never calls them.
- M4 (no cron registration) means the scheduled auto-flip — an EXPECTED UR-008 deliverable — does not actually fire in production. The smoke masks this by invoking the cron endpoint directly.
- Dead-code cluster (M1, M2, m1, m2, m4, m5) is concentrated in `lib/ops/repeat.ts` and the duplicated cron route; a single tidy pass removes most of it.
