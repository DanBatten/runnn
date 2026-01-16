---
name: athlete-patterns
description: Interpret discovered patterns unique to this athlete. Use when analyzing performance trends, predicting outcomes, or personalizing recommendations.
allowed-tools: mcp__runnn-coach__coach_read_athlete_context, mcp__runnn-coach__coach_read_workout_history
---

# Athlete Pattern Interpretation

This skill helps interpret personalized patterns discovered from the athlete's training history.

## Pattern Types

Patterns have three lifecycle states:

| Status | Description | Usage |
|--------|-------------|-------|
| **Candidate** | Observed but not yet reliable (needs more data) | Mention but don't rely on |
| **Active** | Validated correlation, statistically significant | Use in recommendations |
| **Retired** | No longer holds true | Ignore |

## Common Pattern Categories

### Performance Patterns

- **HRV-performance correlation**: "Quality sessions 20% better when HRV >50"
- **Time-of-day preference**: "Faster paces in afternoon vs morning"
- **Weather impact**: "Pace degrades 3% per 10F above 70F"

### Recovery Patterns

- **Sleep-recovery relationship**: "Needs 7+ hours for full recovery"
- **Days between quality**: "Optimal spacing is 72 hours, not 48"
- **Body battery threshold**: "Below 40 = poor workout execution"

### Injury Patterns

- **Location tendencies**: "Left calf tightness after intervals"
- **Warning signs**: "RHR spike precedes injury by 2-3 days"
- **Recovery duration**: "Hamstring issues need 10 days, not 7"

## Using Patterns in Recommendations

Query active patterns with `coach_read_athlete_context`. The `active_patterns` array contains:

```json
{
  "id": "pat_abc123",
  "name": "hrv_performance_correlation",
  "status": "active",
  "confidence": 0.85,
  "description": "Quality sessions 20% better when HRV >50"
}
```

### Application Guidelines

1. **Active patterns (confidence >0.7)**: Incorporate into recommendations
2. **Candidate patterns (confidence 0.4-0.7)**: Mention as observation, don't alter plan
3. **Low confidence (<0.4)**: Ignore unless directly relevant

## Promotion Rules (Guardrails)

For a pattern to move from Candidate to Active:

1. **Minimum sample size**: At least 10 observations
2. **Backtest validation**: Pattern holds on holdout data
3. **No policy conflict**: Policies always override patterns for safety

Example: "HRV correlates with performance" needs 10+ quality sessions with HRV data before activation.

## Retirement Criteria

Patterns are retired when:

- **Sample invalidation**: Recent data contradicts the pattern
- **Context change**: Training, fitness, or life circumstances changed
- **Time decay**: Pattern hasn't been validated in 60+ days

## Integration with Policies

**Important**: Policies always override patterns.

- Policy says "skip quality if HRV <45" = skip, even if pattern suggests otherwise
- Pattern says "athlete performs well on low HRV" = interesting, but safety wins

## Querying Pattern History

```
# Get current active patterns
coach_read_athlete_context

# Analyze workout history for potential patterns
coach_read_workout_history --days 90 --type tempo
```

When analyzing workouts, look for:
- Consistent pace variations by condition
- Execution scores correlated with readiness metrics
- Recovery time between similar workout types
