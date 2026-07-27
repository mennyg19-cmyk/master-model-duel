# P3 Quality Review — arm-05

Reviewer: Quality specialist (blind — no model names).
Scope: P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media.
Plan ref: `shared/MERGED-BUILD-PLAN.md` § P3. Expected ref: `shared/phases/PHASE-P3-EXPECTED.md`.
Method: static review of `arms/arm-05/workspace/` against EXPECTED checklist + smoke evidence in `.scratch/PHASE-P3-SMOKE.md`. No fixes proposed.

Severity scale: Critical / High / Medium / Low / Info.

## Summary counts

- Critical: 0
- High: 4
- Medium: 4
- Low: 4
- Info: 2
- Total: 14

---

## Findings

### H1 — High — Newsletter preferences not exposed (EXPECTED #5, R-018)

- **Location:** `app/unsubscribe/page.tsx`, `app/api/newsletter/route.ts`, `lib/newsletter.ts`
- **Claim:** EXPECTED #5 requires "Newsletter subscribe + **preferences** + HMAC tokenized unsubscribe". Only subscribe and full unsubscribe are implemented. The `NewsletterSubscriber.preferences` JSON column exists in the schema (default `marketing/updates/reminders`) but is never read or written by any API or UI. The unsubscribe page only fully unsubscribes; there is no preferences management surface.
- **Evidence:**
  - `app/unsubscribe/page.tsx:11-19` — single `unsubscribe()` calls `DELETE /api/newsletter`; no preferences form.
  - `app/api/newsletter/route.ts:13-26` — only `POST` (subscribe) and `DELETE` (unsubscribe) handlers. No `PUT`/`PATCH` for preferences.
  - `lib/newsletter.ts:47-65` — `subscribe`/`unsubscribe` only; no preference update function.
  - `prisma/schema.prisma:176-183` — `NewsletterSubscriber.preferences Json @default("{\"marketing\":true,...}")` is unused beyond default.
  - `scripts/smoke-p3.ts:25-34` — S3 verifies subscribe/unsubscribe/tamper/expiry only; no preference assertion.

### H2 — High — Admin catalog CRUD is Create-only (EXPECTED #6, R-065)

- **Location:** `app/admin/catalog/page.tsx`, `app/api/admin/catalog/route.ts`
- **Claim:** EXPECTED #6 requires "Admin product catalog **CRUD**". The admin UI only creates products. There is no edit affordance (the form never sends an `id`) and no delete affordance anywhere. The API supports update via an optional `id`, but the UI never populates it. Delete is entirely absent (no `DELETE` handler, no UI button).
- **Evidence:**
  - `app/admin/catalog/page.tsx:32-53` — `saveProduct` always POSTs without `id`; no edit button on the catalog list.
  - `app/admin/catalog/page.tsx:92-97` — catalog list renders products as read-only `<p>` text; no edit/delete controls.
  - `app/api/admin/catalog/route.ts:32-48` — only `POST` handler; no `DELETE` handler. `id` is parsed but never sent by the client.

### H3 — High — Replacement-link editor shell missing (EXPECTED #6, plan § P3, R-065)

- **Location:** `app/admin/catalog/page.tsx`
- **Claim:** Plan § P3 deliverables: "Admin product catalog CRUD with season select + **replacement-link editor shell** (R-065)". The admin page explicitly defers this to P10 with no shell, no placeholder form, and no link. The `ProductReplacement` model exists in schema (P2) but is unreachable from P3 admin. The plan deliberately puts the *editor shell* in P3 and the *management* in P10.
- **Evidence:**
  - `app/admin/catalog/page.tsx:70` — "Replacement links are managed with season lifecycle in P10."
  - No replacement-related input, select, or section in the admin catalog page.
  - `prisma/schema.prisma:211` (referenced from grep) — `ProductReplacement` model exists but has no P3 admin writer.

### H4 — High — Add-on management incomplete (EXPECTED #6, R-066)

- **Location:** `app/admin/catalog/page.tsx`, `app/api/admin/catalog/route.ts`
- **Claim:** EXPECTED #6 requires "add-on management". The admin can create a product of kind `ADD_ON`, but there is no UI to manage restricted add-on links (`ProductAddOn` table — parent product ↔ add-on product with `isRestricted`). R-066 covers add-on management including the restricted add-on relationship.
- **Evidence:**
  - `app/api/admin/catalog/route.ts:6-16` — `productSchema` has no `restrictedAddons` field; POST never writes to `ProductAddOn`.
  - `app/admin/catalog/page.tsx:74-82` — form has no add-on-linking UI; only a `kind` select that can be set to `ADD_ON`.
  - `prisma/schema.prisma:198-210` — `ProductAddOn` model exists but is never written from P3.

