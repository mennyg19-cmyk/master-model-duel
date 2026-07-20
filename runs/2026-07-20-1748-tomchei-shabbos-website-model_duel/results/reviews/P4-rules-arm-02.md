# Reviewer — Rules — arm-02 (Test 4, P4)

**Arm:** arm-02
**Tree / phase:** `arms/arm-02/workspace/` — Phase P4 (cart-first order builder, address book, customer account, guest drafts)
**Arm rules:** ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol
**Reviewer:** orchestrator (independent of contestants, blind to model name)
**Scope:** findings only — adherence to arm-02's selected catalog rules.

---

## ponytail

- **MINOR — YAGNI: `completeDraft` and `mode="pos"` plumbed before call sites.** `lib/order-builder/draft-store.ts:101-107` implements `completeDraft` for P5 checkout with no P4 caller; `components/builder/order-builder.tsx:201` threads `mode` only to a `data-builder-mode` attribute with no behavior. Both are documented, but ponytail § "No boilerplate 'for later.'"
- **MINOR — ladder `ponytail:` marker absent on P4 shortcuts.** `lib/addresses/geocode.ts:9-21` (local ZIP-centroid provider) and `lib/addresses/autocomplete.ts:16-30` (local street index) are deliberate stdlib/native shortcuts. The upgrade path IS named in comments ("swapping in a real provider later means replacing lookupCoordinates only"), but the `ponytail:` marker convention isn't used. Same gap as arm-01 P4.
- **PASS — dependency discipline.** No new packages for P4; existing zod/prisma/crypto reused.

## clean-code

- **VIOLATION — duplicated address-update logic.** `app/api/admin/customers/[id]/addresses/[addressId]/route.ts:31-47` re-implements the field mapping + geocode + normalizedKey already in `lib/addresses/book.ts` `updateAddressBookEntry` (45-66). The admin route needs an atomic audit row, so the helper should accept a transaction client and be reused inside `db.$transaction`. § duplicated logic.
- **MINOR — duplicated tab-list UI.** `components/builder/assignment-dialog.tsx:76-91` and `components/account/auth-forms.tsx:44-67` both inline the same `role="tablist"` + `bg-brand-soft p-1` strip with the identical `cn(...)` ternary. Rule of 2 met; extract a `Tabs` primitive. § duplicated UI / repeated class strings.
- **MINOR — duplicated SavedAddress→AddressInput mapping.** `components/account/addresses-manager.tsx:26-34` (`startEdit`) and `components/builder/assignment-dialog.tsx:156-164` (Edit onClick) hand-copy the same 7 fields. Extract `toAddressInput(saved)`. § duplicated logic.
- **MINOR — duplicated address-completeness check.** `assignment-dialog.tsx:54-62` `isComplete` re-encodes recipient/line1/city/state-length/zip-regex that `addressInputSchema` (`lib/addresses/normalize.ts:5-17`) already defines server-side. § duplicated logic / type-schema drift.
- **MINOR — inconsistent button styling.** Builder/account mix the shared `<Button>` (`components/ui/button`) with raw `<button>` + hand-rolled Tailwind (product-panel "Customize" 63-69, cart-panel qty ± 79-97 / Remove 99-105 / "Choose recipient" 116-123, assignment-dialog tabs 77-90 / Edit 151-169). README § Patterns: "shared primitives in components/ui/". § UI Consistency / one styling approach.
- **MINOR — magic number.** `components/builder/address-form.tsx:55` uses a bare `250` ms debounce; every other P4 timing (`AUTOSAVE_DELAY_MS`, `STOCK_REFRESH_MS`, `GUEST_DRAFT_TTL_DAYS`, `CACHE_TTL_DAYS`) is a named constant. § magic values.
- **MINOR — unchecked DELETE response.** `addresses-manager.tsx:56-60` `remove()` fires `DELETE` without checking `response.ok`; a silent failure leaves the row and shows no error. `save()` in the same file checks. § Error Handling.

## workflow

- **VIOLATION — DECISION-LOG.md missing.** Five business-logic decisions (DECISION-P4-1..5, `PHASE-P4-STATUS.md:21-26`) were recorded under "## Decisions" in the status file instead of `DECISION-LOG.md`. Workflow § "Never silently choose business logic — log in DECISION-LOG.md and flag." Decisions are logged and flagged (not silent), but in the wrong artifact.
- **MINOR — no `.scratch/run-state.md`.** P4 is a multi-phase feature; workflow § "Run checkpoint" says keep `run-state.md` for multi-phase runs. `phase-plan.md` exists but not the rolling run-state file.
- **PASS — expectation files + running-app smoke.** `phase-plan.md` has P4 todos + verbatim EXPECTED targets written before build; `PHASE-P4-STATUS.md` marks all 8 EXPECTED items `[x]` with SMOKE S1/S2/S3 evidence (29/29 PASS, real HTTP calls, page renders 200). Not "done from code alone."
- **PASS — security basics.** `.env*` and `.scratch/` in `.gitignore`; HMAC-hashed session + guest-draft tokens; rate limits on login/register/autocomplete/draft-save; ownership + anti-enumeration on drafts and addresses; staff address edit writes an atomic AuditLog row.

## vocabulary

- **PASS — term accuracy.** P4 terms (cart-first, three-way picker, on-order / address-book / new recipient, draft, guest access token, address book, account dashboard, continue/pay/cancel draft) used consistently across README, status, and code. No refactor/tidy/rebuild commands issued this phase, so the scope table is not exercised.

## codegraph

- **VIOLATION — index never initialized.** `.codegraph/` is absent from `arms/arm-02/workspace/` (`codegraph status` → "Not initialized"; this reviewer had to run `codegraph init` to inspect). codegraph.md § "Hard rule": "If `.codegraph/` missing and `codegraph` on PATH → `codegraph init` once, then use graph." The contestant built ~40 new P4 files with cross-file imports without ever creating or consulting the graph. Concrete process violation — arm-01 had `.codegraph/` present, arm-02 did not.

## grill-protocol

- **PASS — no spec-gate trigger this phase.** P4 build plan was pre-merged and referenced verbatim; no vague success words, no underspecified ask. DECISION-P4-* entries cover the four grill bullets (goal, constraints, chosen approach, validation) for each open design point (draft≠Order, customer auth, no external APIs, on-order semantics, issues-don't-block-autosave).

---

## Count

12 findings — **0 High, 2 Medium, 10 Low**.

Medium: codegraph index never initialized; duplicated admin/customer address-update logic.
Low: YAGNI `completeDraft`+`mode`, missing `ponytail:` ladder markers, duplicated tab-list UI, duplicated SavedAddress→AddressInput mapping, duplicated address-completeness check, inconsistent button styling, magic `250` debounce, unchecked DELETE response, DECISION-LOG.md missing, no run-state.md.
