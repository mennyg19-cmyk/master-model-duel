# P3 Clean-code Review — arm-05

**Scope:** Storefront (marketing, catalog, archive, newsletter), admin catalog & media, settings hub — `shared/MERGED-BUILD-PLAN.md` § P3.
**Rule source:** `arms/arm-05/.cursor/rules/clean-code.mdc`.
**Method:** findings only — no fixes. Severity: `critical` / `major` / `minor` / `nit`.

## Summary

- Critical: 0
- Major: 4
- Minor: 5
- Nit: 3
- Total: 12

---

## Findings

### 1. Major — Duplicated money formatting (3 implementations, 2 names)

**Location:** `lib/foundation.ts:7-12`, `lib/storefront.ts:5-10`, `app/components/catalog-grid.tsx:16-18`.

**Claim:** Three separate implementations of "format cents as USD" coexist, with two different names for the same operation. Violates "one pattern per concern" and Rule of 2 (3 real call sites → must be a single helper).

**Evidence:**
- `lib/foundation.ts` exports `centsToDollars(cents)` using `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)`.
- `lib/storefront.ts` exports `formatMoney(cents)` with the **identical** body.
- `app/components/catalog-grid.tsx` defines a **third local** `formatMoney` (same body) instead of importing from `lib/storefront`.
- Grep across the arm-05 workspace shows `centsToDollars` is never imported anywhere — it is dead duplicated code. `formatMoney` is imported only by `app/collections/page.tsx`; the catalog grid redefines it locally.

---

### 2. Major — Inline money formatting drifts from the helper

**Location:** `app/admin/catalog/page.tsx:96`.

**Claim:** A fourth money-formatting pattern exists as an inline template literal, bypassing both `formatMoney` and `centsToDollars` and producing inconsistent output (no thousands separator, no Intl, manual `$` prefix).

**Evidence:**
```
${(product.priceCents / 100).toFixed(2)}
```
Renders `$1,299.00` via `formatMoney` on the storefront but `1299.00` (with a leading `$` from the template string `${...}`) in admin — different formatting for the same field across screens. UI consistency rule ("if a new screen looks different from the rest of the app, that's a bug") applies to numeric presentation.

---

### 3. Major — Dead code: `lib/settings.ts` is unused

**Location:** `lib/settings.ts:1-19`.

**Claim:** The in-memory `SettingMap` with `getSetting`/`setSetting` is never imported by any file in the workspace. It is dead code that also introduces a competing settings pattern to the live Prisma `AppSetting` store used by `app/api/admin/settings/route.ts`.

**Evidence:** Grep for `from "@/lib/settings"`, `getSetting`, `setSetting` across the arm-05 workspace returns only the definition file itself — zero call sites. Meanwhile `delivery.zipCodes` and `storeStatus` are persisted via `prisma.appSetting` (`app/api/admin/settings/route.ts:35-43`). Two settings stores, one unused. Violates "Dead code — delete, don't comment out" and "one state management pattern per project."

---

### 4. Major — Duplicated fetch logic inside the admin catalog page

**Location:** `app/admin/catalog/page.tsx:16-30`.

**Claim:** The same `GET /api/admin/catalog` fetch is implemented twice in one component: a named `loadCatalog` function (lines 16-21) and an inline `useEffect` fetch (lines 23-30) that re-implements the same `.then(async (r) => ({ ok: r.ok, body: await r.json() }))` chain instead of calling `loadCatalog`.

**Evidence:**
```16:21:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/admin/catalog/page.tsx
  async function loadCatalog() {
    const response = await fetch("/api/admin/catalog");
    const body = await response.json();
    setMessage(response.ok ? "" : body.error);
    if (response.ok) setCatalog(body);
  }
```
```23:30:runs/2026-07-20-1748-tomchei-shabbos-website-model_duel/arms/arm-05/workspace/app/admin/catalog/page.tsx
  useEffect(() => {
    void fetch("/api/admin/catalog")
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (ok) setCatalog(body);
        else setMessage(body.error);
      });
  }, []);
```
The `useEffect` should call `loadCatalog()`. As written, two code paths must be kept in sync for the same endpoint.

---

### 5. Minor — Inconsistent JSON body parsing across API routes

**Location:** `app/api/newsletter/route.ts:14,21` (uses `.catch(() => null)`); `app/api/admin/catalog/route.ts:37`, `app/api/admin/settings/route.ts:30`, `app/api/staff/route.ts:26`, `app/api/staff/[staffId]/route.ts:24`, `app/api/client-error/route.ts:14`, `app/api/setup/route.ts:30` (do not).

**Claim:** Only the newsletter route guards against invalid JSON with `.catch(() => null)`, so `safeParse` receives `null` and returns a clean 400. The other six routes let `request.json()` throw on malformed bodies, producing an unhandled 500 instead of a 400. One error-handling pattern per project is violated.

**Evidence:** Grep for `await request.json()` returns 8 hits; only 2 (newsletter POST + DELETE) append `.catch(() => null)`. The pattern drift means malformed-JSON behavior depends on which route is hit.

---

### 6. Minor — Duplicated admin auth+origin boilerplate

