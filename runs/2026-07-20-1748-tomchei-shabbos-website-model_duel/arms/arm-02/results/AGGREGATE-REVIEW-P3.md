# Aggregate Review — P3 — arm-02

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-02`
**Phase:** P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media, settings hub
**Inputs:** `results/reviews/P3-security-arm-02.md`, `P3-quality-arm-02.md`, `P3-rules-arm-02.md`, `P3-clean-code-arm-02.md`
**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings.

## Severity counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 5 |
| Minor | 24 |
| **Total** | **29** |

No Critical/High security findings. The single Medium security issue (SEC-1) is Major, not a blocker.

## Aggregated findings

### Blockers

None.

### Major (5)

**MAJ-1 — Unauthenticated newsletter subscribe mints management tokens for arbitrary addresses** *(security, Medium)*
`app/api/newsletter/subscribe/route.ts:22-27` — no email verification; upserts to `SUBSCRIBED` and returns the HMAC preferences/unsubscribe token in the response. Lets an attacker re-subscribe a victim who unsubscribed and immediately unsubscribe / flip their preferences. Token valid 90 days. Per-IP rate limit (5/min) does not bind token to ownership. *(from SEC M1)*

**MAJ-2 — Add-on `restrictedToProductIds` not validated server-side (existence or same-season)** *(quality, medium)*
`app/api/admin/add-ons/route.ts:21-57`, `app/api/admin/add-ons/[id]/route.ts:6-34` — nonexistent product id → Prisma P2003 FK error → unhandled 500 (not 400/404); cross-season restrictions persist silently. Client scoping is trivially bypassed via direct API. *(from Q F1)*

**MAJ-3 — Product PATCH `imageId` / `replacementId` not validated for existence, same-season, or active state** *(quality, medium)*
`app/api/admin/products/[id]/route.ts:6-42` — only guard is self-reference; FK violations surface as 500; replacement can point cross-season or to an inactive product, defeating R-148. *(from Q F2)*

**MAJ-4 — Quick-view modal has no Escape, no focus trap, no scroll lock** *(quality/a11y, medium)*
`components/storefront/product-grid.tsx:63-111` — `role="dialog" aria-modal="true"` overlay with backdrop + `×` close only; no keyboard close path, no focus move/trap, no body scroll lock. S1 smoke only asserts the trigger string. *(from Q F5; rules #7)*

**MAJ-5 — Smoke leaves orphan rows and does not restore the season status it toggled** *(quality/smoke hygiene, medium)*
`.scratch/p3-smoke.ps1` — cleanup at start only; S2 closes/reopens Purim 2026 without snapshot/restore; `smoke@example.com`, `smoke.png`, `smoke-test-box` persist between runs, polluting the storefront grid and admin catalog for later reviews. *(from Q F9)*

### Minor (24)

#### Security (8)

**MIN-1 — `clientIp` trusts `x-forwarded-for` blindly** *(Low)* — `lib/rate-limit.ts:21-23`; rotates per-IP rate-limit key for login/subscribe/client-error. Per-account login limit bounds impact. *(SEC L1)*

**MIN-2 — `SESSION_SECRET` entropy not enforced; example secret committed** *(Low)* — `lib/env.ts:7-9` (min 16 chars); `.env.example:8` ships `change-me-to-a-random-string`. Weak secret enables offline forging of staff/newsletter tokens. *(SEC L2)*

**MIN-3 — `SESSION_SECRET` reused across session and newsletter HMAC schemes** *(Low)* — `lib/auth/session.ts:12`, `lib/newsletter-token.ts:12`; collapses two trust boundaries into one secret. *(SEC L3)*

**MIN-4 — Newsletter token carried in URL query string** *(Low)* — `/newsletter/preferences?token=...`; leaks via Referer/history/logs; also carries the subscriber email in cleartext base64url. *(SEC L4)*

**MIN-5 — No rate limiting on unsubscribe / preferences PATCH** *(Low)* — `app/api/newsletter/unsubscribe/route.ts`, `app/api/newsletter/preferences/route.ts`; token unforgeable so impact is unbounded request volume / log noise only. *(SEC L5)*

**MIN-6 — `/api/setup` GET discloses setup-locked state to unauthenticated callers** *(Low)* — `app/api/setup/route.ts:13-16`; minor reconnaissance aid; POST is correctly transactional. *(SEC L6)*

**MIN-7 — Impersonation has no role-hierarchy guard** *(Informational)* — `app/api/impersonate/route.ts`; `staff.impersonate` holder can impersonate "up" to MANAGER. Mitigated by audit logging. *(SEC I1)*

**MIN-8 — CSRF defense relies solely on `SameSite=Lax`** *(Informational)* — `lib/auth/session.ts:27`; no CSRF token, no `Sec-Fetch-Site` validation. Lax is adequate for POST/PATCH/DELETE but no defense-in-depth. *(SEC I2)*

#### Quality (5)

**MIN-9 — Product / AddOn POST do not validate that `seasonId` exists** *(Low)* — `app/api/admin/products/route.ts:21-29`, `app/api/admin/add-ons/route.ts:21-28`; FK error → 500 instead of 400/404. *(Q F3)*

**MIN-10 — `saveMediaUpload` (local driver) creates the DB row before writing the file; orphan row on disk failure** *(Low)* — `lib/media.ts:61-67` (local), `:50-58` (Vercel Blob symmetric orphan); no try/catch cleanup. *(Q F4)*

**MIN-11 — `SiteHeader` user menu and mobile menu have no click-outside or Escape close** *(Low)* — `components/storefront/site-header.tsx:43-108`; toggle works, dismiss affordances incomplete (especially mobile). *(Q F6; rules #7)*

**MIN-12 — `getArchiveSeasons` drops CLOSED seasons that have zero products** *(Low)* — `lib/season.ts:13-18`; `/collections` omits empty past seasons while `/collections/[seasonId]` renders them — the two archive views disagree. *(Q F7)*

**MIN-13 — Smoke price-sort assertions match the first occurrence anywhere in the HTML body** *(Low)* — `.scratch/p3-smoke.ps1:56-60`; `[regex]::Match` proves "name appears somewhere", not "name is the first card". *(Q F8)*

#### Clean-code / Rules (11)

**MIN-14 — Duplicated / inconsistent client fetch pattern** *(clean-code § duplicated logic + consistency)* — `requestJson` declared separately in `components/admin/catalog-manager.tsx:32` and `components/admin/settings-hub.tsx:33` (different signatures); `media-library.tsx`, `newsletter-signup.tsx`, `preferences-form.tsx`, `zip-checker.tsx` each inline `fetch → .json() → ok?…:error`. Extract `lib/admin-fetch.ts` / `lib/api-client.ts` and converge. *(clean-code F1 + rules #1, #2)*

**MIN-15 — Duplicated `SeasonRow` type (type/schema drift)** *(clean-code)* — `catalog-manager.tsx:10` and `settings-hub.tsx:11` redeclare `SeasonRow` and re-derive the Prisma enum by hand. Centralize (ideally derived from `Prisma.Season`). *(clean-code F2)*

**MIN-16 — Duplicated `soldOut` calculation** *(clean-code § duplicated logic)* — `lib/catalog.ts:34` and `app/(storefront)/catalog/[slug]/page.tsx:20` both inline `quantityOnHand - reserved <= 0`. Extract `isSoldOut(product)` into `lib/catalog.ts`. *(clean-code F3 + rules #3)*

**MIN-17 — Duplicated product image / placeholder UI** *(clean-code § duplicated UI)* — `components/storefront/product-grid.tsx:9` ships `ProductImage` (🎁 fallback); `app/(storefront)/catalog/[slug]/page.tsx:31` reimplements the same inline. Lift to `components/storefront/product-image.tsx`. *(clean-code F4)*

**MIN-18 — Duplicated cents conversion (magic value `* 100`)** *(clean-code § magic values + duplication)* — `Math.round(Number(price) * 100)` in `catalog-manager.tsx:89,108` and `settings-hub.tsx:302,322,333`; inverse `/100` in `settings-hub.tsx:321,332`. Add `toCents`/`fromCents` next to `formatCents` in `lib/catalog.ts`. *(clean-code F5)*

**MIN-19 — Duplicated `filterHref` / `sortHref`** *(clean-code § duplicated logic)* — `app/(storefront)/catalog/page.tsx:48,55` are near-identical URLSearchParams builders. Collapse into `buildCatalogHref({ category, sort })`. *(clean-code F6)*

**MIN-20 — Vague name `data` (banned standalone)** *(clean-code § naming)* — `SettingsHub({ data }: { data: SettingsHubData })` (`settings-hub.tsx:43`). Rename to `settings`. *(clean-code F7 + rules #6)*

**MIN-21 — Vague name `item` (banned standalone)** *(clean-code § naming)* — `app/(storefront)/page.tsx:86` `HOW_IT_WORKS.map((item) => …)`. Rename to `step`. *(clean-code F8)*

**MIN-22 — `settings-hub.tsx` mixes 4 tab concerns in one 390-line file** *(clean-code § split by concern)* — `components/admin/settings-hub.tsx` bundles shell + Orders/Shipping/Email/Developer tabs. Move each to `components/admin/settings/<tab>-tab.tsx`. *(clean-code F9 + rules #4)*

**MIN-23 — Swallowed non-OK in `loadSeason`** *(clean-code)* — `catalog-manager.tsx:60` sets state only on `ok` with no `else`; a failed reload leaves stale state and no error to the user. *(clean-code F10)*

**MIN-24 — Magic value drift on upload limit** *(clean-code § magic values)* — `lib/media.ts:13` defines `MAX_UPLOAD_BYTES = 5 * 1024 * 1024` but `:39` hardcodes `"the limit is 5 MB"` separately. Derive the message from the constant. *(rules #5)*

## Dedupe map

| Specialist finding | Aggregated as |
|---|---|
| SEC M1, L1–L6, I1, I2 | MAJ-1, MIN-1..MIN-8 |
| Q F1, F2, F5, F9 | MAJ-2, MAJ-3, MAJ-4, MAJ-5 |
| Q F3, F4, F6, F7, F8 | MIN-9..MIN-13 |
| clean-code F1 + rules #1, #2 | MIN-14 |
| clean-code F3 + rules #3 | MIN-16 |
| clean-code F7 + rules #6 | MIN-20 |
| clean-code F9 + rules #4 | MIN-22 |
| Q F6 + rules #7 (site-header portion) | MIN-11 |
| Q F5 + rules #7 (quick-view portion) | MAJ-4 |
| clean-code F2, F4, F5, F6, F8, F10 | MIN-15, MIN-17, MIN-18, MIN-19, MIN-21, MIN-23 |
| rules #5 | MIN-24 |

No new findings introduced during aggregation.
