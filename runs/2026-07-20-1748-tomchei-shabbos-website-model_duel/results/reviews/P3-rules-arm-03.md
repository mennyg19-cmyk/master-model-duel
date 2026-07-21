# Reviewer — Rules — arm-03 (Test 4, P3)

**Arm:** arm-03
**Tree / phase:** `arms/arm-03/workspace/` — Phase P3 (storefront: marketing, catalog, archive, newsletter, admin catalog & media)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol
**Reviewer:** orchestrator (independent of contestants, blind to model name)
**Scope:** findings only — adherence to arm-03's selected catalog rules.

---

## Findings

1. **VIOLATION (clean-code / correctness) — `edit()` silently resets inventory.** `components/admin/catalog-admin.tsx:106` hardcodes `onHand: 10` when populating the edit form (the `Product` type lacks `onHand`, so the real stock is never loaded); on save, `app/api/admin/catalog/route.ts:130-137` upserts `InventoryItem.onHand = body.onHand`, so every edit overwrites real stock with 10. Data-loss bug. Smoke S4 only creates (onHand:5), never edits, so it is unverified — § Anti-Hallucination "verify in running app."
2. **VIOLATION (workflow) — expectation files absent.** No `.scratch/phase-plan.md` with pre-build todos + EXPECTED blocks; `.scratch/PHASE-P3-SMOKE.md` is only written at runtime by `scripts/smoke-p3.mjs:240-260` and is not committed. § Expectation Files ("Written BEFORE building").
3. **VIOLATION (workflow) — `.scratch/` not gitignored.** Workspace `.gitignore` has no `.scratch/` entry; workflow § Expectation Files requires adding it if missing. The smoke script writes scratch artifacts that could be committed.
4. **VIOLATION (workflow) — no `DECISION-LOG.md`.** P3 business choices (archive browse-only, replacement editor shell, default options Standard/Deluxe @1200, category default "Packages") were made silently. § "Never silently choose business logic — log in DECISION-LOG.md and flag."
5. **VIOLATION (workflow) — no `.scratch/run-state.md`.** P3 is part of a multi-phase run; § Run checkpoint requires the rolling run-state file. Absent.
6. **VIOLATION (codegraph) — index never built.** `.codegraph/` contains only `.gitignore`; no graph. codegraph.md § "Hard rule": if `codegraph` on PATH, `codegraph init` then use graph for structural lookups. ~25 new P3 files with cross-file imports were added without it.
7. **MINOR (clean-code) — swallowed errors.** `components/admin/media-admin.tsx:17-20` `load()` silently no-ops on `!res.ok` (no message); `components/admin/settings-hub.tsx:21` `if (!res.ok) return;` likewise. § Error Handling "No swallowed errors."
8. **MINOR (clean-code) — duplicated form state + magic values.** `catalog-admin.tsx` repeats the same 10-field initial form literal at lines 26-37 and 212-223 (extract a constant); magic defaults `5400`, `1200`, `"Packages"`, `10`. `settings-hub.tsx:11,15` hardcodes Brooklyn ZIPs `"11218,11219,11230,11204"` / `"11218"` as initial state. § duplicated logic / magic values.
9. **MINOR (clean-code / UI Consistency) — storefront buttons bypass the shared primitive.** `components/storefront/catalog-browser.tsx` (Quick view, Details, Start order) and `components/storefront/shell.tsx` (Order, Menu) use raw `<button>`/`<Link>` with inline Tailwind class strings, while admin screens use `components/ui/button`. Repeated class strings, two styling approaches. § UI Consistency / one styling approach.
10. **PASS — ponytail + security basics.** `lib/storefront/media.ts:10` carries a `ponytail:` marker (local-disk Blob stand-in, named upgrade path to `@vercel/blob`); `lib/storefront/newsletter.ts` uses HMAC-SHA256 + `timingSafeEqual` + `tokenVersion` rotation for unsubscribe tokens; no new packages added this phase; `.env*` gitignored.

---

## Count

10 findings — **0 High, 6 Medium, 3 Low** (1 correctness bug, 5 process violations, 3 clean-code minors; 1 pass).

Medium: edit() resets inventory, expectation files absent, `.scratch/` not gitignored, no DECISION-LOG.md, no run-state.md, codegraph index never built.
Low: swallowed errors in admin loaders, duplicated form state + magic values, storefront button styling bypasses shared primitive.
