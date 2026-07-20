# Aggregate Review — P3 — arm-01

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-01`
**Phase:** P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media, settings hub
**Output:** `arms/arm-01/results/AGGREGATE-REVIEW-P3.md`

**Inputs aggregated:**
- `results/reviews/P3-security-arm-01.md` (10 findings: 1 HIGH, 3 MED, 4 LOW, 2 INFO)
- `results/reviews/P3-quality-arm-01.md` (9 findings: 5 medium, 4 low)
- `results/reviews/P3-rules-arm-01.md` (14 findings: 5 VIOLATION + 9 MINOR)
- `results/reviews/P3-clean-code-arm-01.md` (13 findings: 3 High + 6 Medium + 4 Low)

**Method:** Union + dedupe by location+claim. Security blockers survive. No new findings introduced during aggregation.

**Severity mapping:** security HIGH + quality Critical = **blocker**; security MED + quality medium + rules VIOLATION + clean-code High/Medium = **major**; security LOW + quality low + rules MINOR + clean-code Low = **minor**; Informational = **minor (info)**.

---

## Counts

| Severity | Count |
|---|---|
| Blocker | 1 |
| Major | 20 |
| Minor | 21 |
| **Total** | **42** |

---

## Blockers (1)

### B1 — Test-auth header backdoor grants full identity takeover when `ENABLE_TEST_AUTH=true`
**Sources:** SEC H1
**Locations:** `src/lib/auth.ts:14-24`
**Claim:** `getAuthenticatedClerkUserId()` falls back, when `ENABLE_TEST_AUTH === "true"`, to the attacker-controlled `x-test-clerk-user-id` header (default `__local_manager__`). The value is used directly as `clerkUserId` to look up or bootstrap a `StaffUser` with `MANAGER` role. Any caller can set the header to impersonate any known staff user or become the first active MANAGER. No IP allowlist, no signing, no env guard beyond the single boolean. `.env.example` ships it `false` with a warning, but nothing in code prevents the flag from being flipped in a deployed environment — a misconfigured preview/prod env = complete auth bypass + privilege escalation to MANAGER. Highest-impact trust-boundary issue in the phase.

---

## Majors (20)

### A1 — Unsigned `impersonate_staff_id` cookie enables audit-bypassing impersonation
**Sources:** SEC M1
**Locations:** `src/lib/auth.ts:43-54`; `src/app/api/admin/impersonation/route.ts:51-57`
**Claim:** Impersonation selector stored as a raw unsigned cookie containing the target staff ID. `getCurrentStaffUser` reads it verbatim; the only guard in `requirePermission` is `staff:impersonate`, which any MANAGER has. A MANAGER can craft the cookie to any active staff ID and skip `POST /api/admin/impersonation` — the only place `ImpersonationSession` and `staff.impersonation_started` audit rows are written. Result: acting under another staff identity with no session row and no audit entry, defeating the audit trail the feature exists to create.

### A2 — Bootstrap `/api/setup` lets any Clerk-signed-up user become the first MANAGER
**Sources:** SEC M2
**Locations:** `src/app/api/setup/route.ts:16-72`
**Claim:** `POST /api/setup` only requires a Clerk identity — no pre-approval/allowlist. If Clerk allows public signups, any anonymous visitor can create an account and, before the first manager is bootstrapped, race to install themselves as the sole MANAGER and lock bootstrap state. The transactional lock prevents two managers but not an attacker winning the race against the legitimate operator. Outcome is full admin takeover.

### A3 — Newsletter subscribe returns a valid capability token to the caller for any email
**Sources:** SEC M3
**Locations:** `src/app/api/newsletter/subscribe/route.ts:16-28`; `src/app/api/newsletter/preferences/route.ts:31-57`; `src/lib/newsletter.ts:6`
**Claim:** `POST /api/newsletter/subscribe` is unauthenticated and returns `preferencesUrl` containing a freshly signed HMAC token bound to the (re)subscribed email. The token is a bearer capability for `GET/PATCH /api/newsletter/preferences` with a 30-day lifetime. An attacker can subscribe a victim's email and immediately get read access to the victim's subscription state and write access to unsubscribe/alter prefs — without ever controlling the victim's inbox. Email ownership is never established.

### A4 — Archive (DELETE) bypasses the optimistic-version guard used by PATCH
**Sources:** Q F1, RULES clean-code MINOR (archive no version guard)
**Locations:** `src/app/api/admin/catalog/route.ts:134` (DELETE); `src/components/catalog-manager.tsx:78`
**Claim:** DELETE hard-codes `db.product.update({ where: { id }, data: { isActive: false, version: { increment: 1 } } })` with no `version` predicate, while PATCH correctly uses `updateMany({ where: { id, version } })` returning 409 on mismatch. Two staff archiving the same row concurrently both succeed; the client locally guesses `version + 1` from a `{ archived: true }` response, so the next edit sends a stale version and hits a spurious 409. EXPECTED item 6 ("optimistic updates, audit entries") is only half-implemented.

### A5 — Catalog PATCH allows blanking required `name` and `priceCents`
**Sources:** Q F3
**Locations:** `src/app/api/admin/catalog/route.ts:100`; `src/components/catalog-manager.tsx:199,210`
**Claim:** PATCH writes `name: body.name?.trim()` and `priceCents: body.priceCents` directly from the body. POST rejects missing/blank name and non-integer/negative price, but PATCH only validates price when defined and never validates `name`. `CatalogManager.updateProduct` fires PATCH on every `onBlur`, including an empty name field — the server persists `name: ""`. A staff member clearing the display-name input and tabbing away silently renames the product to an empty string.

### A6 — Newsletter preferences PATCH resets `unsubscribedAt` when `isSubscribed` is omitted
**Sources:** Q F4
**Locations:** `src/app/api/newsletter/preferences/route.ts:42`
**Claim:** Writes `unsubscribedAt: body.isSubscribed === false ? new Date() : null` unconditionally. Any PATCH that omits `isSubscribed` (e.g. a future caller updating only `productUpdates`) sets `unsubscribedAt` to `null` even if the subscriber legitimately unsubscribed earlier — silently re-subscribing them. Latent today (UI always sends `isSubscribed`) but the API contract is wrong; EXPECTED item 5 (HMAC unsubscribe) depends on `unsubscribedAt` being preserved.

### A7 — Quick-view modal has no escape, backdrop-close, or focus trap
**Sources:** Q F5, RULES ponytail MINOR (modal a11y)
**Locations:** `src/components/catalog-explorer.tsx:134-192`
**Claim:** `role="dialog"` `aria-modal="true"` overlay whose only close path is the `×` button. No `Escape` handler, no backdrop-click handler, no focus move into the dialog on open, no focus trap, no body scroll lock. EXPECTED item 3 lists "quick view" as delivered and S1 smoke only asserts the trigger string renders; close/keyboard behavior is untested and broken. Keyboard/screen-reader users cannot dismiss without tabbing to the close button.

### A8 — Smoke mutates the current-season status and does not restore it
**Sources:** Q F7
**Locations:** `.scratch/p3-smoke.ts:25,57` (vs `:139` for S5 restore pattern)
**Claim:** Smoke force-sets the current season to `OPEN` at start, toggles `CLOSED`/`OPEN` through S2, and leaves it `OPEN` at the end. The original season status is never captured or restored, unlike S5 which snapshots `originalZipSetting`. If the seed or a prior test left the season `CLOSED`, this run silently flips it to `OPEN` for any subsequent test/reviewer step. S2's "closed season hides checkout" assertion is exercised against a season the smoke itself opened; post-smoke state differs from pre-smoke state — a real regression risk for later phases that read store status.

### A9 — Newsletter HMAC token logic is untested (Anti-Hallucination)
**Sources:** RULES clean-code VIOLATION
**Locations:** `src/lib/newsletter.ts` (`createNewsletterToken`/`verifyNewsletterToken`, `timingSafeEqual`, expiry, `extraPart` rejection, 30-day lifetime)
**Claim:** Security-sensitive behavior implemented with zero tests. The README claims "signed 30-day HMAC links" and the settings hub advertises "HMAC signed · 30 days." Anti-hallucination: "Do not claim 'fixed/passed/working' without tool output or running-app evidence." The P2 pattern (real domain behavior untested) persists into P3.

### A10 — Duplicated fetch/JSON/setMessage mutation pattern across 6 client components
**Sources:** RULES clean-code VIOLATION, CC F4
**Locations:** `newsletter-form.tsx`, `newsletter-preferences.tsx` (×2), `catalog-manager.tsx` (createProduct/updateProduct/archiveProduct), `staff-manager.tsx` (×3), `media-manager.tsx` (uploadImage/assignPhoto), `settings-hub.tsx` (saveSettings)
**Claim:** Same shape — `await fetch(...)` → `await response.json()` → `if (!response.ok) { setMessage(payload.error); return; }` → optimistic state update — copy-pasted across six components. Rule of 2 met several times over. Extract a `useApiMutation` hook (or `apiFetch`/`fetchJson` helper) into `src/lib/`.

### A11 — `AccessDeniedError → 403` handler duplicated across every admin route
**Sources:** RULES clean-code VIOLATION, CC F1
**Locations:** `src/app/api/admin/{catalog,staff,settings,media,impersonation,overview}/route.ts`
**Claim:** Same "convert `AccessDeniedError` to 403, rethrow otherwise" block reimplemented in six routes in two shapes: helper-function variant (`catalog/route.ts:6-11` `handleCatalogError`, `staff/route.ts:9-14` `permissionError`) and inline `if (error instanceof AccessDeniedError)` variant (`impersonation/route.ts:60-64,103-107`, `overview/route.ts:22-26`, `settings/route.ts:51-55`, `media/route.ts:87-91`). One project, two patterns. Lift into a shared `withStaffRoute` wrapper or `accessDeniedResponse()` in `lib/auth.ts`.

### A12 — Settings mutation is not transactional with its audit log
**Sources:** RULES clean-code VIOLATION
**Locations:** `src/app/api/admin/settings/route.ts:25-48`
**Claim:** Runs `db.season.update`, `saveDeliveryZips`, then a separate `db.auditLog.create` outside any `$transaction`. The catalog route (`api/admin/catalog/route.ts:42-66`) correctly wraps the change and its audit row in `db.$transaction`. If the audit write fails in the settings route, the settings change is persisted unaudited. Inconsistent audit pattern + trust-boundary gap (workflow "audit trail").

### A13 — No running-app smoke evidence for P3
**Sources:** RULES workflow VIOLATION
**Locations:** `shared/phases/PHASE-P3-EXPECTED.md` (requires `.scratch/PHASE-P3-SMOKE.md` S1–S5); `arms/arm-01/workspace/` (no `.scratch/` artifacts); README P3 section
**Claim:** EXPECTED mandates `.scratch/PHASE-P3-SMOKE.md` with S1–S5 evidence (storefront UX, season gate, newsletter round-trip, media+catalog, delivery-ZIP). No `.scratch/` artifacts exist under the workspace. The README asserts the same behaviors with no tool-output evidence. Workflow: "Verify in the running app — never mark done from code alone." (Carried from P2.)

### A14 — Invitation token hashing duplicated
**Sources:** CC F2
**Locations:** `src/app/api/admin/staff/route.ts:66`; `src/app/api/staff/accept-invite/route.ts:23`
**Claim:** Both routes compute `createHash("sha256").update(inviteToken).digest("hex")` inline. The hash algorithm, encoding, and the implicit "token is hashed with sha256/hex before lookup" contract are duplicated knowledge. Centralize in a `hashInviteToken(token)` helper in `lib/ids.ts` next to `createSecureToken`.

### A15 — Staff list ordering drifts between page and API
**Sources:** CC F3
**Locations:** `src/app/(admin)/admin/staff/page.tsx:10`; `src/app/api/admin/staff/route.ts:20`
**Claim:** Page fetches `orderBy: { createdAt: "asc" }` while the staff API `GET` returns `orderBy: { displayName: "asc" }`. Same entity, two different default orderings depending on entry point — a latent UI inconsistency. Pick one canonical ordering for `StaffUser` reads and reuse it.

### A16 — Status-message UI pattern duplicated across client components
**Sources:** CC F5
**Locations:** `catalog-manager.tsx:31,152-156`; `staff-manager.tsx:25,118-122`; `media-manager.tsx:33,154-158`; `settings-hub.tsx:22,166-170`; `newsletter-preferences.tsx:15,80`
**Claim:** `const [message, setMessage] = useState("")` plus the identical `aria-live="polite"` status paragraph is copy-pasted into five components. Extract a `useStatusMessage()` hook paired with a `<StatusMessage>` component — exactly the 2+ real call sites case.

### A17 — Product image tile duplicated between home and catalog explorer
**Sources:** CC F6
**Locations:** `src/app/(storefront)/page.tsx:91-112`; `src/components/catalog-explorer.tsx:81-129`
**Claim:** Featured-product card on home and `CatalogExplorer` grid card render the same structure: `aspect-[4/3]` image tile with alternating `index % 2 ? "bg-[#eef0e7]" : "bg-[var(--brand-soft)]"` background, identical `Image` sizing, `imageUrl ?? "/purim-ribbon.svg"` fallback, and the same category/name/price block. Extract a shared `<ProductCard product={...} index={n} />`.

### A18 — Hardcoded hex colors instead of design tokens
**Sources:** CC F7
**Locations:** `src/app/global-error.tsx:12-25`; `src/components/catalog-explorer.tsx:88`; `src/app/(storefront)/page.tsx:97`; `src/components/media-manager.tsx:147`
**Claim:** Entire codebase uses CSS custom properties (`var(--brand)`, `--ink`, `--muted`, `--cream`, `--brand-soft`) except: `global-error.tsx` uses `#f7f3f7`/`#8f2f67`/`#241f2d`/`#6f6878` (clearly `--cream`/`--brand`/`--ink`/`--muted`); `catalog-explorer.tsx:88` and `page.tsx:97` use `#eef0e7` for alternating tile bg; `media-manager.tsx:147` uses `#eef6ec`/`#35633d` for the success panel. Promote to tokens (`--tile-alt`, `--success-soft`, `--success-ink`) so the palette has one source of truth.

