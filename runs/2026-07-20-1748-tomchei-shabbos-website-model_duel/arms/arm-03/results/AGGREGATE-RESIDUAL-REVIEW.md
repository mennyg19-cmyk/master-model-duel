# Aggregate Residual Review -- arm-03 (Test 5, post self-fix)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-03`
**Output:** `arms/arm-03/results/AGGREGATE-RESIDUAL-REVIEW.md`
**Method:** Union + dedupe by location+claim across four specialist residual reviews (security, quality, rules, clean-code). Blind -- based on post-fix tree only. No new findings introduced during aggregation.

## Classification rule

- High -> **Blocker**
- Medium -> **Major**
- Low / Info -> **Minor**

Security blockers always survive.

## Counts

| Class | Count |
|---|---|
| Blockers | 5 |
| Majors | 11 |
| Minors | 26 |
| **Total** | **42** |

| Source | Blocker | Major | Minor | Total |
|---|---|---|---|---|
| Security | 1 | 4 | 11 | 16 |
| Quality | 0 | 2 | 4 | 6 |
| Rules | 0 | 0 | 2 | 2 |
| Clean-code | 4 | 5 | 9 | 18 |

Security-blocker count: **1** (newsletter subscribe email-bombing faucet).

## Dedupe overlaps merged

- `lib/routes/service.ts` god file (965 lines, 7+ concerns): rules #1 (Medium) merged into clean-code #1 (High) -> single Blocker.
- `lib/payments/reconcile.ts` dead re-export shell + unused `seedOrphanPaymentIntent` + `runPaymentReconciliation` alias: rules #2 (Medium) and clean-code #18 (Low) merged into clean-code #4 (High) -> single Blocker.
- Admin page guard boilerplate (`try { requireAdminPage } catch AuthError 403 -> <Forbidden>`) duplicated across 26 pages: rules #5 (Info) merged into clean-code #3 (High) -> single Blocker.
- Rules #4 (Low cluster of >500-line files: import/repeat/drafts/session/print-batch) fully subsumed by clean-code #2 (import.ts), #7 (drafts/session/print-batch), #9 (repeat.ts) -> dropped.

Five findings merged/dropped; 47 raw -> 42 deduped.

## BLOCKERS (5)

### B1 -- `/api/newsletter/subscribe` is an unbounded welcome-email faucet (High, security)
- **Source:** security H-1
- **Location:** `src/app/api/newsletter/subscribe/route.ts`, `src/lib/storefront/newsletter.ts`
- **Claim:** Public POST upserts on `emailNorm` and **increments `tokenVersion`** on every call; the welcome-email outbox key is `newsletter.welcome:{id}:v{tokenVersion}`, so each subscribe mints a fresh idempotency key and queues a new welcome. An unauthenticated attacker can bomb any victim inbox and grow `NewsletterSubscriber.tokenVersion` + outbox unboundedly. Sibling unsubscribe/preferences routes are signed-token gated; subscribe is the open faucet. Compare `/api/checkout` which correctly applies `withPublicGuard`.
- **Why blocker:** Security High. Money-adjacent abuse (email sending) + unbounded DB growth on a public endpoint.

### B2 -- `lib/routes/service.ts` god file (965 lines, 7+ mixed concerns)
- **Source:** clean-code #1 (merged with rules #1)
- **Location:** `src/lib/routes/service.ts`
- **Claim:** 965 lines bundling PIN hash/verify, magic-link lifecycle, route CRUD, stop delivery, printed-fallback delivery, reroute logic, day-of notify, print PDF. Trips both god-file triggers in `clean-code.mdc`: >500 lines AND mixed concerns. Self-fix deferred as SR-M7 ("large structural move without behavior change; too risky for one security-focused pass") -- defensible for the pass, but the defect remains in the post-fix tree.
- **Why blocker:** Clean-code High. Highest-severity residual in the tree; the file grew further during the self-fix (scrypt + unlock helper).

### B3 -- `lib/ops/import.ts` god file (671 lines, mixed concerns)
- **Source:** clean-code #2
- **Location:** `src/lib/ops/import.ts`
- **Claim:** 671 lines mixing CSV parse + header map + 3 classifiers + 3 committers + stage/commit orchestration. Pre-existing, deferred as SR-M8. The 3 `classify*Rows` functions share one skeleton and the 3 `commit*Row` functions share the P2002 catch pattern (first two byte-identical, third inconsistent) -- see M6.
- **Why blocker:** Clean-code High. God file with internal duplication on a critical import path.

