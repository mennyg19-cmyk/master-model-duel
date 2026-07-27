# Aggregate Review — P3 — arm-05 (blind)

**Phase:** P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media
**Inputs:** `P3-security-arm-05.md`, `P3-quality-arm-05.md`, `P3-rules-arm-05.md`, `P3-clean-code-arm-05.md`
**Method:** union + dedupe by location+claim; security blockers always survive; no new findings.
**Severity mapping:** Critical/High → **blocker**; Medium → **major**; Low → **minor**; Info/Nit → **nit**.

## Post-dedupe counts

| Severity | Count |
|---|---|
| Blocker | 5 |
| Major | 20 |
| Minor | 8 |
| Nit | 8 |
| **Total** | **41** |

Raw inputs: 12 (security) + 14 (quality) + 11 (rules) + 12 (clean-code) = 49. Deduped 8 overlaps (newsletter preferences, replacement-link shell, add-on management, smoke-console.log, three money formatters, duplicated fetch, cents conversion, newsletter origin guard).

Source tags: **[S]** security, **[Q]** quality, **[R]** rules, **[C]** clean-code.

---

## Prioritized fix list (one fix pass)

### Blockers (fix first)

1. **[S] Newsletter unsubscribe token returned to any caller of public subscribe endpoint** — `app/api/newsletter/route.ts:13-18` + `lib/newsletter.ts:47-55`. Public unauthenticated POST upserts subscriber and returns HMAC-signed unsubscribe token to caller. Breaks "only subscriber can unsubscribe" trust model; enables consentless subscription, token harvest, and victim unsubscribe. Add email-verification or out-of-band token delivery; do not return token in the subscribe response.

2. **[Q][R] Newsletter preferences deliverable not implemented** — `app/unsubscribe/page.tsx`, `app/api/newsletter/route.ts`, `lib/newsletter.ts`. EXPECTED #5 / R-018 requires subscribe + **preferences** + HMAC unsubscribe. `NewsletterSubscriber.preferences` column exists but is never read or written. Add a preferences surface (PUT/PATCH + UI toggles).

3. **[Q] Admin catalog CRUD is Create-only** — `app/admin/catalog/page.tsx`, `app/api/admin/catalog/route.ts`. EXPECTED #6 requires CRUD. UI only POSTs (no `id`); no edit affordance, no DELETE handler, no delete UI. Add edit (populate `id`) and delete (handler + button).

4. **[Q][R] Replacement-link editor shell missing** — `app/admin/catalog/page.tsx:70`. Plan § P3 calls for "replacement-link editor shell (R-065)"; page defers entirely to P10 with prose. `ProductReplacement` model exists but is unreachable from P3 admin. Add a structured shell (placeholder form / link), even if management lands in P10.

5. **[Q][R] Add-on management incomplete (restricted add-on linking)** — `app/admin/catalog/page.tsx`, `app/api/admin/catalog/route.ts`. EXPECTED #6 / R-066 requires add-on management. `productSchema` has no `restrictedAddons`; `ProductAddOn` table never written. Add UI + API to link add-on products to parent packages with `isRestricted`.

### Majors (fix in same pass after blockers)

6. **[S] Unsubscribe token leaks subscriber email in plaintext** — `lib/newsletter.ts:18-20,26-29`. Token payload is base64url of `JSON.stringify({ email, expiresAt })` — base64 is not encryption. Email recoverable by anyone observing the token (URLs, Referer, history, logs). Encrypt or use an opaque subscriber-id + HMAC.

7. **[S] Storefront renders unsubscribe URL (with token) as visible page text** — `app/components/storefront-shell.tsx:19`. Subscribe success message puts the signed URL into the DOM as readable text. Remove the URL from the rendered message; deliver via email only.

8. **[S] Media upload trusts client-supplied Content-Type with no content validation** — `app/api/admin/media/route.ts:8-38` + `lib/media.ts:1-12`. Only `file.type` (client-controlled) and `file.size` checked; blob stored with `contentType: file.type`. No magic-byte sniff, no re-encode. Add server-side magic-byte validation; consider re-encoding.

9. **[Q] Catalog filter is by kind, not category** — `app/components/catalog-grid.tsx:36-40`, `lib/storefront.ts:19,34`. EXPECTED #3 / R-003 requires category filters; only `ALL`/`PACKAGE`/`DONATION` offered. `Product` has no `category` field; storefront query also silently excludes add-ons entirely. Add category field + filter; decide add-on visibility.

