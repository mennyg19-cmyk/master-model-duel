# Reviewer — Rules — arm-01 (Test 4, P3)

**Arm:** arm-01
**Tree / phase:** `arms/arm-01/workspace/` — Phase P3 (storefront: marketing, catalog, archive, newsletter, admin catalog & media, settings hub)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol
**Reviewer:** orchestrator (independent of contestants)
**Scope:** findings only — adherence to arm-01's selected catalog rules.

---

## ponytail

- **MINOR — ladder tags still absent on P3 shortcuts.** `src/lib/newsletter.ts` (HMAC via `node:crypto` stdlib), `src/app/api/admin/media/route.ts` (`@vercel/blob` — native Vercel platform, rung 3), and the `data:`-URL smoke fallback in the same route are all deliberate ladder choices the rule asks to tag with a `ponytail:` comment (name ceiling + upgrade path). None present. (Carried pattern from P2.)
- **MINOR — smoke/test fallback branch lives in production source.** `src/app/api/admin/media/route.ts:50-56` stores base64 image payloads as `data:` URLs when `ENABLE_TEST_AUTH === "true"`. Gated by env, so acceptable at runtime, but it is test scaffolding inside a production route handler — same shape as the P2 test-doubles-in-`src/domain` finding. Tag it or move the branch behind a dedicated adapter.
- **MINOR — quick-view modal a11y is incomplete (ponytail "never cut a11y").** `src/components/catalog-explorer.tsx:134-192` sets `role="dialog"`/`aria-modal="true"`/`aria-label`, but focus is not moved into the dialog on open, there is no focus trap, and Escape does not close. The close button is keyboard-reachable only via Tab from outside the dialog.
- **MINOR — mobile menu a11y is incomplete.** `src/components/storefront-header.tsx:59-84` toggles with `aria-expanded` and `aria-label`, but opening the menu does not move focus into it, and the menu is not a focus trap. Basic aria is present; focus management is not.

## clean-code

- **VIOLATION — newsletter HMAC token logic is untested (Anti-Hallucination).** `src/lib/newsletter.ts` implements security-sensitive behavior — `createNewsletterToken`/`verifyNewsletterToken`, `timingSafeEqual` comparison, expiry, `extraPart` rejection, 30-day lifetime — with zero tests. The README claims "signed 30-day HMAC links" and the settings hub advertises "HMAC signed · 30 days." Anti-hallucination: "Do not claim 'fixed/passed/working' without tool output or running-app evidence." The P2 pattern (real domain behavior untested) persists into P3.
- **VIOLATION — duplicated fetch/JSON/setMessage mutation pattern across 5+ client components.** The same shape — `await fetch(...)` → `await response.json()` → `if (!response.ok) { setMessage(payload.error); return; }` → optimistic state update — appears in `newsletter-form.tsx`, `newsletter-preferences.tsx` (×2), `catalog-manager.tsx` (createProduct, updateProduct, archiveProduct), `media-manager.tsx` (uploadImage, assignPhoto), and `settings-hub.tsx` (saveSettings). Clean-code: "No copy-paste patterns with minor variations — extract the pattern." Rule of 2 is met several times over. Extract a `useApiMutation` hook (or a `fetchJson` helper) into `src/lib/`.
- **VIOLATION — inconsistent admin error-handling pattern persists into P3.** `src/app/api/admin/catalog/route.ts:6-11` centralizes `AccessDeniedError → 403` in a local `handleCatalogError` helper, while `src/app/api/admin/media/route.ts:87-90` and `src/app/api/admin/settings/route.ts:50-54` inline the same `instanceof AccessDeniedError` block. One project, two patterns for the same concern. Lift the conversion into `requirePermission` (return a `NextResponse`) or a shared `withStaffRoute` wrapper. (Carried from P2.)
- **VIOLATION — settings mutation is not transactional with its audit log.** `src/app/api/admin/settings/route.ts:25-48` runs `db.season.update`, `saveDeliveryZips`, then a separate `db.auditLog.create` outside any `$transaction`. The catalog route (`api/admin/catalog/route.ts:42-66`) correctly wraps the change and its audit row in `db.$transaction`. If the audit write fails in the settings route, the settings change is persisted unaudited. Inconsistent audit pattern + trust-boundary gap (workflow "audit trail").
- **MINOR — hand-retyped client types drift from Prisma schema.** `ManagedProduct` (`catalog-manager.tsx:7-21`), `MediaAsset`/`ProductWithoutPhoto` (`media-manager.tsx:6-19`), `SeasonChoice`, `CatalogProduct` (`catalog-explorer.tsx:8-22`), and `Preferences` (`newsletter-preferences.tsx:5-11`) all re-declare shapes Prisma already generates. Use `Prisma.XGetPayload<{ select: ... }>` (or a shared `Pick`) so the client tracks schema changes. (Carried from P1/P2.)
- **MINOR — archive (DELETE) skips the optimistic-version guard that PATCH enforces.** `catalog-manager.tsx:78-95` calls DELETE with no version, and `api/admin/catalog/route.ts:134-150` uses `db.product.update` without a version check. PATCH guards `version` and returns 409 on stale writes. Same resource, two concurrency contracts.
- **MINOR — magic default postal code.** `src/lib/store-settings.ts:10` falls back to `["08701"]` as a bare literal. Named constant or `.env` entry.
- **MINOR — type drift / redundant assertion.** `catalog-explorer.tsx:32-33` types `category` and `sort` as bare `string` instead of a union of valid values; `newsletter-preferences.tsx:54` uses `as boolean` to coerce a value that is `string | boolean`. Narrow both.