### B4 -- Admin page guard boilerplate duplicated across 26 pages
- **Source:** clean-code #3 (merged with rules #5)
- **Location:** `src/app/(admin)/admin/**/page.tsx`
- **Claim:** The `try { await requireAdminPage("<perm>"); return <Client />; } catch (error) { if (error instanceof AuthError && error.status === 403) return <Forbidden message={error.message} />; throw error; }` block is hand-rolled in ~26 admin pages. The self-fix SR-M1 copied this boilerplate into the two new routes pages instead of extracting a `withAdminPage(permission, render)` helper or `<AdminPage permission>` wrapper -- reproducing the drift it traveled through. A reader must know one pattern that could be one helper.
- **Why blocker:** Clean-code High. Adoption debt the self-fix reproduced; ~26 x ~10 lines of duplicated control flow.

### B5 -- `lib/payments/reconcile.ts` is a dead re-export shell + unused seed helper
- **Source:** clean-code #4 (merged with rules #2, clean-code #18)
- **Location:** `src/lib/payments/reconcile.ts`
- **Claim:** 65-line module that re-exports `runPaymentReconcile as runPaymentReconciliation`, `listReconcileRuns`, and `ReconcileResult` from `@/lib/ops/reconcile`, plus exports `seedOrphanPaymentIntent`. Tree-wide grep for `from "@/lib/payments/reconcile"` and for `seedOrphanPaymentIntent` returns **zero** hits in `src/` and `scripts/`; both real call sites import directly from `@/lib/ops/reconcile`, and `scripts/smoke-p12.mjs` imports from `../src/lib/ops/reconcile`. The docblock says "re-exports for any leftover imports" but there are no leftover imports. The whole file is dead code -- violates `clean-code.mdc` ("Dead code -- delete, don't comment out") and the ponytail `delete:` audit tag. The `runPaymentReconciliation` alias has no callers.
- **Why blocker:** Clean-code High. The self-fix consolidated the two parallel reconcile libraries (the single biggest P12 defect) but left the old shell behind.

## MAJORS (11)

### M1 -- `/api/health` leaks `AUTH_MODE` and `WEB_PORT` to unauthenticated callers (Medium, security)
- **Source:** security M-1
- **Location:** `src/app/api/health/route.ts`
- **Claim:** Public `GET /api/health` returns `{ authMode, webPort }`. `AUTH_MODE=dev` advertised over HTTP is a reconnaissance signal that the dev-auth bypass is active. Health checks should report liveness only, not configuration.

### M2 -- Guest draft creation has no rate limit -> DB row spam (Medium, security)
- **Source:** security M-2
- **Location:** `src/app/api/drafts/route.ts` (POST), `src/lib/orders/drafts.ts`
- **Claim:** Public `POST /api/drafts` for a guest with no `guest_draft_token` cookie creates a new `Order` (DRAFT) + new guest access token hash on every call. No per-IP/per-session rate limit, no cap on guest drafts per client. Attacker can create unlimited draft rows (and inventory reservations if lines added), degrading DB and the inventory reserve pool. SameSite=lax + httpOnly cookie mitigates CSRF, but volume abuse is open.

### M3 -- `assertCanMutateDraft(draftRef, _request)` ignores the request -> no Origin/CSRF check on draft mutations (Medium, security)
- **Source:** security M-3
- **Location:** `src/lib/orders/draft-access.ts` (`assertCanMutateDraft`), callers in `drafts/[draftRef]/lines`, `drafts/[draftRef]/lines/[lineId]`, `drafts/[draftRef]/assign`, `drafts/[draftRef]` (PATCH)
- **Claim:** `assertCanMutateDraft` takes `_request` and `void`s it -- the parameter is dead. Draft mutation routes rely solely on ownership (customer/guest/staff principal) and never check `Origin`/`Referer`. SameSite=lax blunts classical CSRF, but no explicit same-origin guard. Combined with M2, a malicious page could drive guest draft mutations on a victim's browser via attached cookies. The dead parameter strongly suggests an Origin check was intended and never wired up.