10. **[Q] No product detail page** — `app/catalog/`. EXPECTED #3 requires "detail + option pricing". Only quick-view modal exists; no `/catalog/[id]` route, no dedicated URL, no full description / inventory status. Add a dynamic detail route.

11. **[Q] Settings hub "shells" are prose placeholders, not structured shells** — `app/admin/settings/page.tsx:37-40`, `app/api/admin/settings/route.ts:7-10`. EXPECTED #8 requires structured shells for Orders, Shipping, Email, Developer tabs (package types, pickup locations, rates/rules). Only `storeStatus` and `deliveryZipCodes` are functional inputs. Add structured form controls wired to config keys.

12. **[Q][R] Smoke S1/S2/S4/S5 asserted via `console.log`, not running-app evidence** — `scripts/smoke-p3.ts:43-53`, `.scratch/PHASE-P3-SMOKE.md`. Script only does Prisma + token round-trip assertions; never boots app, never issues HTTP to `/order`, never renders at viewport. SMOKE.md claims UX/HTTP checks that the script does not perform. Replace log lines with real HTTP/render assertions or correct the SMOKE.md claims.

13. **[R] Swallowed / misreported error in admin catalog POST** — `app/api/admin/catalog/route.ts:40-47`. `catch` returns 409 "SKU already exists" for every Prisma failure (FK violation, DB loss, etc.). Actual error discarded; client misled. Discriminate error types; log; return honest messages.

14. **[R][C] Floating-point money conversion rejects valid dollar prices** — `app/admin/catalog/page.tsx:43`. `Number(form.get("priceDollars")) * 100` produces non-integer cents for many inputs (e.g. `1.13 * 100`); server `z.number().int()` rejects. Use `Math.round(Number(...) * 100)`.

15. **[R][C] Three competing money formatters (2 names)** — `lib/foundation.ts:7-12` (`centsToDollars`, dead), `lib/storefront.ts:5-10` (`formatMoney`), `app/components/catalog-grid.tsx:16-18` (local `formatMoney`). Consolidate to one helper; delete dead `centsToDollars`.

16. **[R][C] Duplicated fetch logic in admin catalog page** — `app/admin/catalog/page.tsx:16-30`. `loadCatalog` and the `useEffect` re-implement the same `GET /api/admin/catalog` fetch. Have the effect call `loadCatalog()`.

17. **[R][S] Public newsletter subscribe endpoint: no rate limiting, no origin guard** — `app/api/newsletter/route.ts:13-26`. Unauthenticated write endpoint with no `hasSameOrigin`, no IP rate limit, no captcha. Enables mass-subscribe / email enumeration. Add origin guard + rate limit.

18. **[C] Inline money formatting drifts from the helper** — `app/admin/catalog/page.tsx:96`. `${(product.priceCents / 100).toFixed(2)}` produces `1299.00` (no thousands separator, no Intl) vs `formatMoney`'s `$1,299.00`. Use the shared helper.

19. **[C] Dead code: `lib/settings.ts` unused** — `lib/settings.ts:1-19`. In-memory `SettingMap` never imported; competes with live Prisma `AppSetting` store. Delete.

20. **[C] Inconsistent JSON body parsing across API routes** — `app/api/newsletter/route.ts:14,21` (guards with `.catch(() => null)`); 6 other routes do not. Malformed JSON yields 500 instead of 400 on most routes. Apply one pattern everywhere.

21. **[C] Duplicated admin auth+origin boilerplate** — `app/api/admin/catalog/route.ts`, `app/api/admin/media/route.ts`, `app/api/admin/settings/route.ts`. Same `authorize("settings.manage")` + `hasSameOrigin` block repeated 6×. Extract `requireSettingsManage(request)`.

22. **[C] Archive page re-implements product cards instead of reusing the grid** — `app/collections/page.tsx:18-26` vs `app/components/catalog-grid.tsx:51-67`. Card JSX duplicated verbatim. Extract shared `ProductCard` or add `archived` mode to `CatalogGrid`.

23. **[C] `isOpen` derivation repeated across four storefront pages** — `app/page.tsx:8-11`, `app/catalog/page.tsx:8-11`, `app/collections/page.tsx:7-9`, `app/order/page.tsx:7-8`. Each page re-derives `Boolean(currentSeason)`. Move into `StorefrontShell` or a `getStorefrontOpen()` helper.

24. **[R] `.env.example` missing P3 secrets** — `.env.example`. Omits `NEWSLETTER_TOKEN_SECRET` and `BLOB_READ_WRITE_TOKEN` despite both being P3-introduced and required by code. Add placeholders.

