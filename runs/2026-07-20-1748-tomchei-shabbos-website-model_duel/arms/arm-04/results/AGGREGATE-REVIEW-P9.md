# P9 Aggregate Review — arm-04 (blind)

**Phase:** P9 — Delivery routes, driver magic links, method switch/reroute, pickup, bulk scheduling, bearer crons
**Arm:** arm-04
**Inputs:** `P9-security-arm-04.md`, `P9-quality-arm-04.md`, `P9-rules-arm-04.md`, `P9-clean-code-arm-04.md`
**Method:** Union + dedupe by (location, claim). No new findings. Severities remapped per rubric: security Medium → major, quality Medium → major, rules Medium → major, clean-code Major → major, all Low/Info → minor. No security Critical/High present → no blockers.

## Counts after dedupe

| Bucket | Count |
|---|---|
| Blockers | 0 |
| Majors | 11 |
| Minors | 24 |

## Dedupe notes

- **R-M2 ≡ Q-L8** — `nearbySuggestions` re-geocodes every render (`reroute.ts:196-245`). Rules rated Medium, quality rated Low. Kept as one major (higher severity wins).
- **CC-M3 ≡ R-L2** — `orderLabel` formatting duplicated 4× with case drift. Clean-code rated Major, rules rated Low. Kept as one major.
- **Q-L4 ≡ CC-m4** — `expireUnclaimedPickups` not season-scoped / bypasses `pickupWhere` (`pickup-service.ts:276-280`). Both minor. Kept as one minor.
- **SEC-3 vs Q-L6** — same location (`route-service.ts:351-361`) but distinct claims (season scoping vs PLANNED-route tap). Both retained.
- **SEC-4 vs CC-M2** — overlapping cron logging locations but distinct claims (raw `error.message` persistence vs duplicated body + double-catch). Both retained.
- **R-I2** (codegraph adherence unverifiable from artifacts) and **Q-I13** (driverDeliveredAction audit source — reviewer marked "No action") are meta-observations, not code fix targets. Excluded from the fix list below.

## Prioritized fix list (builder may read)

### Blockers
None.

### Majors (11)

