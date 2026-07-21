# P9 Fix Notes — arm-03

**Phase:** P9 fix pass (aggregate blockers + prioritized majors/minors)
**Workspace:** `arms/arm-03/workspace/`
**Smoke:** re-run `npm run smoke:p9` → **5/5 PASS**

## Fixed

| ID | What changed |
|---|---|
| **B1** | Added `/d(.*)` and `/api/driver(.*)` to middleware public allowlist so magic-link drivers work under default `AUTH_MODE=clerk` (no Clerk session). |
| **B2** | `confirmReroute` now loads the route by `id` + `seasonId`, rejects missing/cross-season routes, and only accepts `DRAFT` / `ASSIGNED` / `IN_PROGRESS` (blocks `COMPLETED`). |
| **B3** | `reassignRoute` revokes all active `DriverMagicLink` rows in the same transaction. `issueMagicLink` already revoked on rotate; smoke S1 now asserts rotation revokes the prior link. |
| **B4** | Confirmed/kept label void inside the same `$transaction` as method switch + `RouteStop` create (via `voidLabelForPackage({ tx })`). Route validation (B2) runs *before* void so FK/status failures no longer void-then-orphan. Shippo HTTP void remains irreversible by nature of the external API. |
| **B5** | `markStopDeliveredFromPrint` requires a matching route PIN when `pinHash` is set (401 on mismatch). API accepts `pin`; smoke S2 asserts bad PIN rejected then good PIN delivers. |
| **M5** | Unassign (`driverStaffId: null`) from `ASSIGNED` reverts status to `DRAFT`. Added `remove-stop` action + `removeRouteStop` so packages can leave a route before switch-to-SHIP. |
| **M6** | `startRouteViaMagicLink` early-return for `IN_PROGRESS` now retries `sendDayOfNotifications` when `dayOfNotifiedAt` is still null. |
| **m1** | Cron bearer compare uses `crypto.timingSafeEqual` (length-checked buffers). |
| **smoke** | S1 asserts `rotationRevoked`; S2 creates route with PIN and checks print-deliver PIN gate. |

## Skipped (out of priority / larger refactors)

| ID | Why skipped |
|---|---|
| **M1** | Manual revoke endpoint — rotation/reassign now revoke; dedicated admin revoke API not required for gate. |
| **M2** | Absolute issuance TTL — schema has no `expiresAt`; would need migration. |
| **M3** | PIN KDF (bcrypt/argon2) — larger crypto migration; not blocker. |
| **M4** | PIN throttle hardening / AuditLog — events already recorded; backoff redesign deferred. |
| **M7** | Admin UI for pickup/bulk/reassign — API-complete; UI scope too large for fix pass. |
| **M8** | God-file split of `service.ts` — deferred (behavior fixes first). |
| **M9–M15** | Dedup / workflow scratch / handler wrappers / client type drift — non-blocking clean-code. |
| **m2–m31** | Remaining minors except **m1** — hardening/docs/smoke-weakness; not prioritized. Partial smoke integrity: S1 rotation + S2 PIN covered; S5 door-list self-patch (m24) left as-is. |

## Files touched

- `src/middleware.ts`
- `src/lib/cron/auth.ts`
- `src/lib/routes/service.ts`
- `src/app/api/admin/routes/[id]/route.ts`
- `scripts/smoke-p9.mjs`

## Smoke result

| ID | Pass |
|---|---|
| S1 | PASS (`rotationRevoked: true`) |
| S2 | PASS (`pinRejected: true`) |
| S3 | PASS |
| S4 | PASS |
| S5 | PASS |

Evidence: `arms/arm-03/results/PHASE-P9-SMOKE.md` (copied from workspace `.scratch/` after re-run).
