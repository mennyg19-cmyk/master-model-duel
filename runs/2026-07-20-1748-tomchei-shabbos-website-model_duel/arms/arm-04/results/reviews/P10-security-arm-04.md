# P10 Security Review — arm-04 (blind)

**Phase:** P10 — Seasons management, repeat orders, replacement mappings
**Scope:** `arms/arm-04/workspace/` — P10 surface only (no P11–P12 features reviewed)
**Reviewer:** Security specialist, blind to model identity
**Reference:** `shared/phases/PHASE-P10-EXPECTED.md`, `kit/prompts/reviewer/review-security.md`
**Method:** Static read of routes, server actions, services, env spec, scratch smoke/STATUS. Findings only — no fixes proposed.

## Surface examined

- Season calendar + actions: `src/app/(admin)/admin/seasons/page.tsx`, `src/app/(admin)/admin/seasons/actions.ts`, `src/app/(admin)/admin/seasons/new/page.tsx`
- Season services: `src/lib/seasons/management.ts`, `src/lib/seasons/schedule.ts`, `src/lib/seasons/wizard.ts`
- Replacements admin: `src/app/(admin)/admin/catalog/replacements/page.tsx`, `src/app/(admin)/admin/catalog/replacements/actions.ts`, `src/app/(admin)/admin/catalog/[productId]/replacement-form.tsx`, `src/app/(admin)/admin/catalog/actions.ts`
- Replacement engine: `src/lib/catalog/replacements.ts`, `src/lib/catalog/admin.ts`
- Customer repeat: `src/app/(storefront)/account/orders/[orderId]/repeat/page.tsx`, `src/app/(storefront)/account/orders/[orderId]/repeat/actions.ts`, `src/app/(storefront)/account/orders/[orderId]/page.tsx`, `src/app/(storefront)/account/session.ts`
- Repeat services: `src/lib/orders/repeat-review.ts`, `src/lib/orders/repeat-plan.ts`, `src/lib/orders/repeat-order.ts`, `src/lib/orders/draft-access.ts`, `src/lib/orders/customer-orders.ts`
- Staff/bulk repeat: `src/app/(admin)/admin/customers/page.tsx`, `src/app/(admin)/admin/customers/actions.ts`, `src/lib/orders/bulk-actions.ts`, `src/lib/pos/counter.ts`
- Cron season-flip: `src/app/api/cron/season-flip/route.ts`, `src/lib/cron/authorize.ts`, `src/lib/cron/job-run.ts`
- Authz + env: `src/lib/auth/staff.ts`, `src/lib/auth/identity.ts`, `src/lib/auth/permissions.ts`, `src/lib/auth/signed-cookie.ts`, `src/lib/env-spec.ts`, `src/lib/http/store-gate.ts`
- Scratch evidence: `.scratch/PHASE-P10-STATUS.md`, `.scratch/PHASE-P10-SMOKE.md`

## Findings

### SEC-1 — `setSeasonSchedule` does not handle a missing season; fabricated id 500s
**Severity:** Low
**File:** `src/lib/seasons/schedule.ts:102–105`

`setSeasonSchedule` calls `db.season.update({ where: { id: input.seasonId } })` without first resolving the season. A manager POST with a fabricated or just-deleted `seasonId` throws Prisma `P2025`, which the action does not catch — it surfaces as a 500 to the actor and a noisy row in logs. The sibling `setSeasonStatus` (`management.ts:42–43`) handles the same miss explicitly and returns a clean failure. Not exploitable beyond log noise and an inconsistent error surface; the actor already holds `seasons.manage`.

### SEC-2 — `setSeasonStatus` reuses error code `SEASON_ALREADY` for "season not found"
**Severity:** Informational
**File:** `src/lib/seasons/management.ts:43`

A missing season returns `failure(SEASON_ALREADY, 'That season no longer exists.')`. The code is misleading — a caller branching on `SEASON_ALREADY` would treat a missing record as a no-op flip. No path does so today, so impact is nil, but the code name lies about the condition.

### SEC-3 — Cron season-flip persists first 200 chars of `error.message` into `CronRunLog.detail`
**Severity:** Informational
**File:** `src/lib/cron/job-run.ts:54–70`

