# Vague fix notes — arm-03

Fixed from `shared/VAGUE-SYMPTOMS.md` only (no DETECT / BUG-LEDGER).

## 1. Per-package delivery zone

**Cause:** Fee engine treated in-zone ZIPs as out-of-zone (membership check inverted).

**Fix:** In `lib/checkout/fees.ts`, require `!deliveryZips.includes(zip)` before the “outside the delivery area” error so in-zone addresses can use per-package delivery and out-of-zone are blocked.

## 2. Shipping charge vs carrier rates

**Cause:** Margin engine charged the cheapest per-carrier best rate instead of the highest.

**Fix:** In `lib/shipping/margin.ts`, set `chargeCents` from the last (highest) entry after ascending sort; still buy the cheapest.

## 3. Checkout API without browser origin

**Cause:** Same-origin guard returned true when neither `Origin` nor `Referer` was present.

**Fix:** In `lib/public-guard.ts`, refuse requests with neither header (`return false`).

## 4. Pay button dead end (404)

**Cause:** Checkout form POSTed to `/api/checkout/start`, which does not exist.

**Fix:** In `components/checkout/checkout-form.tsx`, POST pay/submit to `/api/checkout` (existing session-create route).

## 5. Driver link skips PIN

**Cause:** PIN gate short-circuited with `pinHash && false`.

**Fix:** In `lib/routes/driver-access.ts`, require a valid PIN cookie whenever the link has a `pinHash`.

## Verification

- Unit: `tests/checkout-fees.test.ts` + `tests/shipping-margin.test.ts` — **13/13 pass** (zone + margin symptoms covered).
- `npm run ci`:
  - lint: **pass** (after `npm install` aligned eslint deps)
  - typecheck: **fail** — large pre-existing Prisma/schema drift across admin pages (none in the five edited files)
  - migration:guard: **pass** (shadow DB on 4102)
  - test: **64 pass / 3 fail** — failures are env/DB (`SESSION_SECRET` unset in some suites; `.env` points at 4103 while `db:start` serves 4102), not the symptom fixes
- Arm ports per ARM.md: web **3103**, db **4103**; this workspace’s `db:start` / migration guard still use **4102**.
