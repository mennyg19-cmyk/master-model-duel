# P9 Aggregate Review — arm-05 (blind)

Phase P9. Counts: blocker 3, major 20, minor 20, nit 3, total 46.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 3 |
| Major | 20 |
| Minor | 20 |
| Nit | 3 |
| Total | 46 |

Raw input totals: security 14, quality 16, rules 11, clean-code 16 = 57 findings -> 46 after dedupe (11 duplicates merged across 7 clusters).

Source tags: [S] security, [Q] quality, [R] rules, [C] clean-code.

Severity mapping: Critical/High-security -> blocker; High/Medium -> major; Low -> minor; Info/Nit -> nit.

---

## Prioritized fix list (single pass)

### Blocker - pickup stamp IDOR and cron auth

1. **Cron bearer auth uses non-constant-time string comparison** [S] - `lib/cron-auth.ts:5`
   - `authorizeCron` compares `request.headers.get("authorization")` to `Bearer ${secret}` with `!==`, leaking timing that can recover `CRON_SECRET` byte-by-byte. `lib/delivery.ts` already imports `timingSafeEqual` for PIN checks; the cron path does not. Both pickup-expiry and payment-reminders crons depend on this gate (`app/api/cron/pickup-expiry/route.ts:6`, `app/api/cron/payment-reminders/route.ts:6`). Smoke S5 only asserts missingBearer 401 and valid-bearer 200, never timing. Use `timingSafeEqual` on the bearer token.

2. **Pickup stamp IDOR: no PICKUP fulfillment-method check** [S] - `lib/delivery.ts:424` `stampPickedUp`
   - Any package with `pickupReadyAt` set can be stamped `PICKED_UP` regardless of fulfillment method; the function never verifies `fulfillmentMethod.code === "PICKUP"`. `markPickupReady` (line 401) calls `pickupEligibility` (line 393) which asserts the code; `stampPickedUp` does not. Schema allows `pickupReadyAt` on any package, so a DELIVERY/SHIP package with a stray `pickupReadyAt` can be marked picked up. Exposed via `POST /api/admin/delivery` action `stamp_pickup` (`app/api/admin/delivery/route.ts:55`), reachable by any STAFF with `orders.write`. Add the fulfillment-method guard to `stampPickedUp`.

3. **Pickup stamp IDOR: no pickup-location or door-list scoping** [S] - `lib/delivery.ts:416` `pickupDoorList`, `lib/delivery.ts:424` `stampPickedUp`, `app/api/admin/delivery/route.ts:30-32,55`
   - `stampPickedUp` accepts any `packageId` from the request body with no ownership/location scoping; `pickupDoorList` returns every ready package across all pickup locations (filters only `pickupReadyAt: { not: null }, pickupExpiresAt: { gt: now }, status: { not: "PICKED_UP" }`, no `pickupLocationId` filter). A staff member at location A can mark a package routed to location B as picked up. Recipient names and customer records are returned to any `orders.read` caller via the door-list GET. Scope both functions by `pickupLocationId`.

### Major - security & authz

4. **PIN transmitted in URL query string on GET** [S] - `app/api/driver/[token]/route.ts:15`
   - The optional route PIN is read from `searchParams.get("pin")` and echoed through the driver page (`app/driver/[token]/page.tsx:19`), placing the PIN in server access logs, browser history, and Referer headers. POST sends the PIN in the body, so the read path is inconsistent and leaks the secret. Move the PIN to a POST body or header on the read path.

5. **No audit trail for failed PIN attempts or throttle events** [S] - `lib/delivery.ts:118` `loadDriverLink`
   - Failed PIN attempts increment `failedAttempts` and set `throttledUntil`, but no `auditEvent` or `packageAudit` row is written; brute-force attempts are invisible in the audit log. The plan P9 risk note calls for "audit use" of magic links; throttle events are part of that. Write an audit row on each failed attempt and throttle transition.

6. **Magic-link TTL is 14 days for non-completed routes** [S] - `lib/delivery.ts:8` `MAGIC_LINK_TTL_MS`, `lib/delivery.ts:180` `expiresAt`
   - A DRAFT/ACTIVE route link stays valid for 14 days regardless of activity, exceeding the plan's "expires on route completion (optional short grace)" intent. Expiry is only shortened to `new Date()` when the last stop is delivered (line 287). A leaked DRAFT link remains live for two weeks. Shorten the creation TTL and/or add a sliding inactivity expiry.