### A19 — AppSetting key strings scattered as magic strings
**Sources:** CC F8
**Locations:** `src/lib/storefront.ts:5`; `src/lib/store-settings.ts:3`; `prisma/seed.ts:14,26,45`
**Claim:** `store-settings.ts` defines `const deliveryZipKey = "delivery-zips"`, but `storefront.ts:5` inlines `"current-season-id"`, and `seed.ts` inlines `"organization"`, `"delivery-zips"` (×2), `"current-season-id"` (×2). The `delivery-zips` literal now lives in two files with no shared constant; a key rename would miss either the seed or the lib. Centralize AppSetting keys in one place (e.g. `APP_SETTING_KEYS` in `lib/store-settings.ts`).

### A20 — `getCurrentSeason` / `getArchivedSeasons` duplicate the product include
**Sources:** CC F9
**Locations:** `src/lib/storefront.ts:11-23` and `:26-37`
**Claim:** Both queries repeat the same product relation filter (`products: { where: { kind: "PACKAGE", isActive: true }, orderBy: { name: "asc" }, ... }`). Extract a `seasonProductInclude` constant (or `seasonWithProducts` Prisma helper) so the "active packages only, sorted by name" rule is stated once.

---

## Minors (21)

### m1 — `CLIENT_ERROR_TOKEN` declared but never enforced
**Sources:** SEC L1
**Locations:** `src/lib/env.ts:5,21`; `src/app/api/client-errors/route.ts`
**Claim:** `ServerEnvironment` declares `CLIENT_ERROR_TOKEN` and `.env.example` documents it as "Optional bounded client-error ingestion token," but `POST /api/client-errors` never reads or validates it. Endpoint is fully unauthenticated and writes attacker-supplied `route`/`category` strings (truncated to 200/80) to `console.error` — an unauthenticated log-injection/spam vector the documented token gate was intended to prevent.

