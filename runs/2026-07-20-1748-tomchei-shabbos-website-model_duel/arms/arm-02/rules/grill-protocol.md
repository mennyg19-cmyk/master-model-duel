# Grill Protocol

Adapted from [Julius Brussee / grill-me](https://github.com/JuliusBrussee/skills/tree/main/skills/grill-me) (MIT). Calibrated pressure â€” not hostile debate. Plain English (`workflow.mdc` tone), not caveman.

**Governing rule:** automate implementation and verification, not product decisions. Grill fills gaps before code.

**Models:** Everyday (Terra) for mini-grill and single-model grilling. Premier pair (Sol + Fable) only when multi-model / rebuild architecture / user says **"use more models."** Wrong parent â†’ spawn per `subagents.mdc`.

## When this fires

- User says **grill me** / stress-test / challenge my plan
- **Spec gate** fails in `workflow.mdc` (underspecified non-trivial build)
- Redesign Phase 0 (mandatory)
- Rebuild if user opts in
- Autonomous mode before the user leaves (ambiguous / multi-phase scope)

## Mini-grill (default for Spec gate)

Cap **3â€“5 questions** (or fewer if cleared sooner). Skip calibration if Working+Standard is obvious. Cover only until these four exist:

1. Goal / user-visible outcome
2. Constraints (or "none")
3. Chosen approach (one option)
4. Validation â€” observable proof of done

Then stop, write `.scratch/grill-notes.md`, implement. Do **not** run the full 7-rung ladder for routine feature asks.

Vague blacklist to challenge: *simple, scalable, clean, fast, polish, better, improve, robust, flexible.*

## Core rules

- **One question at a time.**
- Every question includes a **recommended answer** the user can accept, edit, or replace.
- If the answer is in repo/docs/issues/logs, **read first** â€” don't ask what tools can answer.
- Track privately: goal, user/customer, constraints, options, dependencies, risks, validation, rollback.
- User can adjust anytime: "softer", "harder", "teach more", "skip basics", "stop".
- Do not invent product direction â€” surface open questions for the human.

## Phase 1 â€” Frame the target

If unclear, ask what plan/design/decision to grill.

If context already has a plan, summarize in 3â€“6 bullets and ask for correction:

> I think the target is: [...]
>
> Recommended answer: "Yes, grill that" or "Adjust: ..."

## Phase 2 â€” Calibration

Unless level is obvious from context (mini-grill often skips), ask once:

> What is your comfort with this topic, and how hard should the pressure be?
>
> Recommended answer: "I know the basics of [topic]; standard pressure. Explain missing concepts briefly, then keep pushing."

| Dial | Levels |
|---|---|
| **Knowledge** | **New** (needs framing) Â· **Working** (default) Â· **Expert** (skip basics) |
| **Pressure** | **Light** (clarify) Â· **Standard** (default) Â· **Hard** (failure modes, reversibility) |

## Phase 3 â€” Question ladder (full grill)

Use for rebuild/redesign/architecture/"grill me" with Hard pressure. Mini-grill stops after goal/constraints/approach/validation.

Pick the next highest-value gap from the private map. Ladder (stop when clear enough):

1. **Goal fit** â€” outcome, for whom, what makes this not worth doing
2. **Constraints** â€” immovable limits, bottleneck, killer assumption
3. **Options** â€” top two alternatives, why this over the boring one, what you're optimizing for
4. **Execution** â€” smallest useful version, first step, what can defer
5. **Failure modes** â€” production failure, embarrassing edge case, hardest-to-observe break
6. **Validation** â€” observable proof it works; what "done" means
7. **Reversibility** â€” hardest undo, rollback/migration, what to log as explicit tradeoff

### Pressure adaptation

- **New + any pressure:** 2â€“4 sentence concept teach before next question; model good reasoning in recommended answers.
- **Working + Standard:** challenge vague words; push for smallest shippable version.
- **Expert + Hard:** counterfactuals, hidden costs, maintenance, evidence that would change their mind.
- **Light:** stop after top ambiguities resolved.

### Question format

```text
Question: ...
Recommended answer: ...
Why it matters: ... (one sentence)
```

## When to stop

- User says stop.
- Plan has: clear goal, constraints, chosen approach, validation, next concrete step.
- Mini-grill four bullets written.
- Remaining gaps need external research or code exploration only.
- Knowledge gap blocks useful grilling â†’ brief teach + propose one learning step.

## End deliverable

- Current best plan or decision (bullets).
- Open questions (product â€” human must answer).
- Next concrete action.
- Risks to watch.

**Record:** append to the protocol artifact (`rebuild-audit/GRILL-NOTES.md`, `REDESIGN-BRIEF.md` Â§ Grill Gate, `.scratch/grill-notes.md`, or DECISION-LOG) so later phases don't re-litigate settled points.

