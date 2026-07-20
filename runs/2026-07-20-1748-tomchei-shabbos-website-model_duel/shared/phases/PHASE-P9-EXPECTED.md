# Phase EXPECTED — P9

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P9 — Delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling.

## Must be true when phase is done

1. [ ] Mapbox route builder from delivery packages (geocode + cache); route admin list/detail/reassign/print; per-route greeting-card print
2. [ ] Driver magic link: unguessable per-route URL scoped to stops, expires on completion, optional PIN, audit on every Delivered tap; mobile stop cards, start route, Google Maps deep links, printed fallback
3. [ ] Method switch shipping ↔ delivery with charge preserved + audit; map reroute with manager confirm, void printed-not-shipped Shippo label (P8), day-of notification on route start
4. [ ] Pickup: eligibility when inventory available, ready notification, door list + picked-up stamp, unclaimed report, pickup-expiry cron (bearer auth)
5. [ ] Bulk delivery scheduling with email + SMS notification; follow-up call-center filters; payment-reminder cron

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Driver magic link | Assign route, open magic link on phone viewport; scoped stops only; PIN throttled; mark delivered → link expires; audit has timestamp + link id |
| S2 | Maps + print fallback | Google Maps deep links encode stop address; same route completable from printed fallback only |
| S3 | Method switch + reroute | Shipping→delivery preserves balance, voids label, audit; nearby suggestion requires confirm; sent package rejects reroute |
| S4 | Bulk + day-of notify | Schedule bulk delivery → one email + SMS per customer (test capture); route start → idempotent day-of notification |
| S5 | Pickup + crons | Stock available → pickup-ready once; door list + stamp; unclaimed/expiry; crons reject missing bearer secret |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P9-SMOKE.md`

## Out of scope this phase

- Repeat orders / replacement mappings (P10)
- Full email/SMS platform (P11)
- Migration + launch polish (P12)