### M4 -- Refund capability granted to every STAFF via `admin.access` (Medium, security)
- **Source:** security M-4
- **Location:** `src/app/api/admin/orders/[id]/refund/route.ts`, `src/lib/permissions.ts`
- **Claim:** `POST /api/admin/orders/[id]/refund` requires only `admin.access`, which STAFF holds. STAFF can issue refunds of any amount on any order (route validates `amountCents` against the payment but not against a role gate). Refunds are financially sensitive and irreversible (Stripe `refunds.create` in non-mock mode). The model has `settings.write` (MANAGER) for other money-shaping ops (imports, exports, test-ops, season-gate), but refunds sit at the broader `admin.access` tier. Audit captures who, but the gate is wider than the risk.

### M5 -- Refund increment is non-transactional; retry after partial failure double-counts (Medium, quality)
- **Source:** quality RQ-1
- **Location:** `src/lib/payments/webhook.ts:313-329` (`handleChargeRefunded`)
- **Claim:** `db.payment.update({ data: { refundedCents: { increment: refund.amount } } })`, `db.auditLog.create`, `recalcOrderPaymentStatus`, and `markWebhookEventProcessed(appliedKey, "refund.applied")` are four independent non-transactional writes. The per-refund idempotency key `refund_applied:${refund.id}` is only set to `processed` by the last step. If the increment commits but a later step throws, the key stays in `processing`; on Stripe retry `claimWebhookEvent` sees `status !== "processed"` and re-claims, so the increment fires again -- `refundedCents` double-counted and `recalcOrderPaymentStatus` caches an inflated refund total. The SR-M2 fix prevents cross-event double-increment, but the retry-after-partial-failure window is still open. On a money path this can mis-state order payment status (PAID -> PARTIALLY_REFUNDED -> fully refunded when only one refund occurred).

### M6 -- Start/deliver re-verify PIN even when link already unlocked -> refresh-induced lockout (Medium, quality)
- **Source:** quality RQ-2
- **Location:** `src/lib/routes/service.ts:446-462` (`startRouteViaMagicLink`), `:551-568` (`markStopDelivered`); contrast `src/app/api/driver/[token]/route.ts:48-56` (GET uses `isMagicPinUnlocked`)
- **Claim:** The SR-B2 fix made GET release stop PII as soon as `isMagicPinUnlocked(link.id)` is true. The mutating paths do not consult that flag: when `link.pinRequired` is true they always call `verifyMagicPin({ pin: input.pin ?? "" })`, which re-runs `verifyPinHash` and increments `pinFailCount` on mismatch. Broken flow: driver enters PIN -> unlocks -> refreshes page. After refresh `pin` state is gone; GET returns full roster (`unlocked: true`) so UI shows stops + Start/Deliver buttons. Clicking either sends `pin: undefined`; `verifyMagicPin({pin: ""})` fails, increments fail counter, and after three such clicks locks the driver out for 60s -- even though the link is already unlocked. GET and POSTs disagree on what "unlocked" means.

### M7 -- `money(cents)` formatter defined 3x with the same body (Medium, clean-code)
- **Source:** clean-code #5
- **Location:** `components/admin/reports-client.tsx:31`, `lib/email/order-emails.ts:119`, `app/(admin)/admin/page.tsx:7`
- **Claim:** Three copies of the same cents-to-display formatter. Rule of 2 satisfied (3 real call sites). A shared `lib/format/money.ts` would collapse all three.

### M8 -- `import.ts` 3x `classify*Rows` + 3x `commit*Row` share one skeleton (Medium, clean-code)
- **Source:** clean-code #6
- **Location:** `src/lib/ops/import.ts:87,139,198,349,385,423`
- **Claim:** The three `classify*Rows` functions share one skeleton and the three `commit*Row` functions share the P2002 catch pattern. First two `commit*Row` are byte-identical; the third is inconsistent. Rule of 2 satisfied; extracting a `classifyRows(rows, kind)` + `commitRow(tx, row, kind)` pair would dedupe and fix the inconsistency.

### M9 -- `lib/orders/drafts.ts` (540), `lib/checkout/session.ts` (531), `lib/ops/print-batch.ts` (513) all over the 500-line split threshold (Medium, clean-code)
- **Source:** clean-code #7
- **Location:** `src/lib/orders/drafts.ts`, `src/lib/checkout/session.ts`, `src/lib/ops/print-batch.ts`
- **Claim:** Three more files over the 500-line ceiling. Pre-existing, deferred as SR-M8. Recorded as Medium god-file hits outside the security-pass delta.

