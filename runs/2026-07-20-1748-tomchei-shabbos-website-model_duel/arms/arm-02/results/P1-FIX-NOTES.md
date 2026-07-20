# P1 fix notes — arm-02

**Run:** 2026-07-20-1748-tomchei-shabbos-website-model_duel
**Input:** `results/AGGREGATE-REVIEW-P1.md` · **Scope:** single fix pass, no re-review
**Verification:** `npm run ci` green (lint, typecheck, migration guard, 6/6 unit tests); smoke S1–S5 re-run PASS with new assertions for A1/A2/A10 (`workspace/.scratch/PHASE-P1-SMOKE.md`, raw log `workspace/.scratch/smoke-output.log`).

## Fixed

| ID | Sev | Fix |
|---|---|---|
| A1 | blocker | New `lib/rate-limit.ts` (in-memory fixed window). Login throttled per-IP (20/15 min) and per-account (10/15 min); 429 on excess. Smoke: 11 bad logins → 401 ×10 then 429. |
| A2 | blocker | Role/status PATCH and override PUT now `session.deleteMany` for the target inside the mutation transaction — explicit invalidation, privilege change takes effect immediately. Smoke: stale cookie → 401 after role change. |
| A3 | major | Login `?next=` restricted to paths starting `/` and not `//`; anything else falls back to `/admin`. |
| A4 | major | Session cookie sets `secure: NODE_ENV === "production"`. |
| A5 | major | `SESSION_SECRET` is now used: session token lookup hash switched from plain SHA-256 to HMAC-SHA256 keyed by the secret. Rotating the secret revokes all sessions; env contract is accurate. |
| A6 | major | `/api/client-error`: per-IP rate limit (10/min) + control-character stripping (CR/LF, escapes) before logging. |
| A7 | major | `/api/health` failure path returns generic `database: "unreachable"`; raw error logged server-side only. |
| A9 | major | `writeAudit` accepts a `Prisma.TransactionClient`; setup bootstrap, staff create, role/status PATCH, and override PUT each wrap mutation + audit (+ session invalidation) in one `db.$transaction`. |
| A10 | major | `admin/layout.tsx` redirects to `/driver` whenever `actingAs.role === "DRIVER"`, including during impersonation. Smoke: `/admin` while impersonating a driver → 307 → `/driver`. |
| A11 | major | All `package.json` versions pinned exactly (from lockfile-installed versions); no `^` ranges remain. |
| A21 | minor | Override PUT audit detail now records `before` and `after` override lists (came free with the A9 rewrite). |
| A13 | major | No action needed — `.env.example` already exists in the workspace with all four documented vars (present before this pass). |

## Skipped (with reason)

- **A8** (email-based customer linking) — needs a verified-email/identity-proof design decision tied to the Clerk path that P1 cannot exercise (no keys); not a quick fix. Highest-priority carry-over.
- **A12** (middleware raw `process.env`) — importing `lib/env` into edge middleware risks edge-runtime validation failures for a one-line read; deferred.
- **A14–A20, A22–A46** (minors) — out of scope for a single fix pass per instructions; notable carry-overs: security headers (A19), audit action label on combined PATCH (A20), missing smoke assertions for self-target block and impersonation banner (A23, A25), session table indexes (A26).

## Smoke result

S1–S5 all PASS on fresh DB (port 3102), plus new fix-evidence checks for A1, A2, A10 — all PASS. Dev server and embedded Postgres stopped after the run.