1. **PIN lockout resets on lock, enabling sustained brute force.** `src/lib/routing/route-links.ts:165-175`. Counter resets to 0 the moment the 5th wrong guess trips the lock; attacker gets 5 fresh guesses every 10 min for the 3-day link lifetime (~21% cumulative success per leaked-with-PIN link). Accumulate attempts across cycles or lengthen lockout exponentially. *(SEC-1)*
2. **Driver magic link exposes full stop PII with no second factor by default.** `src/app/(driver)/drive/[token]/page.tsx:115-172`, `src/app/(admin)/admin/routes/[routeId]/page.tsx:107-120`. `withPin` defaults unchecked on the issue form; a leaked URL = direct disclosure of every household's name, address, phone, plus stop-control. Default PIN-on, or redact phone/address until PIN answered. *(SEC-2)* — same root cause as #1; fix together.
3. **`stampPickedUp` skips stage discipline and eligibility.** `src/lib/pickup/pickup-service.ts:211`, `src/app/(admin)/admin/pickup/page.tsx:139`. Sets `stage: 'PICKED_UP'` from any stage with only `pickedUpAt` checked; a `NEW` or short-of-stock box can be stamped collected, jumping `NEW → PICKED_UP` and bypassing PRINTED/PACKED. Add `blockers()`/`isPacked` gate. *(Q-M1)*
4. **`rerouteOntoRoute` does not re-verify proximity server-side.** `src/lib/routing/reroute.ts:272`. `nearbySuggestions` only populates `milesFromStop` for the response; a crafted `packageId + routeId + confirmed=on` reroutes any on-board shipping box onto any non-completed route regardless of distance. Assert `<= NEARBY_MILES` in the service. *(Q-M2)*
5. **`issueRouteLink` silently revokes prior live links without an audit row.** `src/lib/routing/route-links.ts:56`. Bulk-sets `revokedAt` on existing live links before creating the new one but writes only `route.link_issued`; `revokeRouteLink` writes `route.link_revoked` per link. Emit the revoke audit on reissue. *(Q-M3)*
6. **`startRoute` is not transactional; audit row can be lost.** `src/lib/routing/route-service.ts:266-296`. Route-status update, `notifyDayOf`, and `recordAudit` are separate DB ops; a failure between update and audit leaves IN_PROGRESS with no `route.started` row. Pair the status update + audit in one transaction before the outbox drain. *(R-M1)*
7. **`nearbySuggestions` re-geocodes every shipping box on every route-detail render.** `src/lib/routing/reroute.ts:196-245` (called from `routes/[routeId]/page.tsx:57`). N geocode lookups per page load, doubled on reroute, re-run on every `revalidatePath` bounce. Cache the suggestion list per (route, short TTL) or compute on demand via a button. *(R-M2 / Q-L8)*
8. **`route-service.ts` is a mixed-concern god file.** `src/lib/routing/route-service.ts` (478 lines, 9 concerns: candidate listing, route building, stop ordering, driver assignment, route starting, stop delivery, completion + link grace, stop appending). Split: `orderStops` → `route-ordering.ts`; `notifyDayOf` → next to `bulk-delivery.ts`; `appendStop` → `reroute.ts` (single caller). *(CC-M1)*
9. **Cron job-body logging duplicated and overlaps `runCronJob` wrapper.** `src/lib/pickup/pickup-service.ts:276-313`, `src/lib/scheduling/payment-reminder.ts:23-90`, `src/lib/cron/authorize.ts:43-56`. ~25 lines of try/create-`cronRunLog`/update-on-success/update-on-failure/rethrow duplicated; the wrapper also catches and `console.error`s, so failures are caught and logged twice. Extract `runCronJobBody(jobName, fn)` owning the row + terminal status; wrapper keeps only auth + HTTP. *(CC-M2)*
10. **`orderLabel` formatting duplicated 4+ times with case drift.** `route-view.ts:121`, `reroute.ts:240`, `pickup-service.ts:87`, `follow-up.ts:85`, plus lowercase variant in `payment-reminder.ts:48`. Extract `formatOrderLabel(order)` helper in `lib/orders/` (or `lib/core/labels.ts`); collapse `Order #` vs `order #` casing to one decision. *(CC-M3 / R-L2)*
11. **Action-layer boilerplate duplicated and vaguely named.** `routes/actions.ts:265-276` (`doneAtRoute`, `backToRoute`, `backToHub`), `pickup/actions.ts:57-63` (`done`, `back`), `drive/[token]/actions.ts:64-66` (`backToDriver`). `workingSeasonId()` re-implemented in `routes/actions.ts:258-263` and `pickup/actions.ts:50-55`. "No season" JSX block duplicated verbatim in `routes/page.tsx:35-44`, `pickup/page.tsx:30-39`, `follow-up/page.tsx:30-39`. Add shared `<NoSeason slug="…" message="…" />` + `requireWorkingSeasonOrRedirect(path)`; rename vague helpers. *(CC-M4)*

### Minors (24)

