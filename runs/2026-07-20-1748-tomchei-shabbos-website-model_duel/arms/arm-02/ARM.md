# Arm arm-02

- host: cursor
- run_mode: model_duel
- pack_id: default
- model: (see .scratch/mapping.md)
- web_port: 3102
- db_port: 4102
- rules: ponytail, clean-code, workflow, vocabulary, codegraph, grill-protocol
- inventory_mode: focused
- self_review_mode: single
- include_grill_inventory: True
- workspace: `workspace/`
- results: `results/`
- Frozen prompts: `../../kit/prompts/`
- Host guide: `../../../adapters/cursor/HOST.md`
- Do not run git. Do not touch `../../results` (run-level) except via orchestrator.
