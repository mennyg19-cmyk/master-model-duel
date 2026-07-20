# Phase EXPECTED — P1

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P1 — Foundation, identity, roles, permissions, staff tooling.

## Must be true when phase is done

1. [ ] Next.js + TypeScript + Prisma + Postgres scaffold with route groups `(storefront)`, `(admin)`, `(driver)`; env validation + `.env.example`
2. [ ] Health check at `/api/health` returns green when DB connected
3. [ ] Clerk auth + middleware; StaffUser roles (Manager/Staff/Driver) with per-user permission grant/deny overrides
4. [ ] Customers are separate from staff (not in staff roles table); customer identity linking works
5. [ ] First-run setup page bootstraps first manager on empty DB then locks
6. [ ] Staff management UI: add users, assign roles, permission override editor; impersonation with banner + audit trail
7. [ ] Admin shell with permission-gated sidebar; Staff without permission gets 403 on gated pages
8. [ ] Design system baseline (shadcn-style kit, tokens, brand constants); global error page
9. [ ] CI scripts: lint, typecheck, migration guard; baseline seed runs
10. [ ] Concurrency smoke: versioned updates report conflicts (10 concurrent updates test)

## Smoke

| # | Check | How |
|---|---|---|
| S1 | App responds | `GET http://127.0.0.1:{WEB_PORT}/` → 200 |
| S2 | Health | `GET http://127.0.0.1:{WEB_PORT}/api/health` → 200 + DB ok |
| S3 | Auth gate | Staff without permission → 403 on protected admin route |
| S4 | Bootstrap | Empty DB → setup creates manager → setup locks |
| S5 | Audit | Role change + impersonation appear in audit log |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P1-SMOKE.md`

## Out of scope this phase

- Business catalog, ordering, checkout, fulfillment, shipping, email campaigns
- Package entity UI (schema may land in P2 only)
