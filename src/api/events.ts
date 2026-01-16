/**
 * Events API - Query the audit event log
 *
 * Read-only access to the append-only event ledger.
 */

import {
  ApiEnvelope,
  EventsResult,
  EventSummary,
  generateTraceId,
  success,
  timeOperation,
} from './types.js';
import {
  getRecentEvents as getEvents,
  getEntityEvents,
  getEventById,
  countEventsByType,
  getTotalEventCount,
  type Event,
} from '../db/events.js';

export interface EventsQueryParams {
  limit?: number;
  entity_type?: string;
  action?: string;
  offset?: number;
}

/**
 * Get recent events from the audit log
 */
export async function listRecentEvents(
  params: EventsQueryParams = {}
): Promise<ApiEnvelope<EventsResult>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const limit = params.limit ?? 50;

    const events = getEvents({
      limit,
      entityType: params.entity_type,
      action: params.action as 'create' | 'update' | 'delete' | undefined,
    });

    const totalCount = getTotalEventCount();

    return success<EventsResult>(
      {
        events: events.map(formatEvent),
        total_count: totalCount,
      },
      trace_id
    );
  });
}

/**
 * Get events for a specific entity
 */
export async function getEventsForEntity(
  entity_type: string,
  entity_id: string,
  params: { limit?: number } = {}
): Promise<ApiEnvelope<EventsResult>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const events = getEntityEvents(entity_type, entity_id, {
      limit: params.limit ?? 100,
    });

    return success<EventsResult>(
      {
        events: events.map(formatEvent),
        total_count: events.length,
      },
      trace_id
    );
  });
}

/**
 * Get a single event by ID
 */
export async function getEvent(
  event_id: string
): Promise<ApiEnvelope<EventSummary | null>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const event = getEventById(event_id);

    if (!event) {
      return success<EventSummary | null>(null, trace_id);
    }

    return success<EventSummary>(formatEvent(event), trace_id);
  });
}

/**
 * Get event counts by entity type
 */
export async function getEventStats(): Promise<ApiEnvelope<{
  total_events: number;
  by_type: Record<string, number>;
}>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const totalEvents = getTotalEventCount();
    const byType = countEventsByType();

    return success(
      {
        total_events: totalEvents,
        by_type: byType,
      },
      trace_id
    );
  });
}

// ============================================
// Helper Functions
// ============================================

function formatEvent(event: Event): EventSummary {
  return {
    id: event.id,
    timestamp: event.timestamp_utc,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    action: event.action,
    source: event.source,
    reason: event.reason ?? null,
  };
}
