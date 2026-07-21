# Aggregate Residual Review -- arm-02 (Test 5, post self-fix)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-02`
**Output:** `arms/arm-02/results/AGGREGATE-RESIDUAL-REVIEW.md`
**Method:** Union + dedupe by location+claim across four specialist residual reviews (security, quality, rules, clean-code). Blind -- based on post-fix tree only. No new findings introduced during aggregation.

## Classification rule

- High -> **Blocker**
- Medium -> **Major**
- Low / Info -> **Minor**

Security blockers always survive. No dedupe overlaps were found across the four inputs (every finding has a distinct location+claim); counts therefore equal the sum of the specialist findings.

## Counts

| Class | Count |
|---|---|
| Blockers | 1 |
| Majors | 11 |
| Minors | 20 |
| **Total** | **32** |

| Source | Blocker | Major | Minor | Total |
|---|---|---|---|---|
| Security | 0 | 5 | 7 | 12 |
| Quality | 0 | 2 | 5 | 7 |
| Rules | 0 | 1 | 2 | 3 |
| Clean-code | 1 | 3 | 6 | 10 |

## BLOCKERS (1)

### B1 -- `adminHandler` helper barely adopted (High, pattern drift)
- **Source:** clean-code #1
- **Location:** `lib/api/admin-handler.ts` vs `app/api/admin/**`
- **Claim:** The shared admin route-handler plumbing (permission gate -> open-season 409 -> body parse 400 -> ActionError mapping) is imported by only ~11 of ~50 admin route files. The remaining ~40 hand-roll the same six-step skeleton (e.g. `app/api/admin/packages/[id]/stage/route.ts:12-23`). The codebase now carries both the helper and the boilerplate it was written to replace -- a reader must know two patterns.
- **Why blocker:** Clean-code specialist rated High. Not a security blocker, but the highest-severity residual in the tree; adoption debt that the self-fix reproduced (new register handlers also bypass `adminHandler`).

## MAJORS (11)

### M1 -- In-memory rate limiter is per-process (Medium, security)
- **Source:** security M1
- **Location:** `lib/rate-limit.ts`
- **Claim:** Fixed-window map lives in module memory; under any multi-instance runtime (Vercel serverless is the prod target) the effective limit becomes `limit x instance_count`, weakening every brute-force control (staff/customer login, driver PIN, register, repeat, draft-save, autocomplete, client-error, newsletter). Needs a shared store (Upstash/Vercel KV) before the advertised limits hold in prod.

### M2 -- Public auth endpoints lack the same-origin guard (Medium, security)
- **Source:** security M2
- **Location:** `app/api/auth/login/route.ts`, `app/api/account/login/route.ts`, `app/api/account/register/route.ts`, `app/api/account/register/complete/route.ts`, `app/api/newsletter/subscribe/route.ts`
- **Claim:** `guardPublicEndpoint` (same-origin + rate-limit) is applied to `checkout` and `checkout/quote` only. The listed auth endpoints rely on rate-limit alone. Not directly exploitable as CSRF (`SameSite=Lax` blocks cross-site form POSTs; login is not CSRF-sensitive), but a cross-origin site can drive POSTs (newsletter list poisoning, verification-email triggering) under the per-IP limit. Inconsistent posture vs checkout routes.

### M3 -- `staff.impersonate` grants full manager-equivalent power (Medium, security/design)
- **Source:** security M3
- **Location:** `app/api/impersonate/route.ts`, `lib/auth/permissions.ts`
- **Claim:** Any holder of `staff.impersonate` can impersonate any `ACTIVE` staff member, including a `MANAGER` (which resolves to `ALL_PERMISSIONS`). Defaults restrict it to `MANAGER`, but the override system can grant it to `STAFF`/`DRIVER` -- a one-step, audited-but-unprevented privilege escalation. Worth a guardrail: forbid impersonating above the actor's own role.

### M4 -- Setup bootstrap endpoint has no rate limit and no same-origin guard (Medium, security)
- **Source:** security M4
- **Location:** `app/api/setup/route.ts`
- **Claim:** The first-manager bootstrap POST is reachable by anyone with no `guardPublicEndpoint` and no rate limit. The transactional `staffCount > 0` lock makes the window narrow (only before first setup) and prevents multiple managers, but during that window an attacker can drive unlimited bootstrap attempts -- the one place a password is set with zero throttling.

