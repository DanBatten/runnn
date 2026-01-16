/**
 * API Index - Re-export all API functions
 *
 * This is the single entry point for all API operations.
 * MCP server and other consumers should import from here.
 */

// Types
export * from './types.js';

// Concurrency utilities
export {
  acquireWriteLock,
  releaseWriteLock,
  checkIdempotency,
  storeIdempotency,
  withWriteLock,
  cleanupIdempotencyKeys,
  getStaleLocksSync,
  clearAllLocks,
} from './concurrency.js';

// Readiness API
export {
  getReadiness,
  getAthleteContext,
} from './readiness.js';

// Workout API
export {
  getTodayWorkout,
  getWorkoutHistory,
} from './workout.js';

// Sync API
export {
  syncAll,
  getSyncStatus,
  type SyncParams,
} from './sync.js';

// Plan API
export {
  generatePlan,
  generateWeeklyPlan,
  type PlanCreateParams,
  type PlanWeekParams,
  type PlanResult,
  type WeekPlanResult,
} from './plan.js';

// Policy API
export {
  listPolicies,
  getPolicy,
  evaluatePolicy,
  evaluateAllPolicies,
  getTriggeredPolicies,
} from './policy.js';

// Doctor API
export {
  runDoctor,
  getDoctorStatus,
  type DoctorParams,
} from './doctor.js';

// Decisions API
export {
  recordDecision,
  getLatestDecision,
  getDecisionById,
  explainDecision,
  getRecentDecisions,
} from './decisions.js';

// Events API
export {
  listRecentEvents,
  getEventsForEntity,
  getEvent,
  getEventStats,
  type EventsQueryParams,
} from './events.js';
