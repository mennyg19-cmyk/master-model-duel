# P3 Security Review — arm-04 (blind)

**Scope:** P3 delta + regressions on P1–P2 trust boundaries.
**Focus:** trust boundaries, auth on admin catalog/media/settings, newsletter HMAC tokens, upload validation, IDOR, injection, store-open gate bypass.
**Method:** static review of `arms/arm-04/workspace/src/**` against `shared/MERGED-BUILD-PLAN.md` § P3 and `shared/phases/PHASE-P3-EXPECTED.md`.
**Severity:** blocker / major / minor. Findings only — no fixes.

## Summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 6 |

## Findings

### MAJOR-1 — `saveAddOn` writes cross-season restriction rows
`src/lib/catalog/admin.ts:185-190`

`saveAddOn` accepts `restrictedToProductIds` from the form and creates `AddOnProductRestriction` rows without verifying the products belong to the same season as the add-on. A `catalog.manage` holder (or a compromised manager account) can point an add-on at products in any season. The add-on's season scoping is the invariant P4/P5 cart builder will rely on; cross-season restrictions will either surface as wrong offers or as Prisma-shaped 500s when the cart reads them. The season is validated for the add-on itself (`db.season.findUnique`) but never for the restriction targets.

### MAJOR-2 — `saveProduct` lets a form change the season of an existing product
`src/lib/catalog/admin.ts:70-76`

On update (productId provided), `data` includes `seasonId` straight from the form. There is no check that the submitted seasonId matches the product's existing season. A manager can reassign a product to a different season, which orphans its `ProductOption`/`InventoryItem` rows (still pointing at the old seasonId via the product relation) and breaks the `@@unique([seasonId, slug])` invariant when the slug already exists in the target season. The edit form pre-selects the season but never re-validates it server-side. The same gap applies to `imageAssetId`: a non-existent asset id throws an uncaught P2003 (500), not a graceful validation error.

### MINOR-1 — `saveProduct` / `saveAddOn` update on missing id throws uncaught
`src/lib/catalog/admin.ts:74-76`, `:181-183`

`db.product.update({ where: { id: input.productId } })` and the add-on equivalent throw `P2025` when the id does not exist. Only `P2002` (duplicate slug) is caught; everything else surfaces as a 500. Not a bypass — `catalog.manage` is required — but the error shape leaks "record not found" vs "validation error" to the caller, which is a minor information disclosure and an ungraceful failure.

### MINOR-2 — Newsletter `loadByToken` timing oracle on subscriber existence
`src/lib/newsletter/subscriptions.ts:58-68`

The comment states "an unknown id fails the same way a bad signature does", and the public message is identical, but the timing is not: a valid signature with a non-existent subscriber id performs a `findUnique` round-trip before returning, while a bad signature returns immediately. This creates a timing side-channel on subscriber id existence. Subscriber ids are random UUIDs so enumeration is impractical, but the equality the comment claims is not actually delivered.

### MINOR-3 — Newsletter `subscribe` action has no rate limit
`src/app/(storefront)/newsletter-actions.ts:18-34`

The footer and newsletter-page signup forms accept any email from any caller with no throttling. `subscribe` upserts on `normalizedEmail`, so duplicates don't accumulate, but an unauthenticated caller can flood the `NewsletterSubscriber` table with unique addresses and probe which addresses are already subscribed (the upsert path vs the create path differ in observable behavior once P11 email sending lands). P3 has no email send, so no spam risk yet, but the unbounded write is the issue. The plan's R-122 calls for "public endpoint guards — same-origin, IP rate limit, Zod" on public endpoints; that guard is not present here.

### MINOR-4 — `setReplacementLink` audit action is indistinguishable from a product save
`src/lib/catalog/admin.ts:130-135`

Replacement-link changes are recorded as `catalog.product_saved` with `created: false`, the same action used for ordinary product edits. The audit trail cannot distinguish "manager changed the replacement pointer" from "manager edited the product fields", which weakens the audit trail for a sensitive operation that P10 repeat-order depends on. Use a distinct action (e.g. `catalog.replacement_linked`).

### MINOR-5 — `beginImpersonation` does not re-check the target's status after cookie issuance
`src/app/(admin)\admin\staff\actions.ts:98-116`