**Location:** `app/api/admin/catalog/route.ts:18-20,33-35`; `app/api/admin/media/route.ts:8-11`; `app/api/admin/settings/route.ts:12-14,26-28`.

**Claim:** The same two-line authorization check plus the same one-line `hasSameOrigin` check are repeated 6 times across the three P3 admin routes, all gating the `settings.manage` permission.

**Evidence:** Each handler opens with:
```
const authorization = await authorize(request, "settings.manage");
if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
```
and each mutating handler additionally repeats:
```
if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
```
A `requireSettingsManage(request)` helper returning `{ staffMember } | NextResponse` would collapse 6 sites to one. Rule of 2 is satisfied. Borderline against the "if removing duplication adds more lines than it saves, leave it" rule, but the helper would also centralize the 403 origin check.

---

### 7. Minor — Archive page re-implements product cards instead of reusing the grid

**Location:** `app/collections/page.tsx:18-26` vs `app/components/catalog-grid.tsx:51-67`.

**Claim:** The archive page hand-rolls its own `<article className="product-card">` with media/placeholder, name, description, price, and an "Archived" badge, duplicating the card structure already in `CatalogGrid`. The card JSX and the `{product.media ? <img .../> : <div className="product-placeholder">Purim collection</div>}` line are repeated verbatim.

**Evidence:** `app/collections/page.tsx:20` is byte-identical to `app/components/catalog-grid.tsx:55`:
```
{product.media ? <img alt="" src={product.media.url} /> : <div className="product-placeholder">Purim collection</div>}
```
A shared `ProductCard` (or `CatalogGrid` with an `archived` mode) would remove the duplication. The "no wrapper components under 5 lines of JSX" rule does not apply here — the card carries real structure (media fallback, sold-out/archived badge, actions).

---

### 8. Minor — `isOpen` derivation repeated across four storefront pages

**Location:** `app/page.tsx:8-11`, `app/catalog/page.tsx:8-11`, `app/collections/page.tsx:7-9`, `app/order/page.tsx:7-8`.

**Claim:** Each storefront page independently computes `const { currentSeason } = await getStorefront();` then passes `isOpen={Boolean(currentSeason)}` to `StorefrontShell`. The `isOpen` semantic ("is there an open season?") is re-derived in four places; a `StorefrontShell` that fetches its own open-state, or a `getStorefrontOpen()` helper, would collapse it.

**Evidence:** Four occurrences of `Boolean(currentSeason)` passed as `isOpen`. Low-impact duplication (one line each), but it is pattern drift: the gate decision lives in the page instead of in the shell that renders the closed banner.

---

### 9. Minor — Client-side cents conversion can produce non-integer `priceCents`

**Location:** `app/admin/catalog/page.tsx:43`.

**Claim:** `Number(form.get("priceDollars")) * 100` is sent to the server as `priceCents`. For decimal dollar inputs like `12.99`, JS floating-point yields `1298.9999999999998`, which the server's `z.number().int()` schema rejects — the save silently 400s for prices whose cent value is not a clean integer in binary. This is anti-AI-tics ("just in case" code that doesn't reason about the domain) and pattern drift from `formatMoney`/`centsToDollars` which already reason about cents correctly.

**Evidence:**
```
priceCents: Number(form.get("priceDollars")) * 100,
```
No `Math.round`. Server schema: `priceCents: z.number().int().min(0).max(1_000_000)` (`app/api/admin/catalog/route.ts:13`).

---

### 10. Nit — Vague standalone state name `message`

**Location:** `app/admin/catalog/page.tsx:14`, `app/admin/settings/page.tsx:9`, `app/unsubscribe/page.tsx:8`.

**Claim:** `const [message, setMessage] = useState("")` uses the generic name `message` for three different concerns (catalog save status, settings save status, unsubscribe status). `storefront-shell.tsx:9` already shows the better form: `newsletterMessage`. The naming rule ("no vague names") is satisfied in the shell but not in the admin pages.

**Evidence:** Three components declare `message` as the status string; the storefront shell declares `newsletterMessage`. Inconsistent naming for the same UI pattern (status banner).

---

### 11. Nit — Magic numbers in token and field length limits

**Location:** `lib/newsletter.ts:5`, `app/api/newsletter/route.ts:10`.

**Claim:** `tokenLifetimeMs = 1000 * 60 * 60 * 24 * 30` (30 days) and `z.string().min(20).max(1000)` for the unsubscribe token use magic numbers. The 30-day lifetime is named but the `20`/`1000` bounds are not. Minor; bounds are arbitrary and undocumented.

**Evidence:** `app/api/newsletter/route.ts:10`: `token: z.string().min(20).max(1000)`. No named constant for either bound.

---

### 12. Nit — Duplicated product filter predicate inside `getStorefront`

**Location:** `lib/storefront.ts:19` and `:34`.

**Claim:** `where: { isActive: true, kind: { not: "ADD_ON" } }` is written twice in the same function (once for the open season, once for archives). A shared `activeCatalogProductWhere` constant would remove the inline duplication and make the "catalog excludes add-ons" rule explicit.

**Evidence:** Two identical `where` objects 15 lines apart in the same `Promise.all`. Low impact — single file, stable expression — so leaving it duplicated is defensible under "if removing duplication adds more lines than it saves, leave it." Noted as a nit.