### m2 — Newsletter bearer token transported in URL query string
**Sources:** SEC L2
**Locations:** `src/app/(storefront)/newsletter/preferences/page.tsx:8`; `src/components/newsletter-preferences.tsx:18`; `src/app/api/newsletter/preferences/route.ts:13`
**Claim:** 30-day capability token passed as `?token=...` on the preferences page and on `GET /api/newsletter/preferences`. Tokens in URLs persist in browser history, server access logs, and any `Referer` leakage. The page loads no third-party assets (limiting `Referer` exposure) but URL persistence in logs/history remains a 30-day-capability disclosure surface.

### m3 — Media upload trusts client-declared `Content-Type` with no magic-byte validation
**Sources:** SEC L3
**Locations:** `src/app/api/admin/media/route.ts:29-49`
**Claim:** Upload gate checks `upload.type` (client-supplied MIME) against an allowlist and stores the asset to Vercel Blob with `contentType: upload.type`. No magic-byte/sniff validation. An attacker with `settings:manage` (or via compromised manager) can upload arbitrary bytes labeled `image/jpeg`. SVG is correctly excluded (mitigating inline-script XSS). Bounded by the `settings:manage` requirement and public-blob `nosniff` behavior.

### m4 — `imageUrl` accepted from admin body without scheme/host validation
**Sources:** SEC L4
**Locations:** `src/app/api/admin/catalog/route.ts:52,105`; `src/components/media-manager.tsx:55-63`
**Claim:** `PATCH /api/admin/catalog` stores `imageUrl` verbatim from the request body (media manager sends the blob URL, but the API accepts any string). Rendering goes through `next/image` whose `remotePatterns` (`next.config.ts:10-17`) restrict to `*.public.blob.vercel-storage.com`, so malicious external/`javascript:`/`data:` URLs fail to render rather than execute. Residual risk is stored-URL injection of a disallowed host that breaks rendering or attempts SSRF via the next/image optimizer.

