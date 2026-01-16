---
name: run-coaching-policies
description: Expert knowledge of running training policies including weekly ramp limits, injury protocols, quality session placement, and readiness interpretation. Use when making coaching decisions, assessing readiness, or creating training plans.
allowed-tools: mcp__runnn-coach__coach_read_*
---

# Run Coaching Policies

This skill provides domain knowledge for making safe, effective coaching decisions.

## Weekly Ramp Rate

The most important safety rule in training load management.

| Situation | Maximum Increase |
|-----------|-----------------|
| Normal training | 10% weekly mileage |
| Returning from injury/illness | 5% max for 2 weeks |
| Post-race recovery | 50% volume for 1 week |
| After 2+ weeks off | Start at 50% previous, 5% ramp |

**Implementation**: Use `coach_read_athlete_context` to check `weekly_ramp_pct`. Flag if exceeding limits.

## Readiness Assessment (HRV-based)

Interpret readiness status from health metrics:

| Status | HRV vs Baseline | Recommendation |
|--------|-----------------|----------------|
| Compromised | <80% | Easy/rest only. Consider life stress factors. |
| Below baseline | 80-95% | Easy day preferred. Quality OK if feeling good. |
| Normal | 95-110% | Follow the plan as prescribed. |
| Elevated | >110% | Good recovery. Quality session appropriate. |

**Additional factors to consider**:
- Sleep <6 hours: Skip or convert quality
- Body battery <25: Extra recovery needed
- RHR elevated >10%: Possible illness or overtraining

## Quality Session Rules

Hard workouts require careful spacing:

- **Maximum**: 3 quality sessions per week (intervals, tempo, long)
- **Spacing**: Minimum 48 hours between quality sessions
- **Prerequisites**:
  - HRV >45 (or >90% of baseline)
  - Sleep >6 hours previous night
  - No active injury limiting running

**Quality session types**: tempo, interval, threshold, race, long (if >90 min)

## Injury Escalation Protocol

Respond appropriately to injury signals:

| Grade | Symptoms | Action |
|-------|----------|--------|
| 1 | Mild discomfort, goes away during warmup | Monitor, reduce volume 20% |
| 2 | Pain during run, doesn't worsen | Skip quality, reduce volume 40% |
| 3 | Pain at rest or worsening | Stop running, seek professional care |

**Escalation**: If Grade 1 doesn't improve in 5 days, escalate to Grade 2 protocol.

## Override Conditions

Situations that override normal recommendations:

- **Sensor issues**: Ignore HRV for 3 days (user override)
- **Travel**: Add 1 easy day per 3 timezone hours changed
- **Life stress**: Convert quality to easy when stress is high
- **Illness**: No running until fever-free for 24 hours

## Safety Guardrails

When using tools to make recommendations:

1. **Always cite policy IDs** that influenced the decision
2. **Prefer conservative** recommendations when uncertain
3. **Surface escalation guidance** if injury signals present
4. **All recommendations persist decision records** for reproducibility

## Using the Tools

```
# Check readiness and get recommendation
coach_read_readiness

# Get full context including injuries, travel, patterns
coach_read_athlete_context

# Get today's workout with policy modifications
coach_read_today_workout

# List which policies are currently triggered
coach_read_policies_triggered
```

## Asking "Why?"

When the user asks why a recommendation was made:

1. Use `coach_read_decision_latest` to get the most recent decision
2. Use `coach_read_decision_explain` with the decision_id for full reasoning
3. Reference the specific policies that triggered the recommendation
4. Never invent explanations - always use recorded decisions
