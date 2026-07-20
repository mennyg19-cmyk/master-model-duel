# Reviewer — Rules — arm-01 (Test 4, P4)

**Arm:** arm-01
**Tree / phase:** `arms/arm-01/workspace/` — Phase P4 (cart-first order builder, saved-recipient workflow, protected auth + guest drafts, customer account)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol
**Reviewer:** orchestrator (independent of contestants)
**Scope:** findings only — adherence to arm-01's selected catalog rules.

---

## ponytail

- **MINOR — ladder tags absent on P4 shortcuts.** `src/lib/customer-access.ts:1-17` uses `node:crypto` `randomBytes`/`createHash` (stdlib, rung 2) and `src/app/api/order/drafts/route.ts:1` uses `randomInt` for draft refs. The rule asks deliberate ladder choices to carry a `ponytail:` comment (name ceiling + upgrade path). None present. (Carried pattern from P2/P3.)
- **MINOR — modal a11y still incomplete (ponytail "never cut a11y").** `RecipientAddressDialog` (`recipient-address-dialog.tsx:88-93`) and `ProductQuickView` (`builder-product-card.tsx:72-77`) set `role="dialog"`/`aria-modal="true"`, but neither moves focus into the dialog on open, traps focus, nor closes on Escape. Same gap as the P3 catalog quick-view. The close affordance is keyboard-reachable only by Tabbing in from outside.
- **MINOR — `order-builder.tsx` is a mixed-concerns god file.** 468 lines, under the >500 hard line, but ponytail's god-file trigger is "refactor command, >500 lines, **or mixed concerns**." This one component owns draft restore, debounced autosave, product grid, cart-line rendering, recipient-assignment picker, and dialog orchestration. Split candidates: a `useDraftAutosave` hook (lines 89-191) and a `CartLine` component (lines 282-419). Rule of 2 is met for both.

## clean-code

- **VIOLATION — `formatDraftReference` is dead code; draft ref is inlined inconsistently.** `src/domain/order-engine.ts:15-21` exports `formatDraftReference(sequence)` (validates positive integer, pads to 8) but nothing calls it. `src/app/api/order/drafts/route.ts:41` inlines `D-${randomInt(1, 100_000_000).toString().padStart(8, "0")}` instead. Dead code + duplicated logic + inconsistent pattern (helper = sequential/safe; inline = random, collision-prone). Either route the POST through `formatDraftReference` or delete the helper. Anti-hallucination: the unused helper implies a guarantee the live code does not provide.
- **VIOLATION — duplicated localStorage key across two files.** `STORAGE_KEY = "tomchei-p4-draft"` (`order-builder.tsx:59`) is re-typed as the bare literal `"tomchei-p4-draft"` in `account-actions.tsx:17` (`window.localStorage.removeItem(...)`). Rule of 2 met; one source of truth needed. Lift to a shared constant in `src/lib/` (e.g. `draft-storage.ts`) and import from both.
- **MINOR — hardcoded `countryCode: "US"` in the recipient dialog.** `recipient-address-dialog.tsx:75` always sends `countryCode: "US"` regardless of the address being edited. `validateAddress` (`domain/customer-address.ts:27-58`) already accepts `countryCode` and defaults to "US" — the dialog hardcodes instead of passing through `address?.countryCode`. Magic value, and a data-loss vector: editing a non-US saved address silently overwrites its country.
- **MINOR — hand-retyped client types drift from Prisma (carried P1→P4).** `BuilderAddress`, `BuilderProduct`, `BuilderLine` (`order-builder.tsx:14-57`) re-declare shapes Prisma already generates. Use `Prisma.XGetPayload<{ select: ... }>` (or a shared `Pick`) so the client tracks schema changes — especially `version`, which both the address PATCH and draft PATCH rely on for optimistic concurrency.
- **MINOR — `eslint-disable-line react-hooks/exhaustive-deps` masks the real fix.** `order-builder.tsx:191` disables the rule on the autosave effect because `saveDraft`/`ensureDraft` are recreated every render and aren't memoized. Extract those into `useCallback` (or the `useDraftAutosave` hook above) so the dependency array is honest. Inconsistent with the "one state management pattern" aim.
- **MINOR — `onOrderAddresses` fallback misrepresents the source.** `order-builder.tsx:394` shows `addresses.slice(0, 1)` under "Already on this order" when no other line has a recipient yet — surfacing an address-book entry under the wrong label. Either disable the ON_ORDER option until another line has a recipient, or comment the intent; right now it implies an address-book row is "on this order."

