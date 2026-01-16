#!/usr/bin/env node
/**
 * Runnn MCP Server
 *
 * Exposes the running coach API as MCP tools for Claude Code.
 * Tools are separated into read (safe) and write (serialized) categories.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Import from the compiled API layer
import {
  getReadiness,
  getAthleteContext,
  getTodayWorkout,
  getWorkoutHistory,
  syncAll,
  getSyncStatus,
  generatePlan,
  generateWeeklyPlan,
  listPolicies,
  evaluatePolicy,
  evaluateAllPolicies,
  runDoctor,
  getLatestDecision,
  explainDecision,
  getRecentDecisions,
  listRecentEvents,
  getEventStats,
  type ApiEnvelope,
} from "../../../dist/api/index.js";

// ============================================
// Tool Definitions
// ============================================

const READ_TOOLS: Tool[] = [
  {
    name: "coach_read_readiness",
    description: "Get today's readiness assessment (HRV, RHR, sleep, recovery status, recommendation)",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date (YYYY-MM-DD), defaults to today" },
      },
    },
  },
  {
    name: "coach_read_today_workout",
    description: "Get recommended workout for today based on readiness, training plan, and policies",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date (YYYY-MM-DD), defaults to today" },
      },
    },
  },
  {
    name: "coach_read_athlete_context",
    description: "Get comprehensive athlete context (fitness, fatigue, trends, patterns, injuries)",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date (YYYY-MM-DD), defaults to today" },
      },
    },
  },
  {
    name: "coach_read_workout_history",
    description: "Query workout history with filters",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of days to look back (default: 30)" },
        type: { type: "string", description: "Filter by workout type (easy, tempo, interval, long)" },
        limit: { type: "number", description: "Max results to return (default: 100)" },
      },
    },
  },
  {
    name: "coach_read_decision_latest",
    description: "Fetch the latest coaching decision record (inputs, policies, outputs)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "coach_read_decision_explain",
    description: "Explain the reasoning behind a specific decision",
    inputSchema: {
      type: "object",
      properties: {
        decision_id: { type: "string", description: "The decision ID to explain" },
      },
      required: ["decision_id"],
    },
  },
  {
    name: "coach_read_decisions_recent",
    description: "Get recent coaching decisions",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max decisions to return (default: 20)" },
        decision_type: { type: "string", description: "Filter by type (today_workout, plan_create, etc)" },
      },
    },
  },
  {
    name: "coach_read_events_recent",
    description: "Fetch recent events from the audit log for debugging",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max events to return (default: 50)" },
        entity_type: { type: "string", description: "Filter by entity type" },
      },
    },
  },
  {
    name: "coach_read_event_stats",
    description: "Get event statistics by entity type",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "coach_read_policies",
    description: "List all active coaching policies",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "coach_read_policy_evaluate",
    description: "Evaluate a specific policy against current context",
    inputSchema: {
      type: "object",
      properties: {
        policy_id: { type: "string", description: "The policy ID to evaluate" },
        date: { type: "string", description: "Optional date for context" },
      },
      required: ["policy_id"],
    },
  },
  {
    name: "coach_read_policies_triggered",
    description: "Get all policies that are currently triggered",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date for context" },
      },
    },
  },
  {
    name: "coach_read_sync_status",
    description: "Get current sync status (last Garmin sync, pending notes)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const WRITE_TOOLS: Tool[] = [
  {
    name: "coach_write_sync",
    description: "Sync Garmin data and process voice notes (idempotent, serialized)",
    inputSchema: {
      type: "object",
      properties: {
        garmin: { type: "boolean", description: "Sync Garmin data (default: true)" },
        notes: { type: "boolean", description: "Process voice notes (default: true)" },
        force: { type: "boolean", description: "Force full sync (default: false)" },
        idempotency_key: { type: "string", description: "Idempotency key for deduplication" },
        dry_run: { type: "boolean", description: "Preview only, no changes (default: false)" },
      },
    },
  },
  {
    name: "coach_write_plan_create",
    description: "Create a multi-week training plan (persists decision record)",
    inputSchema: {
      type: "object",
      properties: {
        weeks: { type: "number", description: "Number of weeks to plan" },
        goal_race: { type: "string", description: "Optional goal race name" },
        goal_time: { type: "string", description: "Optional goal time" },
        weekly_mileage_target: { type: "number", description: "Target weekly mileage in meters" },
        start_date: { type: "string", description: "Plan start date (YYYY-MM-DD)" },
        idempotency_key: { type: "string", description: "Idempotency key" },
        dry_run: { type: "boolean", description: "Preview only (default: false)" },
      },
      required: ["weeks"],
    },
  },
  {
    name: "coach_write_plan_week",
    description: "Generate next week's workout schedule (persists decision record)",
    inputSchema: {
      type: "object",
      properties: {
        week_start: { type: "string", description: "Week start date (YYYY-MM-DD)" },
        idempotency_key: { type: "string", description: "Idempotency key" },
        dry_run: { type: "boolean", description: "Preview only (default: false)" },
      },
    },
  },
  {
    name: "coach_write_doctor_fix",
    description: "Run data quality checks and optionally auto-fix issues",
    inputSchema: {
      type: "object",
      properties: {
        fix: { type: "boolean", description: "Attempt to fix issues (default: false)" },
        dry_run: { type: "boolean", description: "Preview only (default: false)" },
      },
    },
  },
];

const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

// ============================================
// Tool Handlers
// ============================================

type ToolArgs = Record<string, unknown>;

async function handleToolCall(name: string, args: ToolArgs): Promise<ApiEnvelope<unknown>> {
  switch (name) {
    // Read tools
    case "coach_read_readiness":
      return getReadiness(args.date as string | undefined);

    case "coach_read_today_workout":
      return getTodayWorkout(args.date as string | undefined);

    case "coach_read_athlete_context":
      return getAthleteContext(args.date as string | undefined);

    case "coach_read_workout_history":
      return getWorkoutHistory({
        days: args.days as number | undefined,
        type: args.type as string | undefined,
        limit: args.limit as number | undefined,
      });

    case "coach_read_decision_latest":
      return getLatestDecision();

    case "coach_read_decision_explain":
      return explainDecision(args.decision_id as string);

    case "coach_read_decisions_recent":
      return getRecentDecisions({
        limit: args.limit as number | undefined,
        decision_type: args.decision_type as string | undefined,
      });

    case "coach_read_events_recent":
      return listRecentEvents({
        limit: args.limit as number | undefined,
        entity_type: args.entity_type as string | undefined,
      });

    case "coach_read_event_stats":
      return getEventStats();

    case "coach_read_policies":
      return listPolicies();

    case "coach_read_policy_evaluate":
      return evaluatePolicy(
        args.policy_id as string,
        args.date as string | undefined
      );

    case "coach_read_policies_triggered":
      return evaluateAllPolicies(args.date as string | undefined).then(result => {
        if (!result.ok) return result;
        return {
          ...result,
          data: result.data?.filter((p: { triggered: boolean }) => p.triggered),
        };
      });

    case "coach_read_sync_status":
      return getSyncStatus();

    // Write tools
    case "coach_write_sync":
      return syncAll({
        garmin: args.garmin as boolean | undefined,
        notes: args.notes as boolean | undefined,
        force: args.force as boolean | undefined,
        idempotency_key: args.idempotency_key as string | undefined,
        dry_run: args.dry_run as boolean | undefined,
      });

    case "coach_write_plan_create":
      return generatePlan({
        weeks: args.weeks as number,
        goal_race: args.goal_race as string | undefined,
        goal_time: args.goal_time as string | undefined,
        weekly_mileage_target: args.weekly_mileage_target as number | undefined,
        start_date: args.start_date as string | undefined,
        idempotency_key: args.idempotency_key as string | undefined,
        dry_run: args.dry_run as boolean | undefined,
      });

    case "coach_write_plan_week":
      return generateWeeklyPlan({
        week_start: args.week_start as string | undefined,
        idempotency_key: args.idempotency_key as string | undefined,
        dry_run: args.dry_run as boolean | undefined,
      });

    case "coach_write_doctor_fix":
      return runDoctor({
        fix: args.fix as boolean | undefined,
        dry_run: args.dry_run as boolean | undefined,
      });

    default:
      return {
        ok: false,
        error: {
          code: "UNKNOWN_TOOL",
          message: `Unknown tool: ${name}`,
        },
        trace_id: `error_${Date.now()}`,
      };
  }
}

// ============================================
// Server Setup
// ============================================

const server = new Server(
  {
    name: "runnn-coach",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: ALL_TOOLS,
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    const result = await handleToolCall(name, args as ToolArgs);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: !result.ok,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: {
              code: "EXECUTION_ERROR",
              message,
            },
            trace_id: `error_${Date.now()}`,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Runnn MCP server running on stdio");
}

main().catch(console.error);