`safeMessage` keeps the first line of `error.message` up to 200 chars. Database/driver errors can carry connection-string fragments or bound values in their message text. The `CronRunLog` table is read on the developer settings page (`settings.manage` — manager only) but that page renders only `jobName`, `status`, `startedAt`, `itemsProcessed` — not `detail`. So the stored string is reachable only with DB access. This is the same pattern P9 SEC-4 flagged for `pickup-service` and `payment-reminder`; the season-flip path is actually safer than those because it truncates, but the residual is the same: a sanitiser that strips known secret patterns would be more defensible than a length cap.

### SEC-4 — Cron season-flip has no replay or rate-limit protection
**Severity:** Informational
**File:** `src/lib/cron/authorize.ts:19–28`

The bearer secret is static; a captured `Authorization: Bearer <secret>` header can be replayed arbitrarily. The job is idempotent — `applyScheduledSeasonFlips` opens the newest due season and closes the rest in one transaction, so a replay does no damage beyond re-running the sweep. This is the standard cron-secret model and matches the P9 cron posture. Noted for completeness, not as a real attack vector.

### SEC-5 — `createSeasonFromWizard` with `linkReplacements` mutates products in the source (past) season
**Severity:** Informational
**File:** `src/lib/seasons/wizard.ts:170–177`

Creating 2028 with `linkReplacements` writes `replacedByProductId` onto 2027's product rows. The actor holds `seasons.manage` and an audit row is written, so this is authorized and traceable. Worth flagging because past-season catalogue data is mutable after the season has closed — a manager creating a new season rewrites history that repeat orders depend on. No security impact; data-integrity note.

## What was checked and found clean

