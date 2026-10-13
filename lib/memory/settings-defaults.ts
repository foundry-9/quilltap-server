/**
 * Every memory setting's default, in one client-safe module.
 *
 * The values come from the Zod schemas' `.default()`s (`lib/schemas/settings.types.ts`)
 * — this module only parses them once — plus the admission thresholds, which
 * are not user-settable and live here so there is one place to read them.
 * Imports nothing but schemas, so the settings cards can import it directly.
 *
 * @module memory/settings-defaults
 */

import {
  MemoryConsolidationSettingsSchema,
  MemoryExtractionLimitsSchema,
  MemoryExtractionModeSettingsSchema,
  MemoryMaintenanceSettingsSchema,
  MemoryRecallSettingsSchema,
  MEMORY_MAINTENANCE_CAP_MIN,
  MEMORY_MAINTENANCE_CAP_MAX,
} from '@/lib/schemas/settings.types'
import { MAX_REINFORCEMENT_FOOTNOTES } from './reinforcement-footnotes'

/**
 * Admission thresholds: the cosines at which a candidate is absorbed as a
 * near-duplicate, reinforces an existing row, or is linked to it, plus the
 * date guard (two rows more than this many days apart are different
 * occasions) and the footnote cap.
 */
export const ADMISSION_THRESHOLDS = Object.freeze({
  nearDuplicate: 0.90,
  reinforce: 0.85,
  related: 0.70,
  dateGuardDays: 7,
  footnoteCap: MAX_REINFORCEMENT_FOOTNOTES,
} as const)

export type AdmissionThresholds = typeof ADMISSION_THRESHOLDS

/** The default value of every memory setting. */
export const MEMORY_SETTING_DEFAULTS = Object.freeze({
  maintenance: MemoryMaintenanceSettingsSchema.parse({}),
  consolidation: MemoryConsolidationSettingsSchema.parse({}),
  recall: MemoryRecallSettingsSchema.parse({}),
  extractionMode: MemoryExtractionModeSettingsSchema.parse({}),
  extractionLimits: MemoryExtractionLimitsSchema.parse({}),
  admission: ADMISSION_THRESHOLDS,
})

/** The bounds every per-character cap is validated against (schema, API and card alike). */
export const MEMORY_CAP_BOUNDS = Object.freeze({ min: MEMORY_MAINTENANCE_CAP_MIN, max: MEMORY_MAINTENANCE_CAP_MAX })
