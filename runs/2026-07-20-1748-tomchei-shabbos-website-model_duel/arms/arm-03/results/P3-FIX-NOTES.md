# P3 Fix Notes — arm-03

Single-pass fix after `AGGREGATE-REVIEW-P3.md`. Smoke re-run: **pass** (`.scratch/PHASE-P3-SMOKE.md`, 2026-07-21T15:14:00Z).

## Fixed

| ID | Finding | Fix |
|---|---|---|
| B1 | No P3 smoke evidence | Ran `npm run smoke:p3`; wrote `.scratch/PHASE-P3-SMOKE.md` with S1–S5 proof |
| B2 | `edit()` resets `onHand` to 10 | `catalog-admin` loads `product.inventory?.onHand`; Clear uses shared empty form |
| B3 | Media not linked to products | Upload + library “Link to selected product” sets `primaryImageUrl` + `mediaAssetId` via `linkMediaToProduct` |
| B4 | `/order` closure page-only | Middleware enforces `/order(.*)` via `/api/storefront/status`; nested routes rewrite to gate |
| B5 | No Delete in catalog/add-on CRUD | DELETE soft-deactivates (`isActive: false`) + Delete buttons in both admin UIs |
| B6 | Newsletter HMAC public fallback | `secret()` throws if `NEWSLETTER_HMAC_SECRET` missing; no APP_URL/constant fallback |
| H1 | Preferences IDOR | POST requires signed `token`; email alone rejected |
| H2 | Upload extension vs MIME | Allowlist ext↔MIME; block `.html`/`.svg`/etc. |
| H3 | Subscribe returns unsubscribe token | API returns `{ ok, email }` only; form no longer shows token |
| L3 | Prefs audit action (trivial) | Still uses `NEWSLETTER_SUBSCRIBED` + `prefsUpdated` meta (enum has no dedicated action) |

## Deferred

| ID | Severity | Why deferred |
|---|---|---|
| M1 | Medium | Local disk Blob stand-in is intentional ponytail vs Vercel Blob |
| M2 | Medium | Prefs UI / unsubscribe confirm UX — not blocking S3 |
| M3 | Medium | Storefront user menu shell — EXPECTED polish |
| M4 | Medium | Dev auth spoof header — AUTH_MODE=dev only |
| M5–M9 | Medium | Expectation/run-state/codegraph/gitignore archive hygiene |
| M10–M17 | Medium | Include drift, types, dedupe, magic values, UI primitives |
| L1 | Low | Unsubscribe reason codes / double-verify |
| L2 | Low | Inventory XOR outside tx snapshot |
| L4–L5 | Low | Quick-view a11y / naming |

## Smoke summary

All checks passed: S1a–c, S2a–c (incl. nested `/order/*`), S3 (no token leak + IDOR reject), S4 (PNG ok / txt+html+svg reject + media→product link), S5 (delivery ZIP gate).
