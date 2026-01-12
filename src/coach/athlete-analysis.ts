/**
 * Athlete Analysis - Deep analysis of historical data for plan creation
 *
 * Analyzes:
 * - Training history (volume, types, consistency)
 * - Health profile (HRV, sleep, recovery patterns)
 * - Bloodwork insights (biomarkers affecting performance)
 * - Inferred capabilities (pace estimates, base strength)
 */

import { query, queryOne } from '../db/client.js';

// ===== Types =====

interface RaceResult {
  name: string;
  date: string;
  distance_meters: number;
  time_seconds: number;
  pace_sec_per_mile: number;
}

interface FitnessTest {
  type: string;
  date: string;
  result_pace_sec_per_mile: number | null;
}

interface InjuryRecord {
  location: string;
  date: string;
  severity: number;
  resolved: boolean;
}

export interface AthleteAnalysis {
  // Training History
  training_history: {
    total_weeks: number;
    total_runs: number;
    total_miles: number;
    avg_weekly_miles: number;
    peak_weekly_miles: number;
    workout_type_distribution: Record<string, number>;
    longest_run_miles: number;
    consistency_score: number;
    date_range: { start: string; end: string } | null;
  };

  // Recent Performance
  recent_performance: {
    current_weekly_miles: number;
    trend: 'building' | 'maintaining' | 'declining';
    avg_easy_pace: number | null;
    avg_quality_pace: number | null;
    recent_races: RaceResult[];
    fitness_tests: FitnessTest[];
  };

  // Health Profile
  health_profile: {
    avg_sleep_hours: number | null;
    avg_hrv: number | null;
    hrv_trend: 'stable' | 'improving' | 'declining' | 'unknown';
    recovery_rate: 'fast' | 'average' | 'slow' | 'unknown';
    injury_history: InjuryRecord[];
    has_health_data: boolean;
  };

  // Bloodwork Insights
  biomarker_insights: {
    ferritin_status: 'optimal' | 'suboptimal' | 'low' | 'unknown';
    vitamin_d_status: 'optimal' | 'suboptimal' | 'low' | 'unknown';
    inflammatory_markers: 'good' | 'elevated' | 'unknown';
    metabolic_health: 'excellent' | 'good' | 'needs_attention' | 'unknown';
    has_bloodwork: boolean;
  };

  // Inferred Capabilities
  inferred_capabilities: {
    estimated_5k_pace: number | null;
    estimated_10k_pace: number | null;
    estimated_half_pace: number | null;
    estimated_marathon_pace: number | null;
    aerobic_base_strength: 'strong' | 'moderate' | 'developing';
    speed_work_experience: 'experienced' | 'some' | 'none';
    pace_confidence: 'high' | 'moderate' | 'low';
  };

  // Recommendations
  recommendations: string[];
  concerns: string[];
}

// ===== Analysis Functions =====

/**
 * Perform comprehensive athlete analysis
 */
export function analyzeAthlete(): AthleteAnalysis {
  const trainingHistory = analyzeTrainingHistory();
  const recentPerformance = analyzeRecentPerformance();
  const healthProfile = analyzeHealthProfile();
  const biomarkerInsights = analyzeBiomarkers();
  const inferredCapabilities = inferCapabilities(trainingHistory, recentPerformance, healthProfile);
  const { recommendations, concerns } = generateRecommendations(
    trainingHistory,
    recentPerformance,
    healthProfile,
    biomarkerInsights
  );

  return {
    training_history: trainingHistory,
    recent_performance: recentPerformance,
    health_profile: healthProfile,
    biomarker_insights: biomarkerInsights,
    inferred_capabilities: inferredCapabilities,
    recommendations,
    concerns,
  };
}

/**
 * Analyze training history from workouts table
 */
