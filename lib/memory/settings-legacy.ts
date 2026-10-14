/**
 * Translating the memory settings that lived on `chat_settings` before the
 * memory refactor's Phase A into their `instance_settings` form.
 *
 * Pure; shared by the migration that moves them and by the restore of a
 * backup written before it.
 *
 * @module memory/settings-legacy
 */

import {
  MEMORY_MAINTENANCE_CAP_MAX,
  MEMORY_MAINTENANCE_CAP_MIN,
  MemoryMaintenanceSettingsSchema,
} from '@/lib/schemas/settings.types'

const CAP_MIN = MEMORY_MAINTENANCE_CAP_MIN;
const CAP_MAX = MEMORY_MAINTENANCE_CAP_MAX;
const DEFAULT_CAP = MemoryMaintenanceSettingsSchema.parse({}).perCharacterCap;

/**
 * The `memoryMaintenance` value carried over from a legacy per-user
 * `chat_settings.autoHousekeepingSettings` (a JSON string or object): keeps
 * `enabled`, the cap and the overrides, clamps every cap into the bounds the
 * schema enforces, and drops the retired merge knobs. Null for anything that
 * is not an object. Used by `move-memory-maintenance-settings-v1` and by the
 * restore of a backup written before it.
 */
export function legacyHousekeepingToMaintenance(raw: unknown): {
  enabled: boolean;
  perCharacterCap: number;
  perCharacterCapOverrides: Record<string, number>;
} | null {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const clampCap = (n: unknown): number | null => {
    const num = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(num)) return null;
    return Math.min(CAP_MAX, Math.max(CAP_MIN, Math.floor(num)));
  };
  const overrides: Record<string, number> = {};
  if (v.perCharacterCapOverrides && typeof v.perCharacterCapOverrides === 'object') {
    for (const [characterId, cap] of Object.entries(v.perCharacterCapOverrides as Record<string, unknown>)) {
      const clamped = clampCap(cap);
      if (clamped !== null) overrides[characterId] = clamped;
    }
  }
  return {
    enabled: v.enabled === true,
    perCharacterCap: clampCap(v.perCharacterCap) ?? DEFAULT_CAP,
    perCharacterCapOverrides: overrides,
  };
}


/** Instance-settings keys a backup may carry that nothing reads any more. */
const DEAD_INSTANCE_SETTING_KEYS: ReadonlySet<string> = new Set(['memoryExtractionConcurrency'])

const SINGLE_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

/**
 * The instance-settings rows to restore from a backup, with the memory
 * settings brought forward: a backup written before Phase A carries the
 * maintenance settings on its chat-settings row (`autoHousekeepingSettings`)
 * and no `memoryMaintenance` key, so the key is derived from that row (the
 * single user's, else the first that has one). A backup that already carries
 * the key keeps its own. Dead keys are left out.
 */
export function withMemoryMaintenanceFromLegacy(
  instanceSettings: ReadonlyArray<{ key: string; value: string }>,
  chatSettings: ReadonlyArray<unknown>,
): Array<{ key: string; value: string }> {
  const rows = instanceSettings.filter(row => !DEAD_INSTANCE_SETTING_KEYS.has(row.key))
  if (rows.some(row => row.key === 'memoryMaintenance')) return rows
  const candidates = chatSettings.filter(
    (s): s is { userId?: string; autoHousekeepingSettings?: unknown } =>
      !!s && typeof s === 'object' && 'autoHousekeepingSettings' in s,
  )
  const source = candidates.find(s => s.userId === SINGLE_USER_ID) ?? candidates[0]
  const maintenance = source ? legacyHousekeepingToMaintenance(source.autoHousekeepingSettings) : null
  if (!maintenance) return rows
  return [...rows, { key: 'memoryMaintenance', value: JSON.stringify(maintenance) }]
}