- **Authz on seasons.manage.** Calendar, wizard, and all three actions (`setSeasonStatusAction`, `setSeasonScheduleAction`, `createSeasonAction`) call `requirePermission('seasons.manage')`. `seasons.manage` is manager-only and deliberately excluded from the STAFF role defaults. (`seasons/page.tsx:29`, `seasons/new/page.tsx:28`, `seasons/actions.ts:23,42,55`, `permissions.ts:41–50`)
- **Authz on replacements.** `/admin/catalog/replacements` page and `setMappingAction` require `catalog.manage`; the per-product `setReplacementAction` does the same. The catalog page link to replacements is rendered only after the page's own `catalog.manage` gate. (`replacements/page.tsx:28`, `replacements/actions.ts:20`, `catalog/actions.ts:52`)
- **IDOR on customer repeat — read path.** `readRepeatReview` calls `findOwnedOrder({ kind: 'customer', customerId }, sourceOrderId)`, and `ownerFilter` for a customer is `{ customerId, posStaffUserId: null }`. A signed-in customer guessing another's `orderId` gets the same "not one of yours" refusal as a missing id. Smoke S1f confirms. (`repeat-review.ts:37–42`, `draft-access.ts:106–112,161–163`)
- **IDOR on customer repeat — confirm path.** `confirmRepeat` re-runs `readRepeatReview` (and thus `findOwnedOrder`) before writing; the form's `sourceOrderId` is re-checked against ownership, not trusted from the page. (`repeat-review.ts:78–84`)
- **Decisions re-validated against the rebuilt plan.** `applyRepeatPlan` iterates over `plan.lines` (rebuilt fresh from the owned source order), so extra `lineId` values injected via the form are ignored. `productId` choices are checked against `plan.catalog` (the target season's active catalog) and refused with `REPEAT_UNKNOWN_CHOICE` if not found. `customerAddressId` is checked against `plan.addressBook` (built from `db.customerAddress.findMany({ where: { customerId, isArchived: false } })`), so a customer cannot inject another customer's address id. (`repeat-plan.ts:244–282`, `repeat-review.ts:115–140`)
- **Open-cart guard is transactional.** `confirmRepeat` looks for an existing draft and creates the new one inside one `runInTransaction`, so two concurrent confirms cannot both find no cart. The POS cart (`posStaffUserId: staff.acting.id`) is excluded from the customer's open-cart check, which is the intended two-carts design. (`repeat-review.ts:115–140`, `draft-access.ts:106–112`)
- **Staff repeat is season-scoped and till-scoped.** `repeatOrderAtCounter` builds the plan from an order id that came from `repeatLatestOrderForCustomer` (queried by `customerId`), and the open-cart check is keyed to `posStaffUserId: staff.acting.id` + `customerId`, so two staff members cannot collide on the same customer and a customer's own web cart is not visible to staff. (`repeat-order.ts:48–119`, `bulk-actions.ts:154–197`)
- **Bulk repeat authz.** `bulkRepeatHistoryAction` requires `orders.manage` (not `customers.view`); the customers page hides the bulk-repeat form from staff without `orders.manage` (`canSell`), and the action re-checks the permission, so a `customers.view`-only user cannot trigger it. (`customers/actions.ts:68–101`, `customers/page.tsx:35,121–130`)
- **Cron bearer gate.** `cronRequestIsAuthorized` refuses when `CRON_SECRET` is unset (safe default), requires `Bearer ` prefix, and compares SHA-256 digests with `timingSafeEqual` — constant-time and length-hiding. Env-spec enforces a 24-char minimum and rejects an unset secret off loopback. The route is POST-only, defeating browser/crawler prefetch. (`authorize.ts:19–28,64–66`, `season-flip/route.ts:13`, `env-spec.ts:293–312`)
- **Cron job body is unauthenticated by design.** `applyScheduledSeasonFlips` carries a doc comment stating it authenticates nobody and relies on the endpoint's bearer gate; the endpoint calls it only after `runCronJob` authorises. (`schedule.ts:26–33`, `season-flip/route.ts:13–15`)
- **Season flip invariant.** Both the manual switch and the scheduled sweep open at most one season and close the rest in one transaction, so the storefront never has two catalogues. A sweep that finds several due opens the newest and leaves the rest for a manager. (`management.ts:48–57`, `schedule.ts:37–68`)
- **Replacement link direction.** `setReplacementLink` rejects a replacement whose `season.year <= product.season.year`, so links only point forward — the chain walk cannot loop backwards. `resolveReplacements` caps hops at 8 and carries a `seen` set, so a mapping cycle resolves to "unmapped" rather than spinning. (`admin.ts:143–148`, `replacements.ts:39,98–131`)
- **Wizard product scoping.** `createSeasonFromWizard` filters `productIds` against the resolved source season's own products, so a manager cannot copy products from a season they didn't select. The source must exist and be earlier than the target year. (`wizard.ts:61–84`)
- **SQL injection.** All DB access is via Prisma `where` clauses or tagged-template `$queryRaw` / `$executeRaw` (parameterised). No `$queryRawUnsafe`, no string-interpolated SQL. The customer search `q` param flows through `customerSearchWhere` into Prisma `contains` / `mode: 'insensitive'` — no raw fragment. (`customers.ts:116–128`, `reserve.ts`, `payment-status.ts`, `offline-payments.ts`, `reroute.ts`)
- **Open redirect on `requireSignedInCustomer`.** The `next` parameter is hardcoded at each call site (`'/account/orders'`), not user-controlled, and is `encodeURIComponent`-escaped before being appended to the sign-in URL. (`session.ts:14–18`)
- **Cookie integrity.** Session and impersonation cookies are HMAC-SHA256 signed with `AUTH_SESSION_SECRET` (32-char min, weak-secret rejected) and compared with `timingSafeEqual`. Impersonation requires `staff.impersonate` held by the actor in their own right, not just the cookie. (`signed-cookie.ts:11–44`, `identity.ts:53–57`, `staff.ts:45–59`)
- **Store gate.** `requireOpenStore` returns 403 (via `forbidden()`) when no season is open; `readRepeatReview` checks `store.seasonIsOpen` before building a plan, so repeat-into-a-closed-season is refused at the service layer, not just the UI. (`store-gate.ts:20–24`, `repeat-review.ts:47–50`)

## Severity counts

- **Critical / High:** 0
- **Medium:** 0
- **Low:** 1 (SEC-1)
- **Informational:** 4 (SEC-2, SEC-3, SEC-4, SEC-5)
- **Total:** 5 findings

No exploitable authz, IDOR, or injection defect found on the P10 surface. The customer repeat path re-validates ownership and all submitted ids against a freshly rebuilt plan on both read and confirm; the cron season-flip reuses the P9 bearer gate and is POST-only; replacement and season admin are gated by the right manager-scoped permissions. The one Low finding is a missing-record 500 on the schedule action, and the rest are noted for completeness.
