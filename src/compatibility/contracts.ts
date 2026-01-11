/**
 * Contracts - Define what prompts expect from the schema
 *
 * Each prompt has explicit requirements:
 * - required_fields: schema columns the prompt queries
 * - required_tables: tables the prompt accesses
 * - required_tools: CLI tools the prompt calls
 *
 * This allows us to detect breaking changes before deployment.
 */

export interface PromptContract {
  prompt_name: string;
  version: number;
  description: string;
  required_tables: string[];
  required_fields: TableFieldRequirement[];
  required_tools: string[];
  context_pack_type?: 'morning' | 'postrun' | 'weekly_planning';
}

export interface TableFieldRequirement {
  table: string;
  fields: FieldRequirement[];
}

export interface FieldRequirement {
  name: string;
  type: 'text' | 'integer' | 'real' | 'blob' | 'any';
  nullable: boolean;
  description?: string;
}

/**
 * Default contracts for system prompts
 */
export const SYSTEM_PROMPT_CONTRACTS: PromptContract[] = [
  {
    prompt_name: 'daily_readiness',
    version: 1,
    description: 'Morning readiness assessment prompt',
    required_tables: [
      'health_snapshots',
      'readiness_baselines',
      'workouts',
      'planned_workouts',
      'overrides',
      'discovered_patterns',
    ],
    required_fields: [
      {
        table: 'health_snapshots',
        fields: [
          { name: 'local_date', type: 'text', nullable: false },
          { name: 'hrv', type: 'integer', nullable: true },
          { name: 'resting_hr', type: 'integer', nullable: true },
          { name: 'sleep_hours', type: 'real', nullable: true },
          { name: 'sleep_quality', type: 'integer', nullable: true },
          { name: 'body_battery', type: 'integer', nullable: true },
        ],
      },
      {
        table: 'readiness_baselines',
        fields: [
          { name: 'local_date', type: 'text', nullable: false },
          { name: 'hrv_7day_avg', type: 'real', nullable: true },
          { name: 'rhr_7day_avg', type: 'real', nullable: true },
          { name: 'sleep_7day_avg', type: 'real', nullable: true },
        ],
      },
      {
        table: 'planned_workouts',
        fields: [
          { name: 'local_date', type: 'text', nullable: false },
          { name: 'type', type: 'text', nullable: true },
          { name: 'priority', type: 'text', nullable: true },
          { name: 'prescription', type: 'text', nullable: true },
          { name: 'status', type: 'text', nullable: false },
        ],
      },
    ],
    required_tools: ['runnn morning', 'runnn sync'],
    context_pack_type: 'morning',
  },
  {
    prompt_name: 'workout_analysis',
    version: 1,
    description: 'Post-run workout analysis prompt',
    required_tables: [
      'workouts',
      'planned_workouts',
      'health_snapshots',
      'coaching_decisions',
    ],
    required_fields: [
      {
        table: 'workouts',
        fields: [
          { name: 'id', type: 'text', nullable: false },
          { name: 'local_date', type: 'text', nullable: false },
          { name: 'type', type: 'text', nullable: true },
          { name: 'distance_meters', type: 'real', nullable: true },
          { name: 'duration_seconds', type: 'integer', nullable: true },
          { name: 'avg_pace_sec_per_mile', type: 'real', nullable: true },
          { name: 'avg_hr', type: 'integer', nullable: true },
          { name: 'perceived_exertion', type: 'integer', nullable: true },
          { name: 'personal_notes', type: 'text', nullable: true },
        ],
      },
    ],
    required_tools: ['runnn postrun', 'runnn sync'],
    context_pack_type: 'postrun',
  },
  {
    prompt_name: 'weekly_planning',
    version: 1,
    description: 'Weekly training planning prompt',
    required_tables: [
      'workouts',
      'planned_workouts',
      'weekly_summaries',
      'training_blocks',
      'races',
      'pace_zones',
      'overrides',
      'injury_status',
      'life_events',
    ],
    required_fields: [
      {
        table: 'weekly_summaries',
        fields: [
          { name: 'week_start_date', type: 'text', nullable: false },
          { name: 'total_distance_meters', type: 'real', nullable: true },
          { name: 'run_count', type: 'integer', nullable: false },
          { name: 'plan_adherence_pct', type: 'real', nullable: true },
          { name: 'training_load_total', type: 'integer', nullable: true },
        ],
      },
      {
        table: 'races',
        fields: [
          { name: 'id', type: 'text', nullable: false },
          { name: 'name', type: 'text', nullable: false },
          { name: 'race_date', type: 'text', nullable: false },
          { name: 'distance_meters', type: 'real', nullable: false },
          { name: 'priority', type: 'text', nullable: false },
        ],
      },
    ],
    required_tools: ['runnn plan week', 'runnn plan generate-block'],
    context_pack_type: 'weekly_planning',
  },
  {
    prompt_name: 'block_generation',
    version: 1,
    description: 'Training block generation prompt',
    required_tables: [
      'training_plans',
      'training_blocks',
      'races',
      'fitness_tests',
      'pace_zones',
      'workouts',
    ],
    required_fields: [
      {
        table: 'races',
        fields: [
          { name: 'id', type: 'text', nullable: false },
          { name: 'race_date', type: 'text', nullable: false },
          { name: 'distance_meters', type: 'real', nullable: false },
          { name: 'goal_time_seconds', type: 'integer', nullable: true },
        ],
      },
      {
        table: 'fitness_tests',
        fields: [
          { name: 'id', type: 'text', nullable: false },
          { name: 'test_type', type: 'text', nullable: false },
          { name: 'local_date', type: 'text', nullable: false },
          { name: 'result_pace_sec_per_mile', type: 'real', nullable: true },
        ],
      },
    ],
    required_tools: ['runnn plan generate-block'],
  },
];

/**
 * Get contract for a specific prompt
 */
export function getContract(promptName: string): PromptContract | undefined {
  return SYSTEM_PROMPT_CONTRACTS.find(c => c.prompt_name === promptName);
}

/**
 * Get all registered contracts
 */
export function getAllContracts(): PromptContract[] {
  return [...SYSTEM_PROMPT_CONTRACTS];
}

/**
 * Register a custom contract
 */
export function registerContract(contract: PromptContract): void {
  const existing = SYSTEM_PROMPT_CONTRACTS.findIndex(
    c => c.prompt_name === contract.prompt_name
  );
  if (existing >= 0) {
    SYSTEM_PROMPT_CONTRACTS[existing] = contract;
  } else {
    SYSTEM_PROMPT_CONTRACTS.push(contract);
  }
}
