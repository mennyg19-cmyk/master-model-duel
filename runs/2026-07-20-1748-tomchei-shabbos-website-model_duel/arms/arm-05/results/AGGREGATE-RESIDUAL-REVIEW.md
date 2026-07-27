# Aggregate Residual Review — arm-05 (Test 5)

**Reviewer:** external residual aggregator (blind)
**Tree graded:** `arms/arm-05/workspace/` (post self-fix, full tree)
**Method:** union + dedupe by location+claim across the four specialist residual reviews. No new findings introduced. Security findings always survive.
**Sources:**
- `results/reviews/residual-security-arm-05.md`
- `results/reviews/residual-quality-arm-05.md`
- `results/reviews/residual-rules-arm-05.md`
- `results/reviews/residual-clean-code-arm-05.md`

## Totals

| Bucket | Count |
|---|---|
| Blocker | 2 |
| Major | 12 |
| Minor | 19 |
| Nit | 1 |
| **Total (actionable)** | **34** |

Nit items are noted for completeness; not required fixes.

## Per-source counts

| Source | Blocker | Major | Minor | Nit |
|---|---|---|---|---|
| security | 1 | 4 | 5 | 1 |
| quality | 1 | 3 | 5 | 0 |
| rules | 0 | 1 | 5 | 0 |
| clean-code | 0 | 5 | 4 | 0 |
| **raw sum** | 2 | 13 | 19 | 1 |
| **after dedupe** | 2 | 12 | 19 | 1 |

Three duplicates removed:
- security I-2 (naive `parseCsv`) merges into clean-code H-1 (two competing CSV parsers) — same location `lib/admin-operations.ts:33`, same claim; clean-code framing is the higher-severity structural defect, security framing is the data-quality note. Single major, tags [S][C].
- rules RR-3 (channel/production totals full-table load) merges into quality RQ-003 (package board loads every active package) — same location `lib/package-operations.ts:141-144`, same claim. Single major, tags [Q][R].
- rules RR-4 (reports page) + RR-5 (seasons page) merge into clean-code L-1 (duplicated `load()` vs `useEffect` fetch) — same locations, same claim. Clean-code L-1 spans both pages; split by location and merge each with the matching rules finding. Two minors, tags [R][C] each. Net: 3 raw → 2 deduped (removes 1).

No other cross-source duplicates. No new findings introduced.

## Blockers

### BLK-1 — `/api/admin/payments/[paymentId]` DELETE voids any cash/check payment by ID (IDOR)
- **Source:** [S] security H-1
- **Where:** `app/api/admin/payments/[paymentId]/route.ts` (full file); `lib/checkout.ts` `voidOfflinePayment` (lines 364–373).
- **Claim:** The DELETE handler authorizes `orders.write` then calls `voidOfflinePayment(paymentId, staffMember.id)` with only the path param. `voidOfflinePayment` looks the payment up by `id` alone — no `orderId` scoping. Any staff member with `orders.write` can void any posted CASH/CHECK payment in the system by supplying its cuid, flipping the parent order's `paymentStatus`. The sibling refund route (`app/api/admin/orders/[orderId]/route.ts` POST, lines 50–54) correctly scopes by `orderId`; this route does not. Self-fix notes do not address payment-void scoping.
- **Severity rationale:** Cross-tenant data mutation by an authorized-but-over-broad role; insider can void payments on orders they have no authority over. Cuids resist enumeration but `listOrders` exposes payment IDs to `orders.write` holders.

### BLK-2 — Delivery notifications are captured but never delivered
- **Source:** [Q] quality RQ-001
- **Where:** `lib/delivery.ts` `captureNotification` (lines 122–136); `lib/sms.ts` `dispatchSms` (lines 12–18); `app/api/cron/email-outbox/route.ts` (only sweeps `emailOutbox`).
- **Claim:** Every P9 delivery notification (day-of-delivery, pickup-ready, payment-reminder, bulk-delivery-scheduled) is written to the `deliveryNotification` table and never read again. `dispatchSms` does not call any SMS provider — it writes to the same dead-end table. The only sweeper (`sweepEmailOutbox`) queries `emailOutbox`, a different table. `startDriverRoute`, `markPickupReady`, and `sendPaymentReminders` hardcode `channel: "TEST_CAPTURE"` even in production. `scripts/smoke-p9.ts` only asserts `deliveryNotification.count(...)` — it never verifies delivery, so smoke passes while the feature is non-functional. P9/P11 acceptance ("one email + SMS per intended customer"; "trigger each transactional template from its domain event") is not met.
- **Severity rationale:** A core acceptance-gated feature ships completely non-functional in every environment; customers never receive delivery notifications.

