# Aggregate Residual Review — arm-06 (Test 5)

**Reviewer:** external residual aggregator (blind — no model names)
**Tree graded:** `arms/arm-06/workspace/` (post self-fix, full tree)
**Method:** union + dedupe by location+claim across the four specialist residual reviews. No new findings introduced. Security findings always survive.
**Sources:**
- `results/reviews/residual-security-arm-06.md`
- `results/reviews/residual-quality-arm-06.md`
- `results/reviews/residual-rules-arm-06.md`
- `results/reviews/residual-clean-code-arm-06.md`

## Totals

| Bucket | Count |
|---|---|
| Blocker | 0 |
| Major | 5 |
| Minor | 16 |
| Nit | 1 |
| **Total (actionable)** | **22** |

Nit items are noted for completeness; not required fixes.

## Per-source counts

| Source | Blocker | Major | Minor | Nit | Notes (clean) |
|---|---|---|---|---|---|
| security | 0 | 2 | 5 | 0 | 6 |
| quality | 0 | 1 | 3 | 0 | 0 |
| rules | 0 | 0 | 4 | 0 | 1 |
| clean-code | 0 | 2 | 5 | 1 | 0 |
| **raw sum** | 0 | 5 | 17 | 1 | 7 |
| **after dedupe** | 0 | 5 | 16 | 1 | — |

One duplicate removed:
- clean-code F7 (`claimOrderNumber` / `claimDraftRef` near-identical claim) is reclassified as a Nit — the clean-code reviewer explicitly marked it "acceptable as-is — noted for completeness, not a required fix." It survives as a Nit rather than a Minor so it does not inflate the actionable count.

No cross-source location+claim duplicates. Security findings are disjoint from quality/rules/clean-code locations. No new findings introduced during aggregation.

## Severity mapping

Specialist vocabularies mapped to aggregate buckets per `kit/prompts/reviewer/review-aggregate.md` rule 6:

- Security Medium → Major; Security Low → Minor; Security Info → Notes (clean observations, not findings).
- Quality Major → Major; Quality Minor → Minor.
- Rules minor → Minor; Rules "not a finding" → Notes.
- Clean-code medium → Major; Clean-code low → Minor; Clean-code borderline-no-fix → Nit.

## Blockers

None.

## Majors

### MAJ-1 — Admin API mutation routes lack explicit CSRF / same-origin protection
- **Source:** [S] security M-1
- **Where:** All `app/api/admin/**/route.ts` POST/PATCH/DELETE handlers; `lib/auth.ts` `requireApiPermission`; `lib/session-codec.ts` cookie options (`sameSite: "lax"`).
- **Claim:** Public mutation endpoints guard with `assertSameOrigin` plus per-IP rate limiting. Admin API routes rely solely on the `SameSite=Lax` session cookie for CSRF defense — no Origin/Referer check, no CSRF token, no rate limit on any `/api/admin/*` mutation. `SameSite=Lax` blocks cross-site background fetches in modern browsers, so practical exposure is limited, but the defense is entirely browser-policy-dependent and asymmetric with the public routes. A future cookie-policy change, a legacy client, or a same-origin XSS would leave every admin mutation unprotected. Defense-in-depth gap, not an exploitable hole today.
- **Affected surface (sample):** staff create/patch/revoke, impersonation start/stop, payment post/void/refund, POS checkout, order finalize/repeat/bulk, settings writes, email campaign send/test-send, import stage/commit/discard, media upload/patch/delete, route link/deliver/reassign/reroute/start, export, reconciliation run, test-ops.

### MAJ-2 — `Content-Security-Policy` header is not set
- **Source:** [S] security M-2
- **Where:** `next.config.mjs` `headers()`.
- **Claim:** Baseline headers configured by the SR-09 fix: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. No `Content-Security-Policy` (HSTS is platform-managed on Vercel; CSP is not). Without CSP, any injected inline script (e.g., from a future stored-XSS in admin-rendered user content, or a compromised third-party script) executes with no policy boundary. React auto-escapes server-rendered text and admin JSON responses are not navigable HTML, so there is no immediate injection vector — but CSP is the standard defense-in-depth layer and its absence leaves the trust boundary implicit.

