# P10 Security Review — arm-03 (blind)

**Reviewer:** external security specialist
**Phase:** P10 — Seasons, repeat orders, replacement mappings
**Scope:** trust boundaries, auth, secrets, IDOR, injection, season scoping, cron auth
**Mode:** findings only — no fixes

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 3 |
| Low | 8 |
| Info | 2 |
| **Total** | **14** |

Output path: `runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/results/reviews/P10-security-arm-03.md`

---

## High

### H-1 — Cron routes blocked by Clerk middleware in production (P10 S2 broken)

**Files:** `src/middleware.ts`, `src/app/api/cron/season-auto-flip/route.ts`, `src/app/api/cron/season-flip/route.ts`, `src/lib/cron/auth.ts`

The `isPublic` matcher in `src/middleware.ts` does not include `/api/cron(.*)`. In Clerk mode (production default per `src/lib/env.ts`), the `clerkHandler` runs `await auth.protect()` for every non-public route. `/api/cron/season-auto-flip` and `/api/cron/season-flip` are non-public, so an external scheduler presenting only `Authorization: Bearer <CRON_SECRET>` is rejected by Clerk (401) before the route handler ever runs. `requireCronBearer` is effectively dead code in production.

Why it matters: P10 S2 requires "scheduled auto-flip opens season at configured time." The smoke passes only because `AUTH_MODE=dev` short-circuits the middleware (`if (process.env.AUTH_MODE === "dev") return NextResponse.next()`). In production the auto-flip never fires, so seasons stuck in `CLOSED` with a past `scheduledOpenAt` stay closed, and open seasons with a past `scheduledCloseAt` stay open.

Fix direction (not applied): add `/api/cron(.*)` to `isPublic` so the bearer check is the sole gate, matching the documented R-182 design.

---

## Medium

### M-1 — Customer repeat can create drafts in CLOSED seasons (season-scoping bypass)

**Files:** `src/app/api/account/orders/[id]/repeat/route.ts`, `src/lib/ops/repeat.ts`, `src/lib/seasons/manage.ts` (`resolveTargetSeason`)

The customer repeat confirm endpoint accepts `targetSeasonId` in the body and passes it to `confirmRepeatOrder` → `resolveTargetSeason`, which does `db.season.findUniqueOrThrow({ where: { id } })` with no status check. `createDraftFromChoices` then creates the `Order` with `seasonId: target.id` regardless of whether the season is `OPEN` or `CLOSED`.

Even without supplying `targetSeasonId`, `resolveTargetSeason` falls back to `db.season.findFirstOrThrow({ orderBy: { year: "desc" } })` when no `OPEN` season exists — which returns a `CLOSED` season. So a signed-in customer can repeat a prior order into an archived season whenever the store is closed.

The middleware season gate only rewrites `/order/*` page routes (`enforceOrderSeasonGate`). `/api/account/orders/[id]/repeat` is not an order route, so the gate never sees it. The repeat path is the only customer-facing write into a season and it has no `status === OPEN` invariant.

Why it matters: defeats the UR-008 Open/Closed gate for the repeat flow; drafts land in archived seasons with active products, and downstream checkout (`/api/checkout/*` is public in middleware) may or may not re-check season status.

### M-2 — Prior-year-stub endpoint is production-reachable, creates fake PAID orders

**Files:** `src/app/api/admin/imports/prior-year-stub/route.ts`, `src/lib/ops/prior-year-stub.ts`

The route is gated by `requirePermission("settings.write")` (manager) but has no `AUTH_MODE === "dev"` / `NODE_ENV` guard, unlike `src/app/api/dev/session/route.ts` which correctly returns 404 outside dev. `seedImportedPriorYearOrder` creates an `Order` with `status: PAID`, `paymentStatusCached: PAID`, a hardcoded `customer@tomchei.local` lookup, and a random `orderNumber`. The audit entry is written with no `actorId` (`writeAudit({ action: IMPORT_COMMITTED, meta: {...} })`), so the seeder is unattributed.