## Majors

### MAJ-1 — `sendCampaign` calls `createMany` with a single object; campaigns cannot be sent
- **Source:** [S] security M-1
- **Where:** `lib/email.ts` lines 250–261.
- **Claim:** `createMany` expects an array for `data`; a single object throws a Prisma validation error. The campaign is marked `SENT` before the loop, so the rollback reverts it to `DRAFT`, but the manager-facing UX reports a 400 with a raw Prisma message. Residual defect in a staff-only bulk sender that silently disables the campaign feature and leaks provider error text.

### MAJ-2 — Stripe `success_url` / `cancel_url` derived from request `Host` header
- **Source:** [S] security M-2
- **Where:** `lib/checkout.ts` `createProviderCheckout` lines 162–163.
- **Claim:** `requestUrl` host comes from the `Host` header. On Vercel the platform validates Host, but on any non-Vercel deploy (the README documents self-hosted `npm run start` on port 3105) an attacker who can influence `Host` can steer Stripe's post-payment redirect to an attacker origin. Same vector feeds the PAYMENT_LINK email body (MAJ-3).

### MAJ-3 — `replaceTemplateVariables` interpolates `paymentLink` into HTML without escaping
- **Source:** [S] security M-3
- **Where:** `lib/email.ts` lines 28–30, 91–99.
- **Claim:** `paymentLink` is sourced from `provider.url`, which for the local harness is `new URL("/checkout/local", requestUrl)` — Host-header-derived. Combined with MAJ-2, a Host-header injection becomes a phishing link in the PAYMENT_LINK email. Templates are staff-authored (`settings.manage`), so template HTML itself is trusted; the unescaped variable is the gap.

### MAJ-4 — `consolidatedItems` dashboard metric uses page count instead of total
- **Source:** [Q] quality RQ-002
- **Where:** `lib/package-operations.ts` `packageDashboard` line 166.
- **Claim:** The "additional items consolidated into packages" metric is `productionUnits - packages.length`, where `packages` is the paginated array (≤100 rows), not the total active package count. On any multi-page board the metric is overstated by `(total - packages.length)` items. On a 5,000-package board with 10,000 production units, page 1 shows 9,900 instead of the correct 5,000.

### MAJ-5 — Package board loads every active package + its lines into memory on every page load
- **Source:** [Q][R] quality RQ-003 + rules RR-3 (merged)
- **Where:** `lib/package-operations.ts` `packageDashboard` lines 141–145.
- **Claim:** SR-003 paged the visible board to 100 rows, but the channel/production totals are still computed by fetching every active `Package` with its `lines` into Node memory and reducing in JS. At the plan's 5k-package crunch scale this is a multi-thousand-row fetch per board view. A `groupBy` on `fulfillmentMethodId` plus `SUM` of line quantities in SQL would return the same totals in one row per channel. Ponytail `shrink:` candidate.

### MAJ-6 — Staff impersonation is an audit stub, not a working feature
- **Source:** [Q] quality RQ-004
- **Where:** `lib/staff-store.ts` `startImpersonation` lines 216–230; `app/api/staff/[staffId]/route.ts` lines 35–38; `app/admin/staff/page.tsx` line 85.
- **Claim:** `startImpersonation` only writes an `auditEvent` and returns `true`. No session switch, no impersonation banner, no middleware that lets the manager act as the target staff member. R-099 ("impersonation with banner") is not implemented. The route returns "Impersonation session started and audited." but no session is started. `scripts/smoke-p1.ts:118-126` only asserts the audit row exists.

### MAJ-7 — Two competing CSV parsers in the same project
- **Source:** [S][C] security I-2 + clean-code H-1 (merged)
- **Where:** `lib/admin-operations.ts:33` (`parseCsv`) vs `lib/reporting.ts:14` (`parseCsvRecords`) and `lib/reporting.ts:45` (`parseCsv`).
- **Claim:** The project ships two independent CSV parsers with different semantics. `admin-operations.parseCsv` is a naive `line.split(",")` that breaks on quoted fields containing commas; `reporting.parseCsvRecords` is a full quoted-field state machine. Both are invoked from staging paths (`stageImport` and `stageLegacyImport`), so customer-facing CSV uploads use different parsing rules depending on which import screen is used. Security dimension: data-quality issue only (Prisma parameterizes all writes, no injection path). Clean-code dimension: duplicated logic + inconsistent patterns ("one pattern per concern"). Severity taken from the higher (clean-code structural) framing.

