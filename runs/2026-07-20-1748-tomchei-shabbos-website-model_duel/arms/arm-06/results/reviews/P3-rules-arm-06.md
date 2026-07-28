# P3 Rules review — arm-06 (blind)

**Phase:** P3 — Storefront: marketing, catalog, archive, newsletter, admin catalog & media, settings hub
**Rules checked:** `arms/arm-06/.cursor/rules/{clean-code,ponytail,workflow,vocabulary,codegraph}.mdc`
**Reference:** `shared/phases/PHASE-P3-EXPECTED.md` (8 must-be-true items, S1–S5 smoke)
**Scope:** `arms/arm-06/workspace/` — P3 deliverables only (storefront shell, homepage, catalog, archive, gate stubs, newsletter, admin catalog/media/settings). P2 domain core (auth, orders, payments, inventory) read only for context.
**Method:** Findings only, no fixes. Blind to model name. Severity: Blocker / Major / Minor.

## Adherence summary (rules honored)

- **clean-code — one pattern per concern:** README § Patterns documents one choice per concern (mutations, auth gates, errors, body parsing, sessions, HMAC, money, styling, settings, catalog queries, concurrency). P3 code follows it: `apiFetch` for all client mutations, `requireApiPermission` on every admin route, `parseBody` + zod for every JSON body, `recordAudit` on every mutation, integer cents with `lib/money.ts` as the single conversion point. No competing patterns introduced.
- **clean-code — god files:** none. Largest P3 file is `settings-tabs.tsx` at 335 lines; everything else <260. No mixed-concern god files.
- **clean-code — comments:** comments carry non-obvious intent (R-IDs, RESTRICT explanation, HMAC purpose-prefix, x-forwarded-for caveat). No narration, no change-explanation comments.
- **clean-code — error handling:** no empty catch blocks. Bad-JSON catches return a null that is then validated (`parseBody`, `request.json().catch(() => null)`, `request.formData().catch(() => null)`). Error messages state what failed and the expected shape.
- **clean-code — anti-AI-tics:** no redundant try/catch around non-throwing code; no redundant type assertions; no "just in case" branches. The two-shapes-one-route PATCH in `api/admin/products/[id]/route.ts` is the only non-trivial branching and it is justified by the RESTRICT constraint.
- **clean-code — UI consistency:** storefront shell (`SiteHeader`, `SubscribeForm`, `ClosedNotice`) reused on every storefront route; admin uses one `Sidebar` + `Card` kit. Back navigation exception for `not-found`/`forbidden` documented in README § Navigation exceptions.
- **ponytail — ladder:** Vercel Blob and Stripe are lazy seams (`lib/media/storage.ts`, README § Media storage seam) — config-only swap, no package loaded unless token set. No new convenience packages. Dev-auth is a documented test seam behind `DEV_AUTH_BYPASS`, not a silent stand-in.
- **workflow — expectation files:** `.scratch/PHASE-P3-STATUS.md` and `.scratch/PHASE-P3-SMOKE.md` present, all 8 EXPECTED items marked DONE with route/control evidence; S1–S5 smoke run with 23 + 19 checks, both exit 0. Gate discipline satisfied.
- **workflow — security basics:** `.env` in `.gitignore`; `.env.example` regenerated from `lib/env-spec.ts` with placeholders for every secret; `AUTH_SECRET` requires 32+ chars; session cookies httpOnly + sameSite=lax + secure-in-prod; server-side `AuthSession` row validated on every request; HMAC constant-time compare (`safeEqual`).
- **codegraph:** `.codegraph/` initialized; `.scratch/CODEGRAPH-STATUS.md` records 58 files / 420 nodes / 362 edges. First P1 pass had skipped init (flagged A-M6, corrected in fix pass) — P3 shows no regression.
- **vocabulary:** no refactor/rebuild/redesign commands mis-scoped in P3; the upsert-only options design is a documented domain decision (RESTRICT), not a silent scope shrink.

## Findings

### M-1 — Duplicated package SVG glyph (clean-code: duplicated UI, Rule of 2)
**Severity:** Minor
**Where:** `app/(storefront)/packages/packages-grid.tsx:228-236` (`PackageGlyph`) and `app/(storefront)/past-collections/page.tsx:49-53` (inline copy)
**Rule:** clean-code § Refactor categories — "Duplicated UI — extract shared components"; Rule of 2 met (two real call sites now).
**Detail:** The same 3-path package SVG is rendered as a `PackageGlyph` component in the grid and inlined verbatim in the archive page. Both are storefront "no photo yet" placeholders. A shared `components/storefront/package-glyph.tsx` would serve both.
**Caveat:** The SVG is 6 lines and stable; extracting it adds an import + file for ~net-neutral lines. clean-code also says "If removing duplication adds more lines than it saves and the code is stable, leave it duplicated" — so this is a judgment call, not a clear violation. Flagged because two call sites exist and the rule's default is to extract.

### M-2 — Vague parameter name `result` (clean-code: naming)
**Severity:** Minor
**Where:** `app/(admin)/admin/settings/settings-tabs.tsx:64` — `function note(result: { ok: boolean; body: { error?: string } }, okMessage: string)`
**Rule:** clean-code § Naming — `result` is on the banned standalone names list.
**Detail:** `result` describes the shape, not the meaning. `apiResult` or `response` would pass the rule and read clearer at the call sites (`note(await apiFetch(...), "...")`).

### M-3 — Vague parameter name `data` (clean-code: naming, borderline)
**Severity:** Minor
**Where:** `lib/hmac.ts:18` — `export async function hmacSha256(secret: string, data: string)`
**Rule:** clean-code § Naming — `data` is on the banned standalone names list.
**Detail:** `data` is the conventional Web Crypto / HMAC term for the message input, so this is borderline domain-universal (the rule allows abbreviations "universal in the domain"). But `data` is explicitly named in the banned list, and `message` / `payload` would be no worse. Flagged for completeness; a maintainer may legitimately keep `data` here.

### M-4 — Vague loop variable `item` (clean-code: naming)
**Severity:** Minor
**Where:** `components/admin/sidebar.tsx:17` — `items.map((item) => {`
**Rule:** clean-code § Naming — `item` is on the banned standalone names list. Collections are plural (`items`), single items should be descriptive.
**Detail:** `navItem` or `link` would describe what the element is.

### M-5 — Silent delete failure in local media driver (clean-code: error handling, borderline)
**Severity:** Minor
**Where:** `lib/media/storage.ts:49` — `await unlink(path.join(UPLOADS_DIR, storedName)).catch(() => undefined);`
**Rule:** clean-code § Error handling — "No swallowed errors (empty catch blocks)."
**Detail:** This is an idempotent-delete pattern (the file may already be gone, so ENOENT is expected). The `.catch(() => undefined)` swallows every failure, including non-ENOENT ones (EACCES, EBUSY), which would leave a `MediaAsset` row deleted in DB but the file still on disk — a silent leak. A narrower `.catch` that only tolerates `ENOENT` (or logs non-fatal failures) would honor the rule without breaking the idempotent intent.
**Caveat:** Functionally a common Node idiom; flagged because the rule is strict and the failure mode is real.

## Severity counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 5 |

All findings are naming / dedup / error-handling nits. No rule violation blocks the P3 gate. The arm's P3 tree honors its selected catalog rules: one pattern per concern is documented and followed, no god files, expectation files pre-committed with evidence, security basics in place, codegraph initialized, ponytail ladder respected (lazy seams, no convenience deps).
