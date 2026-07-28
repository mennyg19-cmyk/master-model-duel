# Tomchei Shabbos — Mishloach Manos platform (arm-06, phase P3)

Public storefront + admin catalog/settings on the P2 domain core: Next.js (App Router, RSC) + Prisma + Postgres.

## Ports

- Web: **3106** (`npm run dev` / `npm start`)
- DB: **4106** (embedded Postgres, data in `.pgdata/`)

## Run it

```powershell
npm install
npm run db:start          # leave running; embedded Postgres on 4106
npx prisma migrate dev    # apply migrations
npm run seed              # baseline seed (settings, seasons, products, add-ons, demo customer)
npm run gen:env-example   # regenerate .env.example from lib/env-spec.ts
npm run build
npm start                 # serves on 3106
```

Copy `.env.example` to `.env` and fill values. A missing/invalid variable fails startup with a clear message (validated in `lib/env.ts` at boot).

## What P3 ships

- **Storefront shell** — sticky header (desktop links + hamburger sheet + user menu placeholder), closed-season banner, footer with mission/contact/hours links and the newsletter signup.
- **Homepage** — mission hero, live impact bar (cumulative counts from the DB: packages delivered, orders fulfilled, families served), how-it-works, testimonials, store-open-aware CTAs ("Order" only when a season is OPEN).
- **Catalog** — `/packages` current-season grid with category filters, price sort, sold-out badges (reserve-aware stock math), quick-view dialog; `/packages/[slug]` detail with option pricing that updates the displayed total live.
- **Archive** — `/past-collections` browses CLOSED seasons' catalogs (read-only, no buy buttons).
- **Gate stubs** — `/order`, `/checkout`, `/account` enforce season closure; `/checkout` includes the live delivery-ZIP checker (`/api/delivery-check` reads the settings allowlist per request).
- **Newsletter** — `POST /api/subscribe` (upsert), token-verified `/unsubscribe` page (three independent preference states + unsubscribe-all), HMAC-signed 30-day links (`lib/newsletter/tokens.ts`).
- **Admin catalog** — `/admin/products` (season select, create/edit, options upsert editor, replacement-link editor, per-product add-on restrictions), `/admin/addons`, `/admin/media` (upload, assign, delete).
- **Settings hub** — `/admin/settings` with Orders (package types + pickup locations), Shipping (delivery-ZIP allowlist, fees, rules), Email (P11 placeholder), Developer (storage driver, API-keys placeholder) tabs.

## Auth: dev-auth bypass (documented test seam)

**Clerk is NOT installed** — no `@clerk/*` packages, no Clerk middleware. Live Clerk keys were unobtainable on this host, so P1 ships a dev-auth provider behind the seam Clerk will occupy. This is a documented deviation from the P1 plan, not a silent stand-in.

- Session = HMAC-signed cookie (`lib/session-codec.ts`, Web Crypto — the Clerk swap point) with a **server-side `AuthSession` row** (12h `expiresAt`, `revokedAt`). A cookie alone is never enough: `getAuthContext` validates the session row on every request; logout and staff-revoke revoke rows server-side.
- Constant-time signature compare; `AUTH_SECRET` requires 32+ chars.
- `DEV_AUTH_BYPASS=true` enables `/dev-login` (pick any active staff account) and `/api/dev-auth`. With the flag off, both 404 and `requireStaff` redirects to `/`.
- Every role/permission check still runs against the real `StaffUser` row + overrides.
- Clerk integration point: replace the codec + `/dev-login` with Clerk middleware and map Clerk session claims onto the `AuthContext` shape; `lib/auth.ts` callers stay unchanged.

## Media storage seam (R-180)

Uploads validate type/size/extension in `lib/media/validation.ts`, then store through `lib/media/storage.ts`:

- `BLOB_READ_WRITE_TOKEN` set → Vercel Blob (lazy-loaded, like the Stripe seam).
- Not set → local driver writes `.uploads/` and serves bytes via `app/uploads/[name]/route.ts` (strict UUID-name pattern, immutable caching).

The active driver is shown on `/admin/media` and the Developer settings tab.

## Patterns (one per concern — clean-code rule)

| Concern | Choice |
|---|---|
| Mutations | API routes under `/api/**` + `apiFetch` (`lib/api-fetch.ts`) from client components |
| Auth gates | `requireStaff` / `requirePermission` (pages) and `requireApiPermission` (routes) |
| Permissions | `lib/permissions.ts` — deny override > grant override > role default |
| API errors | inline `NextResponse.json({ error }, { status })`; client errors POST to `/api/client-error` |
| Body parsing | `parseBody(request, schema, message)` (`lib/parse-body.ts`) → 400 on bad JSON/schema |
| Sessions | `issueSessionResponse` / `clearSessionResponse` / `createLoginSession` (`lib/auth.ts`) |
| HMAC | `lib/hmac.ts` — session codec and newsletter tokens share sign/verify + base64url |
| Money | integer cents everywhere; `lib/money.ts` is the only dollar↔cent conversion point |
| Styling | Tailwind v4 tokens in `app/globals.css` `@theme`; minimal kit in `components/ui/` |
| Settings | typed key-value store (`lib/settings.ts`) — each key has its own zod schema |
| Catalog queries | `catalogProductInclude` (`lib/storefront/catalog.ts`) shared by grid/quick-view/detail |
| Concurrency | optimistic `version` column on `StaffUser` and `InventoryItem` |

## Navigation exceptions

`app/not-found.tsx` and `app/forbidden.tsx` link to `/` ("Back to home") as an explicit exception: these screens have no meaningful "where you came from" target.

## CI

`npm run ci` = lint + typecheck + migration-guard + unit tests (`scripts/test-*.mts`: permissions, grouping, state machine, P3 helpers) + DB-integration tests (order numbers, inventory race, payments, package stages, constraints — needs the embedded DB running).
`npm run concurrency-smoke` (app running): 10 concurrent versioned updates → 1 win, 9 conflicts.
