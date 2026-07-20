# Test 6 — Seed procedure

1. Declare headline winner (default: with-external-reviewer).  
2. Clone that arm’s finished tree to **every** arm workspace (identical).  
3. Orchestrator (not contestants) injects bugs; record in **gitignored** `.scratch/BUG-LEDGER.md` (never publish).  
4. Publish only vague symptoms later for the fix phase (`VAGUE-SYMPTOMS.md` in shared — no locations).  
5. Run detect prompts → grade vs ledger → vague-fix prompts → grade.

## Bug design tips

- Mix: logic error, missing validation, UI broken path, security footgun.  
- Prefer bugs visible via smoke/checklist failure.  
- Same seeds for all arms.