- **SEC-3** — `markStopDelivered` not season-scoped (`route-service.ts:351-361`, `routes/actions.ts:138-156`). IDOR gap vs siblings; add `seasonId` to lookup.
- **SEC-4** — Cron bodies persist raw `error.message` into `CronRunLog.detail` (`pickup-service.ts:301-309`, `payment-reminder.ts:78-86`). Sanitize/truncate before persist.
- **SEC-5** — Cron endpoints accept GET for side-effecting jobs (`pickup-expiry/route.ts:12-14`, `payment-reminder/route.ts:14-16`). POST-only.
- **SEC-6** — `secretsMatch` early-returns on length mismatch (`authorize.ts:58-64`). Timing oracle on `CRON_SECRET` length; noted, low impact.
- **Q-L4 / CC-m4** — `expireUnclaimedPickups` not season-scoped, bypasses `pickupWhere` (`pickup-service.ts:276-280`). Add `pickupWhereGlobal()` variant or document cross-season scope.
- **Q-L5** — `startRoute` notifies already-delivered stops (`route-service.ts:299`). Filter `notifyDayOf` to `PENDING` stops.
- **Q-L6** — `markStopDelivered` permits taps on a `PLANNED` route (`route-service.ts:351`). Refuse while PLANNED or auto-start on first tap.
- **Q-L7** — `appendStop` sequence race (`route-service.ts:459`). Read-then-write outside uniqueness retry; wrap with retry-on-`@@unique`.
- **Q-L9** — `completeRoute` shortens already-revoked links (`route-service.ts:441`). Filter to `revokedAt: null`.
- **Q-L10** — `expireUnclaimedPickups` writes no per-box audit (`pickup-service.ts`). Asymmetric vs `pickup.collected`; add per-box audit.
- **Q-I11** — No `.scratch/PHASE-P9-STATUS.md` or `PHASE-P9-SMOKE.md` at review time. Record the smoke run.
- **Q-I12** — `pickupExpiredAt` vs `pickupExpiresAt` naming (`Package` schema). Add a clarifying comment if schema is touched.
- **R-L1** — `endDriverSession` exported with zero callers (`driver-session.ts:36-39`). Dead code; delete.
- **R-L3** — Over-exported single-call-site constants `PICKUP_HOLD_DAYS` (`pickup-service.ts:35`), `NEARBY_MILES` (`reroute.ts:39`). Drop `export` or add the test that justifies it.
- **R-L4** — Over-exported single-use helpers `addressKeyOf` (`geocode.ts:39`), `formatDestination` (`maps.ts:21`). Drop `export`.
- **R-L5** — Missing `ponytail:` tag on deliberate shortcut (`route-service.ts:154-162`). Use the agreed tag format.
- **R-I1** — `readFollowUpFilters` casts before validating (`follow-up.ts:42`). Use a `string`-typed intermediate before the `includes` guard.
- **CC-m1** — `itemCount` reduce duplicated (`route-view.ts:118`, `pickup-service.ts:88`). Extract `sumLineQuantities(lines)`.
- **CC-m2** — Address-line string built three ways (`route-service.ts:65-67`, `reroute.ts:236`, `route-view.ts:111-115`). Extract `formatAddressLine(address, { withState }?)`.
- **CC-m3** — `<select>` raw HTML while `<Input>`/`<Label>` are components (`routes/page.tsx:112-124,191-203`, `routes/[routeId]/page.tsx:157-169`, `follow-up/page.tsx:56-69`). Add `<Select>` or a shared `selectClass`.
- **CC-m5** — `readRoute` called with two scoping contracts (`route-view.ts:67`): `{ id, seasonId }` from admin vs bare `{ id }` from driver/print. Split into `readRouteForAdmin` / `readRouteForLink` or push season scope into callers.
- **CC-m6** — `PickupRow.packed` and `PickupRow.inStock` are dead view-model fields (`pickup-service.ts:42-58`). Render or drop.
- **CC-m7** — `geocodeAddress` swallows Mapbox errors silently (`geocode.ts:125-130`). `console.warn` or return a distinguishable `source: 'mapbox-error'`.
- **CC-m8** — `reroute.ts` mixes three concerns (`reroute.ts`, 339 lines): method switch, nearby-box suggestion, reroute orchestration. Split: `nearbySuggestions` → next to `route-view.ts`; `switchFulfillmentMethod` → next to P8 label service.

## Top fix targets

1. **PIN + magic-link PII (majors #1 + #2)** — same root cause; the link is the only credential for a PII surface and its sole second factor is optional-by-default and brute-forceable. Fix the lockout accumulation and default PIN-on together.
2. **`stampPickedUp` eligibility gate (major #3)** — only the stamp path skips `blockers()`; one-line gate restores parity with the ready-notice path.
3. **`rerouteOntoRoute` server-side proximity (major #4)** — move the `NEARBY_MILES` check from advisory suggestion to service invariant.
4. **`startRoute` transaction (major #6)** — pair status update + audit in one transaction; preserves the audit invariant every other state change already holds.
5. **`route-service.ts` split (major #8)** — the file's own header narrates four UR/R/G tags; split by verb the way `shipping/` already does.
6. **Cron logging consolidation (major #9)** — one `runCronJobBody` removes the duplication and the double-catch.
7. **`orderLabel` helper (major #10)** — Rule of 2 satisfied 4× over; one helper collapses five call sites and the casing drift.
8. **Action boilerplate + vague names (major #11)** — `<NoSeason>` + `requireWorkingSeasonOrRedirect` removes three copies of the no-season block and two copies of `workingSeasonId`.
