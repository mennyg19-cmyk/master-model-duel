# Reviewer — Rules — arm-03 (Test 4, P4)

**Arm:** arm-03
**Tree / phase:** `arms/arm-03/workspace/` — Phase P4 (cart-first order builder, address book, customer account, guest drafts)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph
**Reviewer:** orchestrator (independent of contestants, blind to model name)
**Scope:** findings only — adherence to arm-03's selected catalog rules. Grill-protocol out of scope this pass.

---

## ponytail

- **MEDIUM — YAGNI: `lib/orders/finalize.ts` is speculative P5 code with no P4 caller.** The file exports `finalizeOrder` (344), `discardDraft` (424), `transitionOrder` (482), plus private `materializePackages`, `reserveOrderInventory`, `claimNextOrderNumber`. A repo-wide grep for `finalizeOrder|transitionOrder|discardDraft` finds definitions only — zero call sites. P4's draft success path is `markGuestDraftSuccess` (in `drafts.ts`); order placement / package materialization / inventory reservation are P5 concerns (per `PHASE-P4-EXPECTED.md` "Out of scope: payment capture, fulfillment commitment (P5)"). ponytail § "No boilerplate 'for later.'"
- **MINOR — god-file bloat via double-blank-line formatting.** `lib/orders/finalize.ts` inserts a blank line between every statement, inflating ~270 lines of logic to 538. That pushes it past the ponytail/clean-code "split when >500 lines" trigger on a file that is pure padding. clean-code § Anti-AI-tics: "no over-verbose code that does in 10 lines what could be done in 3." Reformat to single-spaced and the file drops under the split line.
- **MINOR — ladder `ponytail:` marker absent on P4 shortcuts.** `lib/address/geocode.ts:27` `fakeGeocode` (local ZIP-centroid provider) and `autocompleteAddresses:121` (hard-coded Brooklyn street index) are deliberate stdlib/native shortcuts with the upgrade path named in a comment but no `ponytail:` tag. Same gap as arm-01 / arm-02 P4.
- **PASS — dependency discipline.** No new packages for P4; existing zod / prisma / node:crypto reused. `DRAFT_ACCESS_SECRET` reuses `NEWSLETTER_HMAC_SECRET` as fallback rather than adding infrastructure.

## clean-code

- **MEDIUM — duplicated `draftInclude` Prisma include.** The same 13-line `lines: { include: { product, productOption, addOns, savedAddress, fulfillmentMethod } }, customer, season` object is defined identically in `lib/orders/drafts.ts:13`, `app/api/drafts/route.ts:12`, and `app/api/drafts/[draftRef]/route.ts:11`. Three copies; drift risk on any schema change. Export once (e.g. from `lib/orders/draft-wire`, already imported by this module) and reuse. § duplicated logic / type-schema drift.
- **MINOR — duplicated address Zod schema.** The same 10-field `addressSchema` is hand-copied in `app/api/addresses/route.ts:8-19`, `app/api/addresses/[id]/route.ts:10-21`, `app/api/admin/addresses/[id]/route.ts:10-21`, and `app/api/drafts/[draftRef]/assign/route.ts:9-20`. Extract a shared `addressInputSchema` in `lib/address/normalize.ts` (which already owns `validateAddressInput`). § duplicated logic / type-schema drift.
- **MINOR — dead code: `void allowedIds;`.** `lib/orders/drafts.ts:219` builds `const allowedIds = new Set(...)` that is never read; line 232 then `void allowedIds;` to silence the unused-var lint. The allow-list check already runs via `product.allowedAddOns.find` on line 222. Delete the Set and the void. § dead code / Anti-AI-tics ("just in case" code).
- **MINOR — dead code: `void AuthError;`.** `app/(storefront)/account/orders/[id]/page.tsx:3,32` imports `AuthError` only to `void` it. The comment on line 31 ("Ownership already enforced by customerId filter") explains why it's unused — the import should just be removed. § dead code.
- **MINOR — redundant ternary branch.** `app/api/drafts/[draftRef]/assign/route.ts:35-40`: both the `staff` and `else` (guest) arms return `order.customerId`, so `actor.kind === "staff"` is a dead check. Collapses to `actor.kind === "customer" ? actor.customerId : order.customerId`.
- **MINOR — duplicated guest-cookie set block.** `app/api/drafts/route.ts:88-95` and `112-119` repeat the same 7-line `res.cookies.set(GUEST_DRAFT_COOKIE, ..., { path, httpOnly: false, sameSite, maxAge })` block. Extract a `setGuestCookie(res, token)` helper. § duplicated logic.
- **MINOR — magic number.** `components/order/assign-dialog.tsx:68` uses a bare `200` ms debounce. Other P4 timings live as named constants; this one is inline. § magic values.
- **MINOR — unchecked fetch responses.** `components/order/cart-sidebar.tsx:37-55` (`updateQty` / `removeLine`) and `components/account/account-dashboard.tsx:84-91` (`cancelDraft`) fire `PATCH` / `DELETE` without checking `res.ok` or surfacing errors — a silent failure leaves stale UI with no message. `assign-dialog.tsx` and `account/addresses/page.tsx` do check; the pattern is inconsistent. § Error Handling / one error-handling approach.
- **MINOR — inconsistent button styling.** A shared `components/ui/button.tsx` (primary/secondary/danger/ghost variants) exists, but P4 screens mix raw `<button>` + hand-rolled Tailwind: `cart-sidebar.tsx:97-116` (Remove, qty, Assign), `product-panel.tsx:89-110` (Quick view, Add), `assign-dialog.tsx:128-142` (mode picker), `account-dashboard.tsx:142-191`. `assign-dialog` uses the shared `<Input>` but not `<Button>`. README § Patterns: "Styling: Tailwind + CSS variables." § UI Consistency / one styling approach.