### m5 — `/api/health` discloses auth mode
**Sources:** SEC I1 (info)
**Locations:** `src/app/api/health/route.ts:12`
**Claim:** Unauthenticated health endpoint returns `auth: "clerk" | "local-development"`. In a deployed environment where Clerk is not yet configured, this publicly signals local-development mode — a reconnaissance hint that pairs with B1/A2 (bootstrap and test-auth exposure). No direct exploit.

### m6 — `setup` GET leaks bootstrap lock state to anonymous callers
**Sources:** SEC I2 (info)
**Locations:** `src/app/api/setup/route.ts:9-14`
**Claim:** `GET /api/setup` is unauthenticated and reports `{ locked: boolean }`. Before bootstrap, it tells any caller the first-manager race window (A2) is still open. Informational only; combined with A2 it shortens an attacker's reconnaissance step.

### m7 — DELETE on unknown product id throws 500 instead of 404
**Sources:** Q F2
**Locations:** `src/app/api/admin/catalog/route.ts:140`; `src/components/catalog-manager.tsx:225`
**Claim:** `db.product.update` with an unchecked `id` from the query string. If the id does not exist or is malformed, Prisma throws `P2025`, which is not an `AccessDeniedError`, so `handleCatalogError` re-throws and Next.js returns 500. A missing product should return 404. The same pattern exists for `replacementProductId` on PATCH — no existence/same-kind validation server-side; the client filter is the only enforcement and is trivially bypassed.

