# arm-06 — Test 4 / P1 build (with_review, first pass): COMPLETE

- Shipped: Next.js 15 + TS + Prisma + embedded Postgres (4106) scaffold; route groups `(storefront)`/`(admin)`/`(driver)`; zod env validation + generated `.env.example`; `/api/health`; first-run `/setup` bootstrap with lock; staff management (add via invite-confirm, roles, grant/deny override editor, self-target blocks, revoke); impersonation with banner + stop; audit log; permission-gated admin shell with 403s; design tokens + minimal shadcn-style kit; global error page + bounded client-error endpoint; baseline seed.
- Auth: documented dev-auth bypass (no live Clerk keys); Clerk swap point isolated in `lib/session-codec.ts`. All gates enforced on real DB rows.
- Smoke S1–S5: **all PASS** on 2026-07-28 (evidence: `workspace/.scratch/PHASE-P1-SMOKE.md`, raw transcript in `workspace/.scratch/smoke/`).
- CI: lint clean, typecheck clean, migration-guard ok, permission tests 7/7, concurrency smoke 1 win + 9 × 409.
- App left running for review: web 3106 (`npm start`), db 4106 (`scripts/db-start.mjs`).
- Full checklist: `workspace/.scratch/PHASE-P1-STATUS.md`.