7. **Reroute can add stops to a COMPLETED route** [S] - `lib/delivery.ts:326` `nearbyShippingPackages`, `lib/delivery.ts:351` `confirmReroute`
   - Neither function checks `route.status`; a manager can confirm a reroute onto a route that is already `COMPLETED`, adding a new stop after completion. `nearbyShippingPackages` does `findUniqueOrThrow` with no `status` predicate; `confirmReroute` then creates a `deliveryRouteStop` with no status guard. Add a `status: "DRAFT" | "ACTIVE"` predicate to the reroute path.

8. **Driver GET response carries no `Cache-Control: no-store`** [S] - `app/api/driver/[token]/route.ts:12-19`
   - The driver route response returns recipient name, full address label, and greeting (PII) with no cache-control header, allowing browser/proxy caching of stop PII on a shared device. `readDriverRoute` returns `recipientName`, `address`, `greeting`, and `mapUrl`. The plan P9 risk note calls for "minimize stop data"; the data is necessary for delivery, but caching it on a borrowed phone is avoidable. Set `Cache-Control: no-store, no-cache` on the driver GET response.

### Major - reroute / method-switch atomicity

9. **Label void + method switch + stop creation is not atomic; `confirmReroute` re-scans and re-validates with a TOCTOU window** [S][Q][C] - `lib/delivery.ts:299-323` `switchPackageMethod`, `lib/delivery.ts:351-363` `confirmReroute`
   - Merged from security M6 + quality H3 + clean-code 4. `voidPackageLabel` runs outside the method-switch `$transaction` (line 300, before the transaction at 305); if the subsequent transaction fails, the Shippo label is voided but the package remains on SHIP with no compensating action. `confirmReroute` compounds this: it calls `nearbyShippingPackages(routeId)` (an O(all shipping packages) scan that re-geocodes every candidate) just to validate one package, then calls `switchPackageMethod` (which re-fetches and re-validates the same package at lines 293-301), then opens a *second* `$transaction` to create the `DeliveryRouteStop` and audit. If the second transaction fails, the label is voided and the method switched but the package is not on the route: an orphaned state. The two-step also creates a time-of-check/time-of-use window between the eligibility scan and the method switch, with no row lock between them. Collapse into a single transaction (or a saga with compensating steps), drop the redundant full rescan, and lock the package row.

### Major - audit correctness

10. **Method-switch audit records a placeholder string, not the preserved charge; label-void ID not linked** [S][Q][R][C] - `lib/delivery.ts:310-321` `switchPackageMethod`
    - Merged from security M4 + quality L1 + rules M1 + clean-code 3. Plan P9 #3 requires "charge preserved + who/when audit". The `delivery.method_switched` audit row stores `details: { from, to, preservedCustomerChargeCents: packageRecord.orderId ? "checkout_snapshot_unchanged" : null }` — a literal string assertion, not the numeric cents value. The `packageRecord` include does not pull `order`, so no charge amount is available to log. A reviewer or reconciliation report cannot verify *what* was preserved from the audit row alone. `lib/shipping.ts:checkoutChargeForPackage` (42-66) already extracts the real cents value and is reusable. Additionally, the voided label ID is not linked: `voidPackageLabel` (`lib/shipping.ts:309`) writes its own `shipping.label_voided` audit with the label ID, but the method-switch row does not reference it. Record the actual preserved cents value and link the voided label ID in the method-switch audit.

### Major - structure / clean-code

11. **God file: `lib/delivery.ts` mixes 7+ P9 concerns in 456 lines** [R][C] - `lib/delivery.ts:1-456`
    - Merged from rules H1 + clean-code 1. `clean-code.mdc` and `ponytail.mdc` both trigger on mixed concerns regardless of line count. A single module exports route CRUD, driver magic-link auth/PIN throttling, geocode caching, method switch + reroute, pickup lifecycle, bulk delivery scheduling, and payment-reminder cron logic — 6+ distinct P9 sub-features fused into one file. 456 lines is under the hard cap but the mixed-concern trigger fires; the next P9 touch pushes it over 500. Split by concern (routes, driver, reroute, pickup, bulk+crons) into separate modules under `lib/delivery/`.

