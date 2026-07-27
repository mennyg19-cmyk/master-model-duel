# P9 Rules review — arm-05 (blind)

**Phase:** P9 — Delivery routes, driver magic links, reroute map, pickup, bulk delivery scheduling
**Rules graded:** `clean-code.mdc`, `vocabulary.mdc`, `ponytail.mdc`, `workflow.mdc`, `codegraph.mdc`
**Scope:** P9 code only (`lib/delivery.ts`, `lib/route-auth.ts`, `lib/cron-auth.ts`, `app/api/admin/delivery/**`, `app/api/driver/[token]/**`, `app/driver/[token]/page.tsx`, `app/admin/delivery/page.tsx`, `app/api/cron/pickup-expiry/route.ts`, `app/api/cron/payment-reminders/route.ts`, `scripts/smoke-p9.ts`, `.scratch/PHASE-P9-STATUS.md`, `.scratch/PHASE-P9-SMOKE.md`).
**Method:** Findings only — no fixes proposed.

## Summary counts

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 5 |
| Low | 4 |
| **Total** | **11** |

## Findings

### High

#### H1 — Mixed-concern god module: `lib/delivery.ts` carries every P9 concern
**Location:** `lib/delivery.ts` (1–456)
**Claim:** `clean-code.mdc` ("Split files by concern, not by line count — split when >500 lines, mixed concerns, or a refactor command") and `ponytail.mdc` ("God files: split when refactor command, >500 lines, or mixed concerns") both trigger on **mixed concerns**, independent of line count.
**Evidence:** A single module exports route creation, route list/reassign, route print/PDF, driver link load, driver route read, driver start, driver deliver, method switch, nearby shipping scan, reroute confirm, bulk delivery scheduling, pickup eligibility, pickup-ready, door list, pickup stamp, pickup expiry, and payment reminders. These are 6+ distinct P9 sub-features (routes / driver / method-switch / reroute / pickup / bulk+crons) fused into one file. 456 lines is under the hard cap, but the mixed-concern trigger fires regardless.

#### H2 — Missing plan deliverables: follow-up call-center filters and print-batch update on reroute
**Location:** `app/admin/delivery/page.tsx`; `confirmReroute` in `lib/delivery.ts` (351–363)
**Claim:** `workflow.mdc` Execution Discipline — "Implement attached plans verbatim — don't edit the plan file or re-create existing todos." Two P9 deliverables from `shared/MERGED-BUILD-PLAN.md` § P9 are absent in code.
**Evidence:**
- Plan P9: "follow-up call center with filters (R-079)". No call-center view, no follow-up filters, no R-079 wiring exists in `app/admin/delivery/page.tsx` or anywhere else in the workspace (grep for `call.?center|follow.?up` returns only unrelated admin operations text). The status file does not mention it.
- Plan P9 reroute: "adds to route, **updates print batch**". `confirmReroute` creates a `deliveryRouteStop` and an `auditEvent` but never calls any `print-batches` function and does not touch `printBatch`/`printArtifact`. The print batch is not updated when a package is rerouted onto a route.

### Medium

#### M1 — Method-switch audit does not record the preserved charge value
**Location:** `switchPackageMethod` audit detail, `lib/delivery.ts` (310–321)
**Claim:** `workflow.mdc` — "Never silently choose business logic (calculations, domain rules) — log in DECISION-LOG.md and flag." Plan P9 requires "charge preserved + who/when audit". The audit records `from`/`to` method codes and the literal string `"checkout_snapshot_unchanged"` instead of the preserved cents value.
**Evidence:** `details: { from, to, preservedCustomerChargeCents: packageRecord.orderId ? "checkout_snapshot_unchanged" : null }`. `preservedCustomerChargeCents` is a string assertion, not the numeric charge. A reviewer or reconciliation report cannot verify the preserved amount from the audit row alone. The smoke test (`smoke-p9.ts` 99–101) only checks `order.totalCents` equality, not the audit content.

#### M2 — Duplicated geocode-cache TTL magic value
**Location:** `geocodeAddress`, `lib/delivery.ts` (69 and 75)
**Claim:** `clean-code.mdc` — "Magic values → named constants / enums"; "Duplicated logic — pull into helpers".
**Evidence:** `new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)` is written twice (create and update branches of the same `upsert`), and the 30-day TTL is unnamed. `MAGIC_LINK_TTL_MS`, `PICKUP_EXPIRY_MS`, `PIN_THROTTLE_MS` are named; the geocode TTL is not.