### M5 -- `SESSION_SECRET` minimum length is 16 characters (Medium, security)
- **Source:** security M5
- **Location:** `lib/env.ts`
- **Claim:** `SESSION_SECRET` min 16 chars is below the recommended 32 bytes for the HMAC key that signs every staff and customer session, registration tokens, newsletter tokens, and driver link/PIN cookies -- all keyed by the same secret. A low-entropy 16-char secret is within offline-brute-force range if the hashed token store ever leaks. Error message suggests `openssl rand -hex 32` but the schema does not require it.

### M6 -- Verify-email registration flow is untested (Medium, quality)
- **Source:** quality F1
- **Location:** `lib/auth/registration-token.ts`, `app/api/account/register/complete/route.ts`, `app/(storefront)/verify-email/page.tsx`, `components/account/verify-email-form.tsx`
- **Claim:** The self-fix headline change (SR-01: prove email control before attaching a password to an existing passwordless customer) has zero smoke and zero unit-test coverage. The HMAC token shape, 24h TTL, `register`-purpose HMAC scoping, `customer.passwordHash` 409 guard, and the `verify-email` invalid-token branch are all unverified. P1 EXPECTED rows S1-S5 do not cover it; nothing was added.

### M7 -- `register` endpoint is a parallel login path without the per-account throttle (Medium, quality / security-adjacent)
- **Source:** quality F2 (rated Low-Med; classified Major -- bypasses the A1 brute-force fix)
- **Location:** `app/api/account/register/route.ts:61-68`
- **Claim:** When the email already has a `passwordHash` and the supplied password verifies, the handler calls `createCustomerSession` and returns `{ ok: true }` -- a successful sign-in via the register endpoint. `app/api/account/login/route.ts` enforces per-IP **and** per-account (10/15min) limits; `register/route.ts` enforces only per-IP (`register:ip`, 10/15min). The per-account lockout that protects a single account from password guessing can be bypassed by probing through `/api/account/register` instead. Anti-enumeration shape preserved (rate-limit weakening, not enumeration leak).

### M8 -- Duplicated logic: two signed-token implementations (Medium, rules/clean-code)
- **Source:** rules #1
- **Location:** `lib/auth/registration-token.ts` vs `lib/newsletter-token.ts`
- **Claim:** The two modules are structurally identical (`sign`/`create*Token`/`verify*Token` with HMAC-SHA256 over `base64url(email).expiresMs.sig`, `timingSafeEqual`, expiry, try/catch -> null). Only divergences: TTL (24h hardcoded vs 90d default param) and the registration signer's `register.` purpose prefix. Rule of 2 satisfied (two real call sites). A shared `lib/signed-token.ts` with `createSignedToken(email, { purpose, ttlMs })` / `verifySignedToken(token, purpose)` would collapse ~40 duplicated lines -- net line reduction, so the ponytail carve-out does not apply.

### M9 -- `apiFetch` documented single convention, but customer forms duplicate it (Medium, clean-code)
- **Source:** clean-code #2
- **Location:** `lib/api-client.ts` vs `components/account/*`, `components/storefront/*`
- **Claim:** `apiFetch` is the documented ONE place that reads the `{error}` convention and is used by ~25 admin components, but customer-facing forms (`auth-forms.tsx:28-39`, the new self-fix `verify-email-form.tsx`, `profile-form.tsx`, `addresses-manager.tsx`, `preferences-form.tsx`, `newsletter-signup.tsx`, `setup-form.tsx`) re-implement the identical fetch + JSON headers + `body?.error ?? "Something went wrong"` shape. The error string is duplicated verbatim. The self-fix reproduced the drift by copying the boilerplate into `verify-email-form.tsx` instead of routing through `apiFetch`.

### M10 -- `lib/routes/service.ts` bypasses `writeAudit` (Medium, clean-code)
- **Source:** clean-code #3
- **Location:** `lib/routes/service.ts` vs `lib/audit.ts`
- **Claim:** `writeAudit` (`lib/audit.ts`) is the central audit writer that derives the actor email with impersonation formatting (`"real@x (impersonating acting@y)"`), called from ~50 sites. `lib/routes/service.ts` inlines `db.auditLog.create` four times (e.g. lines 213-221). The magic-link branch legitimately cannot use `writeAudit` (no `StaffContext`), but the staff branches (`route.started`, `package.method_switched`, `route.rerouted_package`) pass a raw `staff.email` and lose the `(impersonating ...)` tag the rest of the audit log carries -- inconsistent audit shape for the same role.

