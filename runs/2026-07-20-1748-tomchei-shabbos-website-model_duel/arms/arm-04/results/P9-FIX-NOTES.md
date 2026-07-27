# P9 fix notes — arm-04

**Input:** `results/AGGREGATE-REVIEW-P9.md` (0 blockers, 11 majors, 24 minors)
**Outcome:** 11 of 11 majors fixed, 22 of 24 minors fixed, 2 deferred.
**Scope:** one pass. No migration, no new environment variables, no P10 work.

## Fixed — majors (11 of 11)

| # | ID | What changed |
|---|---|---|
| 1 | SEC-1 | `route-links.ts`: failed PIN attempts accumulate for the life of the link instead of resetting on lock, and the lockout doubles per lock — 10 min, 20, 40, to a 12-hour ceiling. A correct PIN clears the counter. The "n more tries" message counts down within the current cycle. |
| 2 | SEC-2 | The issue form asks to go **without** a PIN (`routes/[routeId]/page.tsx`, `routes/actions.ts`), so `withPin` is true unless the office opts out. A leaked URL is no longer a one-factor read of every household on the route. |
| 3 | Q-M1 | `stampPickedUp` runs the same `blockers()` gate the ready notice uses: a box that is not packed, or short of stock, is refused instead of jumping `NEW → PICKED_UP`. |
| 4 | Q-M2 | `rerouteOntoRoute` re-derives the box's distance from `nearbySuggestions` server-side and returns `NOT_NEARBY` when the van is not passing. The suggestion list is advisory; the invariant is the service's. New test covers both branches. |
| 5 | Q-M3 | `issueRouteLink` revokes prior live links inside a transaction and writes `route.link_revoked` for each one, matching what `revokeRouteLink` writes. |
| 6 | R-M1 | `startRoute` pairs the status update and `route.started` in one transaction; the day-of notices are queued first (they are idempotent, keyed on the box) so no HTTP-shaped work sits inside the transaction. |
| 7 | R-M2 / Q-L8 | `nearbySuggestions` moved to `routing/nearby-suggestions.ts` with a per-route 60-second memo. `forgetNearbySuggestions(routeId)` is called by anything that moves a box on or off a van, so the staleness window only holds boxes sold in the last minute. |
| 8 | CC-M1 | `route-service.ts` split: `orderStops` → `routing/route-ordering.ts`, `notifyDayOf` → `scheduling/day-of-notice.ts`, `appendStop` → `routing/reroute.ts` (its only caller). |
| 9 | CC-M2 | `cron/job-run.ts` owns the `CronRunLog` row and its terminal status; `runCronJob` keeps auth and HTTP only. The double-catch is gone, so a failed job is logged once. |
| 10 | CC-M3 / R-L2 | `orders/order-labels.ts` exports `formatOrderLabel`; the five call sites (`route-view`, `nearby-suggestions`, `pickup-service`, `follow-up`, `payment-reminder`) share one casing decision. |
| 11 | CC-M4 | `components/admin/no-season.tsx` and `lib/admin/working-season.ts` replace three copies of the no-season block and two copies of `workingSeasonId`. Renames: `doneAtRoute`/`backToRoute`/`backToHub` → `noticeAtRoute`/`problemAtRoute`/`problemAtRoutesHub`; `backToDriver` → `problemOnDriverPage`; `done`/`back` → `noticeAtCounter`/`problemAtCounter`. |

## Fixed — minors (22 of 24)

