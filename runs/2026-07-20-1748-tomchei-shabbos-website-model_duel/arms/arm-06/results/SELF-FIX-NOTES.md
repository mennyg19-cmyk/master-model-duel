# Test 5 — Self-fix notes (single pass)

**Arm:** arm-06
**Tree:** `arms/arm-06/workspace/` (post-Test-4, fixes applied on top of SELF-REVIEW findings)
**Findings source:** `arms/arm-06/results/SELF-REVIEW.md` (0 blockers · 2 majors · 7 minors)

## Fixed

| ID | Severity | What changed |
|---|---|---|
| SR-01 | major | `lib/media/storage.ts` `copyObject` now names copies `<uuid>.<ext>` (extension from the source stored name) — the same shape originals use, so the strict `/uploads/[name]` serve pattern matches them under the local driver. Verified: generated name matches the route regex, old `copy-…` shape provably did not; P10 domain suite's wizard media-copy check passes. Serve-route comment updated to name the invariant. |
| SR-02 | major | `lib/payments/stripe.ts` idempotency key is now `checkout-<orderId>-<amountCents>`: same-total retries still collapse to one session, but a draft edit that re-freezes a different total mints a fresh session instead of colliding on the reused key. Stripe errors are now typed (`StripeApiError` carrying the HTTP status); a 400 from session-create maps to a `DomainRuleError` ("start checkout again — no charge was made"), which the pay route maps to a clean 422 instead of an unmapped 500. |
| SR-04 | minor | `lib/exports/datasets.ts` adds a `safeText` guard at the export edge: text cells starting with `= + - @` or tab get a leading `'`; numeric cells pass through. Applied centrally in `paged()` and on the two direct-yield datasets (year-metrics, item-sales), so all five datasets are covered. `lib/csv.ts` stays generic. |
| SR-05 | minor | New `lib/dev-auth.ts` owns the single `isDevAuthBypassEnabled()` predicate (bypass on ⇔ `DEV_AUTH_BYPASS=true` + `APP_ENV=test` + not Vercel production/preview). `lib/env.ts` and `middleware.ts` both read it — middleware no longer recomputes a weaker subset. Raw `process.env` reads keep the edge bundle free of the zod env parse; semantics unchanged (both defaults fail closed). |
| SR-06 | minor | Homepage impact bar relabeled to what the counts are: "Packages packed" (was "Packages delivered") and "Families reached" (was "Families served"). Counts kept — relabel chosen over filtering per the finding's either/or. |
| SR-07 | minor | Documented the single-editor assumption at `saveDraft` (`lib/orders/drafts.ts`) and in the README concurrency row: last-write-wins is deliberate, `Order.version` is exposed for a future baseVersion/409 check. Doc variant chosen — a real 409 needs client contract changes on every draft-saving surface, out of scope for one fix pass. |
| SR-08 | minor | `.uploads/` added to the workspace `.gitignore` (same class as `.pgdata/` / `.scratch/`). |
| SR-09 | minor | `next.config.mjs` gains a `headers()` block on `/:path*`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. |
| SR-03 | minor | README brought current: title P6→P12; "What P7..P12 ship" sections (package engine + print pipeline, Shippo + margin law, routes/driver/pickup, season wizard + repeat, email platform, reports/exports/legacy imports/reconciliation + test-ops gate); cron table covering all eight `vercel.json` schedules. |

## Skipped

None — all 9 findings addressed (SR-07 via the finding's own documentation option).

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test:unit` — 13/13 files pass (P5 webhook/pay helpers, P6 CSV, P10 repeat, P12 exports/reconciliation helpers included).
- Domain suites against embedded Postgres on 4106: `test-checkout.mts` (all checks pass — edit-after-submit + expire/repay paths), `test-payments.mts` (pass), `test-p10-domain.mts` (pass — wizard copies product media with independently-owned bytes), `test-p12-domain.mts` (pass — all five export datasets stream header-width rows through the new guard).
- SR-01 serve-pattern proof: new `<uuid>.<ext>` copy name matches `^[0-9a-f-]{36}\.(jpg|png|webp|gif)$`; the old `copy-<uuid>-<name>` shape does not.
- `npm run build` — compiles successfully (validates middleware edge bundling of `lib/dev-auth.ts` + the `headers()` block in `next.config.mjs`).