### M11 -- "Closest-priced product" reducer implemented twice (Medium, clean-code)
- **Source:** clean-code #4
- **Location:** `lib/repeat.ts:67-84` vs `lib/legacy-import/commit.ts:87-92`
- **Claim:** Both find the product whose `basePriceCents` is nearest a target. `repeat.ts` exposes a named, tie-aware `closestPricedProduct`; `commit.ts` re-derives the same idea as an inline closure that returns `.id` only with no tie-break (ties fall to `reduce`'s first-wins). Same domain intent, two implementations, two tie rules. The commit version could call the repeat version and read `.id`.

## MINORS (20)

### m1 -- Middleware dev gate checks cookie presence only (Low, security)
- **Source:** security L1
- **Location:** `middleware.ts` (`devSessionGate`)
- **Claim:** Only checks that `tomchei_session` exists; any value passes the edge gate and renders the `/admin/*` shell. Real validation happens server-side in `requirePermissionPage`/`requirePermissionApi`, so worst case is rendering the empty admin layout (no data). Defense-in-depth gap only.

### m2 -- `clientIp` takes the LAST `X-Forwarded-For` hop (Low, security)
- **Source:** security L2
- **Location:** `lib/rate-limit.ts`
- **Claim:** Reads `chain[chain.length - 1]` when `TRUST_PROXY` is set. Correct for a single-tier proxy (Vercel default), but if a deploy sits behind more than one proxy (CDN -> Vercel, or self-hosted chain), the last hop becomes an intermediate and rate-limit keys collapse. Convention is the leftmost untrusted hop. Document the single-proxy assumption or take the leftmost hop.

### m3 -- Account-order detail page asserts non-null customer context (Low, security)
- **Source:** security L3
- **Location:** `app/(storefront)/account/orders/[id]/page.tsx:18`
- **Claim:** `const customer = (await getCustomerContext())!;` -- if the customer cookie is absent/expired, `customer` is `null`, the non-null assertion is unsound, and the next line throws `TypeError` -> 500 instead of a clean redirect to `/signin`. The `/account` layout normally redirects first; defense-in-depth gap. Use `notFound()` / redirect when `customer` is null.

### m4 -- Newsletter subscribe allows list poisoning (Low, security)
- **Source:** security L4
- **Location:** `app/api/newsletter/subscribe/route.ts`
- **Claim:** Upserts `SUBSCRIBED` for any supplied email and returns `{ ok: true }` with no token. Rate-limited at 5/min/IP. An attacker can add arbitrary addresses to the subscriber list (the management/unsubscribe token is only ever sent by email later, so this does not mint tokens). Consider opt-in confirmation before `SUBSCRIBED`.

### m5 -- Test-email and campaign test-send accept arbitrary recipients (Low, security)
- **Source:** security L5
- **Location:** `app/api/admin/email/test/route.ts`, `app/api/admin/email/campaigns/[id]/test-send/route.ts`
- **Claim:** Both send to any `email()`-valid address supplied by the caller. Permission-gated (`settings.manage` / `email.manage`) and audited; campaign test-send uses a neutral "Test Recipient" display name. Residual: a holder of either permission can use the org's sender to mail arbitrary external addresses (low-volume phishing relay using the org's domain reputation). Worth an allowlist or confirm step for external addresses.

### m6 -- Registration race on the fresh-email branch (Low, security)
- **Source:** security L6
- **Location:** `app/api/account/register/route.ts`
- **Claim:** Checks `db.customer.findUnique({ where: { email } })`, then in the `!existing` branch calls `findOrLinkCustomer(...)` and separately `db.customer.update({ where: { id: customer.id }, data: { passwordHash, name } })`. A concurrent registration for the same brand-new email can create the row between check and create; `findOrLinkCustomer` returns that row and the second writer overwrites the first `passwordHash`. Extremely narrow window. A unique constraint plus upsert-on-create, or a single transaction, would remove it.

### m7 -- `verify-email` page reflects the token's email in the page (Low/info, security)
- **Source:** security L7
- **Location:** `app/(storefront)/verify-email/page.tsx`
- **Claim:** Renders `Choose a password for {email}` where `email` is decoded from the signed token. The email only reaches the token via staff/guest entry that validated it as an email address, and React escapes it -- no injection. Noted only because reflecting server-provided strings is a habit worth keeping conscious of.

### m8 -- `fallbackMethod` can dereference `undefined` (Low, quality)
- **Source:** quality F3
- **Location:** `lib/legacy-import/commit.ts:195`
- **Claim:** `const fallbackMethod = methodByCode.get("local_delivery") ?? methods[0].id;` -- if `fulfillmentMethod` is empty (no seeded methods), `methods[0]` is `undefined` and `.id` throws synchronously inside the `orders` transaction, aborting the commit with a generic error rather than a readable message. The seeded DB always has methods so this is latent; the rest of the import pipeline fails with explicit messages.

