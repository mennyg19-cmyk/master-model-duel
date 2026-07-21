# P3 Aggregate Review — arm-03

Union+dedupe of P3-security, P3-quality, P3-rules, P3-clean-code (arm-03). No new findings. Severity = max across sources; security blockers survive. Source IDs: S/Q/R/CC.

## Blockers (6)

- **B1 — No P3 smoke evidence** (Q-F1): `.scratch/PHASE-P3-SMOKE.md` absent; S1–S5 unverified.
- **B2 — `edit()` silently resets `onHand` to 10** (Q-F5, R1, CC3): `catalog-admin.tsx:106` hardcodes stock; every edit overwrites real inventory. Data-loss.
- **B3 — No media→product linkage UI** (Q-F3): `media-admin.tsx` never sets `Product.primaryImageUrl`/`mediaAssetId`; S4 cannot complete end-to-end.
- **B4 — `/order` closure enforced at page, not middleware** (Q-F4): `middleware.ts` marks `/order` public with no season gate; future `/order/*` routes inherit no gate.
- **B5 — No Delete in catalog/add-on CRUD** (Q-F6): `catalog-admin.tsx`/`addon-admin.tsx` only Create+Edit / Create-only; "CRUD" incomplete.
- **B6 — Newsletter HMAC secret falls back to public constant** (S-H1, Q-F10, CC1): `newsletter.ts:9-11` degrades to `APP_URL`/`"tomchei-dev-newsletter"`; unsubscribe tokens forgeable. Fail-closed.

## High (3)

- **H1 — Newsletter preferences IDOR** (S-M1): `api/newsletter/preferences` POST mutates any subscriber with no token; enumerates status.
- **H2 — Media upload extension not validated vs MIME allowlist** (S-M2): `media.ts:13-50` trusts `file.type`; `evil.html`/`.svg` served from storefront origin — stored XSS via admin compromise.
- **H3 — Subscribe returns unsubscribe token to caller, no email verification** (S-M3): `subscribe/route.ts:30-34`; attacker subscribes victim and receives a valid token.

## Medium (17)

- **M1 — Media is local-disk, not Vercel Blob** (Q-F2, CC6): `media.ts:10` writes `public/uploads` with unimplemented `@vercel/blob.put` branch; ponytail stand-in vs EXPECTED #7.
- **M2 — Newsletter preferences have no standalone UI; unsubscribe auto-fires** (Q-F7): prefs only set inline at subscribe; `newsletter/unsubscribe/page.tsx:11-26` fires on load with no confirm.
- **M3 — Storefront shell has no user menu** (Q-F8): `shell.tsx` renders flat "Account" link vs EXPECTED #2.
- **M4 — Dev auth bypass via spoofable header / weak cookie** (S-L1): `auth.ts:34-49` + `middleware.ts:30-36` trust `x-dev-user-id`; `dev_user_id` cookie non-httpOnly.
- **M5 — Expectation files absent** (R2): no `.scratch/phase-plan.md` with pre-build todos + EXPECTED blocks.
- **M6 — `.scratch/` not gitignored** (R3): workspace `.gitignore` missing entry.
- **M7 — No `DECISION-LOG.md`** (R4): archive browse-only, replacement editor shell, default options, category default chosen silently.
- **M8 — No `.scratch/run-state.md`** (R5): multi-phase run-state file absent.
- **M9 — Codegraph index never built** (R6): `.codegraph/` has only `.gitignore`; ~25 new P3 files added without graph.
- **M10 — Prisma include drift** (CC2): `catalog/route.ts:44-52` inlines a different `include` than `productInclude` in `lib/storefront/catalog.ts:14-18`.
- **M11 — `Product` type drifts from API response** (CC8): `catalog-admin.tsx:7-20` omits `options`/`inventory`/`allowedAddOns`; `replacementsFrom` typed too narrow.
- **M12 — Double email validation** (CC5): `subscribe/route.ts:7` zod + `newsletter.ts:55` hand-rolled regex.
- **M13 — Duplicated `validateUpload` call** (CC7): `api/admin/media/route.ts:27-37` + `storeMedia` both validate.
- **M14 — Magic kind array** (CC9): `lib/storefront/catalog.ts:55` inline `[PACKAGE, MERCH, DONATION]`; hoist to `DEFAULT_CATALOG_KINDS`.
- **M15 — Duplicated form state + magic values** (R8): `catalog-admin.tsx` repeats 10-field literal at 26-37 and 212-223; magic `5400`/`1200`/`"Packages"`/`10`; `settings-hub.tsx` hardcodes Brooklyn ZIPs.
- **M16 — Storefront buttons bypass shared primitive** (R9): `catalog-browser.tsx` + `shell.tsx` use raw `<button>`/`<Link>` with inline Tailwind vs admin `components/ui/button`.
- **M17 — Swallowed errors in admin loaders** (R7): `media-admin.tsx:17-20` and `settings-hub.tsx:21` silently no-op on `!res.ok`.

## Low (5)

- **L1 — Unsubscribe double-verifies + leaks reason codes** (S-L2): `unsubscribe/route.ts:16-23` verifies in route and again in `unsubscribeWithToken`; surfaces `tampered`/`expired`/`stale`/`malformed`.
- **L2 — `assertInventoryTargetXor` runs on outer `db` inside transaction** (S-L3): `catalog/route.ts:131` + `addons/route.ts:52` read outside `tx` snapshot.
- **L3 — Preferences update audit-logs wrong action** (S-I1, CC4): logs `NEWSLETTER_SUBSCRIBED` with `prefsUpdated:true` instead of `NEWSLETTER_PREFS_UPDATED`.
- **L4 — Quick-view dialog lacks a11y close** (Q-F9): `catalog-browser.tsx:132-178` no Escape/overlay-click, no focus trap.
- **L5 — Vague name `quick`** (CC10): `catalog-browser.tsx:38`; rename `quickViewProduct`.

## Summary

| Severity | Count |
|---|---|
| Blocker | 6 |
| High | 3 |
| Medium | 17 |
| Low | 5 |
| **Total deduped** | **31** |

Blockers (must fix before P4): B1–B6. Pass noted: R10 (ponytail marker + HMAC/timingSafeEqual/tokenVersion rotation + no new packages + `.env*` gitignored).
