/**
 * Sort keys accepted by the memory list endpoint.
 *
 * Only real, sortable memory columns are admitted; the value reaches an
 * ORDER BY clause, so anything else is refused at the route.
 *
 * @module lib/memory/list-sort
 */

import { z } from 'zod';

export const MEMORY_LIST_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'importance',
  'reinforcedImportance',
  'reinforcementCount',
  'lastAccessedAt',
  'occurredAt',
] as const;

export const MemoryListSortSchema = z.enum(MEMORY_LIST_SORT_FIELDS);
export const MemoryListSortOrderSchema = z.enum(['asc', 'desc']);