## workflow

- **VIOLATION — no running-app smoke evidence for P3.** `shared/phases/PHASE-P3-EXPECTED.md` mandates `.scratch/PHASE-P3-SMOKE.md` with S1–S5 evidence (storefront UX, season gate, newsletter round-trip, media+catalog, delivery-ZIP). No `.scratch/` artifacts exist under `arms/arm-01/workspace/`. The README asserts the same behaviors with no tool-output evidence. Workflow: "Verify in the running app — never mark done from code alone. An empty 200 is not working: seed data, exercise the real flow." (Carried from P2.)
- **MINOR — no `.scratch/phase-plan.md` with EXPECTED blocks visible.** Workflow expects a rolling phase plan written before each P3 todo and walked afterward with evidence. No artifact survives. (`.scratch/` is gitignored, so absence is not proof — but it compounds the verification gap above.) (Carried from P2.)

## vocabulary

- **PASS — term accuracy.** README and code use exact P3 terms ("storefront", "current-season catalog", "archive", "newsletter preferences", "media library", "settings hub", "delivery ZIPs", "replacement link"). No refactor/tidy/rebuild commands were issued this phase, so the scope table is not exercised. No findings.

## codegraph

- **PARTIAL — index present, process not verifiable.** `.codegraph/` exists in the workspace, so `codegraph init` was run. The rule's hard requirement — CodeGraph (MCP/CLI) for all structural lookups, no grep-for-symbols — governs the development process and cannot be confirmed from the build artifact alone. No findings against the artifact; flagged as non-evaluable for process adherence. (Same as P2.)

## grill-protocol

- **PASS — deferred scope is honestly delineated.** The cart builder is explicitly deferred to P4 (`/order` page copy + README), rate rules to P8 (settings hub copy), email/campaign platform to P11 (settings hub Email tab), replacement-mapping admin to P10. No invented product direction; open scope is surfaced, not silently dropped. Aligns with grill-protocol's "automate implementation and verification, not product decisions."

---

## Summary

| Rule | Findings | Severity |
|---|---|---|
| ponytail | 0 violations + 4 minors (no ladder tags; smoke fallback in prod route; modal a11y focus; mobile-menu a11y focus) | mixed |
| clean-code | 4 violations (newsletter HMAC untested; duplicated fetch-mutation pattern; inconsistent admin error handling; settings audit not transactional) + 4 minors (hand-retyped client types; archive no version guard; magic "08701"; type drift / redundant assertion) | mixed |
| workflow | 1 violation (no P3 smoke evidence) + 1 minor (no phase-plan evidence) | mixed |
| vocabulary | 0 | clean |
| codegraph | index present; process not verifiable | n/a |
| grill-protocol | 0 | clean |

Findings: **5 violations + 9 minors = 14 findings.**

Strongest: season-aware storefront with sticky header, closed-banner, mobile menu, archive browse-only enforcement, server-side `/order` season + delivery-ZIP gate, HMAC-signed newsletter preference tokens with `timingSafeEqual`, optimistic-version-guarded catalog PATCH, restricted/validated media uploads with audit rows, and a tabbed settings hub wired to live store config. Weakest: the security-critical HMAC token path has no tests while the README advertises its guarantees, the fetch-mutation pattern is copy-pasted across six client components, admin error handling still has two patterns, and the settings route writes its audit log outside the transaction that changed the settings — all cheap to fix and they close the gap between the README's claims and what tool output actually demonstrates.
