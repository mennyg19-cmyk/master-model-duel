# P10 Rules Review — arm-02

Reviewer specialist: Rules. Blind to model name.
Scope: P10 changes under `arms/arm-02/workspace/` (seasons, repeat orders, replacement mappings).
Rules graded: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`, `grill-protocol` (per `arms/arm-02/ARM.md`). Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 3 |
| Low | 5 |
| **Total** | **8** |

Strengths: domain logic is split into `lib/repeat.ts` (engine) plus thin routes, with `resolveReplacementChain` / `wouldCreateReplacementCycle` / `closestPricedProduct` pure and unit-tested. Naming is descriptive and boolean-friendly (`isActive`, `keepRecipient`, `recipientValid`). Comments explain non-obvious intent (chain hops, G-012 auto-save, one-shot schedules) — no narration. Zod validates every new route; the customer repeat re-validates server-side and 404s identically on foreign ids (R-121). `getOpenSeason` reads `status` only — no eager write on storefront reads (the cron owns flips). DECISION-LOG carries seven P10 entries; `.scratch/phase-plan.md` has pre-written EXPECTED blocks and `.scratch/PHASE-P10-SMOKE.md` shows all S1–S3 passing in the running app. No dead wrappers (every export in `lib/repeat.ts` has a call site).

## Medium findings

### M1 — Incumbent open season closed without an audit row (clean-code: consistency; workflow: audit trail)
`app/api/admin/season-status/route.ts:26-29` and `app/api/cron/season-flip/route.ts:45-48` — when a season is OPENED, any other OPEN season is closed via `updateMany` with no audit row. The manual close path (`season-status` when status is `CLOSED`) and the cron close-pass (`season-flip` lines 24-35) both write `season.status` / `season.autoflip.close` audit rows; the implicit close-when-opening does not. The trail therefore loses "season X was closed because Y opened" — only Y's open is recorded. Same gap in both the manual switch and the cron open path.

### M2 — Bulk repeat re-fetches the full catalog for every customer (ponytail: efficiency; clean-code: duplicated work)
`lib/repeat.ts:152-154` — `buildRepeatPlan` runs `db.product.findMany` across **all** products in **all** seasons for each order. `app/api/admin/repeat/bulk/route.ts:61` calls `repeatOrderIntoPosDraft` → `buildRepeatPlan` once per customer (up to `BULK_LIMIT = 200`). The open season and product set are fixed for the whole batch, so a 200-customer run does 200 full-catalog scans. Hoist one fetch and pass the `productById` map / `candidates` list into the per-order builder.

### M3 — Two HTTP helpers in the same feature (clean-code: one pattern per concern; workflow: reuse existing helpers)
`components/admin/catalog-manager.tsx:32-39` defines a local `requestJson`, and the P10 replacement picker (lines 166-198) uses it. The new P10 client components (`repeat-review.tsx`, `bulk-repeat.tsx`, `repeat-order-button.tsx`, `season-management.tsx`) all use the shared `apiFetch` from `lib/api-client.ts`, whose header states it is "the ONE place that convention is read." The P10 diff extended the local helper instead of consolidating to the shared one — two fetch+error-extraction paths now coexist in the admin surface.

## Low findings

### L1 — Bulk repeat `skipped` array collected, never surfaced or persisted (clean-code: dead data)
`app/api/admin/repeat/bulk/route.ts:83` returns `skipped` (per-customer `{ customerId, reason }[]`) to the client, but `BulkSummary` in `components/admin/bulk-repeat.tsx:9-15` omits the field and the audit `detail` (line 81) stores only the count summary. Staff see "N skipped" with no way to learn which customers or why without re-running.

### L2 — Response body types drift from the route contracts (clean-code: type/schema drift)
`components/account/repeat-review.tsx:58` types the response as `{ ok: boolean; added: number }`, omitting `unassigned` and shadowing `apiFetch`'s own `ok` flag (a reader may mistake `result.ok` for the body's `ok`). `components/admin/repeat-order-button.tsx:18` and `components/admin/bulk-repeat.tsx:30` similarly inline partial body types. Centralize these response shapes next to `RepeatPlan` in `lib/repeat.ts`.

### L3 — Duplicate `SeasonRow` type (clean-code: centralize types)
`components/admin/catalog-manager.tsx:10` declares a local `type SeasonRow = { id; name; status }` while `components/admin/settings/types.ts:3-10` already exports a richer `SeasonRow` (with `opensAt`/`closesAt`). Two shapes for the same domain row in the same feature.

### L4 — `datetime-local` initial value risks a hydration flash (workflow: verify-in-app)
`components/admin/settings/season-management.tsx:15-20` — `toLocalInput` derives the initial input value from `new Date(iso).getHours()` during render. SSR uses the server's timezone; hydration uses the browser's. If they differ, the displayed schedule time flashes wrong on first paint (the input still saves correctly because `new Date(localValue).toISOString()` round-trips in browser-local time). DECISION-P10-5 flags the org-timezone question as open; this is the concrete SSR/hydrate fallout.

### L5 — `appendToDraft` does a second draft lookup in the bulk path (ponytail: efficiency)
`app/api/admin/repeat/bulk/route.ts:54` pre-checks `findActiveDraft` to skip customers who already have a POS draft, then `repeatOrderIntoPosDraft` → `appendToDraft` (`lib/repeat.ts:311`) calls `findActiveDraft` again per customer. Two lookups per customer in a 200-customer batch; the second is redundant for the customers that just passed the first check.
