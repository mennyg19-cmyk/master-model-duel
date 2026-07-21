# Test 6 — Vague Fix Notes

## Fixes

1. Corrected per-package delivery eligibility so configured ZIPs are accepted and only unlisted ZIPs are rejected.
2. Corrected shipping margin selection so checkout charges the highest per-carrier best quote while purchasing the cheapest eligible quote.
3. Changed the public checkout guard to reject requests that provide neither `Origin` nor `Referer`.
4. Pointed the checkout pay button at the implemented `/api/checkout` endpoint so successful submissions can return the hosted Stripe URL.
5. Restored the driver PIN gate so PIN-protected magic links require a valid verification cookie before route access.

## Verification

- `npm run ci`: PASS
- ESLint: PASS
- TypeScript: PASS
- Migration drift guard: PASS
- Unit tests: 78 passed, 0 failed
- The CI tests exercise the corrected delivery-zone and shipping-margin behavior; endpoint and PIN changes were verified through their shared guard/access paths.
