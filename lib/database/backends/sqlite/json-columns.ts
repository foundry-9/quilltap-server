/**
 * SQLite JSON Column Utilities
 *
 * Provides helpers for working with JSON data in SQLite columns,
 * including serialization, querying, and array operations.
 */

import { logger } from '@/lib/logger';

// ============================================================================
// JSON Serialization
// ============================================================================

/**
 * Serialize a value to JSON for storage in SQLite
 * Handles special cases like arrays and nested objects
 */
export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    logger.error('Failed to serialize value to JSON', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Parse a JSON string from SQLite back to a JavaScript value
 */
export function fromJson<T = unknown>(value: string | null): T | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    logger.error('Failed to parse JSON value', {
      value: typeof value === 'string' ? value.substring(0, 100) : value,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Safely parse JSON, returning null on failure instead of throwing
 */
export function fromJsonSafe<T = unknown>(value: string | null, defaultValue: T | null = null): T | null {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

// ============================================================================
// JSON Field Detection
// ============================================================================

/**
 * Determine if a field should be stored as JSON based on its type
 */
export function shouldStoreAsJson(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  // Arrays should always be JSON
  if (Array.isArray(value)) {
    return true;
  }

  // Objects (but not Date) should be JSON
  if (typeof value === 'object' && !(value instanceof Date)) {
    return true;
  }

  return false;
}

/**
 * Prepare a value for SQLite storage
 * Converts arrays and objects to JSON strings
 */
export function prepareForStorage(value: unknown): string | number | Buffer | null {
  if (value === undefined || value === null) {
    return null;
  }

  // Buffer pass-through (for BLOB columns)
  if (Buffer.isBuffer(value)) {
    return value;
  }

  // Boolean to integer
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  // Date to ISO string
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Array or object to JSON
  if (shouldStoreAsJson(value)) {
    return toJson(value);
  }

  // Strings and numbers pass through
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }

  // Fallback to JSON
  return toJson(value);
}

/**
 * Hydrate a row from SQLite, parsing JSON columns
 * @param row The raw row from SQLite
 * @param jsonColumns Array of column names that should be parsed as JSON
 */
export function hydrateRow<T = Record<string, unknown>>(
  row: Record<string, unknown>,
  jsonColumns: string[]
): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (jsonColumns.includes(key) && typeof value === 'string') {
      result[key] = fromJsonSafe(value);
    } else if (typeof value === 'number' && key.startsWith('is')) {
      // Boolean columns starting with 'is' (e.g., isFavorite)
      result[key] = value === 1;
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

// ============================================================================
// SQL Generation for JSON Queries
// ============================================================================

/**
 * Generate SQL for extracting a JSON value
 * @param column The column name containing JSON
 * @param path The JSON path (e.g., '$.name' or '$.address.city')
 */
export function jsonExtract(column: string, path: string): string {
  return `json_extract("${column}", '${path}')`;
}

/**
 * Generate SQL for checking if a JSON array contains a value
 * @param column The column name containing a JSON array
 * @param value The value to search for
 */
export function jsonArrayContains(column: string, value: unknown): { sql: string; params: unknown[] } {
  const jsonValue = typeof value === 'string' ? `"${value}"` : String(value);
  return {
    sql: `EXISTS (SELECT 1 FROM json_each("${column}") WHERE value = ?)`,
    params: [typeof value === 'string' ? value : jsonValue],
  };
}

/**
 * Generate SQL for checking if a JSON array contains any of the values
 * @param column The column name containing a JSON array
 * @param values The values to search for
 */
export function jsonArrayContainsAny(column: string, values: unknown[]): { sql: string; params: unknown[] } {
  if (values.length === 0) {
    return { sql: '0', params: [] };
  }

  const placeholders = values.map(() => '?').join(', ');
  return {
    sql: `EXISTS (SELECT 1 FROM json_each("${column}") WHERE value IN (${placeholders}))`,
    params: values,
  };
}

/**
 * Generate SQL for checking if any element in a JSON array matches a LIKE pattern
 * Used for regex-like text search on array fields like keywords
 * @param column The column name containing a JSON array
 * @param pattern The LIKE pattern to match (use % for wildcards)
 */
export function jsonArrayContainsLike(column: string, pattern: string): { sql: string; params: unknown[] } {
  return {
    sql: `EXISTS (SELECT 1 FROM json_each("${column}") WHERE value LIKE ?)`,
    params: [pattern],
  };
}

/**
 * Generate SQL for checking if a JSON array of objects contains an object
 * with a nested field matching a value.
 * Used for queries like: participants.characterId = 'some-id'
 * where participants is an array of objects each having a characterId field.
 *
 * @param column The column name containing a JSON array of objects
 * @param nestedPath The JSON path within each array element (e.g., 'characterId' or 'address.city')
 * @param value The value to match
 */
export function jsonArrayObjectMatch(
  column: string,
  nestedPath: string,
  value: unknown
): { sql: string; params: unknown[] } {
  // Use json_each to iterate array elements, then json_extract to get the nested field
  const jsonPath = '$.' + nestedPath;
  return {
    sql: `EXISTS (SELECT 1 FROM json_each("${column}") WHERE json_extract(value, '${jsonPath}') = ?)`,
    params: [value],
  };
}

/**
 * Generate SQL for checking if a JSON array of objects contains an object
 * with a nested field matching any of the values (IN query).
 *
 * @param column The column name containing a JSON array of objects
 * @param nestedPath The JSON path within each array element
 * @param values The values to match
 */
export function jsonArrayObjectMatchAny(
  column: string,
  nestedPath: string,
  values: unknown[]
): { sql: string; params: unknown[] } {
  if (values.length === 0) {
    return { sql: '0', params: [] };
  }

  const jsonPath = '$.' + nestedPath;
  const placeholders = values.map(() => '?').join(', ');
  return {
    sql: `EXISTS (SELECT 1 FROM json_each("${column}") WHERE json_extract(value, '${jsonPath}') IN (${placeholders}))`,
    params: values,
  };
}

/**
 * Generate SQL for inserting a value into a JSON array
 * @param column The column name containing a JSON array
 * @param value The value to insert
 */
export function jsonArrayPush(column: string): string {
  return `CASE
    WHEN "${column}" IS NULL THEN json_array(?)
    ELSE json_insert("${column}", '$[#]', json(?))
  END`;
}

/**
 * Generate SQL for removing a value from a JSON array
 * @param column The column name containing a JSON array
 * @param value The value to remove
 */
export function jsonArrayPull(column: string): { sql: string } {
  // This is more complex - we need to rebuild the array without the value
  return {
    sql: `(SELECT json_group_array(value) FROM json_each("${column}") WHERE value != ?)`,
  };
}

/**
 * Generate SQL for getting the length of a JSON array
 * @param column The column name containing a JSON array
 */
export function jsonArrayLength(column: string): string {
  return `json_array_length("${column}")`;
}

// ============================================================================
// BLOB Serialization (Float32 embeddings)
// ============================================================================

/**
 * Convert a number[] embedding to a Float32 BLOB Buffer for compact SQLite storage.
 * Float32 uses 4 bytes per dimension vs ~8-10 bytes per dimension in JSON text.
 */
export function embeddingToBlob(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

/**
 * Convert a Float32 BLOB Buffer back to a number[] embedding.
 */
export function blobToEmbedding(blob: Buffer): number[] {
  const float32 = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  return Array.from(float32);
}

// ============================================================================
// Type Conversion Helpers
// ============================================================================

/**
 * Convert a document for SQLite storage
 * Handles all field types appropriately
 */
export function documentToRow(
  document: Record<string, unknown>,
  jsonColumns: string[] = [],
  blobColumns: Set<string> = new Set()
): Record<string, string | number | Buffer | null> {
  const row: Record<string, string | number | Buffer | null> = {};

  for (const [key, value] of Object.entries(document)) {
    // BLOB columns: convert number[] to Float32 Buffer
    if (blobColumns.has(key) && Array.isArray(value) && value.length > 0 && typeof value[0] === 'number') {
      row[key] = embeddingToBlob(value as number[]);
    } else if (blobColumns.has(key) && Buffer.isBuffer(value)) {
      row[key] = value;
    } else if (jsonColumns.includes(key) || (shouldStoreAsJson(value) && !blobColumns.has(key))) {
      row[key] = toJson(value);
    } else {
      row[key] = prepareForStorage(value);
    }
  }

  return row;
}

/**
 * Convert a SQLite row back to a document
 */
export function rowToDocument<T = Record<string, unknown>>(
  row: Record<string, unknown>,
  jsonColumns: string[] = []
): T {
  return hydrateRow<T>(row, jsonColumns);
}

/**
 * Detect which columns in a schema should be treated as JSON
 */
export function detectJsonColumns(sampleDocument: Record<string, unknown>): string[] {
  const jsonColumns: string[] = [];

  for (const [key, value] of Object.entries(sampleDocument)) {
    if (shouldStoreAsJson(value)) {
      jsonColumns.push(key);
    }
  }

  return jsonColumns;
}

// ============================================================================
// Query Building Helpers
// ============================================================================

/**
 * Build a WHERE clause condition for a JSON field
 */
export function buildJsonCondition(
  column: string,
  path: string,
  operator: string,
  value: unknown
): { sql: string; params: unknown[] } {
  const extracted = jsonExtract(column, path);

  switch (operator) {
    case '$eq':
      return { sql: `${extracted} = ?`, params: [value] };
    case '$ne':
      return { sql: `${extracted} != ?`, params: [value] };
    case '$gt':
      return { sql: `${extracted} > ?`, params: [value] };
    case '$gte':
      return { sql: `${extracted} >= ?`, params: [value] };
    case '$lt':
      return { sql: `${extracted} < ?`, params: [value] };
    case '$lte':
      return { sql: `${extracted} <= ?`, params: [value] };
    case '$in':
      if (!Array.isArray(value) || value.length === 0) {
        return { sql: '0', params: [] };
      }
      const placeholders = value.map(() => '?').join(', ');
      return { sql: `${extracted} IN (${placeholders})`, params: value };
    case '$exists':
      return {
        sql: value ? `${extracted} IS NOT NULL` : `${extracted} IS NULL`,
        params: [],
      };
    default:
      return { sql: `${extracted} = ?`, params: [value] };
  }
}
