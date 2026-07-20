# P3 Rules Review — arm-02

Reviewer specialist: Rules. Scope: P3 storefront + admin (catalog, archive, newsletter, media, settings) under `arms/arm-02/workspace/`. Graded against this arm's selected rules only: `ponytail`, `clean-code`, `workflow`, `vocabulary`, `codegraph`, `grill-protocol`. Findings only.

## Findings

1. **Duplicated `requestJson` helper** — `components/admin/settings-hub.tsx:33` and `components/admin/catalog-manager.tsx:32` each declare their own `requestJson` with slightly different signatures (one takes `method+body`, the other takes `RequestInit`). Two real call sites now → Rule of 2 met. Pull into `lib/` (clean-code § duplicated logic).

2. **No single mutation/fetch pattern across client components** — `media-library.tsx`, `newsletter-signup.tsx`, `preferences-form.tsx`, `zip-checker.tsx`, and the two admin components all inline `fetch → .json() → response.ok ? … : body.error ?? "X failed."`. clean-code § Consistency: "one data-fetching pattern per project." Extract a `lib/api-client.ts` helper.

3. **Duplicated sold-out computation** — `lib/catalog.ts:34` and `app/(storefront)/catalog/[slug]/page.tsx:20` both inline `quantityOnHand - reserved <= 0`. The detail page re-derives sold-out and options instead of reusing `getCatalogProducts` (or a shared `soldOut(product)` helper the lib owns).

4. **`settings-hub.tsx` mixes 4 tab concerns in one 362-line file** — Orders, Shipping, Email, Developer each carry their own state + API calls. clean-code § "split when mixed concerns." Split each tab into `components/admin/settings/<tab>.tsx`.

5. **Magic value drift on upload limit** — `lib/media.ts:13` defines `MAX_UPLOAD_BYTES = 5 * 1024 * 1024`, but the rejection string at `:39` hardcodes `"the limit is 5 MB"` separately. If the constant changes the message lies. Derive the message from `MAX_UPLOAD_BYTES`.

6. **Banned vague name `data`** — `SettingsHub({ data }: { data: SettingsHubData })` (`settings-hub.tsx:43`). clean-code § Naming bans `data` as standalone. Rename to `settings`.

7. **Modal / menus lack keyboard dismiss and focus handling** — `product-grid.tsx:63` quick-view dialog and `site-header.tsx:43` user/mobile menus open on click but have no Escape-to-close, no focus trap, no outside-click close. ponytail § "Never cut: a11y." Add Escape handler + focus management.

## Notes (not findings)

- `.catch(() => null)` in `unsubscribe/route.ts:18` and `preferences/route.ts:28` are intentional idempotency / not-found handling with explanatory comments — not swallowed errors.
- Dependency versions are all pinned exact; no floating ranges. `@clerk/nextjs` is wired but gated behind `AUTH_MODE=clerk` (dev uses cookie gate) — acceptable for the phase.
- Comments are overwhelmingly intent/rule-ref (`R-015`, `G-014`, `R-128`) — within clean-code guidance.

## Count

7 findings (4 duplicated-logic / consistency, 1 mixed-concerns, 1 magic-value drift, 1 naming, 1 a11y).