#### M3 — Unnamed half-mile / Earth-radius magic numbers in reroute proximity
**Location:** `isWithinHalfMile`, `lib/delivery.ts` (86–93)
**Claim:** `clean-code.mdc` — "Magic values → named constants".
**Evidence:** `0.5` (the plan's "~0.5 mile" threshold) and `3_958.8` (Earth radius in miles) appear inline in the haversine. Both are domain constants the plan calls out explicitly; neither is named.

#### M4 — `nearbyShippingPackages` awaits geocode serially inside a loop
**Location:** `nearbyShippingPackages`, `lib/delivery.ts` (333–348)
**Claim:** `ponytail.mdc` — "Minimum code"; `clean-code.mdc` — "If a function has more than 3 levels of nesting, refactor it." The candidate loop awaits `geocodeAddress` once per candidate, sequentially.
**Evidence:** `for (const candidate of candidates) { ...; const coordinates = await geocodeAddress(candidate.address); ... }`. With N nearby shipping packages this is N sequential round-trips (cache writes + address updates). The same function already parallelises the route-side geocodes with `Promise.all` (332); the candidate branch does not. Inconsistent pattern within one function.

#### M5 — `loadDriverLink` expiry check relies on operator precedence with no parentheses
**Location:** `loadDriverLink`, `lib/delivery.ts` (123)
**Claim:** `clean-code.mdc` — "Comments only for non-obvious intent … if code needs a comment to explain WHAT it does, rewrite the code to be clearer"; `ponytail.mdc` — robotic clarity on security-relevant paths.
**Evidence:** `if (!link || link.expiresAt && link.expiresAt <= new Date() || link.route.completedAt)`. The intended grouping is `(!link) || (link.expiresAt && link.expiresAt <= new Date()) || (link.route.completedAt)` — correct only because `&&` binds tighter than `||`. This is the magic-link expiry security path; parenthesising the clauses would make the intent unambiguous.

### Low

#### L1 — `fixtureCoordinates` base lat/long are unnamed magic numbers
**Location:** `fixtureCoordinates`, `lib/delivery.ts` (43–49)
**Claim:** `clean-code.mdc` — magic values. `40.68` and `-73.99` (Brooklyn baseline) plus the `/ 10_000` jitter divisor are inline. Acceptable for a fixture fallback, but a named `FIXTURE_ORIGIN`/`FIXTURE_JITTER` would satisfy the rule.

#### L2 — Driver page initial load can burn a PIN attempt on PIN-protected routes
**Location:** `app/driver/[token]/page.tsx` (18–33) ↔ `loadDriverLink` (130–139)
**Claim:** `clean-code.mdc` — "Error messages say what went wrong AND what the expected state was." Clicking "Open stops" with an empty PIN on a PIN-protected route increments `failedAttempts` and returns "Enter the route PIN." — the message names the expected state but the failure is recorded as an "attempt", so 5 empty-PIN clicks throttle the link. Not a rule violation, but the error path silently mutates security state; the message does not warn the user that attempts are being counted.

#### L3 — `expirePickupPackages` audits expiry but does not transition package status
**Location:** `expirePickupPackages`, `lib/delivery.ts` (433–440)
**Claim:** `workflow.mdc` — "Never silently choose business logic." The cron writes `pickup.expired` audit rows but leaves `package.status` unchanged; expiry is only implicit via the door-list `pickupExpiresAt > now` filter. Whether an expired pickup should surface as a distinct status (for the unclaimed-pickup report the plan calls out) is a silent business-logic choice. Borderline; flagged for awareness.

#### L4 — Phase status file asserts verification without appending command output
**Location:** `.scratch/PHASE-P9-STATUS.md`; `.scratch/PHASE-P9-SMOKE.md`
**Claim:** `workflow.mdc` — "Verify in the running app — never mark done from code alone"; `clean-code.mdc` anti-hallucination — "Do not claim 'fixed/passed/working' without tool output or running-app evidence." The status file says "verified `npm run smoke:p9` and `npm run typecheck`" and the smoke file lists S1–S5 as "passed", but neither file pastes command output (exit codes, assertion logs, timestamps beyond a single date line).
**Evidence:** `PHASE-P9-SMOKE.md` line 3: "Command: `npm run smoke:p9` — passed 2026-07-28." No transcript, no counts, no exit code. The smoke script (`scripts/smoke-p9.ts`) prints only `console.log("S1/S2 passed: …")` lines; those are not captured into the evidence file.

## Rules not violated (noted for completeness)

- **Dependency discipline:** no new packages added in P9; `delivery.ts` uses `node:crypto`, Prisma, and existing `@/lib/*` only.
- **Naming:** no banned vague standalone names (`data`, `result`, `info`, `temp`, `val`, `item`, `thing`) in P9 code.
- **Comments:** no narration / change-explanation comments in P9 code.
- **UI consistency:** driver and admin delivery pages reuse `card`, `button`, `ops-list`, `eyebrow`, `notice`, `lead` classes used elsewhere in the app.
- **Security basics:** driver token is hashed (`sha256`) before DB lookup; admin routes use `authorize()` + `hasSameOrigin()` + Zod; crons use `authorizeCron` bearer check; no secrets logged.
- **Error handling:** no swallowed errors; every `catch` in P9 routes returns a JSON error.
- **Codegraph:** cannot be graded from code output alone (governs agent behaviour during build, not artifact shape).
