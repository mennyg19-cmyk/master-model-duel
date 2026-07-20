# Philosophy — why Master Model Duel exists

Audience: programmers who ship with coding agents and are tired of vibes, leaderboard screenshots, and “this model feels smarter.”

## The problem

Cursor (and friends) keep adding flagship models. Each one claims to be better at coding. Marketing demos pick flattering tasks. Twitter picks one-shot toys. None of that answers the questions that actually change how you work:

- Can this model **read a real app** and list what it does?
- Can it **plan a greenfield rebuild** from that list without inventing product direction?
- Can it **ship phases** under rules you care about?
- Does a **single review pass** make it better — and is that worth the extra $?
- If you **commit to one model** for build + self-critique + fix, which one leaves fewer landmines?
- When the code is identical, who **finds bugs** and who **fixes from vague symptoms**?
- What does the job **actually cost** in tokens and dollars?

Master Model Duel exists to force those questions into a repeatable run you can publish, argue with, and re-run when the next “high” model shows up.

## What we learned the hard way (v1)

The first duel (Fable high vs Sol high on MenEZmanim) proved the format works and also showed where soft methodology lies:

1. **Split reviewers bias the trail.** Terra grading one arm and Sonnet grading the other is not a fair mid-build history. One reviewer family for everyone is a hard rule now.
2. **Contestant-as-judge is noisy.** Having Fable and Sol score each other’s builds mixes brand loyalty with craft. External panels grade execution.
3. **Reference harvest is not greenfield.** If the prompt allows reading old apps, you measured “rebuild with a cheat sheet,” not “build from an inventory.” Absolute greenfield is locked for the harness.
4. **Build scores compress.** Two finished trees can look almost tied under a single full-audit table. Detection on identical seeded code still separated them. Cost separated them again (cheaper per token ≠ cheaper job when volume explodes).
5. **Reviewer identity moves numbers.** GLM nearly tied the finals; Grok and Kimi then disagreed. Publish disagreement. Prefer specialist panels + evidence over one mushy total.
6. **End-of-day CSV archaeology is painful.** Cost and tokens belong in a ledger from the first spawn.

Those lessons are why the harness looks “heavy.” The ceremony is there so the next run doesn’t accidentally reintroduce the same loopholes.

## What this strategy tests (six skills)

Think of an agent’s job as a pipeline. We score each stage separately so a model can win one stage and lose another — which is useful information.

| Test | Skill under the microscope |
|---|---|
| **1 — Inventory** | Understanding. Read a real codebase; produce a feature inventory. Graded for recall and precision (spam lists lose). |
| **2 — Plan** | Translation. Turn a frozen inventory into an exhaustive phased build plan. No old apps. |
| **3 — Build (no feedback)** | Execution. Same merged plan for every arm; phase gates; smoke evidence. Can it ship without a coach? |
| **4 — Build (one review pass)** | Coachability. Same plan as Test 3; after each phase, one aggregated review → one fix → continue. Does feedback help *this* model? |
| **5 — Solo self-review → fix → residual** | Closed loop. Build (or take a finished tree), review yourself with fresh context, fix once, then face an external residual grade. Answers: “If I only hire one model, which?” |
| **6 — Detect + vague fix** | Debug under uncertainty. Identical bugged tree; find seeded bugs; then fix from symptoms only. |

**Dual headlines (Option D)** exist because Test 4 and Test 5 answer different product decisions:

- **With an external reviewer** → best teammate in a reviewed pipeline.
- **Solo commit** → best default when you’re not paying for a second model to babysit.

If those winners disagree, that disagreement is the result. Don’t squash it into one marketing podium.

## What we deliberately do *not* pretend

- **N=1 product.** One source repo per run. Results are “on this codebase,” not universal law. Re-run on a second app if you want generality.
- **Human taste is optional.** Specialist panels approximate review; they are still models. Screenshots and human spot-checks remain allowed as overrides when you care.
- **Unlimited fix passes aren’t free.** Test 4/5 allow one review→fix cycle with no finding cap. Thrash shows up in the cost ledger. That is intentional.
- **Late joins don’t rewrite history.** Shared freezes (reconciled inventory, merged plan) stay put. Late arms can earn **bonus** for beating a freeze; base rankings for earlier arms stay readable. See `protocol/LATE-JOIN.md`.

## Why rule ablation matters

Agents don’t run naked in Cursor. They run under rule packs: ponytail, clean-code, canaries, testing discipline, and so on. People argue endlessly about whether those rules help or just burn tokens.

Kickoff lets you **choose the pack** and apply the **same pack** to every contestant in a run. Next run, drop `clean-code` or `context-canary` and compare. That is an ablation study on *your* workflow, not a generic LMSYS clone.

## Why the reviewer cannot share a contestant family

If Fable is competing, a Claude-family reviewer creates a credibility problem even when everyone acts in good faith. The harness maps slugs → families and **refuses** overlap. One reviewer family grades everyone. Specialists (security, quality, rules, clean-code) plus an aggregator beat one vague “looks good” pass.

## Why cost sits beside the scorecard (not inside it)

Quality winners and cheap winners are different questions. Folding `$` into the /100 lets a lazy skim model fake “efficiency.” We publish:

- builder-only spend  
- full pipeline spend (includes the review panel)  
- solo TCO for Test 5  

So you can pick “best craft,” “best with a reviewer,” or “best solo for the money” without mixing the units.

## Design stance (short)

1. **Same brief, different brains.** After inventory/plan freezes, builders share one merged plan so execution compares coding, not who wrote the luckier brief.
2. **Fresh context where bias would cheat.** Self-review and residual review don’t get the build chat history.
3. **Evidence or it didn’t happen.** Smoke scripts and path-backed inventory IDs beat STATUS essays.
4. **Orchestrator never builds.** The chat in this repo runs the duel; contestants own the product trees.
5. **Archives are forever.** Each `runs/{run_id}/` is a complete story. Re-open it months later; add a late model; start a new duel. Don’t overwrite.

## How this should feel when you use it

You open Master Model Duel, say **start testing**, pick a real repo and a set of models, pick a reviewer outside their families, pick which rules to enforce, and walk away while an autonomous batch burns through inventory → plan → builds → self-critique → detect/fix. When it finishes, you have numbers, dollars, and trees — enough to decide what to set as your default agent without trusting a demo reel.

That is the whole philosophy: **treat model choice like an engineering decision**, with a protocol you can defend to other programmers.

## Where to go next

| Doc | Role |
|---|---|
| [`README.md`](README.md) | How to run |
| [`protocol/EXPERIMENT-PLAN.md`](protocol/EXPERIMENT-PLAN.md) | Locked methodology |
| [`protocol/LATE-JOIN.md`](protocol/LATE-JOIN.md) | Adding a model mid-run |
| [`catalog/RULE-CATALOG.md`](catalog/RULE-CATALOG.md) | Ablation packs |
| [v1 MenEZmanim write-up](https://github.com/mennyg19-cmyk/model-duel-menezmanim) | First duel results + scars that shaped this |
