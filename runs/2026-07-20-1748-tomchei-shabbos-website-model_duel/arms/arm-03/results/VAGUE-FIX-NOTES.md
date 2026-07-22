# Vague fix notes — arm-03

Fixed from VAGUE-SYMPTOMS only (no DETECT / BUG-LEDGER).

## 1. Per-package delivery zone

**Cause:** Fee engine treated in-zone ZIPs as out-of-zone (membership check inverted).

**Fix:** In `lib/checkout/fees.ts`, require `!deliveryZips.includes(zip)` before the “outside the delivery area” error.

## 2. Shipping charge vs carrier rates

**Cause:** Margin engine charged the cheapest per-carrier best rate instead of the highest.

**Fix:** In `lib/shipping/margin.ts`, set `chargeCents` from the last (highest) entry after ascending sort; still buy the cheapest.

## 3. Checkout API without browser origin

**Cause:** Same-origin guard must refuse requests with neither `Origin` nor `Referer`.

**Fix:** Confirmed `lib/public-guard.ts` `isSameOrigin` already returns `false` when both headers are missing (fail closed).

## 4. Pay button dead end (404)

**Cause:** Checkout form POSTed to `/api/checkout/start`, which does not exist.

**Fix:** In `components/checkout/checkout-form.tsx`, POST pay/submit to `/api/checkout`.

## 5. Driver link skips PIN

**Cause:** PIN gate short-circuited with `&& false`.

**Fix:** In `lib/routes/driver-access.ts`, require a valid PIN cookie whenever the link has a `pinHash`.

## Verification

`npm run ci` — **pass** (lint, typecheck, migration:guard, 78/78 tests).
