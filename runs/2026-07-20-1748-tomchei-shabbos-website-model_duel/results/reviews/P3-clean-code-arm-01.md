# P3 Clean-code review — arm-01

**Arm:** `arm-01`
**Tree / phase:** Test 4 — P3 (storefront + admin surface)
**Reviewer specialist:** Clean-code
**Scope:** `arms/arm-01/workspace/` (src only; `.next/`, `.scratch/`, `node_modules/` excluded)
**Rule check:** `clean-code` is in `arms/arm-01/rules/` → review applies.

Findings only. No fixes applied.

---

## Summary

| # | Category | Severity | Location |
|---|---|---|---|
| 1 | Duplicated logic | High | 6 admin API routes |
| 2 | Duplicated logic | High | staff route × accept-invite route |
| 3 | Pattern drift | High | admin pages vs. their API routes |
| 4 | Duplicated logic | Medium | 6 client components |
| 5 | Duplicated UI | Medium | 5 client components |
| 6 | Duplicated UI | Medium | home + catalog-explorer |
| 7 | Magic values | Medium | global-error, catalog-explorer, home, media-manager |
| 8 | Magic values | Medium | storefront.ts, store-settings.ts, seed.ts |
| 9 | Duplicated logic | Medium | storefront.ts |
| 10 | Pattern drift | Low | catalog-manager vs. staff-manager |
| 11 | Duplicated logic | Low | admin overview route × page |
| 12 | Duplicated logic | Low | admin layout, staff route, overview route |
| 13 | Pattern drift | Low | admin layout nav links |

**Finding count: 13**

---

## 1. AccessDeniedError → 403 handler duplicated across every admin route

**Category:** Duplicated logic · **Severity:** High
**Files:** `src/app/api/admin/{catalog,staff,settings,media,impersonation,overview}/route.ts`

The same "convert `AccessDeniedError` to a 403 response, rethrow otherwise" block is reimplemented in six routes in two inconsistent shapes:

- Helper function variant (2 sites):
  - `catalog/route.ts:6-11` (`handleCatalogError`)
  - `staff/route.ts:9-14` (`permissionError`)
- Inline `if (error instanceof AccessDeniedError)` variant (5 sites):
  - `impersonation/route.ts:60-64` and `:103-107`
  - `overview/route.ts:22-26`
  - `settings/route.ts:51-55`
  - `media/route.ts:87-91`

Six routes, five inline copies plus two differently-named helpers that do the identical thing. A single `withAccessControl(handler)` wrapper or a shared `accessDeniedResponse()` in `lib/auth.ts` would collapse all of them and remove the naming drift (`handleCatalogError` vs `permissionError`).

---

## 2. Invitation token hashing duplicated

**Category:** Duplicated logic · **Severity:** High
**Files:** `src/app/api/admin/staff/route.ts:66`, `src/app/api/staff/accept-invite/route.ts:23`

Both routes compute the invite token hash inline:

```ts
createHash("sha256").update(inviteToken).digest("hex")
```

The hash algorithm, encoding, and the implicit contract that "the token is hashed with sha256/hex before lookup" are now duplicated knowledge. A `hashInviteToken(token)` helper in `lib/ids.ts` (next to `createSecureToken`) would centralize it.

---

## 3. Staff list ordering drifts between page and API

**Category:** Pattern drift · **Severity:** High
**Files:** `src/app/(admin)/admin/staff/page.tsx:10`, `src/app/api/admin/staff/route.ts:20`

The staff admin page fetches with `orderBy: { createdAt: "asc" }` while the staff API route's `GET` returns `orderBy: { displayName: "asc" }`. Same entity, two different default orderings depending on which entry point the client hits — a latent UI inconsistency. Pick one canonical ordering for `StaffUser` reads and reuse it.

---

## 4. `fetch` + JSON + `!response.ok` boilerplate duplicated in every client component

**Category:** Duplicated logic · **Severity:** Medium
**Files:** `catalog-manager.tsx`, `staff-manager.tsx`, `media-manager.tsx`, `settings-hub.tsx`, `newsletter-form.tsx`, `newsletter-preferences.tsx`

Every client component re-implements the same mutation shape:

```ts
const response = await fetch(url, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(...),
});
const payload = await response.json();
if (!response.ok) { setMessage(payload.error); return; }
```

`catalog-manager.tsx` alone repeats this three times (`createProduct`, `updateProduct`, `archiveProduct` at lines 33-51, 56-69, 78-86); `staff-manager.tsx` three times (lines 28-42, 50-67, 76-88). A small `apiFetch(url, { method, body })` helper returning `{ ok, data, error }` would remove the repetition and the per-call `Content-Type` header.

---

## 5. Status-message UI pattern duplicated across client components

**Category:** Duplicated UI · **Severity:** Medium
**Files:** `catalog-manager.tsx:31,152-156`, `staff-manager.tsx:25,118-122`, `media-manager.tsx:33,154-158`, `settings-hub.tsx:22,166-170`, `newsletter-preferences.tsx:15,80`

The `const [message, setMessage] = useState("")` state plus the identical `aria-live="polite"` status paragraph is copy-pasted into five components:

```tsx
{message && (
  <p aria-live="polite" className="mt-4 rounded-xl bg-[var(--brand-soft)] px-4 py-3 text-sm font-semibold">
    {message}
  </p>
)}
```

This is a `useStatusMessage()` hook (state + setter) paired with a `<StatusMessage>` component — exactly the "2+ real call sites" case.

---

## 6. Product image tile duplicated between home and catalog explorer

