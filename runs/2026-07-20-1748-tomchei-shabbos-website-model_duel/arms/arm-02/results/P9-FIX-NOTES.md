# P9 Fix Pass — arm-02

**Input:** `results/AGGREGATE-REVIEW-P9.md` (6 blockers, 17 majors, 24 minors)
**Scope:** single fix pass; blockers B1–B6 all fixed, majors M1–M6 + M10 + M15 fixed.
**Verification:** `npm run ci` PASS (lint, typecheck, migration guard, 66/66 tests); re-smoke S1–S5 **47/47 PASS** (46 original checks + 1 new M4 idempotency check) — evidence `workspace/.scratch/PHASE-P9-SMOKE.md`, logs `.scratch/p9-fix-ci-output.log`, `.scratch/p9-fix-smoke-output.log`.

## Blockers — all fixed

| # | Fix | Where |
|---|---|---|
| B1 | Link id is minted up front (`randomUUID`), so `pinHash` is computed before the insert and the link row is born WITH its PIN hash inside the rotation transaction — no transient (or permanent) PIN-less window. `verifyPin` now returns `ok: false` (`noPin`) for a null `pinHash` instead of `ok: true`; the PIN endpoint maps it to 400 and never mints a cookie (also closes minor m10). | `lib/routes/links.ts`, `app/api/d/[token]/pin/route.ts` |
| B2 | `sendPickupReadyNotifications` now claims the package with a guarded `updateMany` (`pickupReadyAt: null`) and captures the notifications **in the same transaction** (`notifyCustomer(…, tx)`). A failed notification insert rolls the ready stamp back, so the next sweep retries instead of skipping the customer forever. The guarded claim also fixes the concurrent-sweep double-count (minor m8). | `lib/pickup.ts` |
| B3 | `confirmReroute` stop creation (position read + insert) now runs inside the switch transaction (see B5) — no two concurrent reroutes can read the same max position. | `lib/routes/service.ts` |
| B4 | `requireCronAuth` compares the bearer header with `timingSafeEqual` (length-checked), matching the PIN posture. | `lib/cron.ts` |
| B5 | `switchPackageMethod` now runs the label void (guarded PURCHASED→VOIDED flip + carrier `voidLabel` call, bounded by SHIPPO_TIMEOUT) **and** every switch write in ONE `db.$transaction` (same pattern as `buyLabelForPackage`). A carrier refusal or any later failure rolls everything back. New optional `extend(tx)` callback lets `confirmReroute` create its route stop inside the same transaction — void + method switch + stop creation commit or fail together. Residual (noted): if the carrier void succeeds and the commit itself then fails, the carrier holds a refund the DB doesn't know about — inherent to any external call, window is one commit. | `lib/routes/service.ts` |
| B6 | New `lib/api/admin-handler.ts` `adminHandler()` centralizes permission gate → open-season 409 → zod body parse 400 → `ActionError` mapping. 11 handlers refactored onto it: `routes` (create), `routes/[id]` (patch), `[id]/link`, `[id]/start`, `[id]/reroute`, `[id]/print`, `[id]/stops/[stopId]/delivered`, `packages/[id]/method`, `bulk-delivery`, `pickup/ready`, `pickup/door-list`. | `lib/api/admin-handler.ts`, `app/api/admin/**` |

## Majors fixed (8 of 17)

- **M1** `buildRoute` re-asserts inside the transaction that none of the candidate packages acquired a `routeStop` since the candidate query — concurrent builds now 409 instead of relying on the unique constraint.
- **M2** `confirmReroute` re-verifies (inside the transaction) that the package has no `routeStop` before creating the stop — 409 with a refresh hint.
- **M3** `markStopDelivered` flips via guarded `updateMany` (`deliveredAt: null`) — a concurrent double-tap loses and refuses; route completion is a guarded `updateMany` (`status != COMPLETED`) so the COMPLETED transition and audit can't double-fire.
- **M4** Bulk-delivery dedupe key is now the scheduling **intent** (`bulk|seasonId|date|window|customerId`) instead of the schedule row id — double-click/re-submit never double-notifies. New smoke check proves it.
- **M5** `captureDayOfNotifications` no longer filters to `PER_PACKAGE_DELIVERY` — every route stop is a delivery package by construction, so BULK_DELIVERY routes now capture the day-of heads-up too.
- **M6** Rerouted stop is inserted **after its geographically nearest stop** (later positions shift +1, never before an already-delivered stop) instead of blind append — nearest-neighbor order survives reroute; done inside the B3/B5 transaction.
- **M10** Warehouse origin owned by one exported constant `WAREHOUSE_ORIGIN` (`lib/addresses/geocode.ts`); `buildRoute` fallback and the 08701 centroid both reference it.
- **M15** `ROUTE_STATUS_TONE` extracted to `lib/routes/status.ts`; both route pages import it.

## Not fixed this pass (majors)

M7 (god-file split — deliberately skipped as risky for a single pass; correctness prioritized), M8, M9, M11, M12, M13, M14, M16, M17. Minors untouched except m8 and m10, which fell out of B2/B1.

## Re-smoke

S1–S5 per `shared/phases/PHASE-P9-EXPECTED.md`: **47/47 PASS** (`npx tsx .scratch/p9-smoke.ts`, dev server 3102, DB 4102). Smoke updated in two places: the bulk dedupe-key assertion now targets the intent-based key, and a new check re-submits the same bulk drop and asserts zero extra notifications.
