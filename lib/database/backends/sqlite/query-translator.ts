/**
 * SQLite Query Translator
 *
 * Translates the abstract query filter format to SQLite SQL statements.
 * Handles nested fields, JSON columns, and MongoDB-style operators.
 */

import { QueryFilter, QueryOptions, SortSpec, UpdateSpec, UpdateOperators } from '../../interfaces';
import { jsonExtract, jsonArrayContains, jsonArrayContainsAny, jsonArrayObjectMatch, jsonArrayObjectMatchAny, toJson } from './json-columns';
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

export interface TranslatedQuery {
  sql: string;
  params: unknown[];
}

export interface TranslatedUpdate {
  setClauses: string[];
  params: unknown[];
}

// ============================================================================
// Filter Translation
// ============================================================================

/**
 * Check if a value is a comparison condition object
 */
function isComparisonCondition(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return keys.some(k => k.startsWith('$'));
}

/**
 * Translate a single field filter to SQL
 */
function translateFieldFilter(
  field: string,
  value: unknown,
  jsonColumns: Set<string>,
  arrayColumns: Set<string> = new Set()
): TranslatedQuery {
  const clauses: string[] = [];
  const params: unknown[] = [];

  // Handle dot notation for nested fields
  const parts = field.split('.');
  const isNestedInJson = parts.length > 1 && jsonColumns.has(parts[0]);
  const isNestedInArray = parts.length > 1 && arrayColumns.has(parts[0]);

  // Special handling for querying nested fields within array columns
  // e.g., participants.characterId where participants is an array of objects
  if (isNestedInArray) {
    const column = parts[0];
    const nestedPath = parts.slice(1).join('.');

    // Handle array object queries
    if (value === null || value === undefined) {
      // Check if any element has null/undefined for this field
      // This is complex - for now, treat as "no match" for null queries on array elements
      return { sql: '0', params: [] };
    } else if (isComparisonCondition(value)) {
      // Handle comparison operators for array object queries
      const conditions = value as Record<string, unknown>;

      for (const [op, opValue] of Object.entries(conditions)) {
        switch (op) {
          case '$eq': {
            const { sql, params: p } = jsonArrayObjectMatch(column, nestedPath, opValue);
            clauses.push(sql);
            params.push(...p);
            break;
          }
          case '$in': {
            if (Array.isArray(opValue) && opValue.length > 0) {
              const { sql, params: p } = jsonArrayObjectMatchAny(column, nestedPath, opValue);
              clauses.push(sql);
              params.push(...p);
            } else {
              clauses.push('0');
            }
            break;
          }
          case '$ne': {
            // NOT EXISTS for not equal
            const { sql } = jsonArrayObjectMatch(column, nestedPath, opValue);
            clauses.push(`NOT ${sql}`);
            params.push(opValue);
            break;
          }
          default:
            logger.warn('Unsupported operator for array object query', { operator: op, field });
            clauses.push('0');
        }
      }
    } else {
      // Simple equality - e.g., participants.characterId = 'some-id'
      const { sql, params: p } = jsonArrayObjectMatch(column, nestedPath, value);
      clauses.push(sql);
      params.push(...p);
    }

    return {
      sql: clauses.length > 0 ? clauses.join(' AND ') : '1',
      params,
    };
  }

  // Determine the column name and JSON path for non-array JSON columns
  let columnExpr: string;
  if (isNestedInJson) {
    const column = parts[0];
    const jsonPath = '$.' + parts.slice(1).join('.');
    columnExpr = jsonExtract(column, jsonPath);
  } else {
    columnExpr = `"${field}"`;
  }

  // Handle different value types
  if (value === null || value === undefined) {
    clauses.push(`${columnExpr} IS NULL`);
  } else if (isComparisonCondition(value)) {
    // Handle comparison operators
    const conditions = value as Record<string, unknown>;

    for (const [op, opValue] of Object.entries(conditions)) {
      switch (op) {
        case '$eq':
          clauses.push(`${columnExpr} = ?`);
          params.push(opValue);
          break;

        case '$ne':
          clauses.push(`${columnExpr} != ?`);
          params.push(opValue);
          break;

        case '$gt':
          clauses.push(`${columnExpr} > ?`);
          params.push(opValue);
          break;

        case '$gte':
          clauses.push(`${columnExpr} >= ?`);
          params.push(opValue);
          break;

        case '$lt':
          clauses.push(`${columnExpr} < ?`);
          params.push(opValue);
          break;

        case '$lte':
          clauses.push(`${columnExpr} <= ?`);
          params.push(opValue);
          break;

        case '$in':
          if (Array.isArray(opValue) && opValue.length > 0) {
            // Check if we're querying an array column
            if (jsonColumns.has(field)) {
              // Search within JSON array
              const { sql, params: p } = jsonArrayContainsAny(field, opValue);
              clauses.push(sql);
              params.push(...p);
            } else {
              // Standard IN query
              const placeholders = opValue.map(() => '?').join(', ');
              clauses.push(`${columnExpr} IN (${placeholders})`);
              params.push(...opValue);
            }
          } else {
            // Empty $in always false
            clauses.push('0');
          }
          break;

        case '$nin':
          if (Array.isArray(opValue) && opValue.length > 0) {
            const placeholders = opValue.map(() => '?').join(', ');
            clauses.push(`${columnExpr} NOT IN (${placeholders})`);
            params.push(...opValue);
          }
          // Empty $nin is always true, no clause needed
          break;

        case '$exists':
          if (opValue) {
            clauses.push(`${columnExpr} IS NOT NULL`);
          } else {
            clauses.push(`${columnExpr} IS NULL`);
          }
          break;

        case '$regex':
          // SQLite LIKE with pattern conversion (limited regex support)
          // Convert basic regex patterns to LIKE
          let pattern = String(opValue);
          pattern = pattern.replace(/\.\*/g, '%');
          pattern = pattern.replace(/\./g, '_');
          clauses.push(`${columnExpr} LIKE ?`);
          params.push(pattern);
          break;

        default:
          logger.warn('Unknown query operator', { operator: op, field });
      }
    }
  } else if (Array.isArray(value)) {
    // Array equality - check if JSON array contains all values
    // This is a special case for tags: ['tag1', 'tag2']
    for (const item of value) {
      const { sql, params: p } = jsonArrayContains(field, item);
      clauses.push(sql);
      params.push(...p);
    }
  } else {
    // Simple equality
    clauses.push(`${columnExpr} = ?`);
    params.push(value);
  }

  return {
    sql: clauses.length > 0 ? clauses.join(' AND ') : '1',
    params,
  };
}