### M1 — Medium — Catalog filter is by kind, not category (EXPECTED #3, R-003)

- **Location:** `app/components/catalog-grid.tsx`, `lib/storefront.ts`
- **Claim:** EXPECTED #3 requires "category filters". The catalog filter offers only `ALL`/`PACKAGE`/`DONATION` (product kind), not category. There is no `category` field on `Product` in the schema, so category filtering is unimplemented. The storefront query also silently excludes add-ons entirely (`kind not ADD_ON`), so the `ADD_ON` option is missing from the filter UI entirely.
- **Evidence:**
  - `app/components/catalog-grid.tsx:36-40` — filter options are `ALL`, `PACKAGE`, `DONATION` only.
  - `lib/storefront.ts:19,34` — `where: { isActive: true, kind: { not: "ADD_ON" } }` excludes add-ons from both current and archive queries.
  - `prisma/schema.prisma:133-164` — `Product` has no `category` field.

### M2 — Medium — No product detail page (EXPECTED #3)

- **Location:** `app/catalog/`
- **Claim:** EXPECTED #3 requires "detail + option pricing". There is no `/catalog/[id]` or `/products/[id]` route. The only product detail surface is the quick-view modal, which shows options but no full detail page (no inventory status, no full description beyond the card snippet, no dedicated URL).
- **Evidence:**
  - Glob of `app/catalog/` shows only `app/catalog/page.tsx`; no dynamic route segment.
  - `app/components/catalog-grid.tsx:69-83` — quick-view modal is the only detail surface; "From {price}" + options list. No link to a per-product page.

### M3 — Medium — Settings hub "shells" are prose placeholders, not structured shells (EXPECTED #8)

- **Location:** `app/admin/settings/page.tsx`
- **Claim:** EXPECTED #8: "Settings hub shell — Orders, Shipping, Email, Developer tabs (store status, **package types, pickup locations**, **rates/rules**/delivery ZIPs)". Only store status and delivery ZIPs are functional inputs. Package types, pickup locations, follow-up (Orders tab), rates/rules (Shipping tab), Email tab, and Developer tab are static `<p>` paragraphs with no form controls. A "shell" implies structured empty placeholders wired to config keys, not prose deferrals.
- **Evidence:**
  - `app/admin/settings/page.tsx:37` — Orders tab: only `storeStatus` select; paragraph defers package types/pickup/follow-up.
  - `app/admin/settings/page.tsx:38` — Shipping tab: only `deliveryZipCodes` textarea; paragraph defers rates/rules.
  - `app/admin/settings/page.tsx:39-40` — Email and Developer tabs are pure prose, no inputs.
  - `app/api/admin/settings/route.ts:7-10` — `settingsSchema` only validates `deliveryZipCodes` and `storeStatus`; no other keys accepted.

### M4 — Medium — Smoke S1/S2 are data assertions, not UX/HTTP checks (smoke completeness)

- **Location:** `scripts/smoke-p3.ts`, `.scratch/PHASE-P3-SMOKE.md`
- **Claim:** SMOKE.md claims S1 "Open at desktop + mobile widths; nav, quick-view, filter, sort with seeded catalog" and S2 "GET /order returned 307 Temporary Redirect with Location: /catalog". The actual `smoke-p3.ts` script only asserts Prisma rows (season status, product options, inventory, delivery ZIP) and prints console messages for UX. It never boots the app, never issues an HTTP request to `/order`, and never renders at any viewport. The S2 307-redirect claim is not backed by any code in the smoke.
- **Evidence:**
  - `scripts/smoke-p3.ts:43-53` — `verifySmoke()` calls only `verifyStorefrontData()` (Prisma asserts) and `verifyNewsletter()` (token round-trip). No HTTP client, no app boot.
  - `scripts/smoke-p3.ts:48-52` — S1/S2/S3/S4/S5 "passages" are `console.log` statements, not assertions.
  - `.scratch/PHASE-P3-SMOKE.md:11-17` — S1/S2 claim browser-level and HTTP-level checks that the script does not perform.

### L1 — Low — Storefront shell missing user menu (EXPECTED #2)

