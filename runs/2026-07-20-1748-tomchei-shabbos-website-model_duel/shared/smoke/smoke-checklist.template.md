# Smoke checklist — run `__RUN_ID__`

Ports differ per arm (`ARM.md`). Replace host/port per arm.

| # | Check | How | Pass? |
|---|---|---|---|
| S1 | App responds | `GET http://127.0.0.1:__WEB_PORT__/` → 200 | |
| S2 | Health / version | … | |
| S3 | Critical flow | … | |

Add rows from the merged plan. STATUS prose without this table is not evidence.