### MAJ-3 — `cancelDraft` clobbers a concurrent webhook finalize (unconditional status update)
- **Source:** [Q] quality MAJ-R1
- **Where:** `lib/orders/drafts.ts:244-253` (`cancelDraft`), reached by `DELETE /api/drafts/[draftRef]`.
- **Claim:** The status guard runs outside the transaction; the `tx.order.update` is unconditional on `id` — no `status: "DRAFT"` predicate inside the transaction. Compare `discardOrder` in `lib/orders/state-machine.ts:102-106`, which uses `updateMany` with `where: { id, status: "DRAFT" }` and throws `OrderConcurrencyError` on `count === 0`. Race: a customer submits checkout, starts the hosted Stripe page, then hits `DELETE /api/drafts/[draftRef]`. `cancelDraft` reads DRAFT outside the tx. A Stripe webhook lands and commits `completeCheckoutSession` — DRAFT → FINALIZED, stock committed, payment posted, email queued. `cancelDraft`'s transaction then runs `releaseOrderReservation` (a no-op) and unconditionally sets status DISCARDED. Net: a FINALIZED order with committed stock and a posted payment is clobbered to DISCARDED — a state/money inconsistency with no audit row for the clobber. Major, not Blocker: the window is narrow and ownership contains the blast radius to the ordering customer. Fix is one line — use the same conditional `updateMany` + `count === 0` guard as `discardOrder`, or re-read the status inside the tx and bail.

### MAJ-4 — Duplicated `normalizedAddressKey` (Rule-of-2 violation)
- **Source:** [C] clean-code F1
- **Where:** `lib/routes/geo.ts:40-51` (exported) vs `lib/shipping/labels.ts` (local re-declaration, identical body).
- **Claim:** `lib/routes/geo.ts` exports `normalizedAddressKey`; `lib/shipping/labels.ts` re-declares a local `normalizedAddressKey` with an identical body. The labels.ts copy differs only in the `line2` type annotation (`string | null` vs `string | null | undefined`) and is otherwise byte-identical. labels.ts already imports from `lib/routes/geo.ts` elsewhere — the local copy should be dropped in favor of the shared export. Two real call sites, same function: textbook Rule-of-2 violation. Duplicated logic.

### MAJ-5 — Duplicated auth-session scaffolding (staff vs customer)
- **Source:** [C] clean-code F2
- **Where:** `lib/auth.ts` (staff) vs `lib/customers/session.ts` (customer).
- **Claim:** Near-parallel implementations. Both define, with identical bodies: a `*Context` interface, `get*Session()`, `get*Context = cache(async () => …)` (same DB-row + expiry + revocation check), `require*()` → `redirect(isDevAuthBypass ? "/dev-login" : "/")`, `requireApi*()` → same `{ ok: true; ctx } | { ok: false; response: 401 }` gate, `create*LoginSession()` (identical IP + userAgent + `expiresAt` arithmetic), `revoke*LoginSession()` (identical `updateMany`), `*CookieOptions()` (identical httpOnly/sameSite lax/path/secure/maxAge), `issue*SessionResponse()` (identical cookie-set), `clear*SessionResponse()` (identical cookie-clear). The signed-JSON codec is already shared (`lib/session-codec.ts`), but the surrounding cookie/session/require scaffolding is copy-pasted. Two real call sites today; a parameterized `buildSessionAuth({ cookieName, ttlHours, load })` helper would collapse ~9 parallel functions into one. Related to MIN-16 (Session TTL magic value duplicated).

