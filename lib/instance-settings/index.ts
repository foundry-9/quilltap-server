/**
 * Instance Settings — Application-Wide Key/Value Store
 *
 * The `instance_settings` table is a tiny key/value store for configuration
 * that belongs to the *server instance* rather than to any particular user.
 * The version guard (`lib/startup/version-guard.ts`) and a couple of
 * startup migrations already use it; this module adds typed helpers for
 * the memory-extraction knobs.
 *
 * Why instance-wide rather than per-user: Quilltap is single-user per
 * instance, but the `chat_settings` table accumulates orphan rows over a
 * database's lifetime (old test users, migrated accounts, etc.). Reading
 * a "knob" from chat_settings means picking the right row out of the pile,
 * which is brittle. The processor concurrency cap and per-hour extraction
 * limits both affect the single background processor that this server
 * runs; they're a property of the instance, not of any user.
 */

import { rawQuery } from '@/lib/database/manager';
import { logger } from '@/lib/logger';
import { MemoryExtractionLimitsSchema, type MemoryExtractionLimits } from '@/lib/schemas/settings.types';

const KEY_MEMORY_EXTRACTION_CONCURRENCY = 'memoryExtractionConcurrency';
const KEY_MEMORY_EXTRACTION_LIMITS = 'memoryExtractionLimits';

const DEFAULT_MEMORY_EXTRACTION_CONCURRENCY = 1;
const DEFAULT_MEMORY_EXTRACTION_LIMITS: MemoryExtractionLimits = {
  enabled: false,
  maxPerHour: 20,
  softStartFraction: 0.7,
  softFloor: 0.7,
};

async function readSetting(key: string): Promise<string | null> {
  try {
    const rows = (await rawQuery<Array<{ value: string }>>(
      'SELECT "value" FROM "instance_settings" WHERE "key" = ?',
      [key],
    )) ?? [];
    return rows[0]?.value ?? null;
  } catch (error) {
    logger.warn('[InstanceSettings] Failed to read setting', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  await rawQuery(
    'INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?) ' +
      'ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"',
    [key, value],
  );
}

/**
 * Read the per-instance MEMORY_EXTRACTION concurrency cap. Returns the
 * documented default (1) when the setting hasn't been written yet.
 */
export async function getMemoryExtractionConcurrency(): Promise<number> {
  const raw = await readSetting(KEY_MEMORY_EXTRACTION_CONCURRENCY);
  if (raw === null) return DEFAULT_MEMORY_EXTRACTION_CONCURRENCY;
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MEMORY_EXTRACTION_CONCURRENCY;
  return Math.max(1, Math.min(32, parsed));
}

export async function setMemoryExtractionConcurrency(value: number): Promise<void> {
  if (!Number.isFinite(value)) {
    throw new Error('Concurrency must be a finite number');
  }
  const clamped = Math.max(1, Math.min(32, Math.floor(value)));
  await writeSetting(KEY_MEMORY_EXTRACTION_CONCURRENCY, String(clamped));
}

/**
 * Read the per-instance memory extraction rate limits. Returns the
 * documented defaults (off, 20/hour, soft-start 0.7, soft-floor 0.7)
 * when the setting hasn't been written yet.
 */
export async function getMemoryExtractionLimits(): Promise<MemoryExtractionLimits> {
  const raw = await readSetting(KEY_MEMORY_EXTRACTION_LIMITS);
  if (raw === null) return DEFAULT_MEMORY_EXTRACTION_LIMITS;
  try {
    const parsed = JSON.parse(raw);
    return MemoryExtractionLimitsSchema.parse(parsed);
  } catch (error) {
    logger.warn('[InstanceSettings] memoryExtractionLimits failed to parse — using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_MEMORY_EXTRACTION_LIMITS;
  }
}

export async function setMemoryExtractionLimits(value: MemoryExtractionLimits): Promise<void> {
  const validated = MemoryExtractionLimitsSchema.parse(value);
  await writeSetting(KEY_MEMORY_EXTRACTION_LIMITS, JSON.stringify(validated));
}

export const InstanceSettingsKeys = {
  memoryExtractionConcurrency: KEY_MEMORY_EXTRACTION_CONCURRENCY,
  memoryExtractionLimits: KEY_MEMORY_EXTRACTION_LIMITS,
} as const;

// Re-export the schema for callers that want to validate independently.
export { MemoryExtractionLimitsSchema };
export type { MemoryExtractionLimits };
