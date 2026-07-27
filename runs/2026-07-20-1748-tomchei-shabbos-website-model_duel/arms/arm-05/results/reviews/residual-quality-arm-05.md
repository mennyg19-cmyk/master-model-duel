# Residual Quality Review — arm-05 (post self-fix)

**Reviewer specialist:** Residual Quality (Test 5)
**Tree:** `arms/arm-05/workspace/` (post self-fix)
**Source of truth:** `shared/MERGED-BUILD-PLAN.md` (P1–P12)
**Self-fix notes read:** `arms/arm-05/results/SELF-FIX-NOTES.md` (SR-001..SR-008)
**Not consulted:** `arms/arm-05/results/SELF-REVIEW.md` (per residual protocol)

## Summary

The eight self-fix items (SR-001..SR-008) are each landed and verifiable in the tree. The residual issues below are problems that remain after that pass — they were not in scope of the self-fix notes, or the fix introduced a secondary defect.

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 3 |
| Low | 5 |
| **Total** | **9** |

---

## Findings

### RQ-001 — High — Delivery notifications are captured but never delivered

**Location:** `lib/delivery.ts` (`captureNotification`, lines 122–136); `lib/sms.ts` (`dispatchSms`, lines 12–18); `app/api/cron/email-outbox/route.ts` (only sweeps `emailOutbox`).

**Claim:** Every P9 delivery notification (day-of-delivery, pickup-ready, payment-reminder, bulk-delivery-scheduled) is written to the `deliveryNotification` table and never read again. No sweeper, sender, or provider call ever turns those rows into actual emails or SMS. `dispatchSms` does not call any SMS provider — it writes to the same dead-end table.

**Evidence:**
- `captureNotification` (delivery.ts:131) does `prisma.deliveryNotification.upsert(...)` for every non-SMS channel and delegates SMS to `dispatchSms`.
- `dispatchSms` (sms.ts:13) also does `prisma.deliveryNotification.upsert(...)` with `channel: "SMS"` — no Twilio/HTTP call anywhere.
- The only delivery sweeper registered is `/api/cron/email-outbox` → `sweepEmailOutbox`, which queries `prisma.emailOutbox` (email.ts:147), a different table. Nothing queries `deliveryNotification`.
- `startDriverRoute` (delivery.ts:293) hardcodes `channel: "TEST_CAPTURE"` for `DAY_OF_DELIVERY`; `markPickupReady` (delivery.ts:462) does the same for `PICKUP_READY`; `sendPaymentReminders` (delivery.ts:538) does the same for `PAYMENT_REMINDER`. Even in production the channel is `TEST_CAPTURE`.
- `scheduleBulkDelivery` (delivery.ts:428) is the only caller that uses `"EMAIL"` and `"SMS"` channels, but both still terminate in `deliveryNotification` rows.
- `scripts/smoke-p9.ts` asserts only `prisma.deliveryNotification.count(...)` (lines 94, 113, 120) — it never verifies actual delivery, so the smoke passes while the feature is non-functional.

**Impact:** P9/P11 acceptance: customers never receive day-of-delivery, pickup-ready, payment-reminder, or bulk-delivery-scheduled notifications in any environment. The plan (P9 smoke: "one email + SMS per intended customer"; P11: "trigger each transactional template from its domain event") is not met.

---

### RQ-002 — Medium — `consolidatedItems` dashboard metric uses page count instead of total

**Location:** `lib/package-operations.ts` (`packageDashboard`, line 166).

**Claim:** The "additional items consolidated into packages" metric is computed as `productionUnits - packages.length`, where `packages` is the paginated array (≤100 rows), not the total active package count. On any multi-page board the metric is overstated by `(total - packages.length)` items.

**Evidence:**
```166:    consolidatedItems: Math.max(0, productionUnits - packages.length),```
- `packages` is the result of `prisma.package.findMany({ ..., skip, take: PACKAGE_DASHBOARD_PAGE_SIZE })` (lines 124–140), so `packages.length` is at most 100.
- `productionUnits` is summed across every active package via `packageSummaries` (lines 141–158), so it reflects all active packages.
- The UI label is "Additional items consolidated into packages" (`app/admin/packages/page.tsx:122`), which should be `productionUnits - total`, not `productionUnits - packages.length`.
- On a 5,000-package board with 10,000 production units, page 1 shows `consolidatedItems = 10000 - 100 = 9900`; the correct value is `10000 - 5000 = 5000`.