### MAJ-8 — `lib/delivery.ts` is a god file (547 lines, mixed concerns)
- **Source:** [C] clean-code M-1
- **Where:** `lib/delivery.ts` (547 lines).
- **Claim:** Exceeds the 500-line / mixed-concerns split threshold. One module owns geocoding + Mapbox + fixture coordinates, magic-link/PIN throttling, route CRUD, driver stop delivery, package method switching, nearby-shipping proximity, bulk-delivery scheduling, pickup eligibility/ready/door-list/stamp/expire, and payment reminders. Natural split: `lib/delivery/geocoding.ts`, `lib/delivery/driver-routes.ts`, `lib/delivery/pickup.ts`, `lib/delivery/bulk.ts`.

### MAJ-9 — Duplicated SHA-256 hashing helper under two names
- **Source:** [C] clean-code M-2
- **Where:** `lib/delivery.ts:28` (`hashSecret`) and `lib/order-builder.ts:62` (`tokenHash`).
- **Claim:** Both are `createHash("sha256").update(value).digest("hex")` with different names. Two call sites each, so the Rule-of-2 bar for a shared `lib/crypto.ts` helper is met. Duplicated logic + inconsistent naming for the same concern (token hashing for DB lookup).

### MAJ-10 — `normalizeEmail` redefined locally instead of reusing the shared one
- **Source:** [C] clean-code M-3
- **Where:** `lib/admin-operations.ts:29-31` vs `lib/foundation.ts:16-18`.
- **Claim:** `foundation.ts` exports the canonical `normalizeEmail`, used by 5 files. `admin-operations.ts` redefines its own instead of importing the shared helper. Pattern drift on a one-pattern-per-concern concern (email normalization).

### MAJ-11 — Inconsistent error-handling pattern across API routes
- **Source:** [C] clean-code M-4
- **Where:** `lib/foundation.ts:41` (`maskError`) vs ~25 `app/api/**/route.ts` files.
- **Claim:** clean-code.mdc mandates "one error-handling approach per project." A `maskError` helper exists and is used by 3 routes, but every other route inlines `error instanceof Error ? error.message : "<fallback>"` (28 occurrences across 22 files). The two approaches diverge: `maskError` hides messages in production, the inline pattern leaks them.

### MAJ-12 — Duplicated admin POST-fetch boilerplate across every admin page
- **Source:** [C] clean-code M-5
- **Where:** `app/admin/packages/page.tsx:54` (`postJson`), `app/admin/reports/page.tsx:55` (`post`), `app/admin/seasons/page.tsx:47` (`post`) and `:73` (inline), plus inline `fetch(..., { method: "POST", ... })` in `catalog`, `delivery`, `pos`, `staff`, `settings`, `operations`, `test-console`, `orders/[orderId]`.
- **Claim:** Every admin page re-implements the same JSON POST wrapper. No shared `apiPost` helper exists in `lib/`. 14 hits across 10 files. Duplicated logic (Rule of 2 easily met) and inconsistent error shape (some return `{ok, body}`, some `body | null`, some set a message string). Distinct from the GET-side duplication in MIN-15/MIN-16/MIN-13.

## Minors

### MIN-1 — In-memory rate limiting keyed on `x-forwarded-for`; resets every cold start
- **Source:** [S] security L-1
- **Where:** `app/api/checkout/[draftId]/route.ts` lines 7–19; `app/api/newsletter/route.ts` lines 29–50.
- **Claim:** Both store attempts in a module-level `Map` keyed by `x-forwarded-for` (or `"unknown"`). On Vercel serverless each invocation may be a fresh instance, so the map is empty most of the time. `x-forwarded-for` is also client-controllable on any misconfigured proxy. The checkout limiter (12/min) and subscribe limiter (5/min) are effectively advisory only.

### MIN-2 — Newsletter preference/confirmation tokens travel in URL query
- **Source:** [S] security L-2
- **Where:** `app/api/newsletter/route.ts` line 70 (GET `?token=`); `app/api/newsletter/confirm/route.ts` line 9.
- **Claim:** Preference tokens (7-day TTL) are accepted from `searchParams.get("token")`. Confirmation tokens are single-use, but preference tokens are reusable and leak via server logs, browser history, and `Referer` on any image/link loaded from the preferences page.

### MIN-3 — `test-console` TRUNCATE via `$queryRawUnsafe` with env-only gating
- **Source:** [S] security L-3
- **Where:** `app/api/admin/test-console/route.ts` lines 13–24.
- **Claim:** `wipeTestData` builds `TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE` via `$queryRawUnsafe`. Table names come from `pg_tables` (not user input) and are escaped. The gate is `TEST_MODE=true` + `settings.manage` + `NODE_ENV in [development, test]`. Irreversible bulk delete behind an env flag rather than a per-action confirmation; defense-in-depth concern only.

