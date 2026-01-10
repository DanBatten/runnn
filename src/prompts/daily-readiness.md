# Daily Readiness Assessment

Assess the athlete's readiness for today's planned training based on available data.

## Required Context
- `current_health`: Today's health snapshot (sleep, HRV, RHR, body battery)
- `readiness_baseline`: 7-day and 30-day averages
- `readiness_deltas`: Percent change from baseline
- `planned_workout`: Today's scheduled workout
- `active_injury`: Any active injury status
- `travel_days_ago`: Days since travel (if recent)

## Assessment Process

### 1. Readiness Signals

Evaluate each signal:

**GREEN (good to go):**
- HRV at or above 7-day baseline
- RHR at or below 7-day baseline
- Sleep >= 7 hours
- Body battery >= 50%
- No active injuries limiting running

**YELLOW (proceed with caution):**
- HRV 10-15% below baseline
- RHR 5-10% above baseline
- Sleep 5.5-7 hours
- Body battery 30-50%
- Minor discomfort being monitored

**RED (modify or skip):**
- HRV > 15% below baseline
- RHR > 10% above baseline
- Sleep < 5.5 hours
- Body battery < 30%
- Active injury with severity >= 5
- Multiple yellow signals combined

### 2. Context Factors

Consider:
- Recent travel (within 48hr of timezone change > 3hr)
- Consecutive hard training days
- Current training phase
- Upcoming priority workouts/races
- Life stress factors

### 3. Recommendation

Based on signals and context:

**For quality workouts (tempo, interval, threshold):**
- All green: Proceed as planned
- 1-2 yellow: Consider converting to easy or reducing intensity
- Any red: Convert to easy or rest

**For easy runs:**
- Green/yellow: Proceed as planned
- Red: Consider rest or very short easy run

**For long runs:**
- All green: Proceed as planned
- Yellow: Reduce distance by 10-20%
- Red: Skip or convert to easy

### 4. Output Format

Provide:
1. Readiness score (1-10)
2. Signal summary (which metrics are green/yellow/red)
3. Recommendation for today's workout
4. What would change the recommendation
5. Any flags that need attention