12. **Missing plan deliverables: follow-up call-center filters (R-079) and print-batch update on reroute** [Q][R] - `app/admin/delivery/page.tsx`; `confirmReroute` in `lib/delivery.ts:351-363`; `lib/delivery.ts` (no follow-up function); `app/api/admin/delivery/route.ts` (no follow-up action)
    - Merged from rules H2 + quality M2. `workflow.mdc` Execution Discipline: "Implement attached plans verbatim." Two P9 deliverables from `MERGED-BUILD-PLAN.md` P9 are absent. (a) "Follow-up call-center with filters (R-079)" — no call-center view, no follow-up filters, no R-079 wiring anywhere in the workspace (grep for `follow-up|followUp|call.?center|unclaimed` across `lib/` returns no matches); the status file does not mention it. (b) Reroute "updates print batch" — `confirmReroute` creates a `deliveryRouteStop` and an `auditEvent` but never calls any `print-batches` function and does not touch `printBatch`/`printArtifact`; the print batch is not updated when a package is rerouted onto a route. Implement both deliverables.

13. **Duplicated `geocodeCache` upsert with divergent TTLs across files** [R][C] - `lib/delivery.ts:62-77` vs `lib/order-builder.ts:187-197`
    - Merged from rules M2 + clean-code 2. Two separate upsert implementations against the same `GeocodeCache` table, with different TTLs and providers, no shared helper. Rule of 2 met. Delivery uses a 30-day TTL with `"fixture"` provider (lines 69, 75); order-builder uses a 90-day TTL with `"postal-centroid"` provider (lines 194, 196). Same cache, two expiry policies — schema/type drift risk. Extract one shared `upsertGeocodeCache` helper with a named TTL constant.

14. **`expirePickupPackages` writes "expired" audits but never marks the package expired; `skipDuplicates` is a no-op; no unclaimed report** [Q][R][C] - `lib/delivery.ts:433-440`; `app/api/cron/pickup-expiry/route.ts`
    - Merged from quality H2 + rules L3 + clean-code 6. Plan P9 #4 requires an "unclaimed-pickup report" and a pickup-expiry cron. The cron calls `expirePickupPackages`, which selects overdue packages and writes `packageAudit` rows with `action: "pickup.expired"` and `details: {}` — but never updates `Package.status` or `pickupExpiresAt`. Expired packages keep their pre-expiry status (New/Printed/Packed) and simply vanish from `pickupDoorList` because that query filters `pickupExpiresAt: { gt: now }`. The package board still shows them as ready; the audit cannot answer "when did this expire?" without re-reading the package row. There is no function or endpoint that returns unclaimed/expired packages for staff review. Also `packageAudit.createMany({ skipDuplicates: true })` is misleading — `PackageAudit` has no `@@unique` (schema 475-486), so `skipDuplicates` only de-duplicates generated IDs (never happens); it's a dead flag. Transition package status to an expired/unclaimed state, populate `details` with the expiry timestamp, surface an unclaimed-pickup report endpoint, and drop the no-op `skipDuplicates`.

### Major - plan deliverables / geocode

15. **Mapbox not wired; geocoder is a fixture** [Q] - `lib/delivery.ts:43-84` (`fixtureCoordinates`, `geocodeAddress`); `app/admin/delivery/page.tsx` (no map UI)
    - Plan P9 #1 requires a Mapbox route builder from delivery packages with geocode + cache (R-074, R-179, G-030 admin map). The implementation never calls Mapbox. `geocodeAddress` returns `fixtureCoordinates` (deterministic fake lat/lng derived from a SHA-256 digest) and persists `provider: "fixture"` into `GeocodeCache`. There is no admin map UI in `app/admin/delivery/page.tsx` — only a form, a routes list, and print links. EXPECTED S2 only verifies Google Maps destination encoding (a URL string), so the smoke passes without Mapbox; the admin map requirement is unmet. Wire Mapbox geocoding and add the admin map UI.

16. **No route admin detail (JSON) endpoint** [Q] - `app/api/admin/delivery/[routeId]/route.ts:10-25` (GET handler)
    - Plan P9 #1 requires "route admin list/detail/reassign/print". List (`listRoutes`), reassign (`reassignRoute`), and print (`routePdf`) are present. Detail is not — the GET on `/api/admin/delivery/[routeId]` always returns a PDF (or 404), never a JSON view of the route. There is no admin UI screen that shows a single route's stops, driver, and status. Add a JSON detail branch (e.g., `Accept: application/json`) and a per-route admin detail view.

