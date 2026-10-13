/**
 * One typed read of every memory knob (memory refactor §3.1).
 *
 * Every memory setting lives in `instance_settings` — `memoryRecall`,
 * `memoryConsolidation`, `memoryExtractionMode`, `memoryExtractionLimits` and
 * `memoryMaintenance` — and is read here, in one call, with its defaults from
 * the schemas. `capFor` is the one per-character cap resolver (override →
 * `perCharacterCap` → the schema default); nothing else resolves a cap.
 *
 * Server-only (it reads the database). Client code takes its defaults from
 * `settings-defaults.ts`.
 *
 * @module memory/settings
 */

import {
  getMemoryConsolidationSettings,
  getMemoryExtractionLimits,
  getMemoryExtractionModeSettings,
  getMemoryMaintenanceSettings,
  getMemoryRecallSettings,
} from '@/lib/instance-settings'
import type {
  MemoryConsolidationSettings,
  MemoryExtractionLimits,
  MemoryExtractionModeSettings,
  MemoryMaintenanceSettings,
  MemoryRecallSettings,
} from '@/lib/schemas/settings.types'
import { logger } from '@/lib/logger'
import { ADMISSION_THRESHOLDS, MEMORY_SETTING_DEFAULTS, type AdmissionThresholds } from './settings-defaults'
import { DEFAULT_RECALL_TUNING } from './recall/tags'
import type { ResolvedRecallTuning } from './recall/tuning'
import { DEFAULT_MIN_COSINE_NEURAL, DEFAULT_MIN_COSINE_TFIDF } from './scoring'

export { ADMISSION_THRESHOLDS, MEMORY_SETTING_DEFAULTS, MEMORY_CAP_BOUNDS } from './settings-defaults'

export interface MemorySettings {
  extraction: { limits: MemoryExtractionLimits; mode: MemoryExtractionModeSettings }
  admission: AdmissionThresholds
  recall: MemoryRecallSettings & {
    tuning: ResolvedRecallTuning
    minCosine: { neural: number; tfidf: number }
  }
  maintenance: ResolvedMemoryMaintenance & {
    consolidation: MemoryConsolidationSettings
    coldRetentionDays: number | null
  }
}

/**
 * The cap for one character under `settings`: the per-character override when
 * there is one, else the global cap, else the schema default.
 */
export function resolveMemoryCap(
  settings: Pick<MemoryMaintenanceSettings, 'perCharacterCap' | 'perCharacterCapOverrides'> | null | undefined,
  characterId: string,
): number {
  return (
    settings?.perCharacterCapOverrides?.[characterId] ??
    settings?.perCharacterCap ??
    MEMORY_SETTING_DEFAULTS.maintenance.perCharacterCap
  )
}

/** The maintenance settings with the one cap resolver attached. */
export type ResolvedMemoryMaintenance = MemoryMaintenanceSettings & {
  /** The cap for one character: its override, else `perCharacterCap`. */
  capFor(characterId: string): number
}

function withCapFor(maintenance: MemoryMaintenanceSettings): ResolvedMemoryMaintenance {
  return { ...maintenance, capFor: (characterId: string) => resolveMemoryCap(maintenance, characterId) }
}

/**
 * Only the maintenance settings (one instance-setting read), for paths that
 * need nothing but the cap — housekeeping's preview, run and job. The same
 * `capFor` as {@link resolveMemorySettings}'s.
 */
export async function resolveMemoryMaintenance(): Promise<ResolvedMemoryMaintenance> {
  return withCapFor(await getMemoryMaintenanceSettings())
}

/**
 * Every memory knob, typed, with defaults filled. The memory settings are
 * instance-wide; `userId` is accepted so callers need not change when a knob
 * becomes per-user, and appears in the debug log.
 */
export async function resolveMemorySettings(userId?: string): Promise<MemorySettings> {
  const [limits, mode, recall, consolidation, maintenance] = await Promise.all([
    getMemoryExtractionLimits(),
    getMemoryExtractionModeSettings(),
    getMemoryRecallSettings(),
    getMemoryConsolidationSettings(),
    getMemoryMaintenanceSettings(),
  ])
  logger.debug('[MemorySettings] Resolved memory settings', {
    userId: userId ?? null,
    maintenanceEnabled: maintenance.enabled,
    perCharacterCap: maintenance.perCharacterCap,
    capOverrides: Object.keys(maintenance.perCharacterCapOverrides).length,
    consolidationEnabled: consolidation.enabled,
    otherPass: mode.otherPass,
  })
  return {
    extraction: { limits, mode },
    admission: ADMISSION_THRESHOLDS,
    recall: {
      ...recall,
      tuning: DEFAULT_RECALL_TUNING,
      minCosine: { neural: DEFAULT_MIN_COSINE_NEURAL, tfidf: DEFAULT_MIN_COSINE_TFIDF },
    },
    maintenance: {
      ...withCapFor(maintenance),
      consolidation,
      coldRetentionDays: consolidation.coldRetentionDays,
    },
  }
}
