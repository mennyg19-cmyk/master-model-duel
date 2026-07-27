# P9 Quality Review — arm-04 (blind)

**Phase:** P9 — Delivery routes, driver magic links, reroute map, pickup, bulk, crons
**Reviewer:** Quality specialist
**Scope:** `arms/arm-04/workspace/` (P9 surface only)
**Reference:** `shared/phases/PHASE-P9-EXPECTED.md`
**Mode:** Findings only, no fixes. Blind to model identity.

## Summary

The P9 surface is largely correct against EXPECTED: charge is preserved on method switch, the reroute label void goes through the P8 hook, magic links are hashed + PIN-throttled + scoped to one route, crons reject missing/wrong bearer secrets, and the pickup counter gates the ready notice on packed + in-stock. The smoke run (`scripts/smoke-p9.ts`) exercises S1–S5 end to end, including the "press Start twice → 0 sent, 3 already had one" idempotency and the "sent package rejects reroute" guard. No `.scratch/PHASE-P9-STATUS.md` or `PHASE-P9-SMOKE.md` was present at review time, so smoke evidence is the script only, not a recorded run.

Findings are below, grouped by severity. Line refs are to the files in `arms/arm-04/workspace/`.

## Critical

None.

## High

None.

## Medium

1. **`stampPickedUp` skips stage discipline and eligibility.** `src/lib/pickup/pickup-service.ts:211` sets `stage: 'PICKED_UP'` from any stage and only checks `pickedUpAt`. The counter UI (`src/app/(admin)/admin/pickup/page.tsx:139`) renders the Collected button for every non-collected row with no `disabled` and the service applies no `blockers()`/`isPacked` check, so a `NEW` or short-of-stock box can be stamped collected, jumping `NEW → PICKED_UP` and bypassing PRINTED/PACKED. EXPECTED ties pickup eligibility to "inventory available"; the stamp path ignores it. The ready-notice path enforces `blockers()`, the stamp path does not.

2. **`rerouteOntoRoute` does not re-verify proximity server-side.** `src/lib/routing/reroute.ts:272` computes `nearbySuggestions` only to populate `milesFromStop` in the audit/response; it never asserts the box is within `NEARBY_MILES` of the route. The `confirmed` flag is required, but a stale or hand-crafted form posting `packageId + routeId + confirmed=on` reroutes *any* on-board shipping box onto *any* non-completed route of the season regardless of distance. EXPECTED's "nearby suggestion requires confirm" is satisfied on the suggestion screen but not enforced at the switch, so the proximity rule is advisory rather than a server invariant.

3. **`issueRouteLink` silently revokes prior live links without an audit row.** `src/lib/routing/route-links.ts:56` bulk-sets `revokedAt` on existing live links before creating the new one, but only writes a `route.link_issued` audit row. `revokeRouteLink` (line 101) writes `route.link_revoked` per link; the implicit revocation on reissue does not. The audit trail therefore loses the "this link was taken back" event when a manager reissues, which is the common way a wrong-phone link is retired.

## Low

4. **`expireUnclaimedPickups` is not season-scoped.** `src/lib/pickup/pickup-service.ts:276` sweeps every `PICKUP` box regardless of season. A prior season's un-stamped overdue box would be re-stamped on the next cron tick. Probably benign (the box is already past deadline) but diverges from the season-scoped pattern used by `pickupWhere`/`listPickupCounter` and means a cron run touches rows outside the active season.

5. **`startRoute` notifies already-delivered stops.** `src/lib/routing/route-service.ts:299` (`notifyDayOf`) iterates every package on the route without filtering by stop status, so a stop the office already marked delivered before Start gets a "your box is out today" message. The dedupe key prevents a duplicate per box, but the one message that does go out is wrong for a box already SENT. Filter to `PENDING` stops (or skip boxes whose stop is `DELIVERED`) before queueing.

6. **`markStopDelivered` permits taps on a `PLANNED` route.** `src/lib/routing/route-service.ts:351` only refuses when `route.status === 'COMPLETED'`. A driver can mark a stop delivered before the manager presses Start, which advances the box to `SENT` and skips the day-of notice for that family (the notice still queues on the next Start, but the box is already gone). Consider refusing while `PLANNED`, or auto-starting on the first tap.

7. **`appendStop` has a sequence race.** `src/lib/routing/route-service.ts:459` reads `_max.sequence` then writes `+1` outside any uniqueness-retry. Two concurrent `rerouteOntoRoute` calls onto the same route can compute the same sequence and one `create` throws on `@@unique([routeId, sequence])`. The transaction wraps the read+write but the default Postgres isolation (READ COMMITTED) does not block the second `_max` from seeing the same max. Low impact (rare, surfaces as a 500) but real.

8. **`nearbySuggestions` geocodes every candidate on every route-detail render.** `src/lib/routing/reroute.ts:196` calls `geocodeAddress` per candidate each time the detail page loads and again inside `rerouteOntoRoute`. The geocode cache absorbs repeats, but the first render of a large board is N provider calls, and the reroute path doubles them. Performance, not correctness.

9. **`completeRoute` shortens already-revoked links too.** `src/lib/routing/route-service.ts:441` updates every link on the route with `expiresAt > graceEnds`, with no `revokedAt: null` filter. Revoked links get their `expiresAt` rewritten, which is harmless but means the `expiresAt` column no longer distinguishes "naturally expiring" from "revoked then shortened on completion". Filter to `revokedAt: null` for clarity.

10. **`expireUnclaimedPickups` writes no per-box audit.** Only a `CronRunLog` row. `pickup.collected` is audited; the sweep that effectively ends a box's shelf life is not. EXPECTED does not require it, but the trail is asymmetric.

## Informational

11. **No `.scratch/PHASE-P9-STATUS.md` or `PHASE-P9-SMOKE.md` found** under `arms/arm-04/workspace/.scratch/` (the directory does not exist). EXPECTED names `.scratch/PHASE-P9-SMOKE.md` as the evidence path. The smoke script exists and is coherent, but a recorded run result was not present at review time.

12. **`pickupExpiredAt` vs `pickupExpiresAt` naming.** Two adjacent columns differing by one letter (`pickupExpiredAt` = cron stamp, `pickupExpiresAt` = deadline). Not a bug — the migration and schema agree — but a future reader will misread them. Worth a comment on `Package` if the schema is touched again.

13. **`driverDeliveredAction` passes `linkId` to `markStopDelivered` but the audit `source` is derived from `linkId !== null`.** Correct, but the audit row's `linkId` is the only identity for a no-account actor; the comment at `route-service.ts:344` documents this well. No action.

## Severity counts

- Critical: 0
- High: 0
- Medium: 3
- Low: 7
- Informational: 3
- **Total: 10 findings**