**Category:** Duplicated UI · **Severity:** Medium
**Files:** `src/app/(storefront)/page.tsx:91-112`, `src/components/catalog-explorer.tsx:81-129`

The featured-product card on the home page and the `CatalogExplorer` grid card render the same structure: an `aspect-[4/3]` image tile with the alternating `index % 2 ? "bg-[#eef0e7]" : "bg-[var(--brand-soft)]"` background, the same `Image` sizing (`h-3/4 w-3/4 object-contain transition duration-300 group-hover:scale-105`), the same `imageUrl ?? "/purim-ribbon.svg"` fallback, and the same category/name/price block. A shared `<ProductCard product={...} index={n} />` would remove the duplication.

---

## 7. Hardcoded hex colors instead of design tokens

**Category:** Magic values · **Severity:** Medium
**Files:** `src/app/global-error.tsx:12-25`, `src/components/catalog-explorer.tsx:88`, `src/app/(storefront)/page.tsx:97`, `src/components/media-manager.tsx:147`

The entire codebase uses CSS custom properties (`var(--brand)`, `var(--ink)`, `var(--muted)`, `var(--cream)`, `var(--brand-soft)`) — except:

- `global-error.tsx` uses `#f7f3f7`, `#8f2f67`, `#241f2d`, `#6f6878` (four raw hex values that are clearly `--cream`, `--brand`, `--ink`, `--muted`).
- `catalog-explorer.tsx:88` and `page.tsx:97` use `#eef0e7` for the alternating tile background.
- `media-manager.tsx:147` uses `#eef6ec` and `#35633d` for the "all products have photos" success panel.

These should be tokens (e.g. `--tile-alt`, `--success-soft`, `--success-ink`) so the palette has one source of truth; today a theme change would silently miss these surfaces.

---

## 8. AppSetting key strings scattered as magic strings

**Category:** Magic values · **Severity:** Medium
**Files:** `src/lib/storefront.ts:5`, `src/lib/store-settings.ts:3`, `prisma/seed.ts:14,26,45`

`store-settings.ts` correctly defines `const deliveryZipKey = "delivery-zips"` — but `storefront.ts:5` inlines `"current-season-id"`, and `seed.ts` inlines `"organization"`, `"delivery-zips"` (×2), and `"current-season-id"` (×2). The `delivery-zips` literal now lives in two files with no shared constant, so a key rename would miss either the seed or the lib. Centralize AppSetting keys in one place (e.g. `lib/store-settings.ts` exporting `APP_SETTING_KEYS`).

---

## 9. `getCurrentSeason` / `getArchivedSeasons` duplicate the product include

**Category:** Duplicated logic · **Severity:** Medium
**Files:** `src/lib/storefront.ts:11-23` and `:26-37`

Both queries repeat the same product relation filter:

```ts
products: {
  where: { kind: "PACKAGE", isActive: true },
  orderBy: { name: "asc" },
  ...
}
```

Extract a `seasonProductInclude` constant (or a `seasonWithProducts` Prisma helper) so the "active packages only, sorted by name" rule is stated once.

---

## 10. `Button` component used inconsistently across admin forms

**Category:** Pattern drift · **Severity:** Low
**Files:** `src/components/catalog-manager.tsx:148,175,183`, `src/components/media-manager.tsx:92,137`, `src/app/(admin)/admin/staff/staff-manager.tsx:116,127,151,153`

A `Button` component exists (`src/components/button.tsx`) with `tone="primary"|"secondary"` and consistent focus/disabled styling. `staff-manager.tsx` uses it throughout, but `catalog-manager.tsx` and `media-manager.tsx` use raw `<button>` elements with hand-rolled class strings (`rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white`, `rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-bold`, etc.) that approximate `Button`'s secondary tone without the focus-visible/disabled affordances. Pick one: either use `Button` everywhere or document why these two forms are raw.

---

## 11. Audit-log "recent activity" query duplicated with different limits

**Category:** Duplicated logic · **Severity:** Low
**Files:** `src/app/api/admin/overview/route.ts:10-13`, `src/app/(admin)/admin/page.tsx:9-12`

Both the overview API route and the overview page issue the same query with different `take` values (12 vs. 6):

```ts
db.auditLog.findMany({ orderBy: { occurredAt: "desc" }, take: N })
```

The page renders the activity itself and ignores the API route's `recentAudit` entirely — the API route returns data the page never fetches from. Either the page should consume the API, or the API route should drop the audit field; either way the query should be stated once.

---

## 12. "Is impersonating" expression repeated

**Category:** Duplicated logic · **Severity:** Low
**Files:** `src/app/(admin)/admin/layout.tsx:27-28`, `src/app/api/admin/staff/route.ts:80,92`, `src/app/api/admin/overview/route.ts:17`

The `staffSession.actor.id !== staffSession.effective.id` check is written four times. Add an `isImpersonating` getter on the session object returned by `getCurrentStaffUser`/`requirePermission` (e.g. `staffSession.isImpersonating`) so the impersonation contract lives in `lib/auth.ts`.

---

## 13. Admin nav links are hand-written per-route with drift

**Category:** Pattern drift · **Severity:** Low
**Files:** `src/app/(admin)/admin/layout.tsx:52-72`

The sidebar nav duplicates the same `className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]"` string on five `<Link>` elements, with the active "Overview" link using a different class string (`bg-[var(--brand-soft)] ... text-[var(--brand-dark)]`) inlined at line 52. The nav items + permission gates are also expressed inline rather than as data. A small `navItems` array (with `href`, `label`, `permission`) mapped to a single `<NavLink>` would remove the class duplication and make the permission gating consistent.
