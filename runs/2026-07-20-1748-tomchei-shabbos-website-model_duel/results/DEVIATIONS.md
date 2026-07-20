# Deviations — `2026-07-20-1748-tomchei-shabbos-website-model_duel`

| When | What | Why |
|---|---|---|
| Test 1a spawn (aborted) | First arm-01 batch aborted before output; retried with sol-high, also aborted | User aborted parallel spawns |
| Test 1a respawn | arm-01 respawned as `gpt-5.6-sol-medium` per user request | Correct kickoff slug restored |
| Test 1a source | Re-provisioned source from `Tomchei-Shabbos-Website` (README-only) → `tomche-shabbos-website` (full app) | arm-02 specialists returned 0 features — wrong repo |
| Test 4 P2 | arm-01 aggregate + arm-02 security review hit `resource_exhausted`; resumed once each (glm-5.2-high) | Cursor quota; protocol rule 29 |
| Test 4 P2 | arm-02 rules review hit `resource_exhausted`; resumed once (glm-5.2-high) | Cursor quota; protocol rule 29 |
| Test 4 P2 | arm-02 quality + clean-code reviews also exhausted; resumed once each | Cursor quota wave |
| Test 4 P2 | Second `resource_exhausted` on arm-01 aggregate, arm-02 all four P2 reviewers → orchestrator wrote arm-01 aggregate; arm-02 review panel **DNF** until quota resets | Protocol rule 29 |