function analyzeTrainingHistory(): AthleteAnalysis['training_history'] {
  // Get date range
  const dateRange = queryOne<{ min_date: string; max_date: string }>(
    'SELECT MIN(local_date) as min_date, MAX(local_date) as max_date FROM workouts'
  );

  if (!dateRange?.min_date) {
    return {
      total_weeks: 0,
      total_runs: 0,
      total_miles: 0,
      avg_weekly_miles: 0,
      peak_weekly_miles: 0,
      workout_type_distribution: {},
      longest_run_miles: 0,
      consistency_score: 0,
      date_range: null,
    };
  }

  // Total runs and mileage
  const totals = queryOne<{ count: number; total_meters: number; max_meters: number }>(
    `SELECT COUNT(*) as count,
            COALESCE(SUM(distance_meters), 0) as total_meters,
            COALESCE(MAX(distance_meters), 0) as max_meters
     FROM workouts`
  );

  // Calculate weeks
  const startDate = new Date(dateRange.min_date);
  const endDate = new Date(dateRange.max_date);
  const totalWeeks = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)));

  // Weekly mileage stats
  const weeklyStats = query<{ week_start: string; weekly_meters: number }>(
    `SELECT date(local_date, 'weekday 0', '-6 days') as week_start,
            SUM(distance_meters) as weekly_meters
     FROM workouts
     GROUP BY week_start
     ORDER BY week_start`
  );

  const weeklyMiles = weeklyStats.map(w => (w.weekly_meters || 0) / 1609.344);
  const avgWeeklyMiles = weeklyMiles.length > 0
    ? weeklyMiles.reduce((a, b) => a + b, 0) / weeklyMiles.length
    : 0;
  const peakWeeklyMiles = weeklyMiles.length > 0 ? Math.max(...weeklyMiles) : 0;

  // Workout type distribution
  const typeDistribution = query<{ type: string; count: number }>(
    `SELECT COALESCE(type, 'unknown') as type, COUNT(*) as count
     FROM workouts
     GROUP BY type`
  );

  const distribution: Record<string, number> = {};
  typeDistribution.forEach(t => {
    distribution[t.type] = t.count;
  });

  // Consistency score (% of weeks with 3+ runs)
  const weeksWithEnoughRuns = query<{ week_start: string; run_count: number }>(
    `SELECT date(local_date, 'weekday 0', '-6 days') as week_start,
            COUNT(*) as run_count
     FROM workouts
     GROUP BY week_start
     HAVING run_count >= 3`
  );

  const consistencyScore = totalWeeks > 0
    ? Math.round((weeksWithEnoughRuns.length / totalWeeks) * 100)
    : 0;

  return {
    total_weeks: totalWeeks,
    total_runs: totals?.count ?? 0,
    total_miles: Math.round((totals?.total_meters ?? 0) / 1609.344),
    avg_weekly_miles: Math.round(avgWeeklyMiles * 10) / 10,
    peak_weekly_miles: Math.round(peakWeeklyMiles * 10) / 10,
    workout_type_distribution: distribution,
    longest_run_miles: Math.round((totals?.max_meters ?? 0) / 1609.344 * 10) / 10,
    consistency_score: consistencyScore,
    date_range: { start: dateRange.min_date, end: dateRange.max_date },
  };
}

/**
 * Analyze recent performance (last 4 weeks)
 */
