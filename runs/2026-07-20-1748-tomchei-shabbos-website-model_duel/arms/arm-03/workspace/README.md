# Tomchei Shabbos — arm-03 (P10 seasons / repeat)

Ports: web **3103**, db **4103**.

## Patterns (one per concern)

| Concern | Choice |
|---|---|
| Auth | Clerk by default; local cookie bypass only with explicit `AUTH_MODE=dev` |
| Data | Prisma + Postgres |
| Validation | Zod (`src/lib/env.ts` + route bodies) |
| Styling | Tailwind + CSS variables (`src/lib/brand.ts`) |
| Errors | `Result` + `maskError` / `apiErrorResponse` |
| Season flips | Cron `GET|POST /api/cron/season-auto-flip` with Bearer `CRON_SECRET`; scheduled hourly via `vercel.json` |
| Repeat | Preview → middle review (replacements + recipients) → confirm draft |

## Quick start

```powershell
copy .env.example .env
npm run db:start
# other terminal:
npx prisma migrate deploy
npm run db:seed
npm run dev
npm run smoke:p10
```

## CI scripts

- `npm run lint`
- `npm run typecheck`
- `npm run ci:migrate-guard`
- `npm run test:permissions`
- `npm run test:concurrency`
- `npm run ci`

## Rule Preferences

- No Docker on this host → embedded Postgres via `npm run db:start` on port 4103.
- Set `AUTH_MODE=dev` explicitly for local smoke; unset/default is Clerk (fail closed without keys).
- Seasonal auto-flip timezone: server/org-local clock (UR-008 open question default).
