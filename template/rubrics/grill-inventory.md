# Rubric — Test 1b Grill inventory quality

**Arm:** ____  
**Evidence base:** transcript only (turn cites).

## Coverage / usefulness (0–4)

Does the grill inventory capture what the human actually decided (and mark OPEN where unresolved)?

## Anti-hallucination (0–3)

Features without turn cites, or claims contradicting the transcript → penalize.

## Combined with turns

```
inventory_score = coverage + anti_hallucination   # /7
grill_quality   = inventory_score × (turn_quality_mean / 2)   # normalize mean to 0–1 then scale as needed
grill_efficiency = inventory_score / max(1, necessary_turns)
```

Map `grill_quality` into **8 points** for the scorecard (orchestrator normalizes across arms so best ≈ 8).

**Tie-break:** higher `grill_efficiency` wins when inventory_score within 0.5.