## workflow

- **VIOLATION — `.scratch/phase-plan.md` is still the P3 plan.** Workflow (Expectation Files) requires the rolling phase plan to be rewritten per phase with todos + per-todo EXPECTED blocks written **before** building. The surviving `phase-plan.md` lists P3 items only; P4-STATUS.md carries the EXPECTED checklist instead, but the rolling artifact was not updated for P4. (Carried process gap from P3, now visible because the stale file survives.)
- **PASS — running-app smoke evidence exists this phase.** `.scratch/PHASE-P4-SMOKE.md` covers S1–S3 with the exact command, raw JSON result, page probes (`/order` 200, `/account` 200), and per-check PASS notes (three-way assignment, auth + guest draft restore, cross-customer 404, guest-token revocation after success, owner-only edit, normalized dedupe, `geocodeProvider=server-postal-validation`, staff audit). P4-STATUS logs `npm run ci` 13/13 and `npm run build` pass. Clear improvement over P3 (which had no smoke artifact).

## vocabulary

- **PASS — term accuracy.** P4 terms ("cart-first", "address book", "recipient", "on-order / address-book / new recipient", "draft", "guest access token", "account dashboard", "continue and pay", "cancel draft") used consistently across README, status, and code. No refactor/tidy/rebuild commands were issued this phase, so the scope table is not exercised.

## codegraph

- **PARTIAL — index present; process not verifiable.** `.codegraph/` exists in the workspace, so `codegraph init` was run. The rule's hard requirement — CodeGraph (MCP/CLI) for all structural lookups, no grep-for-symbols — governs the development process and cannot be confirmed from the build artifact alone. No findings against the artifact; flagged non-evaluable for process adherence. (Same as P2/P3.)

## grill-protocol

- **PASS — deferred scope is honestly delineated.** P5 payment capture and fulfillment commitment are explicitly out of scope (P4-STATUS § Gate evidence + README § P4). No invented product direction; the cart stops at subtotal with copy ("Payment and fulfillment choices begin in the next step"). Aligns with grill-protocol's "automate implementation and verification, not product decisions."

---

## Summary

| Rule | Findings | Severity |
|---|---|---|
| ponytail | 0 violations + 3 minors (no ladder tags; modal a11y focus/trap/Escape; mixed-concerns god file) | mixed |
| clean-code | 2 violations (`formatDraftReference` dead code + inlined random ref; duplicated localStorage key) + 5 minors (hardcoded "US"; hand-retyped client types; eslint-disable masks fix; onOrderAddresses fallback mislabels source) | mixed |
| workflow | 1 violation (stale P3 phase-plan.md) + 1 pass (P4 smoke evidence present) | mixed |
| vocabulary | 0 | clean |
| codegraph | index present; process not verifiable | n/a |
| grill-protocol | 0 | clean |

Findings: **3 violations + 8 minors = 11 findings.**

Strongest: cart-first flow with three-way recipient picker, inventory-aware builder with options + restricted add-ons, debounced autosave with optimistic version guards on both draft PATCH and address PATCH, normalized-key dedupe into one address book, staff address edits wrapped with `customer.address_updated` audit in the same `$transaction`, guest drafts via hashed expiring tokens with 404 on cross-customer / tokenless access, and ownership-enforced account pages — all backed by S1–S3 smoke evidence with raw JSON. Weakest: a dead `formatDraftReference` helper next to the random inlined draft ref it was meant to replace, the `tomchei-p4-draft` storage key duplicated as a bare literal in the cancel button, a hardcoded "US" that silently overwrites country on edit, and the rolling phase-plan artifact still showing P3 — all cheap fixes that close the gap between the README's claims and what the code actually does.