### MIN-1 — In-memory rate limiting is per-instance (bypassable under serverless)
- **Source:** [S] security L-1
- **Where:** `lib/rate-limit.ts` (module-level `Map`); `app/api/client-error/route.ts` (`recentHits` array).
- **Claim:** The fixed-window limiters and the client-error limiter are in-process maps/arrays. The module comment acknowledges this: "speed bump rather than a hard cap." Under Vercel's serverless model each instance keeps its own buckets, so an attacker rotating across instances effectively gets N× the limit. `MAX_KEYS = 10_000` bounds memory but not bypass. Documented limitation; no infrastructure dependency was added.

### MIN-2 — `clientIp` trusts the first hop of `X-Forwarded-For` (spoofable)
- **Source:** [S] security L-2
- **Where:** `lib/client-ip.ts`; consumed by `lib/auth.ts` `createLoginSession`, `lib/customers/session.ts`, every rate limiter, `lib/audit.ts`.
- **Claim:** `headers.get("x-forwarded-for")?.split(",")[0].trim().slice(0, 45)`. The comment correctly notes the header is client-controllable and is "audit metadata, never an auth input." On Vercel the platform prepends the real client IP, but a caller who controls the request can still influence the first hop in some proxy chains, rotating rate-limit keys and planting misleading audit IPs. Rate-limit evasion (compounds MIN-1) and polluted audit `ip` columns. Not used for authorization anywhere — confirmed by reading every consumer.

### MIN-3 — Open-redirect-shaped `next` parameter in dev-login customer form
- **Source:** [S] security L-3
- **Where:** `app/dev-login/page.tsx:48,63`; `app/dev-login/dev-customer-login-form.tsx` `router.push(next)`.
- **Claim:** The customer form does `next?.startsWith("/admin") ? "/account" : (next ?? "/account")` — so any `next` that does NOT start with `/admin` is passed verbatim to `router.push`. A `next=//evil.com` (protocol-relative) or `next=https://evil.com` would navigate off-origin. The page is gated by `isDevAuthBypass` (`lib/dev-auth.ts`), hard-disabled on every Vercel deploy (`VERCEL_ENV` production AND preview both refuse, plus `APP_ENV=test` required), so unreachable in any deployed environment. Local/test only. Still, the validation is a negative-prefix check rather than an allowlist of internal paths.

### MIN-4 — `assertSameOrigin` allows requests with no `Origin` header
- **Source:** [S] security L-4
- **Where:** `lib/public-guard.ts` `assertSameOrigin`.
- **Claim:** `if (!origin) return null;` — a request with no Origin header passes the guard. The comment justifies this: browsers always send Origin on cross-origin fetches, so a missing Origin means a same-site form or a non-browser caller (curl). Correct for browser CSRF defense, but a same-origin XSS or a browser bug that omits Origin would bypass the check on the public checkout/draft routes. Defense-in-depth gap on the public mutation surface. The admin surface (MAJ-1) has no Origin check at all.

### MIN-5 — `$executeRawUnsafe` used for `TRUNCATE` in test-ops
- **Source:** [S] security L-5
- **Where:** `lib/testops/actions.ts` `truncateAll` (line 113).
- **Claim:** `db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)` where `list` is built from hardcoded `WIPE_TABLES` / `CLEAR_TABLES` arrays. Table names are static module constants — no user input reaches the string. The unsafe variant is used because Prisma's tagged-template `$executeRaw` cannot compose a dynamic table list. None today — inputs are constants. Flagged only because the unsafe API is in use; a future copy-paste that interpolates a parameter here would be injectable. The route is also double-gated (`settings.manage` permission + `requireTestEnv()` refusing non-test `APP_ENV`).

### MIN-6 — No dead-letter row or alerting for a persistently failing safety refund
- **Source:** [Q] quality MIN-R1
- **Where:** `lib/checkout/webhook.ts:36-66` (`safetyRefund`).
- **Claim:** The MIN-1 fix correctly moved `createRefund` before `releaseOrderReservation`, so a refund failure holds the reservation (no double-charge on re-pay). But a persistent Stripe refund failure (outage, merchant balance insufficient) still leaves the captured charge outstanding, the reservation held, and no durable dead-letter row or operator alert. The webhook 500s so Stripe retries; `refund-${paymentIntent}` idempotency prevents a double-refund on retry. But a refund that never succeeds has no durable record beyond the server log. Narrow real-world window, hence Minor. Related to the original MIN-1/MIN-3; the re-pay hazard is closed, the operator-visibility hazard is not.

