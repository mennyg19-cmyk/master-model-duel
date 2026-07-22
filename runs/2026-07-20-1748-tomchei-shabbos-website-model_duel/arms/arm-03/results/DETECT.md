# Test 6 — Detect

| Bug ID | Location | What's wrong | How you found it |
|---|---|---|---|
| BUG-1 | `lib/checkout/fees.ts` — `PER_PACKAGE_DELIVERY` ZIP check (~line 84) | Condition is inverted: `if (config.deliveryZips.includes(...))` treats in-zone ZIPs as "outside the delivery area" and lets out-of-zone ZIPs through. Comment/UI expect the opposite (`!includes`). | Read fee engine vs G-014 comment; UI in `checkout-form.tsx` blocks with `!inZone`; unit test `per-package delivery hard-blocks out-of-zone zips` expects 99999 blocked and 08701 allowed. |
| BUG-2 | `lib/shipping/margin.ts` — `resolveMargin` charge selection (~line 30) | After sorting per-carrier best ascending, `chargeCents` uses `perCarrierBest[0]` (cheapest) instead of the highest carrier best. Margin is always ~0 when buy is also the cheapest. | File header / UR-003 say charge highest; `tests/shipping-margin.test.ts` expects charge 1200 / 1900 with positive margin. |
| BUG-3 | `components/checkout/checkout-form.tsx` — `placeOrder` fetch (~line 109) | Pay posts to `/api/checkout/start`, but the only checkout POST route is `app/api/checkout/route.ts` (`/api/checkout`). No `start` route → 404, no Stripe redirect. | Compared client URL to `app/api/checkout/` tree (only `route.ts` + `quote/route.ts`). |
| BUG-4 | `lib/routes/driver-access.ts` — PIN gate (~line 26) | `if (!pinCookieValid(...) && false)` — the `&& false` makes the PIN-required branch dead. Links with `pinHash` grant full route access without a PIN cookie. | Read `resolveDriverAccess`; condition can never be true despite PIN setup. |
