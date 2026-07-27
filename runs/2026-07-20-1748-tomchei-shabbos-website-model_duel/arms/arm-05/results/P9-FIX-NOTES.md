# P9 fix notes — arm-05

Single fix pass completed 2026-07-28. No re-review was run.

## Fixed

- All blockers: cron secrets use `timingSafeEqual`; pickup stamps require `PICKUP`; and both the door list and stamp require the target pickup location.
- Driver safety: PIN reads use a POST body, PIN failures write route audit events, driver responses are `no-store`, route-start state is checked, and creation links expire after one day.
- Reroute safety and audit: completed routes reject suggestions and confirmation; method-switch audits include the checkout charge and voided-label ID.
- Pickup expiry: a migration adds `UNCLAIMED`; expiry updates status and writes the expiry timestamp; staff can retrieve a location-scoped unclaimed report.
- Other: payment reminders dedupe per schedule, proximity constants are named, candidate geocodes run concurrently, and the smoke covers location-scoped pickup expiry.

## Deferred

- Mapbox/geocode fixture replacement and admin map UI.
- Atomic external label-void compensation, call-center filters, reroute print-batch updates, route detail UI, and delivery-module split.
- Remaining lower-priority pickup, geocode-cache, notification-retention, and UI-cleanup findings.

## Verification

- `npm run typecheck` — exit 0.
- `npm run smoke:p9` — exit 0; S1/S2 through S5 passed.
