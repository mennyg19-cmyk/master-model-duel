# Test 6 — Vague fix notes (arm-02)

Fixed from symptoms only. Five bugs found, all one-line logic flips/typos.

## Fixes

### 1. Delivery zone inverted (`lib/checkout/fees.ts`)

`PER_PACKAGE_DELIVERY` blocked ZIPs that **are** in `config.deliveryZips`:

```ts
if (config.deliveryZips.includes(recipient.address.zip)) { errors.push(...outside the delivery area...) }
```

In-zone customers were rejected; out-of-zone ZIPs sailed through (until the missing-day check caught some). Fix: negate to `!config.deliveryZips.includes(...)`.

### 2. Margin engine charged the lowest rate (`lib/shipping/margin.ts`)

`perCarrierBest` is sorted ascending; both `buy` and `chargeCents` read index `[0]`, so charge == cheapest carrier and margin was always 0. Per the documented rule (charge the HIGHEST per-carrier best, buy the cheapest), fix:

```ts
const chargeCents = perCarrierBest[perCarrierBest.length - 1].amountCents;
```

### 3. Origin guard failed open (`lib/public-guard.ts`)

`isSameOrigin` returned `true` when a request had neither `Origin` nor `Referer` — exactly the curl/server-POST case. The function's own doc comment says such requests are refused. Fix: `return false`. Verified: POST `/api/checkout/quote` with no Origin → 403; with same-origin header → passes guard (400 from Zod, as expected).

### 4. Pay button posted to a nonexistent route (`components/checkout/checkout-form.tsx`)

`placeOrder()` fetched `/api/checkout/start`, but the route lives at `app/api/checkout/route.ts` → 404 instead of the Stripe redirect URL. Fix: fetch `/api/checkout`. Verified: `/api/checkout/start` → 404, `/api/checkout` → 400 (route reached, payload validation).

### 5. Driver PIN gate disabled (`lib/routes/driver-access.ts`)

```ts
if (access.link.pinHash && false) {
```

The `&& false` short-circuited the whole PIN-cookie check, so PIN-protected magic links opened without the PIN. Fix: remove `&& false`.

## Verification

- `npm run ci` — lint, typecheck, migration guard, **78/78 unit tests pass** (the pre-existing fees and margin tests only pass with the corrected logic).
- Smoke against the running dev server (port 3102): ZIP `08701` → `deliverable: true`; origin-less POST to quote → 403; same-origin quote/checkout POSTs reach their routes; `/api/checkout/start` confirmed 404 (dead URL the client no longer uses).
- PIN gate re-enabled by code inspection (no seeded route link available to click through).
