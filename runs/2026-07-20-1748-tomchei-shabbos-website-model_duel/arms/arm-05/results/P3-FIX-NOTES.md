# P3 Fix Notes

## Fixed

- B1, B2, B6, B7, and B17: public newsletter signup now requires an out-of-band confirmation webhook, never returns an unsubscribe token, stores only an opaque confirmation-token hash, and uses an opaque subscriber ID inside its HMAC-signed preferences/unsubscribe token. The preferences page can load and save the three preference toggles.
- B3, B4, B5: catalog administration now supports edit and delete, add-on links with their restricted flag, and a structured replacement-link preparation shell.
- Major follow-ups: catalog API errors distinguish duplicate SKUs from unexpected failures; money conversion rounds to cents; the admin screen reuses its catalog loader and money formatter; media validation checks JPEG/PNG/WebP signatures; `.env.example` documents P3 secrets; the smoke statements now describe the checks actually made.

## Deferred

- Category filters, dedicated catalog detail route, settings-hub controls, live browser/HTTP smoke assertions, permission split, and broader P3 cleanup remain outside this single pass.
- Confirmation delivery requires `NEWSLETTER_DELIVERY_WEBHOOK_URL` (and optional `NEWSLETTER_DELIVERY_WEBHOOK_SECRET`) to be configured with a service that sends the supplied confirmation URL.

## Verification

- `npm run typecheck` passed.
- `npm run lint` passed with three pre-existing `no-img-element` warnings.
- `npm run smoke:p3` passed against embedded PostgreSQL on port 4105; it applied migration `20260727211500_p3_newsletter_confirmation`.
