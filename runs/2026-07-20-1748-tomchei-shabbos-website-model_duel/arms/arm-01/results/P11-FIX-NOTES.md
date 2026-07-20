# P11 Fix Pass Notes — arm-01

## Fixed

- **A-H1:** Delivery-day, pickup-ready, and bulk-delivery email paths now resolve editable transactional templates; SMS remains an outbox message.
- **A-H2:** Added `lockedUntil`, a two-minute processing lease, and stale `PROCESSING` reclamation during atomic claims.
- **A-H3:** Split messaging into configuration, templates, campaigns, outbox, purge, and hub-query concerns; `messaging.ts` is a compatibility facade.
- **A-H4:** Moved payment reminders from `delivery.ts` to `billing-notifications.ts`.
- **A-H5 / A-M6:** Added shared `enqueueRefundEmail` with one cumulative-refund idempotency key across admin and Stripe webhook paths.
- **A-H6:** Added shared `loadEmailHubState` for the admin page and API.
- **A-M1:** HTML template variables are escaped before branded HTML composition.
- **A-M2:** Newsletter subscription is limited to 10 attempts per source per minute.
- **A-M3:** Messaging configuration now runs from seed/smoke setup, not every transactional send or hub read.
- **A-M5:** Campaign status and recipient enqueue are atomic; campaigns remain `SENDING` until every real outbox delivery succeeds, then become `SENT`.
- **A-M7:** Failed-attempt recording uses an idempotent interactive transaction with a lock-release fallback; leases recover any remaining stranded claim.

## Verification

- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run db:guard` — PASS; schema valid and all 16 migrations applied
- `npm run smoke:p11` — PASS: S1 preferences/tokens, S2 campaign/idempotency, S3 transactional retry/audit, S4 cron auth/overlap, S5 purge/test capture

## Remaining blockers

None from the requested High or priority-Medium set.
