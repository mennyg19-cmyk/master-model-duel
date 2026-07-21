# P3 Clean-code review — arm-03

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-03` · **Phase:** P3 (storefront, catalog, archive, newsletter, admin catalog/media)
**Rule source:** `arms/arm-03/rules/clean-code.md`
**Scope:** `arms/arm-03/workspace/src` — storefront pages, `lib/storefront/*`, `api/admin/{catalog,media}`, `api/newsletter/*`, `components/storefront/*`, `components/admin/catalog-admin.tsx`.

## Findings

1. **`newsletter.ts:9-11` weak HMAC secret fallback** — `secret()` falls back to `process.env.APP_URL || "tomchei-dev-newsletter"`. Hardcoded magic string + silent insecure default; throw if `NEWSLETTER_HMAC_SECRET` unset rather than signing with a guessable secret.
2. **`catalog/route.ts:44-52` inlines a different `include` than `lib/storefront/catalog.ts:14-18` `productInclude`** — two Prisma include shapes for the same Product concern (drift); reuse `productInclude` (extend if the admin view needs more).
3. **`catalog-admin.tsx:74-79` hardcodes default options `Standard`/`Deluxe` with magic `1200` adjustment on create** — fabricated product data; either omit options or drive from a constant. Also `:106` resets `onHand: 10` on edit, overwriting real inventory with a magic number.
4. **`api/newsletter/preferences/route.ts:25` writes audit action `NEWSLETTER_SUBSCRIBED` for a prefs update** — misleading audit trail; introduce `NEWSLETTER_PREFS_UPDATED`.
5. **Double email validation** — `api/newsletter/subscribe/route.ts:7` uses `z.string().email()` and `newsletter.ts:55` re-validates with a hand-rolled regex. One email validator per project; pick zod and drop the regex.
6. **`storefront/media.ts:10` comment claims "swap to `@vercel/blob.put` when `BLOB_READ_WRITE_TOKEN` is set" but the env var is never read** — unimplemented conditional; anti-hallucination. Implement the branch or delete the comment and state the stand-in is the path.
7. **`api/admin/media/route.ts:27-37` calls `validateUpload` then `storeMedia` calls `validateUpload` again** — duplicated validation; validate once (in `storeMedia`) and have the route rely on its `Result`.
8. **`catalog-admin.tsx:7-20` `Product` type drifts from the API response** — omits `options`, `inventory`, `allowedAddOns`, and types `replacementsFrom` as `{ toProductId: string }[]` while the route returns full `ProductReplacement` rows. Share a type from a single source.
9. **`lib/storefront/catalog.ts:55` magic kind array `[PACKAGE, MERCH, DONATION]`** — inline default repeated; hoist to a named `DEFAULT_CATALOG_KINDS` constant.
10. **`catalog-browser.tsx:38` vague name `quick`** — rename `quickViewProduct` for clarity (rules ban vague standalone names; `quick` reads as an adjective, not the selected product).

---

**Finding count: 10**
Highest-impact: 1 (security-adjacent secret), 3 (fabricated admin defaults), 8 (type drift), 6 (unimplemented claimed branch).