17. **Magic-link grace period not implemented** [Q] - `lib/delivery.ts:283-289` (completion branch of `deliverDriverStop`)
    - Plan P9 #2 says the magic link "expires on route completion (optional short grace)". Open question 3 proposes a 2-hour default, manager-configurable. The code sets `expiresAt: new Date()` immediately when the last stop is delivered — no grace, no manager setting, no configurability. `MAGIC_LINK_TTL_MS` is a 14-day creation TTL (line 8); no constant for grace. Add a configurable grace period on route completion.

18. **`pickupDoorList` excludes picked-up packages; "stamp" removes the row instead of marking it** [Q] - `lib/delivery.ts:416-422` (`pickupDoorList`); `lib/delivery.ts:424-431` (`stampPickedUp`)
    - EXPECTED #4 says "door list + picked-up stamp". The door list query filters `status: { not: "PICKED_UP" }`, so once `stampPickedUp` sets status to `PICKED_UP`, the package disappears from the door list. There is no view that shows the stamp alongside the door-list row (e.g., a "picked up at" column on the same list). The semantics read as "open pickups only" rather than "door list with stamps". Add a view that shows all ready+stamped pickups with the stamp timestamp.

19. **`sendPaymentReminders` dedupe key is per order, not per schedule** [Q] - `lib/delivery.ts:442-455` (`sendPaymentReminders`)
    - The dedupe key is `payment-reminder:${schedule.orderId}` — one reminder per order ever. If staff reschedule a bulk delivery (creating a second `BulkDeliverySchedule` row for the same order) the second schedule never triggers a reminder because the dedupe key collides with the first. R-080 implies a recurring reminder cron; the current key makes reminders one-shot per order and immune to rescheduling. `BulkDeliverySchedule` has no unique constraint on `orderId` (schema.prisma:450-462), so multiple schedules per order are allowed at the data layer but silently de-duplicated at the notification layer. Include `schedule.id` in the dedupe key.

20. **`nearbyShippingPackages` awaits geocode serially inside a loop and re-geocodes route stops on every call** [R][C] - `lib/delivery.ts:326-348` (`nearbyShippingPackages`)
    - Merged from rules M4 + clean-code 11. The candidate loop awaits `geocodeAddress` once per candidate, sequentially — N sequential round-trips (cache writes + address updates). The same function already parallelises the route-side geocodes with `Promise.all` (line 332); the candidate branch does not. Inconsistent pattern within one function. Additionally, `createRoute` already geocoded and persisted stop coordinates, but `nearbyShippingPackages` re-geocodes all route stops on every suggest call; combined with `geocodeAddress` unconditionally writing the address row (clean-code 10), each suggest call re-writes N address rows for the route's own stops. Parallelise candidate geocodes and skip re-geocoding stored route-stop coordinates.

