# P9 Fix Notes

## Fixed review IDs

- **B1:** Every newly created driver route now requires a four-digit PIN in the domain, admin API, and admin UI. Driver actions require the PIN, and legacy links without a PIN hash fail closed. The URL token is therefore no longer a sole bearer credential.
- **A-H1:** The driver delivery API returns `completed: true` only when `markStopDelivered` reports that the final pending stop completed the route. Other access failures propagate to the error response.
- **A-H3:** `stampPickup` rejects packages with `pickupExpiredAt` set or a `pickupExpiresAt` time in the past.
- **A-H4:** `confirmRouteReroute` checks route status before any method-switch or stop mutation and rejects `COMPLETED` routes.
- **A-H5:** `markStopDelivered` atomically claims only a `PENDING` stop with a conditional `updateMany`; a losing concurrent tap fails before package, audit, or route-completion writes.

## Compatibility and verification

- Updated admin and driver PIN validation/labels for the mandatory PIN.
- Extended `scripts/p9-smoke.ts` to cover mandatory PIN enforcement, non-completion error responses, completed-route reroute rejection, expired-pickup rejection, and concurrent duplicate delivery taps.
- `npm run typecheck` — PASS.
- `npm run lint -- "src/domain/delivery.ts" "src/app/api/driver/routes/[token]/route.ts" "src/app/api/admin/delivery/route.ts" "src/components/delivery-operations.tsx" "src/components/driver-route.tsx" "scripts/p9-smoke.ts"` — PASS.
- `npm run smoke:p9` — PASS once; S1 through S5 all passed.

## Blockers remaining

None for B1, A-H1, A-H3, A-H4, or A-H5.
