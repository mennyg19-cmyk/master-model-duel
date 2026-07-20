# Phase map — equal cuts for all arms

Run: `2026-07-20-1748-tomchei-shabbos-website-model_duel`  
Plan: `shared/MERGED-BUILD-PLAN.md`  
Cut: orchestrator after Test 2 merge (12 phases, P1..P12).

| Phase ID | Title | Inventory IDs (primary) | EXPECTED file |
|---|---|---|---|
| P1 | Foundation, identity, roles, permissions, staff tooling | R-010, R-098..R-120, R-130..R-136, R-161, R-164, R-187..R-192; UR-012; G-016, G-024 | shared/phases/PHASE-P1-EXPECTED.md |
| P2 | Domain core: seasons, catalog schema, packages, payments, shipping schema, inventory engine | UR-001, UR-008, UR-016; R-044..R-047, R-144..R-163; G-003, G-009 | shared/phases/PHASE-P2-EXPECTED.md |
| P3 | Storefront: marketing, catalog, archive, newsletter, admin catalog & media | R-001..R-018, R-065..R-067, R-094, R-096, R-097, R-128, R-146..R-148, R-180; UR-008; G-022 | shared/phases/PHASE-P3-EXPECTED.md |
| P4 | Cart-first order builder, address book, customer account | UR-006, UR-014; G-018, G-019; R-019..R-031, R-038..R-043 | shared/phases/PHASE-P4-EXPECTED.md |
| P5 | Checkout: delivery rules, fees, Stripe hosted, order lifecycle, POS payments | UR-009, UR-011, UR-013; G-007, G-014, G-015, G-020, G-028; R-023, R-032..R-037, R-121..R-127, R-132, R-149..R-152, R-159, R-160, R-166..R-170 | shared/phases/PHASE-P5-EXPECTED.md |
| P6 | Admin operations hub & POS | UR-006, UR-011, G-028; R-049, R-050, R-052..R-054, R-057, R-059..R-064, R-092, R-094..R-096, R-105, R-106, R-143 | shared/phases/PHASE-P6-EXPECTED.md |
| P7 | Package engine: grouping UI, statuses, print batches, greeting cards | UR-001, UR-005, UR-013; G-001..G-004, G-021; R-056, R-072, R-073 | shared/phases/PHASE-P7-EXPECTED.md |
| P8 | Shipping: Shippo, rate margin, labels | UR-003, G-006; R-055, R-081, R-173..R-177, R-183, R-184 | shared/phases/PHASE-P8-EXPECTED.md |
| P9 | Routes, driver magic links, reroute map, pickup, bulk delivery | UR-002, UR-004, UR-010, UR-015; G-005, G-017, G-023, G-025..G-027, G-030; R-074..R-080, R-116, R-179, R-182 | shared/phases/PHASE-P9-EXPECTED.md |
| P10 | Seasons management, repeat orders, replacement mappings | UR-007, UR-008; G-011..G-013; R-041, R-048, R-057, R-058, R-097 | shared/phases/PHASE-P10-EXPECTED.md |
| P11 | Email & notification platform | G-021; R-082..R-090, R-163, R-171, R-172, R-178, R-181, R-185, R-087 | shared/phases/PHASE-P11-EXPECTED.md |
| P12 | Reporting, migration, scale hardening, launch readiness | UR-003, UR-014; G-024, G-029; R-014, R-063, R-091..R-093, R-101..R-103, R-129, R-165, R-186 | shared/phases/PHASE-P12-EXPECTED.md |

Same phase IDs and boundaries for **every arm**. Builds (Tests 3–4) implement phases in order P1 → P12.
