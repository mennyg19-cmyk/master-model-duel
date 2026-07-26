# Plan review — arm-04 (Test 2, late join)

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Plan:** `arms/arm-04/results/BUILD-PLAN.md` (16 phases P0–P15)
**Inventory:** `shared/USER-RESOLVED-INVENTORY.md` + `shared/RECONCILED-INVENTORY.md`
**Reviewer model family:** disjoint from contestants.

## Rubric

| Dimension | Max | Score | Notes |
|---|---:|---:|---|
| Inventory coverage | 6 | 6 | All 16 UR, 30 G, 192 R assigned; appendix lists every R-ID per phase (no ranges). Five overrides applied; five out-of-scope items named in non-goals. |
| Phase sanity (order, smokeable) | 4 | 4 | 16 phases, each with deliverables + multi-step smoke gate on port 3104 with seeded data. Order respects dependencies (foundation → identity → catalog → storefront → customers → cart → fulfillment → checkout → packages → routes → production → email → migration → repeat → reports → scale). |
| No invention past inventory | 3 | 3 | Stack table classifies each row Forced / Inventory-implied / Chosen / Open. SMS vendor, filing-group key, PDF renderer, G-021 collision, and the phantom R-165 script are all raised as open questions, not invented. Print path uses browser print CSS with no new dependency. |
| Clarity / risks called out | 2 | 2 | 17 numbered goals + explicit non-goals; 12-row risk table with mitigations and residual questions; coverage claim table cross-references the five overrides. |
| **Total** | 15 | **15** | |

## Coverage check

- UR-001–016: all mapped (P1 roles, P2 seasons, P4 customers+address book, P5 cart, P6 fulfillment+margin, P7 checkout+payments, P8 packages+print+cards, P9 routes+drivers+reroute+method switch, P10 production+pickup, P11 email hub, P12 migration, P13 repeat, P14 reports, P15 scale).
- G-001–030: all mapped. G-021 collision (cards vs bulk-notification) handled by covering both — cards in P8, bulk notification in P9 with G-017 — and flagged as Risk 4 for inventory correction.
- R-001–192: appendix table assigns each R-ID to exactly one phase with a per-phase count; totals sum to 192. No range coverage, no implicit IDs — every row is enumerated.
- Overrides applied: margin capture (UR-003 replaces R-032 pass-through), package entity (UR-001 replaces R-153 fulfillment-group-only), magic-link drivers (UR-015 replaces R-077/R-078 logged-in messenger), Shippo void-on-reroute (UR-004 replaces R-055/R-175 void-on-save-failure), hosted Stripe only (R-166 per resolution 8b), customers ≠ staff (R-109 per resolution 8a).

## Phase sanity notes

- P0 is foundation-only (env validation, Prisma baseline, helpers, UI kit, public JSON guard, cron scaffolding, CI guardrails) — lighter than arm-03's P1 and cleanly smokeable on its own (health, migration harness, UI gallery, 403/rate-limit).
- P1 bundles identity + roles + permissions + admin shell + audit — comparable to arm-03 P1 but with six smoke checks including impersonation banner and permission unit tests.
- P8 (packages) after P7 (checkout) is correct: orders finalize at checkout, then packages are derived from placed orders. P8's print ≠ shipped invariant is explicitly smoke-checked.
- P9 (routes/drivers/reroute/method switch) correctly depends on P8 packages and P6 shipping. Method-switch charge preservation has a byte-identical charge smoke check.
- P12 migration ahead of P13 repeat — sound ordering given UR-014's address-book cleanup clause gates year-one repeat quality.
- P15 closes with load (5,000 packages), concurrency (split/merge, stock reserve, route assignment), pagination, permission matrix re-test, and a runbook — proper pre-launch gate.

## Invention check

- SMS vendor: declared Open in stack table, flagged Risk 3 with adapter-fails-loudly-if-unconfigured fallback. Not invented.
- Filing-group key: made manager-configurable setting rather than guessed; flagged Risk 2. Not invented.
- PDF renderer: print CSS chosen with no new dependency; Risk 5 explicitly flags the downloadable-PDF interpretation as an open question. Not invented.
- G-021 ID collision: both meanings covered, flagged Risk 4 for inventory correction. Not silently resolved.
- R-165 phantom `scripts/migrate-from-old.ts`: Risk 12 calls it out and writes fresh importers. Not invented.
- No features outside the frozen inventory.

## Clarity / risks

- Goals (17) and non-goals (9 explicit bullets) align with the inventory's in/out-of-scope lists.
- Risk table: 12 risks with mitigations and residual questions (margin accounting owner, filing-group key, SMS vendor, G-021 collision, PDF approach, magic-link threat model, nearby radius, migration quality, Shippo negotiated-rate wiring, season auto-flip, scale baseline, R-165 phantom script).
- Coverage claim table at the end names the five overrides and the four replaced codebase behaviors — auditable from the plan alone.

## bonus_plan (late-join, reported separately — not compared to other arms)

Beyond the MERGED-BUILD-PLAN baseline, arm-04's plan adds execution aids:

- **Per-ID R coverage in the appendix** — every one of R-001…R-192 is listed under its phase with a count column summing to 192. No range coverage, no implicit-by-text IDs. This is stricter than the rubric requires and makes a missing-row audit a one-minute job.
- **16-phase cut vs the 12-phase baseline** — finer-grained gates (P0 foundation, P1 identity, P2 seasons/catalog, P3 storefront/email, P4 customers, P5 cart, P6 fulfillment, P7 checkout, P8 packages/print, P9 routes/drivers, P10 production/pickup, P11 email hub, P12 migration, P13 repeat, P14 reports, P15 scale). Each phase is independently smokeable on port 3104 with seeded data.
- **Forced / Inventory-implied / Chosen / Open classification** in the stack table — every technology choice is tagged with its evidentiary basis, making the invention-vs-inventory distinction auditable per row. "Open" explicitly marks SMS as unresolved.
- **Per-phase "IDs covered" header** at the top of each phase body — explicit ownership before deliverables, no need to scroll to the appendix to know what a phase owns.
- **Override cross-reference in the coverage claim** — the five replaced codebase behaviors (R-032, R-153, R-077/R-078, R-055/R-175) and the two resolution-closed conflicts (R-109, R-166) are named with their replacement UR IDs.
- **Risk 12 (phantom R-165 script)** — calls out that the reconciled inventory cites a `scripts/migrate-from-old.ts` that never existed in the source tree, and treats it as documentation only. This is meta-inventory awareness beyond a normal plan review.
- **Workspace port pin** (web 3104 / db 4104) stated up front in the header — prevents port collisions during parallel arm builds.
- **Smoke check density** — P0: 4, P1: 6, P5: 6, P8: 6, P9: 6, P15: 5. Several smoke checks include negative paths (tampered token rejected, out-of-area ZIP blocked with no override control, 403 not 404-leak, offline-payment without permission returns 403, ingredient UI 404/403s when setting is Off).

These extras help execution without altering scope.
