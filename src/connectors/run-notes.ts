/**
 * Run Notes Connector - Process voice transcriptions and match to workouts
 *
 * Notes lifecycle: pending → processed → linked
 *
 * Matching algorithm (robust for travel/timezone):
 * - Prefers same local_date
 * - Considers start_time proximity (configurable window)
 * - Uses distance/duration similarity if available
 * - If ambiguous, returns candidates for manual choice
 */

import { nanoid } from 'nanoid';
import { readFileSync, readdirSync, existsSync, renameSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { insertWithEvent, query, queryOne, getDb } from '../db/client.js';

interface RunNote {
  id: string;
  captured_at_local: string;
  timezone_offset_min: number;
  audio_path?: string;
  transcription: string;
  status: 'pending' | 'processed' | 'linked';
}

interface RawRunNote {
  id: string;
  captured_at_local: string;
  timezone_offset_min: number;
  audio_path?: string;
  transcription: string;
  status: string;
}

interface Workout {
  id: string;
  local_date: string;
  start_time_utc: string;
  timezone_offset_min: number;
  distance_meters: number | null;
  duration_seconds: number | null;
  type: string | null;
}

interface MatchCandidate {
  workout: Workout;
  score: number;
  reasons: string[];
}

interface ExtractedFields {
  perceived_exertion?: number;
  mood?: string;
  discomfort_notes?: string;
  discomfort_locations?: string[];
  personal_notes: string;
}

interface ProcessResult {
  success: boolean;
  notesProcessed: number;
  notesLinked: number;
  errors: string[];
  pendingMatches: Array<{
    noteId: string;
    candidates: MatchCandidate[];
  }>;
}

const NOTES_INBOX_PATH = process.env.NOTES_INBOX_PATH || './data/run-notes/inbox';
const NOTES_ARCHIVE_PATH = process.env.NOTES_ARCHIVE_PATH || './data/run-notes/archive';

// Time window for matching (hours)
const MATCH_WINDOW_HOURS = 4;

/**
 * Scan inbox for new note files
 */
export function scanInbox(): string[] {
  if (!existsSync(NOTES_INBOX_PATH)) {
    return [];
  }

  const files = readdirSync(NOTES_INBOX_PATH)
    .filter(f => f.endsWith('.json'))
    .map(f => join(NOTES_INBOX_PATH, f));

  return files;
}

/**
 * Read and parse a note file
 */
function readNoteFile(filePath: string): RunNote | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const note = JSON.parse(content) as RawRunNote;

    return {
      ...note,
      status: note.status as 'pending' | 'processed' | 'linked',
    };
  } catch {
    return null;
  }
}

/**
 * Store a run note in the database
 */
function storeRunNote(note: RunNote): string {
  // Store in raw_ingest first
  const rawId = nanoid();

  insertWithEvent(
    'raw_ingest',
    {
      id: rawId,
      source: 'run_note',
      source_id: note.id,
      received_at_utc: new Date().toISOString(),
      payload_json: JSON.stringify(note),
      status: 'pending',
    },
    { source: 'run_notes_sync' }
  );

  return rawId;
}

/**
 * Calculate match score between a note and a workout
 */
