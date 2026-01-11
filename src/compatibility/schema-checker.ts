/**
 * Schema Checker - Verify schema meets requirements
 *
 * Checks:
 * - Required tables exist
 * - Required columns exist with correct types
 * - Schema version tracking
 */

import { query, queryOne } from '../db/client.js';
import type { PromptContract } from './contracts.js';

export interface SchemaInfo {
  tables: Map<string, TableInfo>;
  version: string | null;
}

export interface TableInfo {
  name: string;
  columns: Map<string, ColumnInfo>;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  default_value: string | null;
}

export interface SchemaCheckResult {
  valid: boolean;
  missing_tables: string[];
  missing_columns: Array<{ table: string; column: string }>;
  type_mismatches: Array<{
    table: string;
    column: string;
    expected: string;
    actual: string;
  }>;
  nullable_mismatches: Array<{
    table: string;
    column: string;
    expected_nullable: boolean;
    actual_nullable: boolean;
  }>;
}

/**
 * Get current schema information from the database
 */
export function getSchemaInfo(): SchemaInfo {
  // Get all tables
  const tableRows = query<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  );

  const tables = new Map<string, TableInfo>();

  for (const tableRow of tableRows) {
    const columns = new Map<string, ColumnInfo>();

    // Get column info using PRAGMA
    const columnRows = query<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>(`PRAGMA table_info('${tableRow.name}')`);

    for (const col of columnRows) {
      columns.set(col.name, {
        name: col.name,
        type: normalizeType(col.type),
        nullable: col.notnull === 0,
        pk: col.pk === 1,
        default_value: col.dflt_value,
      });
    }

    tables.set(tableRow.name, {
      name: tableRow.name,
      columns,
    });
  }

  // Get schema version
  const versionRow = queryOne<{ version: string }>(
    `SELECT version FROM schema_versions ORDER BY applied_at DESC LIMIT 1`
  );

  return {
    tables,
    version: versionRow?.version ?? null,
  };
}

/**
 * Check schema against contract requirements
 */
export function checkSchemaForContract(
  contract: PromptContract,
  schemaInfo?: SchemaInfo
): SchemaCheckResult {
  const schema = schemaInfo ?? getSchemaInfo();

  const result: SchemaCheckResult = {
    valid: true,
    missing_tables: [],
    missing_columns: [],
    type_mismatches: [],
    nullable_mismatches: [],
  };

  // Check required tables
  for (const tableName of contract.required_tables) {
    if (!schema.tables.has(tableName)) {
      result.missing_tables.push(tableName);
      result.valid = false;
    }
  }

  // Check required fields
  for (const tableReq of contract.required_fields) {
    const table = schema.tables.get(tableReq.table);

    if (!table) {
      // Table already flagged as missing
      continue;
    }

    for (const fieldReq of tableReq.fields) {
      const column = table.columns.get(fieldReq.name);

      if (!column) {
        result.missing_columns.push({
          table: tableReq.table,
          column: fieldReq.name,
        });
        result.valid = false;
        continue;
      }

      // Check type (flexible matching)
      if (!typesMatch(fieldReq.type, column.type)) {
        result.type_mismatches.push({
          table: tableReq.table,
          column: fieldReq.name,
          expected: fieldReq.type,
          actual: column.type,
        });
        result.valid = false;
      }

      // Check nullability (only flag if schema is stricter than expected)
      if (fieldReq.nullable === false && column.nullable === true) {
        result.nullable_mismatches.push({
          table: tableReq.table,
          column: fieldReq.name,
          expected_nullable: fieldReq.nullable,
          actual_nullable: column.nullable,
        });
        // Don't fail for nullable mismatch - just warn
      }
    }
  }

  return result;
}

/**
 * Check all registered contracts against schema
 */
export function checkAllContracts(
  contracts: PromptContract[]
): Map<string, SchemaCheckResult> {
  const schema = getSchemaInfo();
  const results = new Map<string, SchemaCheckResult>();

  for (const contract of contracts) {
    results.set(contract.prompt_name, checkSchemaForContract(contract, schema));
  }

  return results;
}

/**
 * Get current schema version
 */
export function getCurrentSchemaVersion(): string | null {
  const row = queryOne<{ version: string }>(
    `SELECT version FROM schema_versions ORDER BY applied_at DESC LIMIT 1`
  );
  return row?.version ?? null;
}

/**
 * Record a schema version
 */
export function recordSchemaVersion(
  version: string,
  description?: string,
  migrationHash?: string
): void {
  const { execute } = require('../db/client.js');
  execute(
    `INSERT INTO schema_versions (version, applied_at, description, migration_hash)
     VALUES (?, ?, ?, ?)`,
    [version, new Date().toISOString(), description ?? null, migrationHash ?? null]
  );
}

/**
 * Format schema check result for display
 */
export function formatSchemaCheckResult(
  promptName: string,
  result: SchemaCheckResult
): string {
  const lines: string[] = [
    `Schema check for "${promptName}": ${result.valid ? 'PASS' : 'FAIL'}`,
  ];

  if (result.missing_tables.length > 0) {
    lines.push('');
    lines.push('Missing tables:');
    result.missing_tables.forEach(t => lines.push(`  - ${t}`));
  }

  if (result.missing_columns.length > 0) {
    lines.push('');
    lines.push('Missing columns:');
    result.missing_columns.forEach(c =>
      lines.push(`  - ${c.table}.${c.column}`)
    );
  }

  if (result.type_mismatches.length > 0) {
    lines.push('');
    lines.push('Type mismatches:');
    result.type_mismatches.forEach(m =>
      lines.push(`  - ${m.table}.${m.column}: expected ${m.expected}, got ${m.actual}`)
    );
  }

  if (result.nullable_mismatches.length > 0) {
    lines.push('');
    lines.push('Nullable warnings:');
    result.nullable_mismatches.forEach(m =>
      lines.push(`  - ${m.table}.${m.column}: expected ${m.expected_nullable ? 'nullable' : 'not null'}, got ${m.actual_nullable ? 'nullable' : 'not null'}`)
    );
  }

  return lines.join('\n');
}

// Helper functions

function normalizeType(sqliteType: string): string {
  const upper = sqliteType.toUpperCase();

  if (upper.includes('INT')) return 'integer';
  if (upper.includes('CHAR') || upper.includes('TEXT') || upper.includes('CLOB')) return 'text';
  if (upper.includes('REAL') || upper.includes('FLOA') || upper.includes('DOUB')) return 'real';
  if (upper.includes('BLOB')) return 'blob';

  return 'any';
}

function typesMatch(expected: string, actual: string): boolean {
  if (expected === 'any') return true;
  if (expected === actual) return true;

  // Integer and real are compatible in some cases
  if (expected === 'integer' && actual === 'real') return true;
  if (expected === 'real' && actual === 'integer') return true;

  return false;
}