`beginImpersonation` looks up the target with `status: 'ACTIVE'`, sets the impersonation cookie, and redirects. The cookie is valid for `SESSION_MAX_AGE_SECONDS` (12h). If the target is revoked between the lookup and a later request, `resolveImpersonation` (`src/lib/auth/staff.ts:53-58`) re-checks `status: 'ACTIVE'` on every request, so the live gate holds. The finding is minor: the action itself does not re-verify after the cookie is set, but the per-request re-check covers it. No bypass — noted for completeness.

### MINOR-6 — `saveEmailSettingsAction` does not validate `fromName`
`src/app/(admin)\admin\settings/actions.ts:125-142`

`fromAddress` and `replyToAddress` are validated as emails, but `fromName` is written verbatim with only `.trim()`. A `settings.manage` holder can set the sender display name to any string, including one designed to impersonate a person or brand. Manager-only, but the email sender identity is a trust surface once P11 turns it on; a length cap and a non-empty check would be the minimum.

## Things checked and found sound

- **HMAC unsubscribe tokens** (`src/lib/newsletter/tokens.ts`): purpose-bound signature (`newsletter.unsubscribe.v1`), `timingSafeEqual` on signature compare, expiry enforced, payload only parsed after signature holds, base64url body (no `.` in signature so `lastIndexOf('.')` split is safe). Re-subscribe after unsubscribe is intentional and consent-based.
- **Upload validation** (`src/lib/media/validation.ts`, `storage.ts`, `library.ts`): extension + declared type + magic bytes must all agree, SVG refused, alt text required, 5MB cap, `buildPathname` strips to `[a-z0-9-]` so path traversal is impossible, validate-before-store so rejected bytes never reach disk or Blob, audit row written, `uploadedByStaffUserId` recorded. Local storage refused off loopback via env validation.
- **Admin auth gates**: every admin page and action calls `requirePermission(...)` with the correct permission (`catalog.manage`, `media.manage`, `settings.manage`, `staff.manage`, `audit.view`, `dashboard.view`). The admin layout gates on `dashboard.view` so a driver opening `/admin` gets 403, not the shell. `requirePermission` throws 401/403 (not redirects) thanks to `experimental.authInterrupts`.
- **Store-open gate** (`src/lib/store-state.ts`, `order/page.tsx`): `requireOpenStore()` is the server-side gate on `/order`, returns 403 when closed, reads both `store.open` setting and season `OPEN` status. Archive pages hardcode `canOrder={false}`. Collection and homepage hide CTAs when closed. No bypass found.
- **Delivery ZIP allowlist** (`src/lib/delivery-area.ts`): server-side, no override, empty list blocks everyone, `normalizePostalCode` rejects non-ZIP input, settings textarea dedupes/sorts/reports rejected entries.
- **Injection**: all DB access via Prisma parameterized queries; no raw SQL except `SELECT 1` in health check (no user input). React escapes all rendered query params (`error`, `reason`, etc.). No `dangerouslySetInnerHTML`.
- **Session cookies** (`src/lib/auth/signed-cookie.ts`, `local-session.ts`): httpOnly, sameSite=lax, secure in production, signed with HMAC + `AUTH_SESSION_SECRET`, 12h maxAge, local provider refused off loopback and in production runtime.
- **Bootstrap lock** (`src/lib/bootstrap.ts`): unique-key lock + staff count check in a transaction; concurrent submissions cannot both create a manager.
- **Self-target guards** (`src/lib/staff-service.ts:163-170`): role/status/override edits block self-targeting for both actor and acting ids.
- **`client-error` endpoint** (`src/app/api/client-error/route.ts`): body size capped, fields truncated, global rate limit, nothing echoed back.
- **`request-ip`** (`src/lib/request-ip.ts`): `x-forwarded-for` only read when `TRUST_PROXY_HEADERS=true`, preventing IP forging by callers.
- **Sign-in `next` redirect** (`src/app/sign-in/actions.ts:66-71`): destination restricted to `/admin` and `/driver` roots, defeating open-redirect via `?next=`.

## Out of scope

Cart, checkout, POS, package board, shipping labels, routes/drivers, season management wizard, repeat orders, replacement-mapping admin (P10), Stripe/fee flows (P5). No findings made against these.
