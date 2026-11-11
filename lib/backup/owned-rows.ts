/**
 * Every row a user owns, for the two operations that must not miss one:
 * backup and data deletion (#202).
 *
 * The hydrated `findAll()` of a store-backed repository drops a character,
 * project or group whose document store cannot be read, so enumerating with it
 * silently left such a row out of a backup (with all its memories) and behind
 * after a replace restore or "delete all my data". Here the slim rows are read
 * raw and the hydrated ones laid over them: a row that hydrates comes back
 * whole, one that does not comes back as its raw row and is reported.
 *
 * LLM logs are read page by page rather than capped at the newest 10,000.
 *
 * @module backup/owned-rows
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import type { Character, Project, Group, LLMLog } from '@/lib/schemas/types';

const moduleLogger = logger.child({ module: 'backup:owned-rows' });

const LLM_LOG_PAGE = 1000;

export interface OwnedRows<T> {
  /** Every owned row: hydrated where its store reads, raw where it does not. */
  rows: T[];
  /** Ids of the rows whose store could not be read (carried raw). */
  unreadable: string[];
}

/** Lay the hydrated rows over the raw ones, keeping raw order. */
function overlay<T extends { id: string }>(raw: T[], hydrated: T[], kind: string): OwnedRows<T> {
  const byId = new Map(hydrated.map((row) => [row.id, row]));
  const unreadable: string[] = [];
  const rows = raw.map((row) => {
    const whole = byId.get(row.id);
    if (whole) return whole;
    unreadable.push(row.id);
    return row;
  });
  // A hydrated row the raw read did not return (a test double, a race) is still owned.
  const rawIds = new Set(raw.map((row) => row.id));
  for (const row of hydrated) if (!rawIds.has(row.id)) rows.push(row);
  if (unreadable.length > 0) {
    moduleLogger.warn('Owned rows whose store could not be read; carried as raw rows', { kind, ids: unreadable });
  }
  return { rows, unreadable };
}

export async function readOwnedCharacters(userId: string): Promise<OwnedRows<Character>> {
  const [raw, hydrated] = await Promise.all([
    getRepositories().characters.findAllRaw(),
    getUserRepositories(userId).characters.findAll(),
  ]);
  const owned = (raw as unknown as Character[]).filter((row) => row.userId === userId);
  return overlay(owned, hydrated, 'character');
}

/** Projects are global (no owner column): every project is the user's. */
export async function readOwnedProjects(userId: string): Promise<OwnedRows<Project>> {
  const [raw, hydrated] = await Promise.all([
    getRepositories().projects.findAllRaw(),
    getUserRepositories(userId).projects.findAll(),
  ]);
  return overlay(raw as unknown as Project[], hydrated, 'project');
}

/** Groups are global (no owner column): every group is the user's. */
export async function readOwnedGroups(userId: string): Promise<OwnedRows<Group>> {
  const [raw, hydrated] = await Promise.all([
    getRepositories().groups.findAllRaw(),
    getUserRepositories(userId).groups.findAll(),
  ]);
  return overlay(raw as unknown as Group[], hydrated, 'group');
}

/** Every LLM log of the user, newest first, read a page at a time. */
export async function readAllLlmLogs(userId: string): Promise<LLMLog[]> {
  const repo = getRepositories().llmLogs;
  const logs: LLMLog[] = [];
  for (let offset = 0; ; offset += LLM_LOG_PAGE) {
    const page = await repo.findByUserId(userId, LLM_LOG_PAGE, offset);
    logs.push(...page);
    if (page.length < LLM_LOG_PAGE) break;
  }
  moduleLogger.debug('Read every LLM log', { userId, count: logs.length });
  return logs;
}

/** A manifest warning naming rows carried without their store. */
export function unreadableStoreWarning(kind: string, unreadable: string[]): string | null {
  if (unreadable.length === 0) return null;
  return `${unreadable.length} ${kind}${unreadable.length === 1 ? '' : 's'} could not be read from ${unreadable.length === 1 ? 'its' : 'their'} document store and ${unreadable.length === 1 ? 'was' : 'were'} backed up as the bare row: ${unreadable.join(', ')}`;
}