### m8 — EXPECTED "user menu" in the storefront shell is missing
**Sources:** Q F6
**Locations:** `src/components/storefront-header.tsx`; `shared/phases/PHASE-P3-EXPECTED.md` item 2
**Claim:** EXPECTED item 2 requires the storefront shell to include "sticky header, desktop nav, mobile menu, **user menu**, footer signup, storewide closed banner." The header delivers all except the user menu; only a "Staff" link to `/admin` exists. Customer account is P4, so a full account menu is out of scope, but the EXPECTED line explicitly lists a user menu for P3 and it is absent. Either amend EXPECTED or add a placeholder user entry point.

### m9 — Smoke leaves orphan rows (product, media asset, newsletter subscriber) in the DB
**Sources:** Q F8
**Locations:** `.scratch/p3-smoke.ts:63,102,121,157`
**Claim:** Smoke creates a newsletter subscriber, a media asset, and a catalog product and never deletes them. Only `delivery-zips` is restored. The created product is active, kind `PACKAGE`, in the current season, so it permanently appears in the storefront grid and admin catalog list for every later run/review. EXPECTED item 6/3 assume a clean seeded catalog; the smoke pollutes it with a `Smoke Gift <timestamp>` row and a `smoke/` media asset, skewing later aggregate reviews and P4+ catalog behavior.