25. **[R] Store open/closed flip not audited** — `app/api/admin/settings/route.ts:33-44`. PUT updates `season.status` (OPEN↔CLOSED) without writing an `AuditEvent`. P1 established audit precedent. Add an audit row on flip.

### Minors (fix if time remains)

26. **[S] `hasSameOrigin` rejects requests with no Origin header and is unevenly applied** — `lib/route-auth.ts:51-54`. Missing Origin → 403 (safe-by-default but breaks legit scripts); guard absent from newsletter + client-error routes.

27. **[S] Static shared-secret comparison not constant-time** — `app/api/client-error/route.ts:10-13`. `!==` on a static shared secret shipped in the client bundle. Use constant-time compare; rotate token.

28. **[S] Setup bootstrap state probeable by unauthenticated callers** — `app/api/setup/route.ts:10-16`. `GET /api/setup` returns `{ canBootstrap }` to anyone. Recon disclosure on fresh deployments.

29. **[S] Catalog admin update can move a product across seasons, bypassing archive invariant** — `app/api/admin/catalog/route.ts:6-16,39-47`. `productSchema` accepts `seasonId`; update can move product from archived to open season. Validate target season.

30. **[Q] Storefront shell missing user menu** — `app/components/storefront-shell.tsx:25-34`. EXPECTED #2 requires user menu; only Staff sign-in link present.

31. **[Q] Catalog/media endpoints gate on `settings.manage` (permission conflation)** — `app/api/admin/catalog/route.ts`, `app/api/admin/media/route.ts`, `lib/permissions.ts`. No `catalog.manage` / `media.manage` permission; cannot delegate catalog editing without granting all settings rights.

32. **[Q] Media upload returns 503 without `BLOB_READ_WRITE_TOKEN`; smoke S4 end-to-end blocked** — `app/api/admin/media/route.ts:20-22`. Token not configured; smoke only validates local file-type check.

33. **[Q] Admin layout sidebar links not permission-gated** — `app/admin/layout.tsx:5-17`. All five links rendered unconditionally; no `authorize()` or role check.

### Nits (optional)

34. **[S] Settings PUT toggles only the most-recent season** — `app/api/admin/settings/route.ts:33-43`, `lib/storefront.ts:13-28`. Older OPEN seasons stay live; inconsistent season-gate enforcement.

35. **[S] Dev auth bypass gated only on `NODE_ENV === "development"` string compare** — `lib/dev-auth.ts:15-19`. Defense in depth: also gate on a non-public deployment flag.

36. **[S] Impersonation is a stub that writes a misleading audit event** — `lib/staff-store.ts:216-230`, `app/api/staff/[staffId]/route.ts:35-38`. Audit row records an impersonation that did not happen. Correctness/audit-integrity issue for P6.

37. **[Q] Archive page shows historical price without "historical" label context** — `app/collections/page.tsx:23-24`. Plain bold price; could mislead casual browsers.

38. **[Q] Homepage testimonials section is a single hardcoded quote** — `app/page.tsx:26`. EXPECTED #1 says "testimonials" (plural).

39. **[C] Vague standalone state name `message`** — `app/admin/catalog/page.tsx:14`, `app/admin/settings/page.tsx:9`, `app/unsubscribe/page.tsx:8`. Use a status-specific name (cf. `newsletterMessage` in storefront-shell).

40. **[C] Magic numbers in token and field length limits** — `lib/newsletter.ts:5`, `app/api/newsletter/route.ts:10`. `z.string().min(20).max(1000)` bounds undocumented; name them.

41. **[C] Duplicated product filter predicate inside `getStorefront`** — `lib/storefront.ts:19,34`. `where: { isActive: true, kind: { not: "ADD_ON" } }` written twice 15 lines apart. Extract `activeCatalogProductWhere` (defensible to leave; noted).

---

## Notes

- P3 scope respected: no findings filed against cart, checkout, POS, package board, shipping labels, routes/drivers, season wizard, repeat orders, or replacement mapping *management* (all correctly out of scope per EXPECTED).
- Findings 4 and 5 (replacement-link shell, add-on management) are scope gaps vs. the P3 deliverable wording, not vs. P10 management scope.
- `.env.local` exists with `NEWSLETTER_TOKEN_SECRET` and `DEV_AUTH_SECRET`; `.gitignore` excludes it — no leak path, not a finding.
- Clerk middleware runs on all routes; per-route `authorize` is the actual gate; no bypass observed.