## workflow

- **VIOLATION — `DECISION-LOG.md` missing.** No `DECISION-LOG.md` exists anywhere under `arms/arm-03/` (workspace root, `.scratch/`, arm root all checked). P4 made several silent business-logic choices: draft≠Order lifecycle, `guestTokenVersion` rotation on clear, fake deterministic geocoder as the P4 provider, `on_order` = customer's default address, guest cookie `httpOnly: false` + 14-day maxAge, "checkout / pay ships in P5" gating. Workflow § "Never silently choose business logic — log in DECISION-LOG.md and flag." None are logged or flagged.
- **MINOR — no `.scratch/run-state.md`.** P4 is a multi-phase feature; workflow § "Run checkpoint" says keep `run-state.md` for multi-phase / autonomous runs. `PHASE-P4-STATUS.md` exists but is a static gate summary, not the rolling `protocol / phase / last_gate_passed / next_action` checkpoint.
- **MINOR — no `.scratch/phase-plan.md` with EXPECTED blocks.** Workflow § "Expectation Files" requires a rolling phase plan with an EXPECTED block written **before each todo** (route, control, behavior — observable). `PHASE-P4-EXPECTED.md` exists at the shared level, but the arm-03 `.scratch/` has only `PHASE-P4-SMOKE.md` + `PHASE-P4-STATUS.md` — no pre-todo expectation file. The smoke evidence (15/15 PASS, real HTTP) is good, but the "written before building" discipline is not shown.
- **PASS — running-app verification.** `PHASE-P4-SMOKE.md` shows 15/15 PASS with real HTTP evidence (draft refs, status codes, subtotal recomputation, geocode lat/long, audit id, anti-enumeration 404s). Not "done from code alone."
- **PASS — security basics.** `.env*` in `.gitignore` with `!.env.example` exception; `DRAFT_ACCESS_SECRET` required (fail-closed); guest tokens HMAC-hashed with `timingSafeEqual`; ownership + uniform-404 anti-enumeration on drafts (`loadDraftForAccess`); staff address edit writes an atomic `ADDRESS_STAFF_EDITED` audit row (UR-014 / G-019).

## vocabulary

- **PASS — term accuracy.** P4 terms (cart-first, three-way picker, on-order / address-book / new recipient, draft, guest access token, address book, account dashboard, continue / pay / cancel draft) used consistently across README, status, code, and UI copy. No refactor / tidy / rebuild commands issued this phase, so the scope table is not exercised. "Pay (P5)" placeholder in `account-dashboard.tsx:182` correctly scopes the deferred feature.

## codegraph

- **PASS — index initialized and present.** `arms/arm-03/workspace/.codegraph/codegraph.db` exists (864 KB) with `.gitignore`. Unlike arm-02 P4 (which never initialized), arm-03 has the index. codegraph.md § "Hard rule": "If `.codegraph/` missing and `codegraph` on PATH → `codegraph init` once, then use graph" — satisfied. (Whether the contestant queried the graph vs. grepping cannot be proven from artifacts; the init obligation is met.)

---

## Count

15 findings — **0 High, 3 Medium, 12 Low**.

Medium: `finalize.ts` YAGNI P5 code with no caller; duplicated `draftInclude` across 3 files; missing `DECISION-LOG.md` (silent business-logic choices).

Low: god-file bloat from double-blank formatting, missing `ponytail:` ladder markers, duplicated address Zod schema (4 copies), dead `void allowedIds`, dead `void AuthError`, redundant staff/guest ternary branch, duplicated guest-cookie set block, magic `200` debounce, unchecked fetch responses (cart-sidebar + account-dashboard), inconsistent button styling despite shared `<Button>`, no `run-state.md`, no `phase-plan.md` EXPECTED file.