| ID | What changed |
|---|---|
| SEC-3 | `markStopDelivered` takes `seasonId` and scopes its route lookup by it; the driver-link path passes `null` because the link is already the scope. |
| SEC-4 | `runCronJobBody` truncates the failure message before it reaches `CronRunLog.detail`. |
| SEC-5 | Both cron routes are POST-only; the `GET` re-exports are gone. |
| SEC-6 | `secretsMatch` compares SHA-256 digests, which are the same length whatever the secrets are, so the length oracle is gone. |
| Q-L4 / CC-m4 | `pickupWhereAllSeasons()` is the cross-season variant the sweep uses, named so the scope is a decision rather than an omission. |
| Q-L5 | `startRoute` notifies `PENDING` stops only — a restarted van does not re-tell a household whose box already went. |
| Q-L6 | A tap on a `PLANNED` route starts it rather than being silently accepted against a route that never pulled out. |
| Q-L7 | `appendStop` takes `SELECT … FOR UPDATE` on the route before reading the last sequence, the pattern `payment-status.ts` and `offline-payments.ts` already use. Two managers rerouting onto one van now queue instead of colliding on `@@unique([routeId, sequence])`. |
| Q-L9 | `completeRoute` shortens live links only (`revokedAt: null`). |
| Q-L10 | The sweep writes `pickup.expired` per box, matching `pickup.collected`. |
| Q-I11 | `.scratch/PHASE-P9-SMOKE.md` and `.scratch/PHASE-P9-STATUS.md` are both written and current. |
| Q-I12 | Already satisfied: the `Package` schema comment distinguishes `pickupExpiresAt` (the deadline) from `pickupExpiredAt` (the cron's stamp). Left as it stood. |
| R-L1 | `endDriverSession` deleted — zero callers. |
| R-L3 | `PICKUP_HOLD_DAYS` un-exported; `NEARBY_MILES` is module-private in `nearby-suggestions.ts`. |
| R-L4 | `addressKeyOf` and `formatDestination` un-exported. |
| R-L5 | The nearest-neighbour shortcut in `route-ordering.ts` carries the `ponytail:` tag. |
| R-I1 | `readFollowUpFilters` validates a `string` through an `isFollowUpReason` type guard instead of casting first. |
| CC-m1 | `orders/lines.ts` exports `sumLineQuantities`; two reduces replaced. |
| CC-m2 | `addresses/address-summary.ts` exports `addressSummary`; three hand-built address lines replaced. |
| CC-m3 | `<Select>` added to `components/ui/field.tsx`; the four raw `<select>` elements use it. |
| CC-m5 | `readRoute` split into `readRouteForAdmin(routeId, seasonId)` and `readRouteForLink(routeId)`, so the two scoping contracts are two functions. |
| CC-m6 | `PickupRow.packed` and `PickupRow.inStock` dropped — nothing rendered them; `blockedBy` already says what is in the way. |
| CC-m7 | `geocodeAddress` distinguishes `source: 'mapbox-error'` from a genuine miss, warns on the failure, and does **not** cache it — a provider outage no longer pins a real address as unplaceable for the season. |
| CC-m8 | `reroute.ts` (339 lines) split three ways: `fulfillment/method-switch.ts`, `routing/nearby-suggestions.ts`, and the reroute orchestration that remains. |

## Deferred (2)

| ID | Why |
|---|---|
| R-I2 | "Codegraph adherence unverifiable from artifacts" — a meta-observation about the review inputs, not a code change. The aggregate itself excludes it from the fix list. |
| Q-I13 | `driverDeliveredAction` audit source — the reviewer marked it "No action", and the behaviour is already what S1e asserts (`source: driver_link` from the phone, `office` from the sheet). |

Both deferrals are the two items the aggregate itself named as meta-observations rather than fix
targets. Every entry in the majors and minors lists is addressed.

## Not touched on purpose

`print-batch-service.ts` still creates its own `CronRunLog` row rather than going through
`runCronJobBody`. It is P7 code and outside the three locations CC-M2 named; folding it in is a P12
consistency pass, not a P9 fix.

## Verification

| Gate | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` | **193/193 pass**, 0 fail (11 in `tests/routes.test.ts`) |
| `npm run ci` | exits 0 (lint, typecheck, migration guard, full suite) |
| `npm run smoke:p9` | **24/24 PASS** — `.scratch/PHASE-P9-SMOKE.md` |

Run against a database reset with `npm run db:fresh && npm run seed`, web on 3104, db on 4104.

Smoke evidence for the fixes specifically:

- **S1b** — the link is issued with nothing ticked and still comes back with a 4-digit PIN, which is
  major #2: PIN-on is the default the office has to opt out of.
- **S1d** — the wrong-PIN message reads "4 more tries before the link locks", counting down inside the
  current cycle of an accumulating counter (major #1).
- **S3a**, **S3b** — the reroute still needs the tick, and the confirmed one reports "0 miles from the
  nearest stop", which is the server's own measurement rather than the form's (major #4).
- **S5c**, **S5d** — the collected stamp and the expiry sweep both still work behind the new
  eligibility gate and the new cron body (majors #3 and #9); both crons answer 401 without the secret
  and 200 with it, over POST only (SEC-5).
- **P9-2** — the reroute unit test now asserts `NOT_NEARBY` for a box thirty miles from the van as well
  as the happy path.