21. **Unnamed half-mile / Earth-radius magic numbers in reroute proximity** [R] - `lib/delivery.ts:86-93` (`isWithinHalfMile`)
    - `clean-code.mdc` — "Magic values -> named constants". `0.5` (the plan's "~0.5 mile" threshold) and `3_958.8` (Earth radius in miles) appear inline in the haversine. Both are domain constants the plan calls out explicitly; neither is named. Extract named constants (`PROXIMITY_MILES`, `EARTH_RADIUS_MILES`).

22. **`loadDriverLink` expiry check relies on operator precedence with no parentheses** [R] - `lib/delivery.ts:123` (`loadDriverLink`)
    - `if (!link || link.expiresAt && link.expiresAt <= new Date() || link.route.completedAt)`. The intended grouping is `(!link) || (link.expiresAt && link.expiresAt <= new Date()) || (link.route.completedAt)` — correct only because `&&` binds tighter than `||`. This is the magic-link expiry security path; parenthesising the clauses would make the intent unambiguous. Add explicit parentheses.

23. **Admin delivery page requires staff to paste raw package CUIDs — pattern drift vs every other admin screen** [C] - `app/admin/delivery/page.tsx:44, 63-65`
    - The "Build a route" form asks staff to type comma-separated package CUIDs into a textarea. Every other admin screen in the workspace uses clickable rows from a list (operations page lines 89-97, packages page). The delivery UI is the only one that demands staff know internal IDs. UI consistency rule: "New screens must reuse existing header, theme, and navigation patterns." Add a package picker / list of eligible delivery packages.

### Minor - security / disclosure

24. **Single shared `CRON_SECRET` across all crons** [S] - `lib/cron-auth.ts:4`
    - Both P9 crons share one `CRON_SECRET`; compromise of any one caller's environment leaks a secret valid for every cron. No per-cron rotation. P11 will add more crons on the same secret. Introduce per-cron secrets or a rotation scheme.

25. **`DeliveryNotification` has no retention or purge path** [S] - `lib/delivery.ts:95` `captureNotification`, `prisma/schema.prisma:435` `DeliveryNotification`
    - PII-bearing notification records (customerId, packageId, payload) are retained indefinitely; the P11 email-log purge cron (R-172) targets email logs, not this table. No `deleteMany` or purge job touches `DeliveryNotification` anywhere in `lib/delivery.ts` or the cron routes. The plan's retention open question (Q6) is unresolved for this table. Add a retention/purge path.

26. **`reassignRoute` does not validate the driver's role** [S] - `lib/delivery.ts:204` `reassignRoute`
    - Any staff ID (including MANAGER or STAFF) can be assigned as a route driver; no check that `driverId` resolves to a `DRIVER`-role staff member. `prisma.deliveryRoute.update({ where: { id: routeId }, data: { driverId } })` — no role lookup. The plan separates DRIVER from STAFF/MANAGER (UR-012); assigning a non-driver to a route is allowed silently. Validate the driver role before assignment.

27. **Fixture geocode makes the reroute proximity gate always-true** [S] - `lib/delivery.ts:43` `fixtureCoordinates`, `lib/delivery.ts:86` `isWithinHalfMile`
    - Without Mapbox configured, every shipping package hashes to coordinates within ~0.0001° of every route stop, so `isWithinHalfMile` returns true for all candidates; the proximity filter is non-functional. `fixtureCoordinates` returns `40.68 + digest[0]/10_000` and `-73.99 + digest[1]/10_000` — a ~0.01° band. `nearbyShippingPackages` falls back to this when no stored/cache hit. Not exploitable because manager confirmation is still required (#7 aside), but the "nearby" eligibility check is effectively a no-op in fixture mode, which smoke S3 does not distinguish from real geocoding. Flag the fixture-mode proximity in smoke assertions.

### Minor - pickup / driver correctness

28. **`pickupEligibility` only inspects the first inventory row** [Q] - `lib/delivery.ts:385-398`
    - `pickupEligibility` reads `line.orderLine.product.inventoryItems[0]` and checks `quantityOnHand - quantityReserved >= line.quantity`. If a product has multiple `InventoryItem` rows (multiple lots/locations), only the first is considered. A package can be marked eligible when the first row has stock but the aggregate does not, or ineligible when the first row is empty but other rows cover the line. Sum across `inventoryItems`.

29. **`startDriverRoute` has no state-machine guard** [Q] - `lib/delivery.ts:247-263`
    - `startDriverRoute` unconditionally sets `status: "ACTIVE"` and `startedAt: link.route.startedAt ?? new Date()`. There is no check that the current status is `DRAFT` (or `ACTIVE` for a re-start). Calling start on a `COMPLETED` route would re-activate it (the completion branch in `deliverDriverStop` sets `expiresAt: now()`, but `loadDriverLink` would already reject an expired link, so this is hard to hit in practice — still, the lib function lacks the guard). Add a `status` guard.

30. **`expirePickupPackages` audit `details: {}` is empty** [Q] - `lib/delivery.ts:433-440`
    - The expiry audit row is written with `action: "pickup.expired"` and `details: {}`. `PackageAudit.actorId` is optional and left null (system-initiated) — acceptable — but the empty `details` loses the reason and the expiry timestamp that `pickupExpiresAt` carried. The audit cannot answer "when did this expire?" without re-reading the package row. Populate `details` with the expiry timestamp and reason. (Distinct from #14, which covers the missing status transition and report.)

31. **`nearbyShippingPackages` "same street" is exact `line1` equality, not a cluster** [Q] - `lib/delivery.ts:341-343`
    - Plan P9 #3 says "same street cluster". The implementation treats "same street" as `address.line1 === candidate.address!.line1 && city === city && state === state` — exact house-number-and-street match. "10 Route Street" and "12 Route Street" do not match, even though they are on the same street. The half-mile haversine branch (lines 86-93) compensates for nearby-but-different addresses, but the explicit "same street cluster" requirement is not implemented as a cluster. Implement a street-name cluster (strip house number, match street + city + state).

### Minor - magic values / naming / consistency

32. **`fixtureCoordinates` base lat/long are unnamed magic numbers** [R] - `lib/delivery.ts:43-49` (`fixtureCoordinates`)
    - `clean-code.mdc` — magic values. `40.68` and `-73.99` (Brooklyn baseline) plus the `/ 10_000` jitter divisor are inline. Acceptable for a fixture fallback, but a named `FIXTURE_ORIGIN`/`FIXTURE_JITTER` would satisfy the rule. Extract named constants.

33. **Driver page initial load can burn a PIN attempt on PIN-protected routes** [R] - `app/driver/[token]/page.tsx:18-33` <-> `loadDriverLink:130-139`
    - `clean-code.mdc` — "Error messages say what went wrong AND what the expected state was." Clicking "Open stops" with an empty PIN on a PIN-protected route increments `failedAttempts` and returns "Enter the route PIN." — the message names the expected state but the failure is recorded as an "attempt", so 5 empty-PIN clicks throttle the link. Not a rule violation, but the error path silently mutates security state; the message does not warn the user that attempts are being counted. Distinguish empty-PIN from wrong-PIN, or warn that attempts are counted.

34. **Phase status file asserts verification without appending command output** [R] - `.scratch/PHASE-P9-STATUS.md`; `.scratch/PHASE-P9-SMOKE.md`
    - `workflow.mdc` — "Verify in the running app — never mark done from code alone"; `clean-code.mdc` anti-hallucination — "Do not claim 'fixed/passed/working' without tool output or running-app evidence." The status file says "verified `npm run smoke:p9` and `npm run typecheck`" and the smoke file lists S1-S5 as "passed", but neither file pastes command output (exit codes, assertion logs, timestamps beyond a single date line). `PHASE-P9-SMOKE.md` line 3: "Command: `npm run smoke:p9` — passed 2026-07-28." No transcript, no counts, no exit code. Paste command output into the evidence files.

35. **`MAGIC_LINK_TTL_MS` named constant has a single call site — Rule of 2 borderline** [C] - `lib/delivery.ts:8, 180`
    - `MAGIC_LINK_TTL_MS` is defined once and used once. Rule of 2 says "needs 2+ real call sites right now." The 30-day geocode TTL (lines 69, 75) is the value that's actually duplicated inline — that's the value that should be named. Reconcile: either give the geocode TTL a named constant (see #13) or accept `MAGIC_LINK_TTL_MS` as a single-call-site named constant for clarity.

36. **Duplicated `fulfillmentMethod.upsert` pattern with minor variations** [C] - `lib/delivery.ts:110-116, 302-304`; `scripts/smoke-p9.ts:13-17`
    - The same `fulfillmentMethod.upsert({ where: { code }, create: { code, name }, update: { name } })` pattern repeats 3+ times with only the code/name varying. Rule of 2 met. The smoke script already generalizes it; the lib does not. Extract one `ensureFulfillmentMethod(code, name)` helper.

37. **`deliveryMethod()` helper name is a noun, not a verb** [C] - `lib/delivery.ts:110-116`
    - Function names should describe what they DO. `deliveryMethod` reads as a noun (the method) not a verb; a caller can't tell from `await deliveryMethod()` whether it's a getter, a creator, or a constant. The function actually upserts the DELIVERY fulfillment method record. Rename to `ensureDeliveryMethod` or `upsertDeliveryMethod`.

38. **`geocodeAddress` always writes to the address row even when nothing changed** [C] - `lib/delivery.ts:51-84`
    - When the address already has stored `latitude`/`longitude`, the function returns early with `provider: "stored"` (lines 52-54) but control still falls through to `prisma.address.update` (lines 79-82), writing the same coordinates back and bumping `updatedAt`. Anti-AI-tic: "No 'just in case' code -- every line must have a reason." Skip the update on the stored-coords branch.

39. **Inconsistent audit table split — `PackageAudit` vs `AuditEvent` — undocumented** [C] - `lib/delivery.ts` (multiple); `prisma/schema.prisma:110-118, 475-486`
    - P9 writes package-scoped audits to `PackageAudit` and route-scoped audits to `AuditEvent`. The two tables share the same column shape (id, actorId, action, details, createdAt). Whether this is "one pattern per concern" or "two competing audit patterns" is not documented in the README. Flagging as pattern-drift candidate worth a Rule Preference entry. Document the split (or consolidate).

40. **Admin delivery page duplicates the initial fetch in `useEffect` and `load()`** [C] - `app/admin/delivery/page.tsx:20-37`
    - `load()` (20-25) fetches `/api/admin/delivery`, then a separate `useEffect` (27-37) re-implements the same fetch inline with a `cancelled` flag and different error handling. Two code paths for the initial load; the effect ignores `load()` entirely. Consolidate to one initial-load path.

41. **Driver page `request` helper has two equivalent branches and a redundant ternary** [C] - `app/driver/[token]/page.tsx:18-33`
    - `if (action?.action === "deliver") return load();` and `if (action?.action === "start") return load();` both return the same `load()` — they collapse to one `if (action) return load();` after the POST. Minor readability issue, not a bug. Collapse the two branches.

42. **Driver page initial message contradicts the optional-PIN design** [C] - `app/driver/[token]/page.tsx:16, 43, 47`
    - Initial state `message` says "Enter the optional route PIN to load stops." but the PIN is optional (UR-015) and the label says "Route PIN (if provided)". The message implies the PIN is required to proceed, contradicting the optional-PIN design. Align the message with the optional-PIN design.

43. **`sendPaymentReminders` filters `deliveryDate <= now` — reminders fire after the delivery window** [C] - `lib/delivery.ts:442-455`
    - The cron selects schedules where `deliveryDate { lte: new Date() }` and `paymentStatus: "PENDING"`. For a payment reminder you'd expect upcoming deliveries (`deliveryDate >= now`) so reminders fire before the window, not after. The smoke test (smoke-p9.ts:107) creates a schedule with `new Date(Date.now() - 60_000)` (past) to exercise the path, which only works because the filter is backwards. Functional but semantically odd; flagging for product clarification. Confirm the intended direction of the filter.

### Nit - idempotency / audit gaps

44. **`captureNotification` upsert is a no-op on duplicate dedupeKey** [Q] - `lib/delivery.ts:95-108`
    - `captureNotification` uses `upsert` with `update: {}`. On a duplicate dedupeKey the existing row is kept and the new payload is discarded. This is correct for idempotency (the first capture wins), but means a retried notification with a corrected payload will be silently ignored. Acceptable for the test-capture channel; worth noting if real channels are wired in P11.

45. **`scheduleBulkDelivery` allows multiple schedules per order with no audit row** [Q] - `lib/delivery.ts:365-383`
    - Each call creates a new `BulkDeliverySchedule` row and fires fresh notifications (dedupeKey includes `schedule.id`). There is no check for an existing schedule on the same order, and no `auditEvent` row is written for the scheduling action. Rescheduling is silent at the audit layer. Add an audit row for scheduling.

46. **Driver page PIN input has no submit-on-Enter; only the "Open stops" button submits** [Q] - `app/driver/[token]/page.tsx:43-44`
    - The PIN `<input>` has no `onKeyDown` / form submit binding; the user must click "Open stops". Minor mobile UX gap on a phone-viewport page (the primary target for magic links). Wrap the PIN input in a `<form>` with submit-on-Enter.

---

## Notes

- 3 blockers: cron bearer timing leak (#1) and two pickup-stamp IDOR variants (#2 no fulfillment-method check, #3 no location scoping). All three must be fixed before any phase gate.
- 7 clusters merged (11 duplicates removed): (a) method-switch audit placeholder — S-M4 + Q-L1 + R-M1 + C-3 (#10); (b) god file — R-H1 + C-1 (#11); (c) reroute/method-switch atomicity + TOCTOU — S-M6 + Q-H3 + C-4 (#9); (d) expirePickup no status transition / no report — Q-H2 + R-L3 + C-6 (#14); (e) duplicated geocode-cache upsert — R-M2 + C-2 (#13); (f) nearbyShippingPackages geocode inefficiency — R-M4 + C-11 (#20); (g) missing follow-up call-center — R-H2 + Q-M2 (#12).
- No new findings introduced during aggregation.