### m9 -- `season.orderCounter` overwritten to imported max with no invariant check (Low, quality)
- **Source:** quality F4
- **Location:** `lib/legacy-import/commit.ts:236-237`
- **Claim:** `await tx.season.update({ where: { id: seasonId }, data: { orderCounter: maxNumber } })` is safe only because (a) the legacy season is created `status: "CLOSED"` and (b) order numbering is season-scoped. The code asserts neither invariant. If a future change reuses an OPEN season for legacy import, or if order numbers ever go global, this update could reset the counter downward and the next finalize would collide. P12 S3 smoke proves the happy path (counter 108) but not the invariant.

### m10 -- Stale placeholder comment on `orders.view` (Info, quality)
- **Source:** quality F5
- **Location:** `lib/auth/permissions.ts:8`
- **Claim:** `"orders.view": "View orders (placeholder until ordering phases land)"` -- ordering phases (P4/P5) have landed; the comment is stale. Cosmetic only; the permission itself works.

### m11 -- Dead `quote.fees!.ok` conditionals in `create-order.ts` (Info, quality)
- **Source:** quality F6
- **Location:** `lib/checkout/create-order.ts:161,164`
- **Claim:** The function returns a conflict at lines 67-73 when `!quote.fees || !quote.fees.ok`, so by the time the transaction runs `quote.fees.ok` is guaranteed true. Lines 161 and 164 still gate on `quote.fees!.ok ?` -- dead branches; harmless but misleading (they imply the false case is reachable).

### m12 -- `register/complete` TOCTOU + non-single-use token (Info, quality)
- **Source:** quality F7
- **Location:** `app/api/account/register/complete/route.ts:37-50`
- **Claim:** `findUnique` -> `if (customer.passwordHash) return 409` -> `update`. Two concurrent completes with the same token both pass the check and both write the password (last write wins). Both callers hold a valid token, so both proved email control -- not a security hole; the account ends up with exactly one password. The token is not invalidated after use; replay within the 24h TTL is blocked only by the `passwordHash` check. The token's TTL is the only thing keeping a leaked-but-unused token live.

### m13 -- Documentation drift: stale path in DECISION-LOG (Low, rules)
- **Source:** rules #2
- **Location:** `DECISION-LOG.md:92` (DECISION-P12-7)
- **Claim:** References `STATE_NAMES` in `lib/legacy-import.ts`, which was deleted in the self-fix and split into `lib/legacy-import/plan.ts` (where `STATE_NAMES` now lives) and `lib/legacy-import/commit.ts`. Tree-wide search confirms line 92 is the only remaining reference to the old filename; every code importer and the test were updated. A reader chasing `STATE_NAMES` from the decision log lands on a 404 path. Violates clean-code "consistency / single source of truth" and workflow's "keep README/decision log current."

### m14 -- Codegraph impact step not verifiable from tree (Info, rules)
- **Source:** rules #3
- **Location:** `lib/legacy-import/{plan,commit}.ts`
- **Claim:** The codegraph rule requires `codegraph_impact` before a rename/delete/signature change/refactor. The self-fix performed exactly such a refactor (deleted `lib/legacy-import.ts`, split into two concern-scoped files). Whether the impact step was run is a process fact not recorded in the tree, so it cannot be graded from the post-fix state alone. Observable: the split is clean -- `app/api/admin/legacy-import/route.ts`, `lib/legacy-import/commit.ts`, and `tests/legacy-plan.test.ts` all import from the new paths; no dangling reference to the old module survives (the one `lib/legacy-import.ts` hit, DECISION-LOG:92, is documentation, not an import). Recorded as Info, not a defect.

### m15 -- Two `CommitResult` types in the same `lib/` tree (Low, clean-code)
- **Source:** clean-code #5
- **Location:** `lib/imports.ts:112-114` vs `lib/legacy-import/commit.ts:15-19`
- **Claim:** `lib/imports.ts` exports a `{ ok: true; created; skippedDuplicates } | { ok: false; error; invalidLines? }` shape; `lib/legacy-import/commit.ts` exports `{ runId; completedStages; status }` under the same name `CommitResult`. Both are `lib`-level exports; a caller importing from the wrong path gets a silently wrong shape. Distinct features (staged CSV import vs legacy migration), but the name collision is an unnecessary trap -- rename one (e.g. `LegacyCommitResult` / `StagedCommitResult`).

### m16 -- Conditional className built two ways (Low, clean-code)
- **Source:** clean-code #6
- **Location:** `components/account/auth-forms.tsx:69-72` vs `components/admin/email-hub.tsx:34-36`
- **Claim:** `auth-forms.tsx` imports `cn` from `@/lib/cn` for conditional tab styling; `email-hub.tsx` does the same kind of conditional with a template-literal ternary and no `cn`. The clean-code rule calls for one styling approach per project. `cn` exists for exactly this; the email hub (and a few other admin components) skip it. Minor, but the kind of drift that compounds.