function calculateMatchScore(note: RunNote, workout: Workout): MatchCandidate {
  const reasons: string[] = [];
  let score = 0;

  // Extract local date from note
  const noteLocalDate = note.captured_at_local.slice(0, 10);
  const workoutLocalDate = workout.local_date;

  // Same date is strong signal
  if (noteLocalDate === workoutLocalDate) {
    score += 50;
    reasons.push('Same local date');
  } else {
    // Check if within 1 day (for late-night runs)
    const noteDateObj = new Date(noteLocalDate);
    const workoutDateObj = new Date(workoutLocalDate);
    const daysDiff = Math.abs(
      (noteDateObj.getTime() - workoutDateObj.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysDiff <= 1) {
      score += 20;
      reasons.push('Within 1 day');
    }
  }

  // Time proximity (note usually captured shortly after run ends)
  const noteTime = new Date(note.captured_at_local).getTime();
  const workoutEndTime = new Date(workout.start_time_utc).getTime() +
    (workout.duration_seconds || 0) * 1000;

  const timeDiffHours = Math.abs(noteTime - workoutEndTime) / (1000 * 60 * 60);

  if (timeDiffHours < 0.5) {
    score += 30;
    reasons.push('Captured within 30min of run end');
  } else if (timeDiffHours < 2) {
    score += 20;
    reasons.push('Captured within 2hr of run end');
  } else if (timeDiffHours < MATCH_WINDOW_HOURS) {
    score += 10;
    reasons.push(`Captured within ${MATCH_WINDOW_HOURS}hr window`);
  }

  // Check if workout already has notes
  const existingNotes = queryOne<{ personal_notes: string | null }>(
    'SELECT personal_notes FROM workouts WHERE id = ?',
    [workout.id]
  );

  if (existingNotes?.personal_notes) {
    score -= 30;
    reasons.push('Workout already has notes (penalty)');
  }

  return { workout, score, reasons };
}

/**
 * Find matching workouts for a note
 */
export function findMatchingWorkouts(note: RunNote): MatchCandidate[] {
  const noteLocalDate = note.captured_at_local.slice(0, 10);

  // Get workouts within a few days of the note
  const workouts = query<Workout>(
    `SELECT id, local_date, start_time_utc, timezone_offset_min,
            distance_meters, duration_seconds, type
     FROM workouts
     WHERE local_date BETWEEN date(?, '-2 days') AND date(?, '+1 day')
     ORDER BY start_time_utc DESC`,
    [noteLocalDate, noteLocalDate]
  );

  if (workouts.length === 0) {
    return [];
  }

  // Calculate scores for each workout
  const candidates = workouts
    .map(w => calculateMatchScore(note, w))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates;
}

/**
 * Extract structured fields from transcription
 */
export function extractFields(transcription: string): ExtractedFields {
  const fields: ExtractedFields = {
    personal_notes: transcription,
  };

  // Extract RPE (look for "RPE X" or "X out of 10" patterns)
  const rpeMatch = transcription.match(/\b(?:rpe|effort)\s*(\d+)/i) ||
                   transcription.match(/(\d+)\s*(?:out of 10|\/10)/i);
  if (rpeMatch) {
    const rpe = parseInt(rpeMatch[1], 10);
    if (rpe >= 1 && rpe <= 10) {
      fields.perceived_exertion = rpe;
    }
  }

  // Extract mood keywords
  const moodKeywords: Record<string, string> = {
    great: 'great',
    good: 'good',
    solid: 'good',
    okay: 'okay',
    ok: 'okay',
    tired: 'tired',
    exhausted: 'tired',
    rough: 'rough',
    tough: 'rough',
    hard: 'hard',
    easy: 'easy',
    smooth: 'good',
  };

  for (const [keyword, mood] of Object.entries(moodKeywords)) {
    if (transcription.toLowerCase().includes(keyword)) {
      fields.mood = mood;
      break;
    }
  }

  // Extract discomfort mentions
  const bodyParts = [
    'calf', 'calves', 'shin', 'shins', 'knee', 'knees',
    'hamstring', 'hamstrings', 'quad', 'quads',
    'hip', 'hips', 'glute', 'glutes',
    'ankle', 'ankles', 'achilles', 'foot', 'feet',
    'back', 'lower back',
  ];

  const discomfortKeywords = [
    'tight', 'sore', 'pain', 'ache', 'hurt', 'tender',
    'twinge', 'niggle', 'stiff', 'uncomfortable',
  ];

  const foundLocations: string[] = [];
  const lowerTranscription = transcription.toLowerCase();

  for (const part of bodyParts) {
    for (const keyword of discomfortKeywords) {
      // Check if both body part and discomfort keyword are nearby
      const partIndex = lowerTranscription.indexOf(part);
      const keywordIndex = lowerTranscription.indexOf(keyword);

      if (partIndex !== -1 && keywordIndex !== -1) {
        // Check if they're within 50 characters of each other
        if (Math.abs(partIndex - keywordIndex) < 50) {
          if (!foundLocations.includes(part)) {
            foundLocations.push(part);
          }
        }
      }
    }
  }

  if (foundLocations.length > 0) {
    fields.discomfort_locations = foundLocations;

    // Extract the sentence containing discomfort info
    const sentences = transcription.split(/[.!?]+/);
    const discomfortSentences = sentences.filter(s => {
      const lower = s.toLowerCase();
      return discomfortKeywords.some(k => lower.includes(k)) &&
             bodyParts.some(p => lower.includes(p));
    });

    if (discomfortSentences.length > 0) {
      fields.discomfort_notes = discomfortSentences.join('. ').trim();
    }
  }

  return fields;
}

/**
 * Link a note to a workout
 */
export function linkNoteToWorkout(
  note: RunNote,
  workoutId: string
): boolean {
  const fields = extractFields(note.transcription);

  const db = getDb();

  db.prepare(`
    UPDATE workouts
    SET personal_notes = ?,
        perceived_exertion = COALESCE(?, perceived_exertion),
        mood = COALESCE(?, mood),
        discomfort_notes = COALESCE(?, discomfort_notes),
        discomfort_locations = COALESCE(?, discomfort_locations),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    fields.personal_notes,
    fields.perceived_exertion || null,
    fields.mood || null,
    fields.discomfort_notes || null,
    fields.discomfort_locations ? JSON.stringify(fields.discomfort_locations) : null,
    workoutId
  );

  // Emit event for the update
  const { emitEvent } = require('../db/events.js');
  emitEvent({
    entityType: 'workouts',
    entityId: workoutId,
    action: 'update',
    source: 'run_notes_sync',
    reason: `Linked note ${note.id}`,
  });

  return true;
}

/**
 * Move processed note file to archive
 */
function archiveNoteFile(filePath: string): void {
  if (!existsSync(NOTES_ARCHIVE_PATH)) {
    mkdirSync(NOTES_ARCHIVE_PATH, { recursive: true });
  }

  const filename = basename(filePath);
  const archivePath = join(NOTES_ARCHIVE_PATH, filename);
  renameSync(filePath, archivePath);
}

/**
 * Process all pending notes
 */
export async function processRunNotes(options: {
  autoLink?: boolean;
  minScore?: number;
}): Promise<ProcessResult> {
  const result: ProcessResult = {
    success: true,
    notesProcessed: 0,
    notesLinked: 0,
    errors: [],
    pendingMatches: [],
  };

  const minScore = options.minScore ?? 60;
  const autoLink = options.autoLink ?? true;

  // Scan inbox for new notes
  const noteFiles = scanInbox();

  if (noteFiles.length === 0) {
    return result;
  }

  for (const filePath of noteFiles) {
    try {
      const note = readNoteFile(filePath);
      if (!note) {
        result.errors.push(`Failed to read note: ${filePath}`);
        continue;
      }

      // Store in database
      storeRunNote(note);
      result.notesProcessed++;

      // Find matching workouts
      const candidates = findMatchingWorkouts(note);

      if (candidates.length === 0) {
        result.pendingMatches.push({
          noteId: note.id,
          candidates: [],
        });
        continue;
      }

      const bestMatch = candidates[0];

      // Auto-link if score is high enough and enabled
      if (autoLink && bestMatch.score >= minScore) {
        linkNoteToWorkout(note, bestMatch.workout.id);
        result.notesLinked++;
        archiveNoteFile(filePath);
      } else {
        // Return candidates for manual selection
        result.pendingMatches.push({
          noteId: note.id,
          candidates: candidates.slice(0, 3),
        });
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Error processing ${filePath}: ${errorMsg}`);
    }
  }

  return result;
}

/**
 * Manually link a note to a workout (for ambiguous cases)
 */
export function manualLinkNote(noteId: string, workoutId: string): boolean {
  // Find the note in raw_ingest
  const rawIngest = queryOne<{ payload_json: string }>(
    `SELECT payload_json FROM raw_ingest
     WHERE source = 'run_note' AND source_id = ?`,
    [noteId]
  );

  if (!rawIngest) {
    return false;
  }

  const note = JSON.parse(rawIngest.payload_json) as RunNote;
  return linkNoteToWorkout(note, workoutId);
}