### MIN-4 — Driver PIN-failure audit events have no `actorId`
- **Source:** [S] security L-4
- **Where:** `lib/delivery.ts` lines 168–174.
- **Claim:** `actorId` is omitted from the `delivery.driver_pin_failed` audit event. PIN brute-force attempts are throttled (5/15min) but never attributed. Audit trail gap; cannot later correlate who hammered a route link.

### MIN-5 — `bulk` action on `/api/admin/operations` increments order versions with no business effect
- **Source:** [S] security L-5
- **Where:** `app/api/admin/operations/route.ts` lines 54–65.
- **Claim:** Staff with `orders.write` can pass arbitrary finalized order cuids + versions and bump `version` by 1 with no other change. Audited as `orders.bulk_version_probed`. A staff member could intentionally desync concurrent optimistic-lock updates on orders they do not own. No scoping by customer or assignment.

### MIN-6 — `nearbyShippingPackages` does not filter by finalized order
- **Source:** [Q] quality RQ-005
- **Where:** `lib/delivery.ts` lines 381–384.
- **Claim:** The reroute candidate query selects active, unshipped SHIP packages with no `deliveryStop`, but does not require `order: { status: "FINALIZED" }`. Compare `createRoute` (delivery.ts:186–194) which does require it; the reroute path is inconsistent. Latent guard gap; no current data path triggers it.

### MIN-7 — Stripe reconciliation only flags orphaned intents, never matches them
- **Source:** [Q] quality RQ-006
- **Where:** `lib/reporting.ts` `runStripeReconciliation` lines 200–210.
- **Claim:** R-093 calls for a "Stripe payment reconciliation — run button + cron + matcher." The implementation creates an audit flag for each `stripePaymentIntent` with `paymentId: null` but never attempts to link the intent to an order/payment. The matcher half is missing. Orphaned intents accumulate as flags forever; staff get no actionable match, only a count.

### MIN-8 — `season-auto-flip` cron log records scheduled IDs that were not necessarily opened
- **Source:** [Q] quality RQ-007
- **Where:** `lib/seasons.ts` `autoOpenScheduledSeasons` lines 22–30.
- **Claim:** `cronRunLog.details.openedSeasonIds` is copied from the read query, but the subsequent `updateMany` may skip seasons a manager manually opened in the gap. `opened.count` is the real number of rows updated; `openedSeasonIds` is the pre-update read set, which can be larger. Audit log can show a season as auto-opened when it was actually opened manually.

### MIN-9 — Inventory is reserved but never consumed on pickup/delivery
- **Source:** [Q] quality RQ-008
- **Where:** `lib/checkout.ts` `reserveLineInventory` lines 223–238; `lib/delivery.ts` `stampPickedUp`, `deliverDriverStop`.
- **Claim:** `completeCheckout` increments `quantityReserved` and creates an `inventoryReservation`. No later step (pickup stamp, driver delivery, void) ever decrements `quantityReserved` or moves it to a consumed column. `quantityOnHand` never decreases. Reserved stock stays reserved indefinitely. Behavior is undocumented and inconsistent with typical inventory semantics.

### MIN-10 — `listAudits` loads the entire audit table with no pagination
- **Source:** [Q] quality RQ-009
- **Where:** `lib/staff-store.ts` `listAudits` lines 142–146.
- **Claim:** The audit list endpoint returns every `auditEvent` row ordered by `createdAt desc` with no `take`/`skip`. Over a season this table grows unbounded (every package, payment, print, import, and impersonation writes one), so the admin audit page will fetch and serialize the full set.

### MIN-11 — Inconsistent `where` reuse in `packageDashboard`
- **Source:** [R] rules RR-1
- **Where:** `lib/package-operations.ts:120-145`.
- **Claim:** A `where` const is declared on line 121 and used by `count` (123) and the totals `findMany` (142), but the paginated `findMany` re-inlines `where: { isActive: true }` on line 125. One pattern per concern (clean-code § Consistency).

### MIN-12 — Indentation drift inside the paginated `findMany` in `packageDashboard`
- **Source:** [R] rules RR-2
- **Where:** `lib/package-operations.ts:124-140`.
- **Claim:** `where`/`include`/`orderBy` sit at 4 spaces while `skip`/`take` and the sibling `findMany` body use 6. Mixed formatting in a single object literal.