**Impact:** Staff see inflated consolidation counts on the fulfillment board; the metric is only correct when the board fits on a single page.

---

### RQ-003 — Medium — Package board loads every active package + its lines into memory on every page load

**Location:** `lib/package-operations.ts` (`packageDashboard`, lines 141–145).

**Claim:** SR-003 paged the visible board to 100 rows, but the channel/production totals are still computed by fetching every active `Package` with its `lines` into Node memory and reducing in JS. At the plan's 5k-package crunch scale this is a multi-thousand-row fetch (package + line rows) per board view.

**Evidence:**
```141:    prisma.package.findMany({
142:      where,
143:      select: { fulfillmentMethod: { select: { code: true } }, lines: { select: { quantity: true } } },
144:    }),
```
- `where` is `{ isActive: true }` with no `take` — every active package is loaded.
- The reduce loop (lines 146–157) iterates all of them in JS to build channel counts and `productionUnits`.
- A `groupBy` on `fulfillmentMethodId` plus a `SUM` of line quantities in SQL would return the same totals in one row per channel.

**Impact:** Board page load cost grows linearly with total active packages; at 5k packages this is a measurable per-request memory and latency hit, exactly the crunch scenario G-024 targets.

---

### RQ-004 — Medium — Staff impersonation is an audit stub, not a working feature

**Location:** `lib/staff-store.ts` (`startImpersonation`, lines 216–230); `app/api/staff/[staffId]/route.ts` (lines 35–38); `app/admin/staff/page.tsx` (line 85).

**Claim:** `startImpersonation` only writes an `auditEvent` and returns `true`. There is no session switch, no impersonation banner, no middleware that lets the manager act as the target staff member. R-099 ("impersonation with banner") is not implemented.

**Evidence:**
- `startImpersonation` (staff-store.ts:216) does `prisma.auditEvent.create(...)` and returns `true`; it never touches a session, cookie, or Clerk act-as claim.
- The route returns `"Impersonation session started and audited."` but no session is actually started.
- `scripts/smoke-p1.ts:118-126` only asserts that the `staff.impersonation_started` audit row exists — it does not verify any act-as behavior or banner.
- No middleware or layout reads an impersonation flag; `app/admin/layout.tsx` has no banner state.

**Impact:** The "Impersonate" button in the staff admin UI is non-functional beyond logging; the R-099 acceptance gate (banner + act-as) is not met.

---

### RQ-005 — Low — `nearbyShippingPackages` does not filter by finalized order

**Location:** `lib/delivery.ts` (lines 381–384).

**Claim:** The reroute candidate query selects active, unshipped SHIP packages with no `deliveryStop`, but does not require `order: { status: "FINALIZED" }`. Packages are only ever created for finalized orders today, but the absence of the guard means a future code path that creates packages on draft orders would surface them as reroute candidates.

**Evidence:**
```381:    const candidates = await prisma.package.findMany({
382:      where: { isActive: true, status: { not: "SENT" }, fulfillmentMethod: { code: "SHIP" }, deliveryStop: null },
383:      include: { address: true },
384:    });
```
- Compare `createRoute` (delivery.ts:186–194) which does require `order: { status: "FINALIZED" }`; the reroute path is inconsistent.

**Impact:** Latent guard gap; no current data path triggers it, but it is a defense-in-depth inconsistency.

---

### RQ-006 — Low — Stripe reconciliation only flags orphaned intents, never matches them

**Location:** `lib/reporting.ts` (`runStripeReconciliation`, lines 200–210).

**Claim:** R-093 calls for a "Stripe payment reconciliation — run button + cron + matcher." The implementation creates an audit flag for each `stripePaymentIntent` with `paymentId: null` but never attempts to link the intent to an order/payment. The matcher half is missing.

**Evidence:**
```201:  const orphaned = await prisma.stripePaymentIntent.findMany({ where: { paymentId: null }, ... });
...
204:    if (!await prisma.auditEvent.findFirst({ where: { action: "stripe.reconciliation_flagged", subjectId } })) {
205:      await prisma.auditEvent.create({ ... });
206:    }
```
- No `payment.update`, no `order.update`, no link attempt — only audit rows.
- The P12 smoke for reconciliation only checks the flag count, not a match.

**Impact:** Orphaned intents accumulate as flags forever; staff get no actionable match, only a count.

---