### MIN-7 — Two `// P5` change-explanation prefixes remain
- **Source:** [Q] quality MIN-R2
- **Where:** `lib/settings.ts:19` (`// P5 delivery rules (UR-009/G-015)...`), `lib/testops/baseline-seed.ts:186` (`// P5 placeholder rate rules...`).
- **Claim:** The "why" content of each comment is good and should stay; the `P5` prefix is the changelog tic MIN-16 called out. 2 of the 9 original sites remain.

### MIN-8 — `order_finalize` audit commits outside the finalize transaction
- **Source:** [Q] quality MIN-R3
- **Where:** `app/api/admin/orders/[orderId]/finalize/route.ts:17-24`.
- **Claim:** `finalizePosOrder` commits stock + finalize in its own transaction, then the route calls `recordAudit` after the transaction. A crash between commit and audit leaves a finalized order with no `order_finalize` audit row. Same class as the original MIN-2 (which the fix closed for the payment verbs). The P5 aggregate referenced this as the existing contrast pattern, so it is a known minor rather than a regression. Note: the POS checkout flow (`lib/payments/pos.ts`) does not write `order_finalize` at all — only `payment_post` — so the finalize action there has no dedicated audit row.

### MIN-9 — Dead code — `isProductionDeploy` exported, never imported
- **Source:** [R] rules 1
- **Where:** `lib/env.ts:32`.
- **Claim:** `export const isProductionDeploy = process.env.VERCEL_ENV === "production";` — a workspace-wide search returns exactly one occurrence, the declaration itself. No module imports it. The dev-bypass predicate that lives alongside it (`isDevAuthBypass`) is wired through `lib/auth.ts`, the middleware, `/dev-login`, and every `/api/dev/*` fixture route, so the production-deploy flag was either superseded by the `VERCEL_ENV !== "production"` checks inside `lib/dev-auth.ts` or left behind a refactor. Dead and should be deleted (ponytail Rule of 2 / YAGNI). Does not affect behavior; violates the dead-code category of the clean-code refactor checklist.

### MIN-10 — God file — `lib/shipping/labels.ts` at 597 lines
- **Source:** [R] rules 2
- **Where:** `lib/shipping/labels.ts` (597 lines).
- **Claim:** Single concern (carrier label lifecycle: purchase, void, refund, tracking, stuck-purchase sweep), cohesive, and the size is driven by the transactional audit + Shippo call shape — not a grab-bag. Still trips the clean-code bright line ("split when >500 lines"). A natural split is `lib/shipping/labels/purchase.ts` vs `lib/shipping/labels/sweep.ts` (the stuck-purchase resolution + `STUCK_PURCHASE_TTL_MINUTES` block is a self-contained cron helper). Borderline — size alone is the trip wire; no mixed-concern smell. Note: the clean-code reviewer reported "God files = 0" and listed `lib/print/pdf.ts` (338), `lib/shipping/shippo.ts` (295) as the largest modules — it did not surface `lib/shipping/labels.ts`. The two reviewers disagree on this file; the rules reviewer's line count is the verifiable fact, so the finding stands.