### M10 -- `reports-client.tsx` redeclares `SeasonRow` (no `slug`) and `MarginReport` (no `orderId`) as subset copies of exported lib types (Medium, clean-code)
- **Source:** clean-code #8
- **Location:** `src/components/admin/reports-client.tsx:6-29` vs `src/lib/ops/reports.ts`
- **Claim:** Client redefines two types as subset copies of the lib-exported types. Type/schema drift risk if the lib type changes -- the client copy silently stays. Use `Pick<SeasonRow, ...>` / `Omit<MarginReport, "orderId">` from the single source of truth.

### M11 -- `lib/ops/repeat.ts` 665 lines, 5 exported repeat-order functions (Medium, clean-code)
- **Source:** clean-code #9
- **Location:** `src/lib/ops/repeat.ts`
- **Claim:** Single domain but over the 500-line threshold; preview/confirm/bulk seams visible. Borderline god file -- split by repeat operation kind if touched.

## MINORS (26)

### m1 -- `/api/client-error` unauthenticated, unbounded, no origin check (Low, security)
- **Source:** security L-1
- **Location:** `src/app/api/client-error/route.ts`
- **Claim:** Public route accepts `{ message, route }` and writes to `console.error` as JSON (newline log-injection mitigated by serialization). No rate limit or origin check. Attacker can flood server logs at no cost. `message` capped at 500 / sliced to 200 in log, limiting per-request size but not volume.

### m2 -- `admin/email` test_email + trigger_transactional send arbitrary content to arbitrary recipients (Low, security)
- **Source:** security L-2
- **Location:** `src/app/api/admin/email/route.ts`
- **Claim:** MANAGER can send `test_email` with attacker-controlled `subject`/`body` to any `to`, and `trigger_transactional` with arbitrary `vars` to any `recipientEmail`. `paymentUrl` sanitized via `sanitizeSameOriginUrl` (no phishing redirect), but the email body is manager-authored. Phishing-through-the-org's-channel vector if a manager account is compromised. No 2FA gate or allowlist on `to`.

### m3 -- `admin/customers` POST requires `admin.access`, not `settings.write` (Low, security)
- **Source:** security L-3
- **Location:** `src/app/api/admin/customers/route.ts`
- **Claim:** STAFF can create new customer records (display name, email, phone). Lower-risk than editing, but writes PII. `findOrCreateCustomer` is audited. Acceptable for POS walk-in workflow, but broader than strictly necessary.

### m4 -- `admin/pos/attach-customer` attaches by `customerId` without season/active scoping (Low, security)
- **Source:** security L-4
- **Location:** `src/app/api/admin/pos/attach-customer/route.ts`, `src/lib/ops/customers.ts`
- **Claim:** `attachOrCreatePosCustomer` takes a `customerId` and attaches to a draft. Route requires `admin.access` and asserts draft access, but no season/active scoping on `customerId` -- any customer id (including archived season) could be attached. Object-level gap vs routes that scope by `seasonId`. Impact limited (POS draft).

### m5 -- `admin/orders/[id]/labels` validate forwards arbitrary address to Shippo (Low, security)
- **Source:** security L-5
- **Location:** `src/app/api/admin/orders/[id]/labels/route.ts`
- **Claim:** `validate` action Zod-schemas the address with per-field max lengths (200/200/100/50/20) and forwards to `validateAddress` (Shippo API). Schema is fine; noted only because the address is sent to an external API under `admin.access`. No fix needed.

### m6 -- `admin/print-batches/artifacts/[artifactId]` serves stored `pdfDataUrl` (Low, security)
- **Source:** security L-6
- **Location:** `src/app/api/admin/print-batches/artifacts/[artifactId]/route.ts`
- **Claim:** Route calls `getPrintArtifact(season.id, artifactId)` -- season scoping present (good). `pdfDataUrl` base64-decoded and served inline with sanitized filename. No active issue; noting the trust path. If a season is archived and a new season reuses an id, `season.id` scoping still protects.

### m7 -- Dev `dev_user_id` cookie is `secure: false` (Info, security)
- **Source:** security I-1
- **Location:** `src/app/api/dev/session/route.ts`
- **Claim:** Dev session cookie set without `secure`. Intentional for loopback HTTP smoke (`APP_URL=http://127.0.0.1:3103`); route hard-gated on `AUTH_MODE=dev` + `NODE_ENV !== production`. Risk only if AUTH_MODE=dev runs on a non-loopback network. Documented convention; no fix needed.