/**
 * Translate a query filter to SQL WHERE clause
 */
export function translateFilter(
  filter: QueryFilter,
  jsonColumns: Set<string> = new Set(),
  arrayColumns: Set<string> = new Set()
): TranslatedQuery {
  if (!filter || Object.keys(filter).length === 0) {
    return { sql: '1', params: [] };
  }

  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' && Array.isArray(value)) {
      // Logical AND
      const subClauses: string[] = [];
      for (const subFilter of value) {
        const translated = translateFilter(subFilter as QueryFilter, jsonColumns, arrayColumns);
        subClauses.push(`(${translated.sql})`);
        params.push(...translated.params);
      }
      if (subClauses.length > 0) {
        clauses.push(`(${subClauses.join(' AND ')})`);
      }
    } else if (key === '$or' && Array.isArray(value)) {
      // Logical OR
      const subClauses: string[] = [];
      for (const subFilter of value) {
        const translated = translateFilter(subFilter as QueryFilter, jsonColumns, arrayColumns);
        subClauses.push(`(${translated.sql})`);
        params.push(...translated.params);
      }
      if (subClauses.length > 0) {
        clauses.push(`(${subClauses.join(' OR ')})`);
      }
    } else if (key === '$not' && typeof value === 'object' && !Array.isArray(value)) {
      // Logical NOT
      const translated = translateFilter(value as QueryFilter, jsonColumns, arrayColumns);
      clauses.push(`NOT (${translated.sql})`);
      params.push(...translated.params);
    } else {
      // Regular field filter
      const translated = translateFieldFilter(key, value, jsonColumns, arrayColumns);
      clauses.push(translated.sql);
      params.push(...translated.params);
    }
  }

  return {
    sql: clauses.length > 0 ? clauses.join(' AND ') : '1',
    params,
  };
}