function analyzeRecentPerformance(): AthleteAnalysis['recent_performance'] {
  const fourWeeksAgo = subtractDays(new Date().toISOString().split('T')[0], 28);

  // Current weekly mileage (last 7 days)
  const currentWeek = queryOne<{ meters: number }>(
    `SELECT COALESCE(SUM(distance_meters), 0) as meters
     FROM workouts
     WHERE local_date >= date('now', '-7 days')`
  );
  const currentWeeklyMiles = (currentWeek?.meters ?? 0) / 1609.344;

  // Previous 2 weeks for trend
  const prevWeek = queryOne<{ meters: number }>(
    `SELECT COALESCE(SUM(distance_meters), 0) as meters
     FROM workouts
     WHERE local_date >= date('now', '-14 days') AND local_date < date('now', '-7 days')`
  );
  const prevWeekMiles = (prevWeek?.meters ?? 0) / 1609.344;

  // Determine trend
  let trend: 'building' | 'maintaining' | 'declining' = 'maintaining';
  if (prevWeekMiles > 0) {
    const change = (currentWeeklyMiles - prevWeekMiles) / prevWeekMiles;
    if (change > 0.1) trend = 'building';
    else if (change < -0.1) trend = 'declining';
  }

  // Average easy pace
  const easyPace = queryOne<{ avg_pace: number }>(
    `SELECT AVG(avg_pace_sec_per_mile) as avg_pace
     FROM workouts
     WHERE type = 'easy' AND local_date >= ? AND avg_pace_sec_per_mile IS NOT NULL`,
    [fourWeeksAgo]
  );

  // Average quality pace (tempo, threshold, interval)
  const qualityPace = queryOne<{ avg_pace: number }>(
    `SELECT AVG(avg_pace_sec_per_mile) as avg_pace
     FROM workouts
     WHERE type IN ('tempo', 'threshold', 'interval', 'race')
       AND local_date >= ?
       AND avg_pace_sec_per_mile IS NOT NULL`,
    [fourWeeksAgo]
  );

  // Recent races
  const races = query<{
    name: string;
    race_date: string;
    distance_meters: number;
    result_time_seconds: number;
  }>(
    `SELECT name, race_date, distance_meters, result_time_seconds
     FROM races
     WHERE result_time_seconds IS NOT NULL
     ORDER BY race_date DESC
     LIMIT 5`
  );

  const recentRaces: RaceResult[] = races.map(r => ({
    name: r.name,
    date: r.race_date,
    distance_meters: r.distance_meters,
    time_seconds: r.result_time_seconds,
    pace_sec_per_mile: r.result_time_seconds / (r.distance_meters / 1609.344),
  }));

  // Fitness tests
  const tests = query<{
    test_type: string;
    local_date: string;
    result_pace_sec_per_mile: number | null;
  }>(
    `SELECT test_type, local_date, result_pace_sec_per_mile
     FROM fitness_tests
     ORDER BY local_date DESC
     LIMIT 5`
  );

  const fitnessTests: FitnessTest[] = tests.map(t => ({
    type: t.test_type,
    date: t.local_date,
    result_pace_sec_per_mile: t.result_pace_sec_per_mile,
  }));

  return {
    current_weekly_miles: Math.round(currentWeeklyMiles * 10) / 10,
    trend,
    avg_easy_pace: easyPace?.avg_pace ?? null,
    avg_quality_pace: qualityPace?.avg_pace ?? null,
    recent_races: recentRaces,
    fitness_tests: fitnessTests,
  };
}

/**
 * Analyze health profile from health_snapshots
 */
function analyzeHealthProfile(): AthleteAnalysis['health_profile'] {
  const thirtyDaysAgo = subtractDays(new Date().toISOString().split('T')[0], 30);

  // Check if we have health data
  const healthCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM health_snapshots WHERE local_date >= ?',
    [thirtyDaysAgo]
  );

  const hasHealthData = (healthCount?.count ?? 0) > 7;

  if (!hasHealthData) {
    return {
      avg_sleep_hours: null,
      avg_hrv: null,
      hrv_trend: 'unknown',
      recovery_rate: 'unknown',
      injury_history: [],
      has_health_data: false,
    };
  }

  // Average sleep and HRV
  const healthAvg = queryOne<{ avg_sleep: number; avg_hrv: number }>(
    `SELECT AVG(sleep_hours) as avg_sleep, AVG(hrv) as avg_hrv
     FROM health_snapshots
     WHERE local_date >= ?`,
    [thirtyDaysAgo]
  );

  // HRV trend (compare last 7 days to previous 7 days)
  const recentHrv = queryOne<{ avg: number }>(
    `SELECT AVG(hrv) as avg FROM health_snapshots
     WHERE local_date >= date('now', '-7 days') AND hrv IS NOT NULL`
  );
  const prevHrv = queryOne<{ avg: number }>(
    `SELECT AVG(hrv) as avg FROM health_snapshots
     WHERE local_date >= date('now', '-14 days')
       AND local_date < date('now', '-7 days')
       AND hrv IS NOT NULL`
  );

  let hrvTrend: 'stable' | 'improving' | 'declining' | 'unknown' = 'unknown';
  if (recentHrv?.avg && prevHrv?.avg) {
    const change = (recentHrv.avg - prevHrv.avg) / prevHrv.avg;
    if (change > 0.05) hrvTrend = 'improving';
    else if (change < -0.05) hrvTrend = 'declining';
    else hrvTrend = 'stable';
  }

  // Recovery rate (based on HRV recovery after hard workouts)
  // Simplified: based on average body battery if available
  const recoveryRate: 'fast' | 'average' | 'slow' | 'unknown' = 'average'; // Default

  // Injury history
  const injuries = query<{
    location: string;
    local_date: string;
    severity: number;
    limits_running: number;
  }>(
    `SELECT location, local_date, severity, limits_running
     FROM injury_status
     ORDER BY local_date DESC
     LIMIT 10`
  );

  const injuryHistory: InjuryRecord[] = injuries.map(i => ({
    location: i.location,
    date: i.local_date,
    severity: i.severity,
    resolved: i.limits_running === 0,
  }));

  return {
    avg_sleep_hours: healthAvg?.avg_sleep ? Math.round(healthAvg.avg_sleep * 10) / 10 : null,
    avg_hrv: healthAvg?.avg_hrv ? Math.round(healthAvg.avg_hrv) : null,
    hrv_trend: hrvTrend,
    recovery_rate: recoveryRate,
    injury_history: injuryHistory,
    has_health_data: true,
  };
}

