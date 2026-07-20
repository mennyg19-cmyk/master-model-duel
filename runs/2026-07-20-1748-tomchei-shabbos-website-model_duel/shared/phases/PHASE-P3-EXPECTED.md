# Phase EXPECTED — P3

**Written before build.** Arms: all. Plan ref: `shared/MERGED-BUILD-PLAN.md` § P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media.

## Must be true when phase is done

1. [ ] Homepage: mission, impact bar, how-it-works, testimonials, CTAs — store-open-aware
2. [ ] Storefront shell: sticky header, desktop nav, mobile menu, user menu, footer signup, storewide closed banner
3. [ ] Current-season catalog: category filters, price sort, sold-out handling, quick view, detail + option pricing
4. [ ] Past-collections archive (all years, browse only, no checkout); closure enforcement on order/checkout routes
5. [ ] Newsletter subscribe + preferences + HMAC tokenized unsubscribe
6. [ ] Admin product catalog CRUD with season select + replacement-link editor shell; add-on management
7. [ ] Media library on Vercel Blob with restricted validated uploads + needs-photos panel
8. [ ] Settings hub shell — Orders, Shipping, Email, Developer tabs (store status, package types, pickup locations, rates/rules/delivery ZIPs)

## Smoke

| # | Check | How |
|---|---|---|
| S1 | Storefront UX | Open at desktop + mobile widths; nav, quick-view, filter, sort with seeded catalog |
| S2 | Season gate | Closed season hides checkout CTAs, blocks `/order` server-side; archive browsable without buy buttons |
| S3 | Newsletter | Subscribe → unsubscribe token round-trip; reject tampered/expired tokens |
| S4 | Media + catalog | Upload allowed image, reject disallowed file; admin product appears in storefront grid |
| S5 | Delivery ZIP | Edit delivery-ZIP in settings → checkout blocking updates immediately |

Evidence path per arm: `arms/{id}/workspace/.scratch/PHASE-P3-SMOKE.md`

## Out of scope this phase

- Cart, checkout, POS, package board, shipping labels, routes/drivers
- Season management wizard, repeat orders, replacement mapping admin (P10)
- Full checkout fee/Stripe flows (P5)