// ============================================================================
// Sort Translation
// ============================================================================

/**
 * Translate sort specification to SQL ORDER BY clause
 */
export function translateSort(sort?: SortSpec): string {
  if (!sort || Object.keys(sort).length === 0) {
    return '';
  }

  const orderClauses: string[] = [];

  for (const [field, direction] of Object.entries(sort)) {
    const dir = direction === 'desc' || direction === -1 ? 'DESC' : 'ASC';
    orderClauses.push(`"${field}" ${dir}`);
  }

  return orderClauses.length > 0 ? `ORDER BY ${orderClauses.join(', ')}` : '';
}

// ============================================================================
// Pagination Translation
// ============================================================================

/**
 * Translate pagination options to SQL LIMIT/OFFSET
 */
export function translatePagination(options?: QueryOptions): string {
  const parts: string[] = [];

  if (options?.limit !== undefined && options.limit > 0) {
    parts.push(`LIMIT ${options.limit}`);
  }

  if (options?.skip !== undefined && options.skip > 0) {
    parts.push(`OFFSET ${options.skip}`);
  }

  return parts.join(' ');
}

// ============================================================================
// Update Translation
// ============================================================================

/**
 * Check if an update spec uses operators or is a plain object
 */
function hasUpdateOperators(update: UpdateSpec<unknown>): update is UpdateOperators<unknown> {
  if (typeof update !== 'object' || update === null) {
    return false;
  }

  const keys = Object.keys(update);
  return keys.some(k => k.startsWith('$'));
}

/**
 * Translate an update specification to SQL SET clauses
 */
export function translateUpdate(
  update: UpdateSpec<unknown>,
  jsonColumns: Set<string> = new Set()
): TranslatedUpdate {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (hasUpdateOperators(update)) {
    // Handle MongoDB-style update operators

    // $set - set fields to values
    if (update.$set) {
      for (const [field, value] of Object.entries(update.$set)) {
        if (jsonColumns.has(field) || (typeof value === 'object' && value !== null)) {
          setClauses.push(`"${field}" = ?`);
          params.push(toJson(value));
        } else {
          setClauses.push(`"${field}" = ?`);
          params.push(value);
        }
      }
    }

    // $unset - remove fields (set to null in SQLite)
    if (update.$unset) {
      for (const field of Object.keys(update.$unset)) {
        setClauses.push(`"${field}" = NULL`);
      }
    }

    // $inc - increment numeric fields
    if (update.$inc) {
      for (const [field, amount] of Object.entries(update.$inc)) {
        setClauses.push(`"${field}" = "${field}" + ?`);
        params.push(amount);
      }
    }

    // $push - append to array (JSON column)
    if (update.$push) {
      for (const [field, value] of Object.entries(update.$push)) {
        setClauses.push(`"${field}" = CASE
          WHEN "${field}" IS NULL THEN json_array(?)
          ELSE json_insert("${field}", '$[#]', json(?))
        END`);
        const jsonValue = toJson(value);
        params.push(value, jsonValue);
      }
    }

    // $pull - remove from array (JSON column)
    if (update.$pull) {
      for (const [field, value] of Object.entries(update.$pull)) {
        setClauses.push(`"${field}" = (SELECT json_group_array(value) FROM json_each("${field}") WHERE value != ?)`);
        params.push(typeof value === 'string' ? value : toJson(value));
      }
    }

    // $addToSet - add unique value to array
    if (update.$addToSet) {
      for (const [field, value] of Object.entries(update.$addToSet)) {
        setClauses.push(`"${field}" = CASE
          WHEN "${field}" IS NULL THEN json_array(?)
          WHEN NOT EXISTS (SELECT 1 FROM json_each("${field}") WHERE value = ?) THEN json_insert("${field}", '$[#]', json(?))
          ELSE "${field}"
        END`);
        const jsonValue = toJson(value);
        params.push(value, value, jsonValue);
      }
    }
  } else {
    // Plain object update - set all fields
    for (const [field, value] of Object.entries(update)) {
      // Skip id and createdAt - these shouldn't be updated
      if (field === 'id' || field === 'createdAt') {
        continue;
      }

      if (jsonColumns.has(field) || (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date))) {
        setClauses.push(`"${field}" = ?`);
        params.push(toJson(value));
      } else if (Array.isArray(value)) {
        setClauses.push(`"${field}" = ?`);
        params.push(toJson(value));
      } else if (typeof value === 'boolean') {
        setClauses.push(`"${field}" = ?`);
        params.push(value ? 1 : 0);
      } else {
        setClauses.push(`"${field}" = ?`);
        params.push(value);
      }
    }
  }

  return { setClauses, params };
}

