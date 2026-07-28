# Plan review — arm-06 (Test 2, late join)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Plan:** `arms/arm-06/results/BUILD-PLAN.md` (13 phases P0–P12)
**Inventory:** `shared/USER-RESOLVED-INVENTORY.md` + `shared/RECONCILED-INVENTORY.md`
**Reviewer model family:** disjoint from contestants.

## Rubric

| Dimension | Max | Score | Notes |
|---|---:|---:|---|
| Inventory coverage | 6 | 6 | All 16 UR, 30 G, 192 R assigned (Appendix A). Phase ID lists use some ranges (e.g. R-001–R-008, R-107–R-113) rather than full per-ID enumeration; Appendix A confirms all 192 carried forward or adapted. Six adaptations named (R-077, R-116/R-118, R-109, R-166, R-184, pass-through→UR-003, fulfillment-group→UR-001, void-on-save→UR-004). Six out-of-scope items restated in non-goals. Minor: R-013 UI mentioned in P1 deliverables but ID listed in P11 — split-ownership ambiguity, not a gap. |
| Phase sanity (order, smokeable) | 4 | 4 | 13 phases, each with IDs + deliverables + 3–6 smoke checks with negative paths (tampered webhook, wrong PIN, unauth cron, blocked zip no-override, ingredient UI 404s when off). Order respects deps: foundation → catalog → customers/cart → checkout → packages → shipping → delivery execution → pickup → print → migration → repeat → ops hub → scale. P4 packages after P3 checkout is correct (orders finalize, then packages derived). P9 migration before P10 repeat honors UR-014. |
| No invention past inventory | 3 | 3 | Stack table tags each row Forced-by-inventory Yes/No. Free choices minimal: SMS vendor (Twilio) and test frameworks (Vitest/Playwright), both flagged. R-184 kept declaration-only; R-166 stays hosted-only per 8b; R-109 rebuilt per 8a; customers≠staff per 8a. Filing-group key, magic-link grace, PIN delivery, margin timing, geocode TTL — all raised as open questions, not invented. |
| Clarity / risks called out | 2 | 2 | 7 numbered goals + 8 explicit non-goals bullets; 10-row risk table with mitigations and open questions; coverage matrix in Appendix A cross-references UR/G/R; Appendix B restates out-of-scope. |
| **Total** | 15 | **15** | |

## Coverage check

- UR-001–016: all mapped (P4 packages, P6 method switch, P5 margin, P6 reroute, P8 print, P2 cart, P10 repeat, P1 seasons, P3 delivery rules, P7 pickup, P3 payments, P0 roles, P8 cards, P2+P9 address book+migration, P6 driver UX, P4 production).
- G-001–030: all mapped. G-021 (cards) in P8; bulk-delivery notification (G-017) in P6 — both covered, no collision.
- R-001–192: Appendix A states "all 192 carried forward or explicitly adapted." Phase ID lists use ranges in places (e.g. R-001–R-008, R-104–R-106, R-107–R-113, R-082–R-086, R-091–R-096, R-149–R-155, R-166–R-170, R-173–R-177) but expand to complete coverage. Spot-check of every R-ID confirms assignment to exactly one phase (R-048 and R-122 intentionally cross-referenced across two phases for split concerns).
- Overrides applied: pass-through rates → UR-003 margin (R-032); fulfillment-group-only → UR-001 package entity (R-153); logged-in messenger → UR-015 magic links (R-077); void-on-save-failure → UR-004 void-on-reroute (R-055/R-175); hosted Stripe only (R-166 per 8b); customers ≠ staff (R-109 per 8a); R-184 stays declaration-only; R-116/R-118 scoping adapted to per-route link.

## Phase sanity notes