### m10 — `getArchivedSeasons` excludes non-CLOSED seasons, so a currently-OPEN past year is invisible in the archive
**Sources:** Q F9
**Locations:** `src/lib/storefront.ts:26`
**Claim:** Filters `where: { status: "CLOSED" }`. EXPECTED item 4 says "Past-collections archive (all years, browse only)." If a prior season is left `OPEN` (which is exactly what m8's smoke does, and is a legitimate transition state), it will not appear in `/collections` at all — the archive is "CLOSED seasons only," not "all past years." Either key off `year < currentYear` rather than `status`, or reconcile EXPECTED wording with the implementation.

### m11 — Ladder tags still absent on P3 shortcuts
**Sources:** RULES ponytail MINOR
**Locations:** `src/lib/newsletter.ts` (HMAC via `node:crypto`); `src/app/api/admin/media/route.ts` (`@vercel/blob` rung 3); `data:`-URL smoke fallback in same route
**Claim:** Deliberate ladder choices the rule asks to tag with a `ponytail:` comment (name ceiling + upgrade path). None present. Carried pattern from P2.

### m12 — Smoke/test fallback branch lives in production source
**Sources:** RULES ponytail MINOR
**Locations:** `src/app/api/admin/media/route.ts:50-56`
**Claim:** Stores base64 image payloads as `data:` URLs when `ENABLE_TEST_AUTH === "true"`. Gated by env, so acceptable at runtime, but it is test scaffolding inside a production route handler — same shape as the P2 test-doubles-in-`src/domain` finding. Tag it or move the branch behind a dedicated adapter.

### m13 — Mobile menu a11y is incomplete
**Sources:** RULES ponytail MINOR
**Locations:** `src/components/storefront-header.tsx:59-84`
**Claim:** Toggles with `aria-expanded` and `aria-label`, but opening the menu does not move focus into it, and the menu is not a focus trap. Basic aria is present; focus management is not.

### m14 — Hand-retyped client types drift from Prisma schema
**Sources:** RULES clean-code MINOR
**Locations:** `catalog-manager.tsx:7-21` (`ManagedProduct`); `media-manager.tsx:6-19` (`MediaAsset`/`ProductWithoutPhoto`); `catalog-explorer.tsx:8-22` (`SeasonChoice`/`CatalogProduct`); `newsletter-preferences.tsx:5-11` (`Preferences`)
**Claim:** Re-declares shapes Prisma already generates. Use `Prisma.XGetPayload<{ select: ... }>` (or a shared `Pick`) so the client tracks schema changes. Carried from P1/P2.

### m15 — Magic default postal code
**Sources:** RULES clean-code MINOR
**Locations:** `src/lib/store-settings.ts:10`
**Claim:** Falls back to `["08701"]` as a bare literal. Named constant or `.env` entry.

### m16 — Type drift / redundant assertion
**Sources:** RULES clean-code MINOR
**Locations:** `catalog-explorer.tsx:32-33`; `newsletter-preferences.tsx:54`
**Claim:** `category` and `sort` typed as bare `string` instead of a union of valid values; `newsletter-preferences.tsx:54` uses `as boolean` to coerce a `string | boolean`. Narrow both.

### m17 — No `.scratch/phase-plan.md` with EXPECTED blocks visible
**Sources:** RULES workflow MINOR
**Claim:** Workflow expects a rolling phase plan written before each P3 todo and walked afterward with evidence. No artifact survives. (`.scratch/` is gitignored, so absence is not proof — but it compounds the verification gap A13.) Carried from P2.

### m18 — `Button` component used inconsistently across admin forms
**Sources:** CC F10
**Locations:** `src/components/catalog-manager.tsx:148,175,183`; `src/components/media-manager.tsx:92,137`; `src/app/(admin)/admin/staff/staff-manager.tsx:116,127,151,153`
**Claim:** `Button` (`src/components/button.tsx`, `tone="primary"|"secondary"` with focus/disabled styling) is used throughout `staff-manager.tsx`, but `catalog-manager.tsx` and `media-manager.tsx` use raw `<button>` elements with hand-rolled class strings approximating `Button`'s secondary tone without the focus-visible/disabled affordances. Pick one: use `Button` everywhere or document why these two forms are raw.

### m19 — Audit-log "recent activity" query duplicated with different limits
**Sources:** CC F11
**Locations:** `src/app/api/admin/overview/route.ts:10-13`; `src/app/(admin)/admin/page.tsx:9-12`
**Claim:** Both the overview API route and the overview page issue `db.auditLog.findMany({ orderBy: { occurredAt: "desc" }, take: N })` with different `take` (12 vs. 6). The page renders the activity itself and ignores the API route's `recentAudit` — the API route returns data the page never fetches from. State the query once: either the page consumes the API, or the API drops the audit field.

### m20 — "Is impersonating" expression repeated
**Sources:** CC F12
**Locations:** `src/app/(admin)/admin/layout.tsx:27-28`; `src/app/api/admin/staff/route.ts:80,92`; `src/app/api/admin/overview/route.ts:17`
**Claim:** `staffSession.actor.id !== staffSession.effective.id` written four times. Add an `isImpersonating` getter on the session object returned by `getCurrentStaffUser`/`requirePermission` so the impersonation contract lives in `lib/auth.ts`.

### m21 — Admin nav links are hand-written per-route with drift
**Sources:** CC F13
**Locations:** `src/app/(admin)/admin/layout.tsx:52-72`
**Claim:** Sidebar nav duplicates the same `className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]"` on five `<Link>` elements, with the active "Overview" link using a different inlined class string at line 52. Nav items + permission gates are expressed inline rather than as data. A small `navItems` array (`href`, `label`, `permission`) mapped to a single `<NavLink>` would remove the class duplication and make permission gating consistent.

---

## Dedupe map (selected merges)

- Q F1 ≡ RULES clean-code MINOR (archive version guard) → **A4**
- Q F5 ≡ RULES ponytail MINOR (quick-view a11y) → **A7**
- RULES clean-code VIOLATION (fetch-mutation pattern) ≡ CC F4 → **A10**
- RULES clean-code VIOLATION (admin error handling) ≡ CC F1 → **A11**

---

## Fix-pass priority (orchestrator hint)

1. **B1** — gate test-auth behind a non-deployable build flag or remove from production builds
2. **A1, A2, A3** — sign the impersonation cookie; allowlist bootstrap identity; verify email ownership before issuing a newsletter capability token
3. **A4, A5, A6** — extend optimistic-version guard to DELETE; validate PATCH name/price; make `unsubscribedAt` write conditional on `isSubscribed` presence
4. **A9, A13** — add HMAC token tests; produce `.scratch/PHASE-P3-SMOKE.md` evidence
5. **A7, A8** — modal focus trap/escape/backdrop; snapshot+restore season status in smoke
6. **A10, A11, A12** — extract `apiFetch`/`useStatusMessage`; lift `withStaffRoute`; wrap settings+audit in `$transaction`
7. **A14–A20** — clean-code dedupe/consistency wins in a single pass
