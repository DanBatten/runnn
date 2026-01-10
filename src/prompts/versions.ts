/**
 * Prompt Versioning - Track and manage coaching prompt versions
 *
 * Each prompt is versioned with:
 * - Semantic version
 * - Content hash
 * - Required schema fields
 * - Required tools
 * - Changelog
 */

import { query, queryOne, generateId, insertWithEvent } from '../db/client.js';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface PromptVersion {
  id: string;
  name: string;
  version: number;
  hash: string;
  changelog: string | null;
  required_fields: string[];
  required_tools: string[];
  created_at: string;
}

interface PromptVersionRow {
  id: string;
  name: string;
  version: number;
  hash: string;
  changelog: string | null;
  required_fields: string | null;
  required_tools: string | null;
  created_at: string;
}

/**
 * Hash prompt content for change detection
 */
export function hashPromptContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Register a new prompt version
 */
export function registerPromptVersion(
  name: string,
  content: string,
  options?: {
    changelog?: string;
    required_fields?: string[];
    required_tools?: string[];
  }
): string {
  const hash = hashPromptContent(content);

  // Check if this exact version already exists
  const existing = queryOne<PromptVersionRow>(
    'SELECT * FROM prompt_versions WHERE name = ? AND hash = ?',
    [name, hash]
  );

  if (existing) {
    return existing.id;
  }

  // Get current version number
  const latestVersion = queryOne<{ max_version: number }>(
    'SELECT MAX(version) as max_version FROM prompt_versions WHERE name = ?',
    [name]
  );

  const newVersion = (latestVersion?.max_version ?? 0) + 1;
  const id = generateId();

  insertWithEvent(
    'prompt_versions',
    {
      id,
      name,
      version: newVersion,
      hash,
      changelog: options?.changelog ?? null,
      required_fields: options?.required_fields ? JSON.stringify(options.required_fields) : null,
      required_tools: options?.required_tools ? JSON.stringify(options.required_tools) : null,
    },
    { source: 'prompt_version_register' }
  );

  return id;
}

/**
 * Get the latest version of a prompt
 */
export function getLatestPromptVersion(name: string): PromptVersion | null {
  const row = queryOne<PromptVersionRow>(
    'SELECT * FROM prompt_versions WHERE name = ? ORDER BY version DESC LIMIT 1',
    [name]
  );

  return row ? parsePromptVersionRow(row) : null;
}

/**
 * Get a specific prompt version
 */
export function getPromptVersion(name: string, version: number): PromptVersion | null {
  const row = queryOne<PromptVersionRow>(
    'SELECT * FROM prompt_versions WHERE name = ? AND version = ?',
    [name, version]
  );

  return row ? parsePromptVersionRow(row) : null;
}

/**
 * Get prompt version by ID
 */
export function getPromptVersionById(id: string): PromptVersion | null {
  const row = queryOne<PromptVersionRow>(
    'SELECT * FROM prompt_versions WHERE id = ?',
    [id]
  );

  return row ? parsePromptVersionRow(row) : null;
}

/**
 * Get all versions of a prompt
 */
export function getPromptVersionHistory(name: string): PromptVersion[] {
  const rows = query<PromptVersionRow>(
    'SELECT * FROM prompt_versions WHERE name = ? ORDER BY version DESC',
    [name]
  );

  return rows.map(parsePromptVersionRow);
}

/**
 * List all prompts with their latest versions
 */
export function listPrompts(): Array<{ name: string; latest_version: number; hash: string }> {
  const rows = query<{ name: string; version: number; hash: string }>(
    `SELECT name, MAX(version) as version, hash
     FROM prompt_versions
     GROUP BY name
     ORDER BY name`
  );

  return rows.map(r => ({
    name: r.name,
    latest_version: r.version,
    hash: r.hash,
  }));
}

/**
 * Check if prompt content has changed since last registration
 */
export function hasPromptChanged(name: string, content: string): boolean {
  const latest = getLatestPromptVersion(name);
  if (!latest) return true;

  const currentHash = hashPromptContent(content);
  return currentHash !== latest.hash;
}

/**
 * Load prompt content from file and register if changed
 */
export function loadAndRegisterPrompt(
  name: string,
  filePath: string,
  options?: {
    required_fields?: string[];
    required_tools?: string[];
  }
): { id: string; changed: boolean } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const changed = hasPromptChanged(name, content);

  const id = registerPromptVersion(name, content, {
    changelog: changed ? 'Content updated' : undefined,
    required_fields: options?.required_fields,
    required_tools: options?.required_tools,
  });

  return { id, changed };
}

/**
 * Load all prompts from the prompts directory
 */
export function loadAllPrompts(promptsDir: string): {
  loaded: number;
  changed: string[];
} {
  const changed: string[] = [];
  let loaded = 0;

  const files = fs.readdirSync(promptsDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const name = path.basename(file, '.md');
    const filePath = path.join(promptsDir, file);
    const result = loadAndRegisterPrompt(name, filePath);

    loaded++;
    if (result.changed) {
      changed.push(name);
    }
  }

  return { loaded, changed };
}

/**
 * Check compatibility between prompts and schema
 */
export function checkPromptCompatibility(promptVersionId: string): {
  compatible: boolean;
  missing_fields: string[];
  missing_tools: string[];
} {
  const version = getPromptVersionById(promptVersionId);
  if (!version) {
    return { compatible: false, missing_fields: [], missing_tools: [] };
  }

  // This would check against actual schema - simplified for now
  // In a full implementation, we'd query PRAGMA table_info and check available tools

  return {
    compatible: true,
    missing_fields: [],
    missing_tools: [],
  };
}

/**
 * Parse a database row into PromptVersion
 */
function parsePromptVersionRow(row: PromptVersionRow): PromptVersion {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    hash: row.hash,
    changelog: row.changelog,
    required_fields: row.required_fields ? JSON.parse(row.required_fields) : [],
    required_tools: row.required_tools ? JSON.parse(row.required_tools) : [],
    created_at: row.created_at,
  };
}
