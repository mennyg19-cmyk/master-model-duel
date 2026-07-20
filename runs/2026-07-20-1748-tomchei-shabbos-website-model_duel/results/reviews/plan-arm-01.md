# Reviewer — Plan review (Test 2)

**Arm:** arm-01
**Plan:** `arms/arm-01/results/BUILD-PLAN.md`
**Inventory:** `shared/USER-RESOLVED-INVENTORY.md`, `shared/RECONCILED-INVENTORY.md`
**Reviewer:** orchestrator (non-contestant family)
**Rubric:** `kit/rubrics/plan.md` (max 15)

---

## Verdict

Strong, well-ordered plan. Every frozen inventory ID is accounted for as a primary allocation, no features are invented past the inventory, and each phase is independently mergeable with concrete smoke checks. Two minor phase-ordering notes below; neither blocks the build.

## Rubric

| Dimension | Max | Score | Notes |
|---|---:|---:|---|
| Inventory coverage | 6 | 6 | All 192 R-IDs, 16 UR-IDs, 30 G-IDs primary-scoped; none missing, none duplicated |
| Phase sanity (order, smokeable) | 4 | 3 | 10 phases ordered foundation → storefront → cart → checkout → admin → inventory → fulfillment → delivery → messaging → reporting/migration; each has merge boundary + smoke checks. One cross-phase dependency note (P3 repeat vs P10 migration) is acknowledged but not structurally resolved |
| No invention past inventory | 3 | 3 | Stack, entities, and behaviors all trace to inventory IDs; open questions are framed as config decisions, not invented features |
| Clarity / risks called out | 2 | 2 | 8 risks + 6 open questions, per-phase merge boundaries, explicit non-goals |
| **Total** | 15 | **14** | |

## Inventory coverage check

Primary allocations sum to exactly 192 R-IDs, 16 UR-IDs, 30 G-IDs with no gaps or overlaps.

- **R-IDs by phase (primary):** P1 `R-107`–`R-143`, `R-161`–`R-164`, `R-187` (42); P2 `R-001`–`R-018`, `R-065`–`R-067`, `R-094`, `R-096`–`R-097`, `R-146`–`R-148`, `R-180`, `R-188`–`R-192` (33); P3 `R-019`–`R-031`, `R-038`–`R-043`, `R-048`, `R-144`–`R-145` (22); P4 `R-032`–`R-037`, `R-044`–`R-047`, `R-149`–`R-160`, `R-166`–`R-170` (27); P5 `R-049`–`R-064`, `R-098`–`R-106` (25); P6 `R-068`–`R-071` (4); P7 `R-072`–`R-076`, `R-081`, `R-095`, `R-173`–`R-177`, `R-179`, `R-183`–`R-184` (15); P8 `R-077`–`R-080`, `R-182` (5); P9 `R-082`–`R-090`, `R-171`–`R-172`, `R-178`, `R-181`, `R-185` (14); P10 `R-091`–`R-093`, `R-165`, `R-186` (5). Total = 192.
- **Missing R-IDs:** none.
- **UR-IDs:** all 16 primary-scoped (`UR-001`–`UR-005`, `UR-006`–`UR-007`, `UR-008`, `UR-009`, `UR-010`–`UR-011`, `UR-012`–`UR-013`, `UR-014`–`UR-016`).
- **G-IDs:** all 30 primary-scoped (`G-001`–`G-030`).
- Cross-phase IDs cited in phase bodies (e.g. P7 references `R-153`–`R-157`, `R-162`; P9 references `R-009`, `R-013`, `R-018`, `R-087`–`R-088`, `G-017`, `G-021`, `G-027`; P5 cross-checks `UR-012`, `G-016`, `G-024`, `G-028`) are labeled as integration/delivery acceptance checks, not primary allocations — consistent with the plan's claim of exhaustive, non-duplicative primary allocation.

## Invented features check

None detected. Spot checks against the inventory:

- Stack choices all trace: Next.js/TS/shadcn → `R-188`–`R-190`; Postgres/Prisma → `R-137`–`R-143`; Clerk → `R-107`–`R-114`; Stripe hosted → `UR-011` / `R-166` / user resolution 8b; Shippo + FedEx/UPS/USPS → `UR-003` / `G-006` / user resolution 6; Mapbox + Google Maps deep links → `G-030` / user resolution 5; Vercel Blob → `R-180`; Resend + outbox → `R-171`, `R-178`, `R-181`; Vercel Cron → `R-185`.
- Behavioral claims trace: package entity + stages → `UR-001` / `G-001`–`G-004`; method switch with charge preservation → `UR-002` / `G-005`; rate margin → `UR-003` / `G-006`; nightly print batch → `UR-005`; cart-first + three-way recipient picker → `UR-006` / `G-018`; repeat order + replacement review → `UR-007` / `G-011`–`G-013`; delivery rules → `UR-009` / `G-014`–`G-015`; pickup → `UR-010` / `G-026`; driver magic-link + PIN → `UR-015` / `G-025`; finished-package inventory + gated BOM → `UR-016` / `G-008`–`G-010`; roles → `UR-012` / `G-016`; seasons/archive → `UR-008` / `G-022`; greeting cards → `UR-013` / `G-021`; map reroute + label void → `UR-004` / `G-023`; POS cash/check → `UR-011` / `G-028`; scale baseline → `G-024`; historical migration → `G-029`.
- The SMS-provider gap is correctly surfaced as an open question (inventory does not select a vendor), not an invented commitment.
- Non-goals match the user-resolved out-of-scope list: embedded Stripe Elements, ingredient UI, customer-chosen appointment slots, out-of-area per-package override, automatic reroute.

## Phase issues

1. **P3 repeat-order vs P10 migration dependency.** P3 builds the repeat-order feature; P10 migrates the historical data that makes year-one repeats meaningful. The plan acknowledges this ("Complete this before enabling year-one repeat ordering against migrated history") but the P3 merge boundary still declares the repeat workflow "complete." Recommend the P3 smoke check scope explicitly use seeded synthetic prior-season data, with a noted gate that production repeat against migrated history waits on P10. Not a blocker — the sequencing is correct — but the merge-boundary wording slightly overstates what P3 alone delivers.
2. **Fulfillment-group schema placement.** `R-153`–`R-157` (fulfillment groups, fulfillment methods, shipping quotes, pickup locations, package types) are primary-allocated to P4 (checkout/lifecycle/payments) but are structurally consumed by P7 (fulfillment/shipping). P7 references them as "schema integration" cross-checks. This is defensible — checkout needs the quote/method schema to price — but it means P4 must land a chunk of fulfillment schema it does not exercise until P7. Minor; no action required, just flag for the builder to keep P4 migrations minimal and P7-owned behavior thin until P7.

No other phase issues. Order is sound (schema/identity → catalog → cart → checkout → admin → inventory → fulfillment → delivery → messaging → reporting/migration), each phase is smokeable on its own seed, and merge boundaries are real increments rather than partial slices.

## Total score

**14 / 15**

**Verdict:** Approve. Coverage is complete, nothing invented, phases are smokeable and well-ordered. The two notes above are advisory; the plan may proceed to Test 3 build.