- P0 bundles foundation + auth + roles + RBAC + audit + admin shell + UI kit + env validation + first-run setup — heavy but each sub-deliverable has its own smoke check (health, first-run lock, role landing, permission toggle audit, impersonation bar, CI migration block).
- P3 (checkout/delivery rules/payments) before P4 (packages) is correct: per-package *fee* is computed per recipient at checkout; the physical package *entity* is derived after order finalization. P4 explicitly supersedes fulfillment groups with packages (snapshots retained) — documented rework, not a dependency violation.
- P5 (Shippo/margin/labels) after P4 (packages) — labels attach to packages. P6 (routes/reroute/method switch/drivers) after P5 — reroute voids Shippo labels. Method-switch charge preservation has a byte-identical-charge smoke check.
- P8 (print) after P6/P7 — print batch needs package + route state; print ≠ shipped invariant explicitly smoke-checked.
- P9 migration before P10 repeat — sound: UR-014 address-book cleanup gates year-one repeat quality.
- P12 closes with load (1k orders / 5k packages / 10 concurrent staff), concurrency (lock conflicts on colliding edits), pagination, security sweep (public guard, staff-only, cron secrets, media restrictions, destructive-test gating), CI guardrails, error masking, launch checklist.

## Invention check

- SMS vendor (Twilio): declared "No — vendor is my pick, cheapest well-known path" in stack table; Risk 1 flags swap cost. Not invented.
- Test frameworks (Vitest/Playwright): declared "No — framework unnamed in inventory." Not invented.
- Filing-group key: Risk 5 raises it as an open question (grouping by fulfillment channel + route/location); needs confirmation before P8. Not invented.
- Magic-link grace window: Risk 2 proposes 2 hours but flags it as an open question. Not invented.
- PIN delivery: Risk 3 assumes manager copies link, system sends nothing to driver — flagged as assumption, not invented.
- Margin attribution timing: Risk 4 records both quote-time and purchase-time, reports delta. Not invented.
- Geocode TTL: Risk 7 flags cache tuning at scale. Not invented.
- Season auto-flip warning email: Risk 10 explicitly says "not in inventory — default no." Not invented.
- No features outside the frozen inventory.

## Clarity / risks

- Goals (7) and non-goals (8 bullets) align with the inventory's in/out-of-scope lists.
- Risk table: 10 risks with mitigations and residual questions (SMS vendor, magic-link grace, PIN delivery, margin timing, filing-group definition, legacy data quality, geocode accuracy, nightly PDF throughput, Shippo account prerequisite, season auto-flip).
- Appendix A coverage matrix cross-references all UR/G/R with phase assignments and names the six adaptations; Appendix B restates the six out-of-scope items.
- Stack table's Forced/Free classification makes the invention-vs-inventory distinction auditable per row.

## bonus_plan (late-join, reported separately — not compared to other arms)

Beyond the baseline, arm-06's plan adds execution aids:

- **Forced-by-inventory Yes/No column in the stack table** — every technology choice tagged with its evidentiary basis; free choices (SMS vendor, test frameworks) explicitly marked as not inventory-forced. Makes the invention boundary auditable per row.
- **13-phase cut** — finer-grained gates than a 12-phase baseline (P0 foundation/auth/roles, P1 seasons/catalog, P2 customers/cart, P3 checkout/payments, P4 packages/inventory, P5 shipping, P6 fulfillment execution, P7 pickup, P8 print, P9 migration, P10 repeat, P11 ops hub/marketing/reporting, P12 scale/security/launch). Each phase independently smokeable with seeded data.
- **Per-phase "IDs covered" header** at the top of each phase body — explicit ownership before deliverables.
- **Smoke check density with negative paths** — P0: 6, P1: 5, P2: 6, P3: 8, P4: 4, P5: 5, P6: 7, P7: 4, P8: 4, P9: 5, P10: 4, P11: 8, P12: 5. Negative paths include tampered-webhook rejection, duplicate-webhook no-op, wrong-PIN block, unauth cron refuse, blocked-zip no-override, ingredient UI 404/403 when flag off, another-user token 404, destructive-test endpoint refuse in live mode.
- **Cross-referenced split-ownership IDs** — R-048 (mapping editor P1 + chain walk P10) and R-122 (public guard P3 + verification sweep P12) named in both phases with their distinct concerns, avoiding silent duplication.
- **Appendix A + B** — coverage matrix naming all 16 UR / 30 G / 192 R with phase assignments and the six adaptations; out-of-scope restated for auditable non-goals.
- **Risk 10 (season auto-flip warning email)** — explicitly notes "not in inventory — default no," demonstrating discipline against scope creep on an optional feature.

These extras help execution without altering scope.