### MIN-13 — Duplicated initial-fetch logic in packages page (`load()` vs `useEffect`)
- **Source:** [R] rules RR-6
- **Where:** `app/admin/packages/page.tsx:44-83`.
- **Claim:** `load(page, signal?)` already accepts an optional `AbortSignal` (line 44), yet the `useEffect` (68-83) re-implements the fetch+abort instead of calling `void load(1, controller.signal).catch(...)`. Most avoidable of the three admin-page duplications. Clean-code L-1 did not list the packages page, so this stands alone.

### MIN-14 — Inconsistent error-message fallback in `postJson`
- **Source:** [R] rules RR-7
- **Where:** `app/admin/packages/page.tsx:54-66`.
- **Claim:** `postJson` does `setMessage(body.error)` (62) with no `??` fallback, while the sibling `load` (48) uses `body.error ?? "Packages could not be loaded."`. A server error with no body renders the literal string `"undefined"` to the user.

### MIN-15 — Duplicated initial-fetch logic in reports page (`load()` vs `useEffect`)
- **Source:** [R][C] rules RR-4 + clean-code L-1 (merged)
- **Where:** `app/admin/reports/page.tsx:22-53`.
- **Claim:** `load()` (22-31) and the `useEffect` (33-53) both GET `/api/admin/reports` and set the same five state vars. The effect re-implements the fetch with an AbortController instead of calling `load(signal)`. Line-for-line duplicated `set*` calls.

### MIN-16 — Duplicated initial-fetch logic in seasons page (`load()` vs `useEffect`)
- **Source:** [R][C] rules RR-5 + clean-code L-1 (merged)
- **Where:** `app/admin/seasons/page.tsx:18-45`.
- **Claim:** `load()` (18-25) and the `useEffect` (27-45) re-issue the same fetch and the same `setState` + `setTargetSeasonId` chain. Same shape as MIN-15.

### MIN-17 — Duplicated storefront draft-session logic across components
- **Source:** [C] clean-code L-2
- **Where:** `app/components/order-builder.tsx:54, 77-81, 112` vs `app/components/checkout-flow.tsx:16, 30-31, 58-62`; `lib/order-builder.ts:145`.
- **Claim:** Both client components independently define `const storageKey = "tomchei-order-draft"` and re-implement the sessionStorage read + `x-draft-access-token` header construction. Server side reads the same header name as a literal string — a third copy of the magic string. No shared `useDraftSession` hook or `lib/draft-session.ts` helper.

### MIN-18 — Near-duplicate `.admin-alert` and `.notice` CSS rules
- **Source:** [C] clean-code L-3
- **Where:** `app/styles.css:27` and `app/styles.css:31`.
- **Claim:** Two classes express the same "highlighted alert banner" intent with slightly different values. Same colors and border, different margin/padding shorthand — the two classes should be one token.

### MIN-19 — `centsToDollars` is a dead alias for `formatMoney`
- **Source:** [C] clean-code L-4
- **Where:** `lib/foundation.ts:14`.
- **Claim:** `export const centsToDollars = formatMoney;` provides a second name for the same function. Grep shows `formatMoney` is used widely and `centsToDollars` has no call sites in the workspace — dead alias.

## Nit (noted, no fix required)

### NIT-1 — `approveLegacyAddress` does not require `reviewStatus === "PENDING"`
- **Source:** [S] security I-1
- **Where:** `lib/reporting.ts` lines 305–316.
- **Claim:** `transaction.address.update({ where: { id: addressId }, data: { reviewStatus: "APPROVED", ... } })` updates any address by cuid regardless of current status. Re-approving an already-approved address just rewrites `reviewedAt`. No security impact beyond redundant audit entries; the route is `imports.manage` gated.

## Dedupe notes

- **MAJ-7** merges security I-2 (naive `parseCsv`, info) and clean-code H-1 (two competing CSV parsers, high) — same location `lib/admin-operations.ts:33`, same root claim. Severity taken from the higher (clean-code structural) framing; security's "no injection path" note preserved in the claim text.
- **MAJ-5** merges quality RQ-003 and rules RR-3 — same location `lib/package-operations.ts:141-144`, same claim (full-table load for totals).
- **MIN-15** merges rules RR-4 and the reports-page portion of clean-code L-1 — same location `app/admin/reports/page.tsx:22-53`, same claim.
- **MIN-16** merges rules RR-5 and the seasons-page portion of clean-code L-1 — same location `app/admin/seasons/page.tsx:18-45`, same claim. Clean-code L-1 spanned two pages; split by location and merged each with the matching rules finding.
- No other cross-source duplicates. Security findings are otherwise disjoint from quality/rules/clean-code locations.
- No new findings introduced during aggregation.
