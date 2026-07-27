# Test 6 — Vague fix notes (arm-04)

Worked from the five symptom descriptions only. No DETECT file, no bug ledger, no git, no
other arm's tree. Ports 3104 (web) / 4104 (db).

## Fixes

### 1. Per-package delivery turned in-zone customers away (and let out-of-zone through)

`lib/checkout/fees.ts:84` — the hard ZIP block tested `config.deliveryZips.includes(zip)`,
so being **on** the delivery list was treated as being outside it. Inverted the test to
`!config.deliveryZips.includes(zip)`. The storefront already had it the right way round
(`components/checkout/checkout-form.tsx` computes `inZone` and disables the method when
`!inZone`), so the server was the odd one out.

Evidence: `tests/checkout-fees.test.ts` — "per-package delivery hard-blocks out-of-zone
zips" (99999 refused) and "per-package delivery bills per recipient and requires a day"
(08701 accepted, 3 fees) both pass.

### 2. Shipping charge matched the cheapest carrier, so margin was zero

`lib/shipping/margin.ts:30` — `chargeCents` read `perCarrierBest[0]`, which after the
ascending sort is the same rate the label is bought on: charge == buy, spread always 0.
The documented pricing rule (README "Shipping (Shippo + margin engine)", and this file's
own header comment) is charge the **highest** carrier's best rate and buy the cheapest, so
the charge now reads the last element of the sorted list.

Evidence: `tests/shipping-margin.test.ts` — charge 1900 vs buy 1100 across FedEx/UPS/USPS,
and the single-carrier case still charges 1000 with 0 margin.

### 3. Checkout / quote APIs accepted requests with no browser origin

`lib/public-guard.ts:22` — `isSameOrigin` fell through to `return true` when a request
carried neither `Origin` nor `Referer`, which is exactly the curl / server-side shape the
guard exists to stop (the function's own doc comment says such requests are refused).
Changed the fall-through to `return false`. Stripe webhooks are unaffected: they are
signature-authenticated and never pass through `guardPublicEndpoint`.

Added `tests/public-guard.test.ts` (4 cases: no headers, foreign Origin, foreign Referer,
own Origin/Referer, unparseable Referer) so this cannot silently flip back.

### 4. Pay button posted to a route that does not exist

`components/checkout/checkout-form.tsx:109` — `placeOrder` posted to
`/api/checkout/start`. The order-placing handler lives at `app/api/checkout/route.ts`
(`POST /api/checkout`); there is no `start` segment, hence the 404 and the missing
redirect. The quote call on line 79 already used the correct `/api/checkout/quote`.
Pointed the pay call at `/api/checkout`.

### 5. Driver magic link skipped its PIN

`lib/routes/driver-access.ts:26` — the PIN branch read
`if (!pinCookieValid(...) && false)`, so the `pin_required` result was unreachable and
possession of the URL was enough for both the `/d/[token]` page and the driver APIs.
Dropped the `&& false`. `verifyPin` and the cookie minting were already correct, so the
real PIN flow needed no other change.

## Clone artifacts fixed (not product bugs)

- `package.json` had a UTF-8 BOM, which breaks Prisma's config read — stripped, as
  instructed.
- `package.json` `migration:guard` pointed its shadow database at port **4102** (another
  arm's cluster). Repointed to this arm's **4104** so the guard cannot reach outside this
  workspace.
- `.env` had no `APP_URL`, so the same-origin check fell back to the schema default
  `http://127.0.0.1:3102` and would have rejected this arm's own storefront on 3104 once
  fix 3 made the guard strict. Added `APP_URL=http://127.0.0.1:3104`.

## Verification

`npm run ci` (lint + typecheck + prisma migration guard + unit tests): **pass, 82/82
tests** (78 existing + 4 new origin-guard cases). `npm run smoke:concurrency`: **PASS**
(10 concurrent updates → 1 commit, 9 conflicts).

Live-app probes against `npm run dev` on 127.0.0.1:3104:

| Probe | Result |
|---|---|
| `POST /api/checkout/start` (the old pay URL) | 404 — confirms the symptom-4 root cause |
| `POST /api/checkout`, no Origin/Referer | 403 cross-origin |
| `POST /api/checkout/quote`, no Origin/Referer | 403 cross-origin |
| `POST /api/checkout`, `Origin: http://evil.example` | 403 cross-origin |
| `POST /api/checkout`, own Origin (and own Referer only) | 400 payload validation — past the guard, route exists |
| `GET /d/<token>` on a PIN link, no cookie | PIN prompt |
| `POST /api/d/<token>/start`, no PIN cookie | 401 |
| `POST /api/d/<token>/pin` wrong PIN / right PIN | 401 / 200 |
| `GET /d/<token>` + `POST .../start` after the PIN | stops shown / 200 — drivers are not locked out |

Fixture for the driver probes: `.scratch/t6-driver-seed.ts` mints a route with PIN 4321.
Dev server stopped afterwards.

### Note on the database

The Postgres cluster running on 4104 holds a schema whose applied migrations are not the
ones in this tree's `prisma/migrations`, so the DB-backed suites (`domain-db`,
`legacy-plan`) failed on "column does not exist" **before** any change here. Rather than
mutate that database, I migrated and seeded a separate `tomchei_t6` database on the same
cluster and ran CI and the smoke against it; `.env` still points at `tomchei`. Nothing
outside this arm was touched.