// ============================================================================
// Full Query Building
// ============================================================================

/**
 * Build a complete SELECT query
 */
export function buildSelectQuery(
  table: string,
  filter: QueryFilter,
  options?: QueryOptions,
  jsonColumns?: Set<string>,
  arrayColumns?: Set<string>
): TranslatedQuery {
  const whereClause = translateFilter(filter, jsonColumns, arrayColumns);
  const orderBy = translateSort(options?.sort);
  const pagination = translatePagination(options);

  let sql = `SELECT * FROM "${table}" WHERE ${whereClause.sql}`;

  if (orderBy) {
    sql += ' ' + orderBy;
  }

  if (pagination) {
    sql += ' ' + pagination;
  }

  return { sql, params: whereClause.params };
}

/**
 * Build a SELECT COUNT query
 */
export function buildCountQuery(
  table: string,
  filter: QueryFilter,
  jsonColumns?: Set<string>,
  arrayColumns?: Set<string>
): TranslatedQuery {
  const whereClause = translateFilter(filter, jsonColumns, arrayColumns);
  return {
    sql: `SELECT COUNT(*) as count FROM "${table}" WHERE ${whereClause.sql}`,
    params: whereClause.params,
  };
}

/**
 * Build an UPDATE query
 */
export function buildUpdateQuery(
  table: string,
  filter: QueryFilter,
  update: UpdateSpec<unknown>,
  jsonColumns?: Set<string>,
  arrayColumns?: Set<string>
): TranslatedQuery {
  const whereClause = translateFilter(filter, jsonColumns, arrayColumns);
  const updateClause = translateUpdate(update, jsonColumns);

  if (updateClause.setClauses.length === 0) {
    throw new Error('Update must specify at least one field to update');
  }

  const sql = `UPDATE "${table}" SET ${updateClause.setClauses.join(', ')} WHERE ${whereClause.sql}`;

  return {
    sql,
    params: [...updateClause.params, ...whereClause.params],
  };
}

/**
 * Build a DELETE query
 */
export function buildDeleteQuery(
  table: string,
  filter: QueryFilter,
  jsonColumns?: Set<string>,
  arrayColumns?: Set<string>
): TranslatedQuery {
  const whereClause = translateFilter(filter, jsonColumns, arrayColumns);

  return {
    sql: `DELETE FROM "${table}" WHERE ${whereClause.sql}`,
    params: whereClause.params,
  };
}
