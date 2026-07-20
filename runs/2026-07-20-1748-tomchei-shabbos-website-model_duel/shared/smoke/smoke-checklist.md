# Smoke checklist — run `2026-07-20-1748-tomchei-shabbos-website-model_duel`

Ports: arm-01 web **3101** db **4101** | arm-02 web **3102** db **4102**

## P2

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | Migrate + seed | ✓ | ✓ (build) |
| S2 | Grouping engine tests | ✓ | ✓ (build) |
| S3 | State machine tests | ✓ | ✓ (build) |
| S4 | Concurrent order numbers | ✓ | ✓ (build) |
| S5 | Inventory race | ✓ | ✓ |

See `shared/phases/PHASE-P2-EXPECTED.md`. Both arms P2 **gated**.

## P3 (next)

| # | Check | arm-01 | arm-02 |
|---|---|---|---|
| S1 | `GET /` → 200 | ✓ | ✓ |
| S2 | `GET /api/health` → DB ok | ✓ | ✓ |
| S3 | Unauthorized staff → 403 | ✓ | ✓ |
| S4 | Setup bootstrap + lock | ✓ | ✓ |
| S5 | Audit log entries | ✓ | ✓ |

See `shared/phases/PHASE-P1-EXPECTED.md` for full must-be-true list.