Why it matters: a manager in production can mint historical paid orders that pollute reporting, reconciliation, and repeat-from-history (the very P10 S3 flow this stub feeds). The unattributed audit makes it hard to detect.

### M-3 — Audit attributes impersonated staff, not the real actor

**Files:** `src/lib/auth.ts` (`getStaffContext`), `src/lib/seasons/manage.ts`, `src/app/api/admin/seasons/route.ts`, `src/app/api/admin/season-gate/route.ts`, `src/app/api/admin/catalog/route.ts`

`requirePermission` returns `ctx.effectiveStaff` which is the impersonated staff when an `ImpersonationSession` is active. Season, season-gate, and catalog routes all pass `ctx.effectiveStaff.id` as `actorId` to `writeAudit`. The impersonator's identity is only recorded in the separate `IMPERSONATION_STARTED` audit entry — the per-action audit row names the impersonated user as the actor.

Why it matters: under impersonation, the audit log shows the lower-privileged staff "doing" the season flip / catalog change, not the manager who drove it. Reconstructing "who actually did this" requires correlating impersonation sessions, which is fragile. `requireActorPermission` exists (used by `/api/impersonate`) but is not used for the season/catalog write paths.

---

## Low

### L-1 — Customer-initiated repeat audit has null actorId

**File:** `src/lib/ops/repeat.ts` (`confirmRepeatOrder`)

`writeAudit({ actorId: input.actorStaffId ?? null, ... })`. Customer repeats pass `actorCustomerId` but no `actorStaffId`, so `actorId` is `null`. The audit row records `meta.mode: "customer_confirm"` but not which customer. There is no way to attribute a customer repeat to the acting customer from the audit log alone.

### L-2 — Cron auto-flip has no concurrency guard

**File:** `src/lib/seasons/manage.ts` (`applyScheduledSeasonFlips`)

`dueOpen` and `dueClose` are read with `findMany` outside the per-season transaction. Two concurrent cron invocations see the same due list and both enter transactions. The `updateMany` that closes other `OPEN` seasons and the `update` that opens the target serialize on row locks, but the read-side snapshot is shared. In REPEATABLE READ (or just unlucky timing) both can open different seasons and the close-others step may not see the other's commit, leaving two `OPEN` seasons. No `pg_advisory_xact_lock` guards the run.

### L-3 — Season slug charset not validated

**Files:** `src/app/api/admin/seasons/route.ts` (POST schema), `src/lib/seasons/manage.ts` (`slugify`)

The route schema accepts `slug: z.string().min(1).max(60).optional()` with no character class. `createSeason` uses `input.slug?.trim() || slugify(...)` — a caller-supplied slug is stored verbatim after trim. Slugs surface in `/archive/[slug]` URLs. A slug containing spaces, slashes, or punctuation is stored and routed. No SQL injection (Prisma parameterizes), but URL/path handling and archive link generation can produce surprising routes.

### L-4 — Guest-token secret falls back to NEWSLETTER_HMAC_SECRET

**File:** `src/lib/orders/guest-token.ts` (`secret()`)

`secret()` returns `DRAFT_ACCESS_SECRET || NEWSLETTER_HMAC_SECRET`. If `DRAFT_ACCESS_SECRET` is unset in a deploy, draft access tokens are HMACed with the newsletter secret — cross-purpose secret reuse. A newsletter secret leak then also forges draft tokens, and rotating one invalidates the other. `.env` does set `DRAFT_ACCESS_SECRET`, but the fallback is a latent footgun.

### L-5 — `scheduleSeasonFlip` audit is not atomic with the update

**File:** `src/lib/seasons/manage.ts`

`scheduleSeasonFlip` runs `db.season.update(...)` then `writeAudit(...)` outside any transaction. If the audit write fails, the schedule is changed with no audit record. Compare `createSeason` / `setSeasonStatus` which write audit inside the `$transaction`.