### MIN-11 — Naming — `result` / `data` as standalone names (systemic)
- **Source:** [R] rules 3
- **Where:** Systemic. `app/(admin)/admin/page.tsx:23` (`const data = ...`); `lib/imports/customers.ts:16`; `lib/imports/legacy/customers.ts:47,116,128`; ~20 client components (`const result = await apiFetch<...>(...)`); `lib/shipping/shippo.ts:285`; several `app/api/admin/.../route.ts` handlers.
- **Claim:** The clean-code rule bans `data`, `result`, `info`, `temp`, `val`, `item`, `thing` as standalone names. The post-fix tree has a systemic pattern of `const result = await apiFetch<...>(...)` in client components and `const data = ...` in a few lib/routes. The `result` pattern is pervasive enough to be a convention rather than a slip, but the rule names `result` as banned standalone. Two readings are defensible: (a) the rule is absolute and every occurrence is a finding; (b) `result` of a typed `apiFetch<T>` carries the type at the call site, so the vagueness is mitigated. Graded as a single systemic minor rather than ~25 individual ones — a single sweep renaming to `submitResult` / `fetchResult` / the specific noun would clear the category. No behavior impact; readability-only. Note: the clean-code reviewer reported "Naming violations = 0" — it graded function-naming consistency, not the banned-standalone-variable list. The two reviewers examined different facets of the naming rule; the rules finding stands on the banned-names facet.

### MIN-12 — Comment quality — change-explanation prefixes in two post-fix headers
- **Source:** [R] rules 5
- **Where:** `lib/env.ts:28-31` ("The bypass predicate lives in lib/dev-auth.ts (single source shared with middleware)..."); `lib/dev-auth.ts:1-13` ("Single source for the dev-login bypass predicate (SR-05)").
- **Claim:** The post-fix tree leans heavily on "why" comments (good), but a small number drift toward change-explanation in their opening sentences. `lib/env.ts:28-31` is a change-explanation comment ("lives in", "shared with") that narrates the SR-05 fix; the code already shows the import, the comment restates the fix's rationale. `lib/dev-auth.ts:1-13` is a 13-line header essay on the SR-05 fix; lines 1–6 and 8–13 carry the non-obvious platform-gating reasoning (good), but the "Single source for the dev-login bypass predicate (SR-05)" opening line is the change-explanation part. Both are defensible because the non-obvious platform-gating logic genuinely needs prose. Trimming the "single source / shared with middleware" sentences would tighten them. Minor / stylistic; no action required. Distinct from MIN-7 (which targets `// P5` prefixes in `lib/settings.ts` and `lib/testops/baseline-seed.ts`).

### MIN-13 — "Is provider configured?" checked four different ways (pattern drift)
- **Source:** [C] clean-code F3
- **Where:** `lib/notify/sms.ts` (`isSmsConfigured()`); `lib/email/resend.ts` (no helper — callers inline `const { apiKey } = getResendConfig(); if (!apiKey)` in `lib/email/dispatch.ts`); `lib/payments/stripe.ts` (no helper — callers inline `getStripeConfig().secretKey !== null` in `lib/checkout/submit.ts`); `lib/shipping/shippo.ts` (signals via `getShippoConfig()` returning `null`).
- **Claim:** One pattern per concern is violated across the four provider wrappers. Pick one (either `is*Configured()` everywhere, or `get*Config(): X | null` everywhere) and apply it to all four.

### MIN-14 — Provider config-cache memo pattern duplicated 3x (duplication)
- **Source:** [C] clean-code F4
- **Where:** `lib/payments/stripe.ts`, `lib/email/resend.ts`, `lib/notify/sms.ts` (each repeats the `let *ConfigCache = null; function get*Config() { if (!cache) { cache = {…} } return cache }` shape); `lib/shipping/shippo.ts` intentionally skips the cache (documented: env already snapshots once).
- **Claim:** Three modules repeat the same config-cache memo shape; shippo's documented opt-out makes the inconsistency starker. A tiny `memoizeConfig(builder)` helper would remove the boilerplate and make the "why is shippo different" decision an explicit opt-out.