/**
 * Analyze bloodwork/biomarker data
 */
function analyzeBiomarkers(): AthleteAnalysis['biomarker_insights'] {
  // Check if we have bloodwork data
  const bloodworkCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM biomarker_results'
  );

  if (!bloodworkCount || bloodworkCount.count === 0) {
    return {
      ferritin_status: 'unknown',
      vitamin_d_status: 'unknown',
      inflammatory_markers: 'unknown',
      metabolic_health: 'unknown',
      has_bloodwork: false,
    };
  }

  // Get latest values for key markers
  const ferritin = queryOne<{ value: number }>(
    `SELECT br.value FROM biomarker_results br
     JOIN lab_panels lp ON br.lab_panel_id = lp.id
     WHERE br.marker_name LIKE '%Ferritin%'
     ORDER BY lp.collection_date DESC LIMIT 1`
  );

  const vitaminD = queryOne<{ value: number }>(
    `SELECT br.value FROM biomarker_results br
     JOIN lab_panels lp ON br.lab_panel_id = lp.id
     WHERE br.marker_name LIKE '%Vitamin D%' OR br.marker_name LIKE '%25-OH%'
     ORDER BY lp.collection_date DESC LIMIT 1`
  );

  const hsCrp = queryOne<{ value: number }>(
    `SELECT br.value FROM biomarker_results br
     JOIN lab_panels lp ON br.lab_panel_id = lp.id
     WHERE br.marker_name LIKE '%CRP%' OR br.marker_name LIKE '%hs-CRP%'
     ORDER BY lp.collection_date DESC LIMIT 1`
  );

  const insulin = queryOne<{ value: number }>(
    `SELECT br.value FROM biomarker_results br
     JOIN lab_panels lp ON br.lab_panel_id = lp.id
     WHERE br.marker_name LIKE '%Insulin%' AND br.marker_name NOT LIKE '%Resistance%'
     ORDER BY lp.collection_date DESC LIMIT 1`
  );

  // Evaluate ferritin (athletic optimal: 50-150 ng/mL)
  let ferritinStatus: 'optimal' | 'suboptimal' | 'low' | 'unknown' = 'unknown';
  if (ferritin?.value !== undefined) {
    if (ferritin.value >= 50) ferritinStatus = 'optimal';
    else if (ferritin.value >= 30) ferritinStatus = 'suboptimal';
    else ferritinStatus = 'low';
  }

  // Evaluate vitamin D (athletic optimal: 40-60 ng/mL)
  let vitaminDStatus: 'optimal' | 'suboptimal' | 'low' | 'unknown' = 'unknown';
  if (vitaminD?.value !== undefined) {
    if (vitaminD.value >= 40) vitaminDStatus = 'optimal';
    else if (vitaminD.value >= 30) vitaminDStatus = 'suboptimal';
    else vitaminDStatus = 'low';
  }

  // Evaluate inflammation (hs-CRP < 1 is good)
  let inflammatoryMarkers: 'good' | 'elevated' | 'unknown' = 'unknown';
  if (hsCrp?.value !== undefined) {
    if (hsCrp.value < 1) inflammatoryMarkers = 'good';
    else inflammatoryMarkers = 'elevated';
  }

  // Evaluate metabolic health (insulin < 8 is excellent)
  let metabolicHealth: 'excellent' | 'good' | 'needs_attention' | 'unknown' = 'unknown';
  if (insulin?.value !== undefined) {
    if (insulin.value < 5) metabolicHealth = 'excellent';
    else if (insulin.value < 10) metabolicHealth = 'good';
    else metabolicHealth = 'needs_attention';
  }

  return {
    ferritin_status: ferritinStatus,
    vitamin_d_status: vitaminDStatus,
    inflammatory_markers: inflammatoryMarkers,
    metabolic_health: metabolicHealth,
    has_bloodwork: true,
  };
}