### RQ-007 — Low — `season-auto-flip` cron log records scheduled IDs that were not necessarily opened

**Location:** `lib/seasons.ts` (`autoOpenScheduledSeasons`, lines 22–30).

**Claim:** The `cronRunLog.details.openedSeasonIds` is copied from the read query (`scheduledSeasons`), but the subsequent `updateMany` may skip seasons that a manager manually opened in the gap. The log overstates what the cron actually changed.

**Evidence:**
```28:      details: { opened: opened.count, openedSeasonIds: scheduledSeasons.map((season) => season.id) },
```
- `opened.count` is the real number of rows updated; `openedSeasonIds` is the pre-update read set, which can be larger.

**Impact:** Audit log can show a season as auto-opened when it was actually opened manually; minor reconciliation noise.

---

### RQ-008 — Low — Inventory is reserved but never consumed on pickup/delivery

**Location:** `lib/checkout.ts` (`reserveLineInventory`, lines 223–238); `lib/delivery.ts` (`stampPickedUp`, `deliverDriverStop`).

**Claim:** `completeCheckout` increments `quantityReserved` and creates an `inventoryReservation`. No later step (pickup stamp, driver delivery, void) ever decrements `quantityReserved` or moves it to a consumed column. `quantityOnHand` never decreases either. Reserved stock stays reserved indefinitely.

**Evidence:**
- `reserveLineInventory` (checkout.ts:229–237) does `UPDATE "InventoryItem" SET "quantityReserved" = "quantityReserved" + ${quantity}` and inserts an `inventoryReservation`.
- `stampPickedUp` (delivery.ts:490–493) only updates `Package.status` and writes a `packageAudit`; no `InventoryItem` update.
- `deliverDriverStop` (delivery.ts:312–320) only updates the stop and package status; no inventory touch.
- `voidOfflinePayment` / `refundStripePayment` do not release the reservation either.

**Impact:** If the intended model is "reserved = sold," this is acceptable but then `quantityOnHand` is misleading. If consumption is intended, inventory availability erodes incorrectly over time. Either way the behavior is undocumented and inconsistent with typical inventory semantics.

---

### RQ-009 — Low — `listAudits` loads the entire audit table with no pagination

**Location:** `lib/staff-store.ts` (`listAudits`, lines 142–146).

**Claim:** The audit list endpoint returns every `auditEvent` row ordered by `createdAt desc` with no `take`/`skip`. Over a season this table grows unbounded (every package, payment, print, import, and impersonation writes one), so the admin audit page will fetch and serialize the full set.

**Evidence:**
```143:  return (await prisma.auditEvent.findMany({
144:    orderBy: { createdAt: "desc" },
145:  })).map(toAuditEvent);
```
- No `take`, no `skip`, no cursor.

**Impact:** Audit page degrades as the table grows; eventually the JSON response becomes unacceptably large for the admin UI.

---

## Notes on self-fix verification

For completeness, the eight self-fix claims were each checked against the tree and are landed:

- **SR-001** (multi-page PDF): `lib/print-batches.ts:123-167` builds a real `/Pages` tree with `pageObjectIds`; `tests/domain-core.test.ts:31-36` asserts `/Count 2` and `Package 56` for a 56-line input.
- **SR-002** (production geocoding requires Mapbox): `lib/delivery.ts:54-87` gates fixtures on `TEST_MODE && NODE_ENV !== production` and re-geocodes stale fixture cache rows via `mapboxCoordinates`.
- **SR-003** (board paging): `lib/package-operations.ts:120-168` pages the visible list at `PACKAGE_DASHBOARD_PAGE_SIZE = 100`. (See RQ-002/RQ-003 for residual defects in the same function.)
- **SR-004** (item-sales finalized only): `lib/reporting.ts:186-188` filters `order: { status: "FINALIZED" }`.
- **SR-005** (margin excludes voided): `lib/reporting.ts:152` filters `labelVoidedAt: null`.
- **SR-006** (legacy import creates `PackageLine`): `lib/reporting.ts:277-287` creates the package with `lines: { create: { orderLineId, quantity } }`.
- **SR-007** (anonymous POS distinct customers): `lib/admin-operations.ts:184-186` creates a customer with no email when `emailNormalized` is absent.
- **SR-008** (reports/seasons effect lint): `app/admin/reports/page.tsx:33-53` and `app/admin/seasons/page.tsx:27-45` do all `setState` inside `.then(...)` callbacks, not in the effect body.
