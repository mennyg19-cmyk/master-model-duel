# Specialist roles (focused multi-agent mode)

Used when kickoff (or **run test**) sets focused inventory / focused self-review.  
All specialists for a given arm use **that arm’s contestant model** (same family). They do **not** use the reviewer model.

## Inventory jobs (Test 1)

Default set if user says “use defaults”:

| Job ID | Focus |
|---|---|
| `product` | User-facing features, flows, screens, permissions as product behavior |
| `security` | Auth, roles, secrets handling, trust boundaries, sensitive paths |
| `data` | Persistence, schemas, migrations, files/blob storage, caching |
| `ui` | Routes, layouts, navigation, forms, client-only state |
| `integrations` | External APIs, webhooks, email, payments, cron/jobs |

User may add/remove/rename jobs at kickoff. Each job → one fresh agent → one partial inventory file under the arm (e.g. `workspace/.scratch/inventory-{job}.md`).  
Then one **merge** agent (same contestant model, fresh) unions them into the arm’s final inventory (evidence paths required; no invented IDs). Cost ledger: one row per specialist + merge.

## Self-review jobs (Test 5)

Default set if user says “use defaults”:

| Job ID | Focus |
|---|---|
| `security` | Trust boundaries, auth, secrets, IDOR |
| `quality` | Correctness, broken flows, stubs, regressions |
| `rules` | Adherence to **this arm’s** selected catalog rules |
| `clean-code` | Duplication, naming, god files, pattern drift |

Same pattern: N specialists → one self-aggregate → fix agent gets only the aggregate. Residual reviewer panel stays on the kickoff **reviewer** model (unchanged).

## Single-agent mode

`inventory_mode: single` / `self_review_mode: single` → one deep pass per arm (no job split). Cheaper; still valid.