/**
 * Infer athlete capabilities from available data
 */
function inferCapabilities(
  training: AthleteAnalysis['training_history'],
  performance: AthleteAnalysis['recent_performance'],
  _health: AthleteAnalysis['health_profile']
): AthleteAnalysis['inferred_capabilities'] {
  // Determine aerobic base strength
  let aerobicBase: 'strong' | 'moderate' | 'developing' = 'developing';
  if (training.avg_weekly_miles >= 40 && training.consistency_score >= 80) {
    aerobicBase = 'strong';
  } else if (training.avg_weekly_miles >= 25 && training.consistency_score >= 60) {
    aerobicBase = 'moderate';
  }

  // Determine speed work experience
  const qualityTypes = ['tempo', 'interval', 'threshold', 'race'];
  const qualityRuns = qualityTypes.reduce((sum, type) => sum + (training.workout_type_distribution[type] || 0), 0);
  const totalRuns = training.total_runs;

  let speedExperience: 'experienced' | 'some' | 'none' = 'none';
  if (totalRuns > 0) {
    const qualityPercent = (qualityRuns / totalRuns) * 100;
    if (qualityPercent >= 15) speedExperience = 'experienced';
    else if (qualityPercent >= 5) speedExperience = 'some';
  }

  // Estimate paces from available data
  let paceConfidence: 'high' | 'moderate' | 'low' = 'low';
  let estimated5k: number | null = null;
  let estimated10k: number | null = null;
  let estimatedHalf: number | null = null;
  let estimatedMarathon: number | null = null;

  // Priority 1: Recent race results
  if (performance.recent_races.length > 0) {
    const race = performance.recent_races[0];
    const racePace = race.pace_sec_per_mile;
    const raceDistance = race.distance_meters;

    // Use Riegel formula to estimate other distances
    // T2 = T1 * (D2/D1)^1.06
    if (raceDistance >= 3000 && raceDistance <= 5500) {
      // 5K race
      estimated5k = racePace;
      estimated10k = racePace * Math.pow(2, 0.06) * 1.02;
      estimatedHalf = racePace * Math.pow(4.2195, 0.06) * 1.05;
      estimatedMarathon = racePace * Math.pow(8.439, 0.06) * 1.08;
      paceConfidence = 'high';
    } else if (raceDistance >= 9000 && raceDistance <= 11000) {
      // 10K race
      estimated5k = racePace / (Math.pow(0.5, 0.06) * 1.02);
      estimated10k = racePace;
      estimatedHalf = racePace * Math.pow(2.1095, 0.06) * 1.03;
      estimatedMarathon = racePace * Math.pow(4.2195, 0.06) * 1.06;
      paceConfidence = 'high';
    } else if (raceDistance >= 20000 && raceDistance <= 22000) {
      // Half marathon
      estimated5k = racePace / (Math.pow(4.2195, 0.06) * 1.05);
      estimated10k = racePace / (Math.pow(2.1095, 0.06) * 1.03);
      estimatedHalf = racePace;
      estimatedMarathon = racePace * Math.pow(2, 0.06) * 1.03;
      paceConfidence = 'high';
    }
  }

  // Priority 2: Fitness test results
  if (!estimated5k && performance.fitness_tests.length > 0) {
    const test = performance.fitness_tests.find(t => t.result_pace_sec_per_mile);
    if (test?.result_pace_sec_per_mile) {
      // Use test pace as threshold estimate
      const thresholdPace = test.result_pace_sec_per_mile;
      estimated5k = thresholdPace - 15;
      estimated10k = thresholdPace;
      estimatedHalf = thresholdPace + 30;
      estimatedMarathon = thresholdPace + 60;
      paceConfidence = 'moderate';
    }
  }

  // Priority 3: Easy pace estimation
  if (!estimated5k && performance.avg_easy_pace) {
    const easyPace = performance.avg_easy_pace;
    // Rough estimation: easy pace is ~75 sec/mi slower than 10K pace
    estimated10k = easyPace - 75;
    estimated5k = estimated10k - 20;
    estimatedHalf = estimated10k + 30;
    estimatedMarathon = estimated10k + 60;
    paceConfidence = 'low';
  }

  return {
    estimated_5k_pace: estimated5k ? Math.round(estimated5k) : null,
    estimated_10k_pace: estimated10k ? Math.round(estimated10k) : null,
    estimated_half_pace: estimatedHalf ? Math.round(estimatedHalf) : null,
    estimated_marathon_pace: estimatedMarathon ? Math.round(estimatedMarathon) : null,
    aerobic_base_strength: aerobicBase,
    speed_work_experience: speedExperience,
    pace_confidence: paceConfidence,
  };
}

