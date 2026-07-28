# P4 Rules review — arm-06 (blind)

**Phase:** P4 — Cart-first order builder, address book, customer account
**Rules checked:** `arms/arm-06/.cursor/rules/{clean-code,ponytail,workflow,vocabulary,codegraph}.mdc`
**Reference:** `shared/phases/PHASE-P4-EXPECTED.md` (8 must-be-true items, S1–S3 smoke)
**Scope:** `arms/arm-06/workspace/` — P4 deliverables only (order builder, recipient/address dialogs, draft engine, customer session, address book, account area, checkout draft view, dev-auth-customer). P3 domain core read only for context.
**Method:** Findings only, no fixes. Blind to model name. Severity: Blocker / Major / Minor.

## Adherence summary (rules honored)

- **clean-code — one pattern per concern:** README § "What P4 ships" + "Customer auth" documents the choices. P4 code follows them: `apiFetch` for every client mutation, `requireApiCustomer` on every customer route, `requireApiPermission("customers.manage")` on the staff address route, `parseBody` + zod for every JSON body, `recordAudit` on the staff address mutation, integer cents with `lib/money.ts`. No competing patterns introduced. The P3 `create-draft.ts` line-resolution was extracted into `lib/orders/resolve-lines.ts` so drafts and checkout share one engine — a dedupe-logic refactor done right.
- **clean-code — god files:** none. Largest P4 file is `order-builder-shell.tsx` at ~300 lines; everything else <210. No mixed-concern god files.
- **clean-code — comments:** comments carry non-obvious intent (R-IDs, anti-enumeration rationale, HMAC purpose-prefix `guest-draft:`, RESTRICT/SetNull FK explanation, geocode provider seam, Clerk swap points). No narration, no change-explanation comments.
- **clean-code — error handling:** no empty catch blocks that swallow real errors. `readGuestDraft`'s `catch { return null }` parses untrusted localStorage and the result is validated downstream (same pattern P3 accepted). Error messages state what failed and the expected shape.
- **clean-code — anti-AI-tics:** no redundant try/catch around non-throwing code; no redundant type assertions beyond the unavoidable `as unknown as` across the signed-JSON codec boundary; no "just in case" branches. The three-way recipient picker is the only non-trivial branching and it is justified by UR-006/G-018.
- **clean-code — UI consistency:** storefront shell reused on `/order`; account area uses one `AccountLayout` + `AccountNavLink` kit; the hand-rolled `components/ui/dialog.tsx` is the single modal surface for recipient picker, add/edit address, and quick view. Back navigation is explicit (continue/pay/cancel links route to known builder/checkout paths, documented in the page comments).
- **ponytail — ladder:** geocode is a deterministic dev seam (`deriveGeoPoint` only swaps for a live provider), no new package loaded. `Dialog` is hand-rolled (focus trap, Escape, Tab cycle) rather than pulling radix — stdlib/native/existing first. No convenience deps added. `package.json` diff carries no new runtime dep for P4.
- **workflow — expectation files:** `.scratch/PHASE-P4-STATUS.md` and `.scratch/PHASE-P4-SMOKE.md` present, all 8 EXPECTED items marked DONE with route/control evidence; S1–S3 smoke = 35 checks, 0 failures, exit 0. Gate discipline satisfied.
- **workflow — security basics:** `.env` in `.gitignore` (carried); customer session cookies httpOnly + sameSite=lax + secure-in-prod; server-side `CustomerSession` row validated (revokedAt/expiresAt/customerId match) on every gated request; HMAC constant-time compare (`safeEqual`) for both staff and guest tokens; guest token raw value issued once, HMAC hash stored only.
- **codegraph:** `.codegraph/` healthy — 77 files / 567 nodes / 762 edges (up from P3's 58/420/362). P4 growth indexed, no regression.
- **vocabulary:** no refactor/rebuild/redesign commands mis-scoped in P4; the checkout "payment opens with the next release" notice is a documented scope boundary (P5), not a silent scope shrink.

## Findings

### M-1 — Customer session TTL drifts from the documented value (workflow: keep README current; clean-code: one pattern per concern documented)
**Severity:** Major
**Where:** `lib/customers/session.ts:15` — `export const CUSTOMER_SESSION_TTL_HOURS = 24 * 30;` (720 hours = 30 days). README § "Customer auth" and `.scratch/PHASE-P4-STATUS.md` both state the customer session is "12h, revocable".
**Rule:** `workflow.mdc` "Keep README current"; `clean-code.mdc` "Consistency — one pattern per concern … document in README" and Security Basics. Session lifetime is security-relevant: the documented intent (12h, mirroring staff) and the actual code (30 days) disagree by 60×.
**Detail:** The constant is the source of truth for both the cookie `maxAge` and the `CustomerSession.expiresAt`. A reviewer or operator trusting the README would believe customer sessions expire in half a day when they actually persist for a month. Either the constant should be `12` (matching the docs and the staff mirror) or the docs should be corrected to 30 days — but the two must agree. Flagged Major because it is a security-basics accuracy gap, not a cosmetic doc slip.

### m-2 — Inconsistent unique-violation handling (clean-code: one error-handling approach per project)
**Severity:** Minor
**Where:** `lib/customers/addresses.ts:91-97` — `saveAddress` catches a create failure and string-matches `error.message.includes("customerId_label")` to surface the label-unique violation as a `DomainRuleError`. Compare `lib/customers/dedupe.ts:68-70` (`isUniqueViolation` via `Prisma.PrismaClientKnownRequestError && error.code === "P2002"`) and `app/api/account/profile/route.ts:42` (same `P2002` check).
**Rule:** `clean-code.mdc` "One error-handling approach per project" + "Anti-Hallucination — do not invent library APIs … from memory." String-matching a Prisma error message is fragile (message text is not a contract and can change across Prisma versions); the codebase already has the robust `P2002` pattern in two other P4 files.
**Detail:** The dedupe pre-check makes this branch rare in practice, which is why it is Minor not Major. But the project has one canonical unique-violation handler; this one site should use it too.

### m-3 — Duplicated magic string for the guest-draft localStorage key (clean-code: magic values / DRY, Rule of 2 met)
**Severity:** Minor
**Where:** `components/storefront/clear-guest-draft.tsx:12` — `localStorage.removeItem("arm06_guest_draft")`. The constant `GUEST_DRAFT_KEY = "arm06_guest_draft"` is already exported from `components/order-builder/use-auto-save.ts:11` and used by `writeGuestDraft` / `readGuestDraft` / `clearGuestDraft` there.
**Rule:** `clean-code.mdc` "Magic values — named constants" and "Duplicated logic — pull into helpers." Two real call sites for the same string; a named constant already exists.
**Detail:** `ClearGuestDraftOnSuccess` also re-implements the remove inline instead of calling the existing `clearGuestDraft()` helper, so there are two "clear the guest draft" implementations. Importing `GUEST_DRAFT_KEY` (and ideally calling `clearGuestDraft`) collapses both to one source of truth.

### m-4 — Vague parameter name `result` (clean-code: naming)
**Severity:** Minor
**Where:** `components/order-builder/order-builder-shell.tsx:88` — `async function saveNow(...) { const result = await apiFetch<...>(...)` and `:99` `if (!result.ok || !result.body.draftRef)`.
**Rule:** `clean-code.mdc` "No vague names: `data`, `result`, `info`, `temp`, `val`, `item`, `thing` are banned as standalone names."
**Detail:** `result` describes the shape, not the meaning. `saveResult` or `response` would pass the rule and read clearer at the two call sites. Same class of nit as P3's m-2; the arm has a standing pattern of `result` usage to clean up.

### m-5 — Vague setter callback name `value` (clean-code: naming, borderline)
**Severity:** Minor
**Where:** `components/order-builder/product-quick-view.tsx:121` — `setQty((value) => Math.max(1, value - 1))` and `:132` — `setQty((value) => value + 1)`.
**Rule:** `clean-code.mdc` banned standalone names list includes `val` (and the spirit covers `value`).
**Detail:** `value` is the conventional React setter-callback parameter and is arguably "universal in the domain," so this is borderline. `qty` or `nextQty` would describe what the number is. Flagged for consistency with the rule; a maintainer may legitimately keep `value` here.

### m-6 — `findDuplicate` full-scans a customer's addresses in memory (clean-code: borderline design; not a hard rule violation)
**Severity:** Minor
**Where:** `lib/customers/addresses.ts:53-63` — `findDuplicate` does `db.address.findMany({ where: { customerId } })` then an in-memory `.find` against `addressDedupeKey(address)`.
**Rule:** `clean-code.mdc` "Inconsistent patterns — pick one, apply everywhere" (the rest of the address engine queries by indexed columns); borderline against the anti-bloat spirit in `ponytail.mdc`.
**Detail:** The normalized dedupe key is computed in JS, not stored as a column, so a server-side filter is impossible without a schema change. For a typical customer this is a handful of rows and the function is called once per save. Flagged only because the scan grows with book size and an indexed `dedupeKey` column would make it O(1) — a design note, not a gate blocker.

## Severity counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 1 |
| Minor | 5 |

No rule violation blocks the P4 gate. The one Major (M-1) is a doc/code TTL mismatch on a security-relevant value and should be reconciled before the gate closes — either align the constant to the documented 12h or correct the README/status to 30 days. The five Minors are naming, error-handling-consistency, and a duplicated localStorage-key string. The arm's P4 tree otherwise honors its selected catalog rules: one pattern per concern is documented and followed, no god files, expectation files pre-committed with 35/35 smoke evidence, security basics in place (HMAC sessions, constant-time compare, anti-enumeration 404s, audited staff edits), codegraph healthy and grown with the phase, ponytail ladder respected (deterministic geocode seam, hand-rolled dialog, no new deps).