### m8 -- `assertOfflinePaymentStaffOnly(true)` is a constant assertion (Info, security)
- **Source:** security I-2
- **Location:** `src/app/api/checkout/offline/route.ts`, `src/lib/payments/offline.ts`
- **Claim:** Asserts the literal `true`. Route already requires `admin.access` via `requirePermission`, so the gate is enforced upstream. The helper is a no-op that would only catch a future refactor dropping the upstream check. Defense-in-depth; not a finding against current code.

### m9 -- `admin/imports/prior-year-stub` and `admin/test-ops` dev-gated correctly (Info, security)
- **Source:** security I-3
- **Location:** `src/app/api/admin/imports/prior-year-stub/route.ts`, `src/app/api/admin/test-ops/route.ts`
- **Claim:** Both routes correctly gate on `AUTH_MODE=dev` + non-production, plus `settings.write`. Destructive ops additionally require test mode enabled. Positive; no residual issue.

### m10 -- Secret hygiene correct (Info, security)
- **Source:** security I-4
- **Location:** `.env`, `.env.example`, `.gitignore`
- **Claim:** `.env*` gitignored with `!.env.example` carve-out. `.env.example` uses placeholders (`pk_test_replace_me`, `sk_test_mock`, `whsec_mock_dev_only`, `tomchei-arm03-...-dev-only`) and documents fail-closed behavior. `NEWSLETTER_HMAC_SECRET`, `DRAFT_ACCESS_SECRET`, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET` all required at runtime with explicit throws. No hardcoded production secrets; no secret logged in any route. Positive.

### m11 -- Deprecated/dead routes return 410 without side effects (Info, security)
- **Source:** security I-5
- **Location:** `admin/print-artifacts/[id]`, `admin/packages/bulk-stage`, `admin/packages/regroup`, `admin/packages/[id]/split`, `admin/packages/[id]/stage`, `admin/orders/[id]/packing-slip`
- **Claim:** Six deprecated routes return `410 Gone` with a redirect hint to the live ops engine. None perform any DB write or state change. Safe to leave; consider deleting in a future tidy pass per clean-code `dead code` category.

### m12 -- `getStripeMode` silently labels a live key as "test" in production when `STRIPE_MODE` unset (Low, quality)
- **Source:** quality RQ-3
- **Location:** `src/lib/stripe/client.ts:8-36`
- **Claim:** In production with a real `STRIPE_SECRET_KEY` but `STRIPE_MODE` unset, the function falls through to `return mode === "live" ? "live" : "test"` and returns `"test"`. The fail-closed guard correctly forbids mock and rejects missing/mock-looking keys, but does not require `STRIPE_MODE` to be explicit. `getStripe()` charges the real key regardless of the label, so charges are not broken, but any branch keying off `getStripeMode() === "test"` will behave as if in test while live money moves.

### m13 -- Dead stub shipped: `stubAssignLabelToRoute` (Low, quality)
- **Source:** quality RQ-4
- **Location:** `src/lib/shipping/labels.ts:340-346`
- **Claim:** `export async function stubAssignLabelToRoute(labelId: string)` is defined (P9 hook stub) but has zero callers anywhere under `src/` (grep confirms only the definition site). Exported from a production module and ships in the bundle as dead code. The "P9 hook stub" naming signals it was meant to be wired into route assignment and never was. Delete it, or wire it into the route-build/reroute path.

### m14 -- Prior-year import remains a stub bypassing the real ORDERS pipeline (Low, quality)
- **Source:** quality RQ-5
- **Location:** `src/lib/ops/prior-year-stub.ts:16-155`; `src/app/api/admin/imports/prior-year-stub/route.ts`
- **Claim:** `seedImportedPriorYearOrder` directly creates a prior-year `PAID` order with `kind: "prior_year_order_stub"` rather than exercising the real `ImportKind.ORDERS` `classifyOrderRows` / `commitOrderRow` pipeline. Route is correctly dev-gated (`AUTH_MODE=dev` + non-production + `settings.write`), so cannot ship to production. Residual concern is evidentiary: P10/P12 smoke treats this stub as migration proof, so the real historical ORDERS import path remains unexercised end-to-end. Explicitly deferred in `SELF-FIX-NOTES.md` (SR-m6); recorded for completeness -- no new defect.

### m15 -- Gated GET still loads full stop PII from DB before discarding it (Low, quality)
- **Source:** quality RQ-6
- **Location:** `src/lib/routes/service.ts:370-390` (`loadMagicLinkSession`); `src/app/api/driver/[token]/route.ts:48-56`
- **Claim:** `loadMagicLinkSession` always `include`s `route.stops` (line 376). On the PIN-gated GET path the handler returns only `{ok, linkId, pinRequired:true, unlocked:false}` and throws the stops away. No data leaks (stops never serialized), but every locked-GET touches recipient names/addresses in the DB and hydrates the full stop graph for nothing -- wasted query + unnecessary PII hydration on the most-hit driver endpoint. Load link + route without stops for the gated branch, or split into a light variant for the unlock check.

### m16 -- Duplicated logic: complete-route block in `routes/service.ts` (Low, rules)
- **Source:** rules #3
- **Location:** `src/lib/routes/service.ts` `markStopDelivered` (~610-643) vs `markStopDeliveredFromPrint` (~998-1025)
- **Claim:** Both contain the same "if `pending === 0` -> mark route COMPLETED, set `graceExpiresAt`, revoke active magic links, write `ROUTE_COMPLETED` audit" block (~15 lines each). Two real call sites, Rule of 2 satisfied. A shared helper `completeRouteIfDone(tx, { routeId, actorId, via })` would collapse ~30 duplicated lines into one ~15-line helper plus two one-line calls -- net line reduction, so the ponytail carve-out does not apply.

### m17 -- Codegraph impact step not verifiable from tree (Info, rules)
- **Source:** rules #6
- **Location:** `src/lib/routes/service.ts` (future split)
- **Claim:** `codegraph.mdc` requires `codegraph_impact` before any rename/delete/signature change/refactor command. The self-fix did not perform a structural split (explicitly deferred the god-file splits), so no impact step was required by the delta. Whether one was run for the in-place edits is a process fact not recorded in the tree. Recorded as Info, not a defect.

### m18 -- Staff-id access naming drift across admin routes (Low, clean-code)
- **Source:** clean-code #10
- **Location:** `src/app/api/admin/**` (e.g. `reconcile/route.ts:27`, `season-gate/route.ts:21`, `email/route.ts:138`)
- **Claim:** Three different access shapes for the same concept: `staff.effectiveStaff.id` vs `ctx.staff.id` vs `ctx.effectiveStaff.id`. One pattern per concern says pick one and apply everywhere.

### m19 -- `imports-client.tsx` redeclares `ImportKind` as a string-literal union (Low, clean-code)
- **Source:** clean-code #11
- **Location:** `src/components/admin/imports-client.tsx:29,81`
- **Claim:** Redefines `ImportKind` as `"CUSTOMERS" | "PRODUCTS" | "ORDERS"` string-literal union and casts on every change; the prisma enum is the source of truth. Import the enum type from the schema instead.

### m20 -- `imports-client.tsx` embeds `MESSY_ORDERS` fixture CSV + seeded default `csvText` in the shipped admin client bundle (Low, clean-code)
- **Source:** clean-code #12
- **Location:** `src/components/admin/imports-client.tsx:21,31`
- **Claim:** Fixture CSV and seeded default text ship in the admin client bundle. Move fixtures to `scripts/` / smoke seeds; start UI with empty textarea.

### m21 -- `reports/route.ts` serializes `totals` that the client recomputes and never reads (Low, clean-code)
- **Source:** clean-code #13
- **Location:** `src/app/api/admin/reports/route.ts:24-34` vs `src/components/admin/reports-client.tsx:64-69`
- **Claim:** Server serializes `totals` on every performance response; client recomputes `totals` locally and never reads the server copy. Dead payload on the wire.

### m22 -- `reconcile/route.ts` POST validates `action: z.enum(["run"]).default("run")` -- single legal value with default, never read after parse (Low, clean-code)
- **Source:** clean-code #14
- **Location:** `src/app/api/admin/reconcile/route.ts:17-24`
- **Claim:** Single legal value with default; `action` is never read after parse. Either drop the field or add a real second action.

### m23 -- `reports-client.tsx` error paths set `error` and return without clearing `seasons` / `margin` (Low, clean-code)
- **Source:** clean-code #15
- **Location:** `src/components/admin/reports-client.tsx:48-55`
- **Claim:** A failed refresh after a successful load leaves stale data on screen with no staleness signal. Clear the prior data on error, or surface a stale flag.

### m24 -- `TestModeSetting` defined twice with the same shape in two lib files (Low, clean-code)
- **Source:** clean-code #16
- **Location:** `src/lib/ops/settings-keys.ts:13` and `src/lib/ops/test-ops.ts:27`
- **Claim:** Same type defined in two files. Drift risk if one side changes. Single exported type from `settings-keys.ts`; import everywhere.

### m25 -- `ReconcileResult.adjustedCount` and `createdAdjustments` are the same value under two names (Low, clean-code)
- **Source:** clean-code #17
- **Location:** `src/lib/ops/reconcile.ts:11-16,125,152-153`
- **Claim:** Both returned and set to the same value (`createdAdjustments`). Two names for one number. Pick one.

### m26 -- Naming / error handling clean (Info, clean-code)
- **Source:** clean-code #19
- **Location:** tree-wide (`src/lib/`)
- **Claim:** No banned vague names (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`) found as standalone identifiers. No empty catch blocks anywhere. `ActionError` messages consistently state what went wrong and the expected state. Comments are intent-bearing (rule IDs, atomicity notes, retry-safety notes), not narration. Strongest aspect of the tree. Positive.

## Dedupe notes

Five findings merged/dropped during aggregation (all by location+claim overlap):

- **Rules #1** (Medium, `routes/service.ts` god file) merged into **clean-code #1** (High, same file same claim) -> B2.
- **Rules #2** (Medium, `lib/payments/reconcile.ts` dead) merged into **clean-code #4** (High, same file same claim) -> B5. **Clean-code #18** (Low, `runPaymentReconciliation` alias no callers) is a subset of the same dead-file finding and folded into B5.
- **Rules #5** (Info, admin page guard boilerplate) merged into **clean-code #3** (High, same pattern same pages) -> B4.
- **Rules #4** (Low, cluster of >500-line files: import/repeat/drafts/session/print-batch) fully subsumed by **clean-code #2** (import.ts -> B3), **clean-code #7** (drafts/session/print-batch -> M9), **clean-code #9** (repeat.ts -> M11) -> dropped.

Adjacent-but-distinct pairs checked and kept separate:

- **Security M-2** (guest draft no rate limit) vs **Security M-3** (`assertCanMutateDraft` ignores request) -- same draft-mutation route set, different claims (volume abuse vs origin/CSRF guard).
- **Security I-3** (prior-year-stub + test-ops dev-gated correctly, positive) vs **Quality RQ-5 / m14** (prior-year stub bypasses real ORDERS pipeline) -- same stub, different claims (gating positive vs evidentiary gap).
- **Quality RQ-1 / M5** (refund increment non-transactional, `webhook.ts` `handleChargeRefunded`) vs **Security M-4** (refund capability too broad) -- same money path, different claims (atomicity vs privilege breadth).
- **Quality RQ-2 / M6** (start/deliver re-verify PIN, `routes/service.ts` mutating paths) vs **B2** (same file god file) -- same file, different claims (correctness vs structure).
- **Quality RQ-6 / m15** (gated GET loads full stop PII, `loadMagicLinkSession`) vs **B2** -- same file, different claims (query waste vs structure).
- **Clean-code #16 / m24** (`TestModeSetting` defined twice) vs self-review SR-m3 -- residual re-found the same defect; not a cross-source overlap.
- **Clean-code #11 / m19** (`imports-client.tsx` redeclares `ImportKind`) vs **Clean-code #12 / m20** (same file embeds `MESSY_ORDERS` fixture) -- same file, different claims (type drift vs dead fixture).

## Bottom line

The post-fix tree has **one security blocker** (B1, the newsletter subscribe email-bombing faucet) and **four clean-code blockers** (B2-B5: two god files, the admin page guard boilerplate adoption debt, and the dead `reconcile.ts` shell left by the reconcile consolidation). The 11 Majors split into 4 security hardening gaps (M1-M4: health info disclosure, guest draft volume abuse, draft-mutation origin gap, refund privilege breadth), 2 quality correctness findings (M5-M6: refund retry double-count, PIN re-verify lockout -- both in code touched by the self-fix and representing incomplete closure of the underlying issues), and 5 clean-code pattern/duplication findings (M7-M11). The 26 Minors are defense-in-depth polish, latent guards, dead stubs, doc/type drift, and positive observations. No new findings were introduced during aggregation.