/**
 * Generate recommendations and concerns based on analysis
 */
function generateRecommendations(
  training: AthleteAnalysis['training_history'],
  performance: AthleteAnalysis['recent_performance'],
  health: AthleteAnalysis['health_profile'],
  biomarkers: AthleteAnalysis['biomarker_insights']
): { recommendations: string[]; concerns: string[] } {
  const recommendations: string[] = [];
  const concerns: string[] = [];

  // Training-based recommendations
  if (training.total_runs === 0) {
    concerns.push('No workout history found - start with a conservative base-building plan');
  } else if (training.avg_weekly_miles < 15) {
    recommendations.push('Current base is developing - recommend extended base phase before racing');
  } else if (training.avg_weekly_miles >= 30 && training.consistency_score >= 70) {
    recommendations.push('Solid training base - ready for structured training');
  }

  if (training.workout_type_distribution['easy'] &&
      Object.keys(training.workout_type_distribution).length === 1) {
    recommendations.push('Consider adding quality sessions (tempo, intervals) for race preparation');
  }

  if (training.consistency_score < 60 && training.total_weeks > 4) {
    concerns.push('Training consistency below 60% - focus on regular running before adding intensity');
  }

  // Performance-based recommendations
  if (performance.trend === 'declining') {
    concerns.push('Recent mileage trending down - assess recovery or life factors');
  }

  if (performance.fitness_tests.length === 0 && performance.recent_races.length === 0) {
    recommendations.push('No recent performance data - consider a fitness test to calibrate paces');
  }

  // Health-based recommendations
  if (!health.has_health_data) {
    recommendations.push('No health data available - connect wearable for readiness tracking');
  } else {
    if (health.hrv_trend === 'declining') {
      concerns.push('HRV trending down - may indicate accumulated fatigue or stress');
    }
    if (health.avg_sleep_hours && health.avg_sleep_hours < 7) {
      recommendations.push('Average sleep below 7 hours - prioritize sleep for recovery');
    }
  }

  if (health.injury_history.some(i => !i.resolved && i.severity >= 4)) {
    concerns.push('Active injury detected - recommend resolving before intensive training');
  }

  // Biomarker-based recommendations
  if (biomarkers.has_bloodwork) {
    if (biomarkers.ferritin_status === 'low') {
      concerns.push('Ferritin is low - may affect energy and recovery (consult physician)');
    } else if (biomarkers.ferritin_status === 'suboptimal') {
      recommendations.push('Ferritin suboptimal for athletes - consider iron-rich foods');
    }

    if (biomarkers.vitamin_d_status === 'low' || biomarkers.vitamin_d_status === 'suboptimal') {
      recommendations.push('Vitamin D below optimal - consider supplementation');
    }

    if (biomarkers.inflammatory_markers === 'elevated') {
      concerns.push('Inflammatory markers elevated - review recovery and diet');
    }

    if (biomarkers.metabolic_health === 'excellent') {
      recommendations.push('Excellent metabolic health - body is primed for training');
    }
  } else {
    recommendations.push('No bloodwork data - consider baseline labs before intensive training');
  }

  return { recommendations, concerns };
}

// ===== Utility Functions =====

function subtractDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

/**
 * Format pace (seconds per mile) as MM:SS string
 */
export function formatPace(secPerMile: number): string {
  const mins = Math.floor(secPerMile / 60);
  const secs = Math.floor(secPerMile % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
