# Tomchei Shabbos — Mishloach Manos platform (arm-06, phase P1)

Foundation phase: identity, roles, permissions, staff tooling on a Next.js + Prisma + Postgres scaffold.

## Ports

- Web: **3106** (`npm run dev` / `npm start`)
- DB: **4106** (embedded Postgres, data in `.pgdata/`)

## Run it

```powershell
npm install
npm run db:start          # leave running; embedded Postgres on 4106
npx prisma migrate dev    # apply migrations
npm run seed              # baseline seed (settings + demo customer, never staff)
npm run gen:env-example   # regenerate .env.example from lib/env-spec.ts
npm run build
npm start                 # serves on 3106
```

Copy `.env.example` to `.env` and fill values. A missing/invalid variable fails startup with a clear message (validated in `lib/env.ts` at boot).

## Auth: dev-auth bypass (documented test seam)

**Clerk is NOT installed** — no `@clerk/*` packages, no Clerk middleware. Live Clerk keys were unobtainable on this host, so P1 ships a dev-auth provider behind the seam Clerk will occupy. This is a documented deviation from the P1 plan, not a silent stand-in.

- Session = HMAC-signed cookie (`lib/session-codec.ts`, Web Crypto — the Clerk swap point) with a **server-side `AuthSession` row** (12h `expiresAt`, `revokedAt`). A cookie alone is never enough: `getAuthContext` validates the session row on every request; logout and staff-revoke revoke rows server-side.
- Constant-time signature compare; `AUTH_SECRET` requires 32+ chars.
- `DEV_AUTH_BYPASS=true` enables `/dev-login` (pick any active staff account) and `/api/dev-auth`. With the flag off, both 404 and `requireStaff` redirects to `/`.
- Every role/permission check still runs against the real `StaffUser` row + overrides — smoke S3–S6 exercise the gates, not the bypass.
- Clerk integration point: replace the codec + `/dev-login` with Clerk middleware and map Clerk session claims onto the `AuthContext` shape; `lib/auth.ts` callers (`requireStaff`/`requirePermission`) stay unchanged.

## Patterns (one per concern — clean-code rule)

| Concern | Choice |
|---|---|
| Mutations | API routes under `/api/**` + `apiFetch` (`lib/api-fetch.ts`) from client components |
| Auth gates | `requireStaff` / `requirePermission` (pages) and `requireApiPermission` (routes) |
| Permissions | `lib/permissions.ts` — deny override > grant override > role default |
| API errors | inline `NextResponse.json({ error }, { status })`; routes return `ApiGate` unions from `requireApiPermission`; client errors POST to `/api/client-error` (bounded, redacted, rate-capped) |
| Body parsing | `parseBody(request, schema, message)` (`lib/parse-body.ts`) → 400 on bad JSON/schema |
| Sessions | `issueSessionResponse` / `clearSessionResponse` / `createLoginSession` (`lib/auth.ts`) — the only cookie paths |
| Styling | Tailwind v4 tokens in `app/globals.css` `@theme`; minimal kit in `components/ui/` |
| Settings | typed key-value store (`lib/settings.ts`) |
| Concurrency | optimistic `version` column on `StaffUser`; stale writers get 409 |

`lib/` holds only modules with live callers. Money/id/phone/date helpers land with the phase that first uses them (P2+), not before.

## Navigation exceptions

`app/not-found.tsx` and `app/forbidden.tsx` link to `/` ("Back to home") as an explicit exception: these screens have no meaningful "where you came from" target.

## CI

`npm run ci` = lint + typecheck + migration-guard + permission unit tests.
`npm run concurrency-smoke` (app running): 10 concurrent versioned updates → 1 win, 9 conflicts.