### L-6 — CSV import stores raw cells; formula injection on re-export

**File:** `src/lib/ops/import.ts` (`parseCsv`, `classifyCustomerRows`, `classifyProductRows`)

The custom CSV parser trims cells but stores `displayName`, `email`, `phone`, `sku`, `name` verbatim in `ImportRow.raw` and later in `Customer` / `Product`. No prefix-stripping for `=`, `+`, `-`, `@`, `\t` that spreadsheet apps treat as formula triggers. React rendering is escaped (no XSS), but any later CSV/Excel export of customers or products becomes a formula-injection vector.

### L-7 — Middleware internal-fetch amplification on every `/order/*` request

**File:** `src/middleware.ts` (`enforceOrderSeasonGate`)

Each `/order/*` request triggers `fetch("/api/storefront/status", { cache: "no-store" })` from inside the middleware. That fetch re-enters the middleware (the status route is public, so it short-circuits, but the round-trip still happens). Every storefront order view costs an extra internal HTTP request plus a DB read for season + delivery zips. An attacker hitting `/order/*` amplifies load two- to threefold. The status result should be cached or resolved in-process.

### L-8 — Prior-year-stub `orderNumber` is random and collision-prone

**File:** `src/lib/ops/prior-year-stub.ts`

`orderNumber: 900000 + Math.floor(Math.random() * 9000)` in a season where `@@unique([seasonId, orderNumber])` holds. Repeated stub invocations (or a clash with a real order number in that range) throw `P2002` and the whole `Order` insert rolls back. Non-deterministic and untested. Use the season's `nextOrderNumber` counter like `finalizeOrder` does.

---

## Info

### I-1 — Staff bulk repeat also lands in a closed season when no season is open

**File:** `src/lib/ops/repeat.ts` (`bulkRepeatOrders`)

Same root cause as M-1: `resolveTargetSeason` falls back to the latest season regardless of status. Staff-initiated, so trusted, but inconsistent with the UR-008 gate and worth fixing alongside M-1.

### I-2 — Staff single repeat allows arbitrary `targetSeasonId` (incl. closed)

**File:** `src/app/api/admin/orders/[id]/repeat/route.ts`

The admin repeat route forwards `body.targetSeasonId` to `repeatOrder` / `confirmRepeatOrder` with no status check. Staff-trusted, but the API has no invariant that the target season is `OPEN`, so the season-gate contract is only enforced at the page middleware, not at the order-creation layer.

---

## Notes on what was checked and looked clean

- Customer ownership check in `/api/account/orders/[id]/repeat` (`assertOwnsOrder` does `findFirst({ where: { id, customerId } })`) — no IDOR.
- `loadDraftForAccess` uniform 404 (never reveals draft existence cross-principal); guest token cookie is httpOnly+secure, hash compared with `timingSafeEqual`.
- `requireCronBearer` itself uses `timingSafeEqual` with length check — correct; the problem is the middleware layer above it (H-1).
- Dev auth: `getAuthIdentity` returns `null` when `NODE_ENV === "production"` even if `AUTH_MODE=dev`; `dev/session` returns 404 in production. Defense in depth is present.
- `canImpersonate` enforces strictly-lower role and no permission escalation; `requireActorPermission` used for impersonate start/stop.
- Optimistic concurrency on bulk status / bulk repeat uses `lockOrderForUpdate` + `updateMany` with version guard — correct.
- `linkOrCreateCustomer` refuses to link by email unless `emailVerified` and refuses emails that collide with `StaffUser`.
- Setup bootstrap uses an `AppSetting` lock row with a unique key to make first-manager-creation atomic.
- Prisma parameterization everywhere — no raw SQL injection except the parameterized `listAudit` raw query, which uses `Prisma.sql` / `Prisma.join` for bound values.