### MIN-15 — `addressDedupeKey` vs `normalizedAddressKey` divergent normalization (duplication / drift)
- **Source:** [C] clean-code F5
- **Where:** `lib/customers/addresses.ts` `addressDedupeKey` vs `lib/routes/geo.ts` `normalizedAddressKey`.
- **Claim:** Both share the same "join line1|line2|city|region|postal|country, lowercase" shape but normalize differently: `addressDedupeKey` uses `normalizeWhitespace(part).toLowerCase()` (collapses internal runs of whitespace); `normalizedAddressKey` uses `part.trim().toLowerCase()` (edge trim only). A user typing `"123  Main St"` and `"123 Main St"` dedupes in the address book but produces different geocode cache keys (and different route-grouping keys). The two functions look interchangeable but aren't; the divergence is a latent correctness seam, not just style.

### MIN-16 — Session TTL magic value duplicated (magic values)
- **Source:** [C] clean-code F6
- **Where:** `SESSION_TTL_HOURS = 12` in `lib/auth.ts` and `CUSTOMER_SESSION_TTL_HOURS = 12` in `lib/customers/session.ts`, both documented as "the same 12h".
- **Claim:** Two sources of truth for one documented value. Collapse to a shared constant (related to MAJ-5).

## Nit (noted, no fix required)

### NIT-1 — `claimOrderNumber` / `claimDraftRef` near-identical claim (borderline)
- **Source:** [C] clean-code F7
- **Where:** `lib/orders/numbers.ts`.
- **Claim:** Two atomic UPDATE→RETURNING claim helpers that differ only by the column being incremented/read. Borderline: each is ~8 lines, stable, and column-specific. Per the discipline rule ("if removing duplication adds more lines than it saves and the code is stable, leave it"), this is acceptable as-is — noted for completeness, not a required fix. Reclassified from the clean-code reviewer's raw "low" count to a Nit so it does not inflate the actionable Minor count.

## Notes (clean observations, not findings)

Specialist reviewers recorded these as "checked and found clean." They are not findings and take no action; listed so the residual record shows they were examined, not missed.

- **[S] I-1 — Unauthenticated first-manager bootstrap at `/api/setup`:** Intentionally unauthenticated (no staff exists yet). Uses `pg_advisory_xact_lock(1)` + `staffUser.count() > 0` inside one transaction to make the empty-database check atomic, then 409s forever after the first manager. By design; the advisory lock prevents a TOCTOU double-bootstrap.
- **[S] I-2 — `/uploads/[name]` serves files unauthenticated:** Strict regex `^[0-9a-f-]{36}\.(jpg|png|webp|gif)$` (UUID + image ext) prevents path traversal and non-image names. Files served with immutable cache headers. Names are server-generated UUIDs, so enumeration is infeasible. Product images are public by intent; no auth gate is correct here.
- **[S] I-3 — Stripe webhook verification is correct and replay-protected:** RAW body read with `request.text()` and verified against the v1 signature with a 5-minute replay window, timing-safe compare. Idempotency via unique `StripeWebhookEvent(eventId)` row created before any domain work; on processing failure the row is deleted so Stripe retries cleanly. Zod parses the envelope and per-type object. No residual issue.
- **[S] I-4 — Driver magic link + PIN throttling is sound:** 256-bit token, only SHA-256 hash stored. PIN optional, hashed with route-id salt. Escalating lockout (`pinLockCount` never resets on success; 10m→20m→…→12h, then dead until rotation). PIN cookie is HMAC-bound to `linkId + expiresAt`. `requireActiveLink` is the single guard for every `/api/drive/[token]/*` verb. No residual issue.
- **[S] I-5 — Guest draft token transport is httpOnly-only:** Raw guest token issued once in the create response, then travels only in an httpOnly, `SameSite=Lax`, scoped, max-age-bounded cookie — never in URLs, response bodies, or localStorage. DB stores only the HMAC hash. Misses return 404 (not 403) to prevent enumeration. No residual issue.
- **[S] I-6 — Export CSV formula-injection guard present:** Every text cell starting with `= + - @` or a tab is prefixed with `'` so spreadsheet apps render it literally. The `content-disposition` filename for print-batch PDFs sanitizes quotes, backslashes, and control chars from the staff-influenced `filingGroup`. Route PDFs use `routeId` (server UUID) in filenames. No residual issue.
- **[R] 4 — Inline styles in `app/global-error.tsx`:** The one screen in the tree with inline styles, and the one screen where Tailwind is unavailable (`global-error.tsx` replaces the root layout and `globals.css` is not loaded for it). The file documents the constraint in a comment at line 6–7. Justified exception, not a rogue-styling violation.

