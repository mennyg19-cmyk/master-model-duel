# Plan review — arm-03 (Test 2)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Plan:** `arms/arm-03/results/BUILD-PLAN.md` (12 phases)
**Inventory:** `shared/USER-RESOLVED-INVENTORY.md` + `shared/RECONCILED-INVENTORY.md`
**Reviewer model family:** disjoint from contestants.

## Rubric

| Dimension | Max | Score | Notes |
|---|---:|---:|---|
| Inventory coverage | 6 | 6 | All 16 UR, 30 G, 192 R accounted for; deferrals match inventory (G-009 UI, embedded Stripe, customer slots, auto-reroute, out-of-area override). |
| Phase sanity (order, smokeable) | 4 | 4 | 12 phases, each with deliverables + smoke gate; order is logical and mergeable; P1 is heavy (schema + auth + admin shell + design system) but gated. |
| No invention past inventory | 3 | 3 | Stack choices are inventory-forced; SMS-Twilio and magic-link grace flagged as open questions, not invented. No out-of-scope features. |
| Clarity / risks called out | 2 | 2 | Goals/non-goals explicit; 10-row risk table with mitigations; coverage claim table present. |
| **Total** | 15 | **15** | |

## Coverage check

- UR-001–016: all mapped (P1 schema, P2 roles, P3 seasons, P5 cart, P6 checkout, P7 packages, P8 margin, P9 routes/drivers, P10 pickup/inventory, P11 repeat/email, P12 reports).
- G-001–030: all mapped; G-009 UI deferred (schema in P1/P10) per inventory.
- R-001–192: union of phase ID lists covers all 192. A handful are covered by range (R-019–031, R-107–120, R-144–164) rather than per-ID; R-061 (POS checkout) and R-123 (HMAC prefs) are covered implicitly by deliverable text rather than explicit ID. No missing rows.
- Overrides applied: margin (UR-003), package entity (UR-001), magic-link drivers (UR-015), Shippo void-on-reroute (UR-004), hosted Stripe only (R-166), customers ≠ staff (R-109).

## Phase sanity notes

- P1 bundles foundation + schema spine + auth + roles + admin shell + design system + test-mode — heavier than MERGED P1+P2, but the smoke gate (health, migrate/seed, setup lockout, permission tests) is coherent.
- P5 cart-first builder is correctly placed before P6 checkout; P7 package entity before P8 shipping before P9 routes — matches dependency order.
- P12 closes with reports + scale hardening + full coverage checklist — sound pre-launch gate.

## Invention check

- SMS provider left as open question (G-021 default) — not invented.
- Magic-link grace duration flagged as open — not invented.
- No features outside the frozen inventory.

## Clarity / risks

- Goals/non-goals section explicit and inventory-aligned.
- Risk table: 10 risks with mitigations (SMS vendor, package vs filing-group mental model, Shippo margin math, magic-link threat model, nearby false positives, migration quality, BOM UI exposure, scale deferral, UPS direct creds, Clerk/customer-staff edge cases).
- Coverage claim table present and consistent with phase bodies.

## bonus_plan (late-join, reported separately — not compared to other arms)

Beyond the MERGED-BUILD-PLAN baseline, arm-03's plan adds execution aids:

- **Per-phase ID ownership legend** at the top of §3, explicitly stating later phases may deepen earlier IDs and pointing to the Coverage claim for the union — reduces ambiguity about duplicate vs primary ownership.
- **Workspace port pin** (web 3103 / db 4103) stated up front in the header — prevents port collisions during parallel arm builds.
- **"No git in arm workspace"** reminder under §2 — reinforces the orchestrator absolute inside the plan itself.
- **P12 explicit coverage sweep** deliverable: "any remaining R-001–192 row not yet smoke-verified gets a checklist tick or explicit defer only if inventory-deferred" — closes the loop on the implicit-range IDs (R-061, R-123, R-021–023) by forcing a final per-ID tick.
- **Override cross-reference** in Coverage claim table (margin, Package entity, magic-link, Shippo void, hosted Stripe, customers ≠ staff) — makes the four inventory overrides auditable from the plan alone.

These extras help execution without altering scope.