### m17 -- Tab-list pattern hand-rolled twice (Low, clean-code)
- **Source:** clean-code #7
- **Location:** `components/account/auth-forms.tsx`, `components/admin/email-hub.tsx`
- **Claim:** The tab-list container (`role="tablist"` + mapped buttons with `aria-selected` + per-tab conditional styling) appears in `auth-forms.tsx` (2 tabs) and `email-hub.tsx` (4 tabs) with different markup and styling. Two call sites is the Rule-of-2 floor, but the shapes diverge enough that a shared `<Tabs items=...>` would absorb the role/aria/conditional-class logic and leave only the labels. Borderline -- leaving it duplicated is defensible if the two tab UIs are expected to stay visually distinct.

### m18 -- Admin page header snippet repeated 6x (Low, clean-code)
- **Source:** clean-code #8
- **Location:** `app/(admin)/admin/**/page.tsx` (`help`, `exports`, `page`, `test-console`, `import`, `reports`)
- **Claim:** The exact `<h1 className="text-2xl font-semibold mb-1">` + `<p className="text-sm text-muted mb-6">` subtitle block appears in 6 admin pages. A `<PageHeader title subtitle>` would be a 5-line component used 6 times -- roughly break-even on lines, positive on consistency. Borderline; stable enough to leave per the "if removing duplication adds more lines than it saves" rule, but the subtitle class is the kind of token that drifts per-page over time.

### m19 -- No god files (Info, clean-code)
- **Source:** clean-code #9
- **Location:** `lib/routes/service.ts` (largest, 475 lines)
- **Claim:** No source file exceeds the 500-line god-file threshold. `lib/routes/service.ts` (475) bundles five route-lifecycle operations plus `switchPackageMethod` (a package-level concern) under one file. The header scopes the file to "delivery route lifecycle," but `switchPackageMethod` is invoked from `confirmReroute` and the package board -- a package operation living in the routes file. A split would separate the two concerns before the file crosses 500. Not a god file today; the seam is visible.

### m20 -- Naming / error handling clean (Info, clean-code)
- **Source:** clean-code #10
- **Location:** tree-wide (`lib/`)
- **Claim:** No banned vague names (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`) found as standalone identifiers. No empty `catch` blocks anywhere in the tree. `ActionError` messages consistently state what went wrong and the expected state. Comments are intent-bearing (rule IDs, atomicity notes, retry-safety notes), not narration. Strongest aspect of the tree.

## Dedupe notes

No two specialist findings shared the same location+claim, so no findings were merged. Adjacent-but-distinct pairs that were checked and kept separate:

- **Security M2** (same-origin guard absent on auth endpoints) vs **Security L4** (newsletter list poisoning) vs **Quality F2 / M7** (register endpoint parallel login without per-account throttle) -- same endpoint set, different claims (origin guard vs opt-in vs per-account throttle).
- **Security L6** (register fresh-email race, `app/api/account/register/route.ts`) vs **Quality F7 / m12** (`register/complete` TOCTOU, `app/api/account/register/complete/route.ts`) -- different files, different races.
- **Quality F1 / M6** (verify-email flow untested) vs **Security L7 / m7** (verify-email page reflects token email) -- same page, different claims (coverage vs reflection).
- **Rules #1 / M8** (duplicated signed-token implementations) vs **Quality F1 / M6** (verify-email flow untested) -- both touch `lib/auth/registration-token.ts`; one is duplication, the other is test coverage.
- **Clean-code #4 / M11** (closest-priced reducer twice) vs **Quality F3 / m8** and **F4 / m9** (both in `lib/legacy-import/commit.ts`) -- same file, different claims (duplication vs undefined deref vs counter invariant).
- **Clean-code #5 / m15** (two `CommitResult` types) vs **Quality F3/F4** -- same file (`lib/legacy-import/commit.ts`), different claims.

## Bottom line

The post-fix tree has **no High-severity security residuals**; the single Blocker is a clean-code adoption-debt finding (B1, `adminHandler` barely adopted). The 11 Majors split into 5 security hardening gaps (M1-M5, the most operationally relevant being M1 -- per-process rate limiter under multi-instance prod), 2 quality coverage/throttle findings (M6-M7), 1 rules duplication finding (M8), and 3 clean-code pattern-drift findings (M9-M11). The 20 Minors are defense-in-depth polish, latent guards, doc drift, and borderline duplication. No new findings were introduced during aggregation.