## Suggested rubric score

Per `kit/rubrics/self-review-residual.md` (max 15). Grounded in residual counts above and the self-fix fix rate from `results/SELF-FIX-NOTES.md` + `results/SELF-REVIEW.md` (read only for the fix-rate dimension, per instructions — no findings added from those files).

| Dimension | Max | Score | Notes |
|---|---:|---:|---|
| Residual quality (post-fix tree) | 6 | 4 | 0 blockers, 5 majors, 16 minors, 1 nit. Quality reviewer closed all 4 pre-fix majors and 17/19 pre-fix minors; the tree is disciplined (server-side sessions with revocation, per-route permission gates, constant-time secret compares, fail-closed dev seams, raw-body webhook verification with DB idempotency, row-locked inventory, atomic number claims, zod at every input boundary). The 5 residual majors are defense-in-depth gaps (MAJ-1 admin CSRF, MAJ-2 no CSP), one real but narrow concurrency race (MAJ-3 `cancelDraft`), and two clean-code duplications (MAJ-4, MAJ-5) — not architectural faults. 5 majors is meaningful residual, hence 4/6 rather than 5–6. |
| Self-finding fix rate | 4 | 4 | Self-review found 0 blockers + 2 majors + 7 minors (9 findings). Self-fix notes: all 9 addressed (SR-01 through SR-09), none skipped. Fix rate on self-found majors+blockers = 2/2 = 100%. |
| Regressions introduced | 3 | 3 | Quality reviewer: "No regressions detected in the fee math, the state machine, the inventory locks, or the checkout page rendering." Residual findings are pre-existing patterns or edge cases, not regressions from the fix pass. |
| Solo process hygiene | 2 | 2 | Fresh self-review (single mode, findings only) and a single self-fix pass are both present and consistent; notes are complete (per-finding what-changed + verification block with typecheck/lint/unit/domain-suite/build evidence). |
| **Total** | 15 | **13** | |

Solo TCO ($): not computed here — lineage + self-review + self-fix cost rows live in `results/COST-LEDGER.csv`; the residual reviewer is listed separately per the rubric.

## Dedupe notes

- **NIT-1** reclassifies clean-code F7 from the raw "low" count to a Nit — the clean-code reviewer explicitly marked it "acceptable as-is — noted for completeness, not a required fix." Same location+claim, single item; severity adjusted so it does not inflate the actionable Minor count.
- **MIN-10** (rules: `lib/shipping/labels.ts` 597 lines) and **MIN-11** (rules: systemic `result`/`data` naming) are cases where the rules reviewer and the clean-code reviewer examined different facets of the same clean-code rule and disagreed on whether a finding exists. The rules reviewer's verifiable observations (line count; banned-name occurrences) stand; the clean-code reviewer's "0 god files / 0 naming violations" stance is preserved in each claim's note so the disagreement is visible rather than silently resolved.
- **MAJ-5** and **MIN-16** are related (same files, scaffolding duplication vs magic-value duplication) but target different claims, so they remain separate findings; the relation is noted in MAJ-5's claim.
- **MIN-7** (quality: `// P5` prefixes in `lib/settings.ts` and `lib/testops/baseline-seed.ts`) and **MIN-12** (rules: change-explanation headers in `lib/env.ts` and `lib/dev-auth.ts`) are the same clean-code category (comment quality) but different locations and different specific claims (changelog-prefix tic vs SR-05 fix narration). Kept separate.
- No other cross-source duplicates. Security findings are otherwise disjoint from quality/rules/clean-code locations.
- No new findings introduced during aggregation.