- **Location:** `app/components/storefront-shell.tsx`
- **Claim:** EXPECTED #2 requires "user menu" in the storefront shell. The shell has brand, mobile menu toggle, nav links (Shop, Past collections, Staff sign in), and a Start-an-order button. There is no customer account menu (sign in / orders / profile). Only a "Staff sign in" link to `/admin` exists.
- **Evidence:**
  - `app/components/storefront-shell.tsx:25-34` — header contains brand, menu-toggle, nav with Shop/Past collections/Staff sign in/Start order. No user/account menu.

### L2 — Low — Catalog/media endpoints gate on `settings.manage` (permission conflation)

- **Location:** `app/api/admin/catalog/route.ts`, `app/api/admin/media/route.ts`, `lib/permissions.ts`
- **Claim:** Catalog and media endpoints gate on `settings.manage`. The permissions list has only `staff.manage`, `audit.read`, `settings.manage`, `orders.read`. There is no `catalog.manage` or `media.manage` permission, so a Staff role cannot be granted catalog-editing rights without also gaining all settings rights. This conflates catalog editing with settings editing and prevents least-privilege delegation.
- **Evidence:**
  - `lib/permissions.ts:1-6` — only 4 permissions defined.
  - `app/api/admin/catalog/route.ts:19,33` — `authorize(request, "settings.manage")`.
  - `app/api/admin/media/route.ts:9` — `authorize(request, "settings.manage")`.

### L3 — Low — Media upload returns 503 without token; smoke S4 end-to-end blocked

- **Location:** `app/api/admin/media/route.ts`, `.scratch/PHASE-P3-STATUS.md`
- **Claim:** S4 smoke "Upload an allowed image and reject a disallowed file" cannot run end-to-end because `BLOB_READ_WRITE_TOKEN` is not configured. The route returns 503. The smoke only validates the local file-type check (`validateCatalogImage`), not the actual Blob upload path or the 503 failure path. Status doc records this as a blocker.
- **Evidence:**
  - `app/api/admin/media/route.ts:20-22` — returns 503 if `BLOB_READ_WRITE_TOKEN` missing.
  - `scripts/smoke-p3.ts:46-47` — only tests `validateCatalogImage` locally; no HTTP call to `/api/admin/media`.
  - `.scratch/PHASE-P3-STATUS.md:18` — "Actual Vercel Blob upload smoke cannot run until `BLOB_READ_WRITE_TOKEN` is supplied."

### L4 — Low — Admin layout sidebar links are not permission-gated

- **Location:** `app/admin/layout.tsx`
- **Claim:** The admin sidebar renders links to Catalog & media, Settings, Staff & permissions, Security audit unconditionally. A driver-role user (or any visitor reaching `/admin`) sees all five links. The layout is a server component with no `authorize` call and no role-based visibility. (P1 owns permission gates for pages, but P3 added the Catalog link without any visibility gating.)
- **Evidence:**
  - `app/admin/layout.tsx:5-17` — all five links rendered unconditionally; no `authorize()` call, no role check, no `hasPermission` import.

### I1 — Info — Archive page shows historical price without "historical" label context

- **Location:** `app/collections/page.tsx`
- **Claim:** Archive products render `<strong>{formatMoney(product.priceCents)}</strong>` followed by "Archived collection · not available to buy". EXPECTED only forbids checkout/buy buttons; showing the historical price is acceptable, but the price is shown as a plain bold figure with no "(last season price)" context, which could mislead a casual browser.
- **Evidence:**
  - `app/collections/page.tsx:23-24` — `<strong>{formatMoney(product.priceCents)}</strong>` then `<p className="archived">Archived collection · not available to buy</p>`.

### I2 — Info — Homepage testimonials section is a single hardcoded quote

- **Location:** `app/page.tsx`
- **Claim:** EXPECTED #1 says "testimonials" (plural). The homepage has exactly one hardcoded testimonial. Acceptable for a marketing shell but worth noting for content completeness.
- **Evidence:**
  - `app/page.tsx:26` — single `<section className="testimonials">` with one quote and one attribution.

---

## Notes

- P3 scope was respected: no findings filed against cart, checkout, POS, package board, shipping labels, routes/drivers, season wizard, repeat orders, or replacement mapping *management* (all correctly out of scope per EXPECTED "Out of scope this phase").
- Findings H3 and H4 are scope gaps vs. the plan's P3 deliverables (replacement-link editor **shell** and add-on management), not vs. P10 management scope.
- Smoke script `scripts/smoke-p3.ts` is data-assertion heavy; M4 records that several SMOKE.md claims are not actually exercised by code.
