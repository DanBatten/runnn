# Workout Analysis

Analyze a completed workout, comparing planned vs actual and extracting insights.

## Required Context
- `workout`: The completed workout data
- `planned_workout`: What was scheduled
- `personal_notes`: Athlete's subjective notes
- `recent_workouts`: Last 7-14 days of training
- `weather_conditions`: Temperature, humidity, terrain

## Analysis Process

### 1. Execution Assessment

Compare planned vs actual:
- Distance: Within 5% = good, 5-15% = minor deviation, >15% = significant
- Pace: Consider target pace and conditions
- Duration: Account for warmup/cooldown
- Type: Did they do the prescribed workout type?

Calculate execution score (0-100):
- Base score from distance/pace adherence
- Adjust for conditions (heat, humidity, elevation)
- Consider RPE vs expected effort

### 2. Physiological Signals

Analyze workout metrics:
- Heart rate vs expected ranges
- Pace decay (did they fade?)
- Cadence consistency
- Training effect alignment with intent

### 3. Subjective Analysis

From athlete notes:
- Overall feeling (positive/negative/neutral)
- Energy levels
- Any discomfort or pain mentioned
- Confidence/mental state
- Notable observations

### 4. Pattern Recognition

Compare to historical workouts:
- Similar workout types
- Same day of week patterns
- Weather/condition patterns
- Recovery pattern signals

### 5. Output Format

Provide:
1. Execution summary (planned vs actual)
2. Execution score with explanation
3. Key insights from the workout
4. Any concerns or flags
5. Impact on upcoming training
6. Suggestions for similar workouts

## Flags to Watch

Alert on:
- Significant pace decay in the second half
- HR drift > 10% for steady-state efforts
- Mentioned pain in notes (extract location, severity)
- RPE much higher than expected for the pace
- Early workout termination
- Missed quality session
